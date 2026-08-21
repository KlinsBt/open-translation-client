import { describe, expect, it, vi } from "vitest";
import { createPersistedEditQueue } from "./persistedEditQueue";

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("lifecycle-safe persisted edit queue", () => {
	it("starts immediately and coalesces overlapping edits to the final snapshot", async () => {
		const first = deferred();
		const writes: Array<{ text: string }> = [];
		const persist = vi.fn(async (value: { text: string }) => {
			writes.push(value);
			if (writes.length === 1) await first.promise;
		});
		const queue = createPersistedEditQueue({ text: "old" }, persist);

		void queue.schedule({ text: "a" });
		void queue.schedule({ text: "ab" });
		void queue.schedule({ text: "final" });
		expect(writes).toEqual([{ text: "a" }]);
		first.resolve();
		await queue.whenIdle();

		expect(writes).toEqual([{ text: "a" }, { text: "final" }]);
		expect(queue.committedSnapshot()).toEqual({ text: "final" });
	});

	it("debounces the rest of a rapid burst after a fast initial write", async () => {
		const writes: Array<{ text: string }> = [];
		const queue = createPersistedEditQueue(
			{ text: "old" },
			async (value) => {
				writes.push(value);
			},
			{},
			{ debounceMs: 10_000 },
		);

		void queue.schedule({ text: "a" });
		await Promise.resolve();
		await Promise.resolve();
		expect(writes).toEqual([{ text: "a" }]);

		void queue.schedule({ text: "ab" });
		void queue.schedule({ text: "final" });
		await Promise.resolve();
		expect(writes).toEqual([{ text: "a" }]);

		await queue.flush();
		expect(writes).toEqual([{ text: "a" }, { text: "final" }]);
		expect(queue.committedSnapshot()).toEqual({ text: "final" });
	});

	it("flush waits for an already-running final write", async () => {
		const write = deferred();
		const queue = createPersistedEditQueue({ text: "old" }, async () => {
			await write.promise;
		});
		void queue.schedule({ text: "final" });
		let flushed = false;
		const flush = queue.flush().then(() => (flushed = true));
		await Promise.resolve();
		expect(flushed).toBe(false);
		write.resolve();
		await flush;
		expect(flushed).toBe(true);
	});

	it("rolls back exactly and drops dependent pending edits after failure", async () => {
		const first = deferred();
		const failures: Array<{ error: unknown; committed: { text: string } }> = [];
		const queue = createPersistedEditQueue(
			{ text: "persisted" },
			async () => first.promise,
			{
				onFailure(error, committed) {
					failures.push({ error, committed });
				},
			},
		);
		void queue.schedule({ text: "first optimistic edit" });
		void queue.schedule({ text: "dependent edit" });
		first.reject(new DOMException("abort", "AbortError"));
		await queue.whenIdle();

		expect(failures).toHaveLength(1);
		expect(failures[0].committed).toEqual({ text: "persisted" });
		expect(queue.committedSnapshot()).toEqual({ text: "persisted" });
	});

	it("adopts successful non-editor mutations as the rollback baseline", async () => {
		const failure = new DOMException("quota", "QuotaExceededError");
		const rollbacks: Array<{ text: string; locked: boolean }> = [];
		const queue = createPersistedEditQueue(
			{ text: "old", locked: false },
			async () => {
				throw failure;
			},
			{ onFailure: (_error, committed) => rollbacks.push(committed) },
		);
		queue.markCommitted({ text: "old", locked: true });
		await queue.schedule({ text: "new", locked: true });
		expect(rollbacks).toEqual([{ text: "old", locked: true }]);
	});

	it("defers expensive snapshots until a coalesced write starts", async () => {
		const first = deferred();
		const live = { text: "" };
		const snapshots: string[] = [];
		const writes: string[] = [];
		const queue = createPersistedEditQueue(
			{ text: "persisted" },
			async (value) => {
				writes.push(value.text);
				if (writes.length === 1) await first.promise;
			},
			{},
			{
				cloneScheduled: (value) => value,
				cloneForPersistence: (value) => {
					snapshots.push(value.text);
					return structuredClone(value);
				},
			},
		);

		live.text = "a";
		void queue.schedule(live);
		live.text = "ab";
		void queue.schedule(live);
		live.text = "final";
		void queue.schedule(live);
		expect(snapshots).toEqual(["a"]);
		first.resolve();
		await queue.whenIdle();

		expect(snapshots).toEqual(["a", "final"]);
		expect(writes).toEqual(["a", "final"]);
	});

	it("reconciles generated revisions into the scheduled live value", async () => {
		const live = { text: "draft", revision: 1 };
		const queue = createPersistedEditQueue<{
			text: string;
			revision: number;
		}>(
			{ text: "old", revision: 1 },
			async (value) => {
				value.revision += 1;
			},
			{},
			{
				cloneScheduled: (value) => value,
				cloneForPersistence: structuredClone,
				onPersisted: (scheduled, persisted) => {
					scheduled.revision = persisted.revision;
				},
			},
		);
		await queue.schedule(live);
		expect(live.revision).toBe(2);
	});

	it("advances a dependent pending snapshot to the committed revision", async () => {
		const first = deferred();
		const initial = { text: "old", revision: 1 };
		const optimistic = { text: "first", revision: 1 };
		const dependent = { text: "confirmed", revision: 1 };
		let writes = 0;
		const queue = createPersistedEditQueue<{
			text: string;
			revision: number;
		}>(
			initial,
			async (value) => {
				writes += 1;
				if (writes === 1) await first.promise;
				value.revision += 1;
			},
			{},
			{
				cloneScheduled: (value) => value,
				cloneForPersistence: structuredClone,
				onPersisted: (scheduled, persisted) => {
					scheduled.revision = persisted.revision;
				},
			},
		);
		void queue.schedule(optimistic);
		void queue.schedule(dependent);
		first.resolve();
		await queue.whenIdle();
		expect(dependent.revision).toBe(3);
		expect(queue.committedSnapshot()).toEqual({
			text: "confirmed",
			revision: 3,
		});
	});
});
