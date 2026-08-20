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
});
