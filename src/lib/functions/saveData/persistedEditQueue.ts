export interface PersistedEditQueueHandlers<T> {
	onFailure?: (error: unknown, committed: T) => void;
	onCommit?: (committed: T) => void;
}

export interface PersistedEditQueue<T> {
	schedule(value: T): Promise<void>;
	flush(): Promise<void>;
	whenIdle(): Promise<void>;
	markCommitted(value: T): void;
	committedSnapshot(): T;
}

/**
 * Starts the first save immediately and coalesces edits made while that write is
 * in flight into one final snapshot. The queue is independent of component
 * lifetime, so destroying a route does not cancel its outstanding transaction.
 */
export function createPersistedEditQueue<T>(
	initial: T,
	persist: (value: T) => Promise<void>,
	handlers: PersistedEditQueueHandlers<T> = {},
): PersistedEditQueue<T> {
	let committed = structuredClone(initial);
	let pending: T | null = null;
	let running: Promise<void> | null = null;

	async function drain(): Promise<void> {
		while (pending !== null) {
			const candidate = pending;
			pending = null;
			try {
				await persist(structuredClone(candidate));
				committed = structuredClone(candidate);
				handlers.onCommit?.(structuredClone(committed));
			} catch (error) {
				// A newer candidate is based on an optimistic state that did not commit,
				// so it cannot safely be persisted. Restore the exact last good snapshot.
				pending = null;
				handlers.onFailure?.(error, structuredClone(committed));
			}
		}
	}

	function startDrain(): Promise<void> {
		if (running) return running;
		const operation = drain();
		running = operation.finally(() => {
			running = null;
			if (pending !== null) void startDrain();
		});
		return running;
	}

	async function whenIdle(): Promise<void> {
		while (running || pending !== null) {
			if (pending !== null) startDrain();
			if (running) await running;
		}
	}

	return {
		schedule(value) {
			pending = structuredClone(value);
			startDrain();
			return whenIdle();
		},
		flush: whenIdle,
		whenIdle,
		markCommitted(value) {
			committed = structuredClone(value);
		},
		committedSnapshot() {
			return structuredClone(committed);
		},
	};
}
