export interface PersistedEditQueueHandlers<T> {
	onFailure?: (error: unknown, committed: T) => void;
	onCommit?: (committed: T) => void;
}

export interface PersistedEditQueueOptions {
	debounceMs?: number;
}

export interface PersistedEditQueue<T> {
	schedule(value: T): Promise<void>;
	flush(): Promise<void>;
	whenIdle(): Promise<void>;
	markCommitted(value: T): void;
	committedSnapshot(): T;
}

/**
 * Starts the first save immediately, then debounces the remainder of the input
 * burst into a trailing final snapshot. The queue is independent of component
 * lifetime, so destroying a route does not cancel its outstanding transaction.
 */
export function createPersistedEditQueue<T>(
	initial: T,
	persist: (value: T) => Promise<void>,
	handlers: PersistedEditQueueHandlers<T> = {},
	options: PersistedEditQueueOptions = {},
): PersistedEditQueue<T> {
	const debounceMs = Math.max(0, options.debounceMs ?? 250);
	let committed = structuredClone(initial);
	let pending: T | null = null;
	let running: Promise<void> | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let burstOpen = false;
	let forceDrain = false;
	let timerElapsed = false;
	let idleWaiters: Array<() => void> = [];

	function clearTimer() {
		if (timer !== null) clearTimeout(timer);
		timer = null;
	}

	function resolveIdle() {
		if (running || pending !== null || timer !== null || burstOpen) return;
		const waiters = idleWaiters;
		idleWaiters = [];
		for (const resolve of waiters) resolve();
	}

	function waitForIdle(): Promise<void> {
		if (!running && pending === null && timer === null && !burstOpen)
			return Promise.resolve();
		return new Promise((resolve) => {
			idleWaiters.push(resolve);
		});
	}

	function closeBurst() {
		clearTimer();
		forceDrain = false;
		timerElapsed = false;
		burstOpen = false;
		resolveIdle();
	}

	function armDebounce() {
		clearTimer();
		timer = setTimeout(() => {
			timer = null;
			if (running) {
				timerElapsed = true;
				return;
			}
			if (pending !== null) startDrain();
			else closeBurst();
		}, debounceMs);
	}

	function startDrain(): Promise<void> {
		if (running) return running;
		if (pending === null) return Promise.resolve();
		const candidate = pending;
		pending = null;
		let failed = false;
		running = (async () => {
			try {
				await persist(structuredClone(candidate));
				committed = structuredClone(candidate);
				handlers.onCommit?.(structuredClone(committed));
			} catch (error) {
				failed = true;
				// A newer candidate is based on an optimistic state that did not commit,
				// so it cannot safely be persisted. Restore the exact last good snapshot.
				pending = null;
				handlers.onFailure?.(error, structuredClone(committed));
			}
		})().finally(() => {
			running = null;
			if (failed) {
				closeBurst();
				return;
			}
			if (pending !== null) {
				if (forceDrain || timerElapsed) {
					timerElapsed = false;
					clearTimer();
					void startDrain();
				} else if (timer === null) {
					armDebounce();
				}
				return;
			}
			if (forceDrain) closeBurst();
			else armDebounce();
		});
		return running;
	}

	async function flush(): Promise<void> {
		forceDrain = true;
		timerElapsed = false;
		clearTimer();
		if (!running && pending !== null) void startDrain();
		else if (!running) closeBurst();
		await waitForIdle();
	}

	return {
		schedule(value) {
			pending = structuredClone(value);
			if (!burstOpen) {
				burstOpen = true;
				void startDrain();
			} else {
				armDebounce();
			}
			return waitForIdle();
		},
		flush,
		whenIdle: waitForIdle,
		markCommitted(value) {
			committed = structuredClone(value);
		},
		committedSnapshot() {
			return structuredClone(committed);
		},
	};
}
