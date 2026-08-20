import { describe, expect, it, vi } from "vitest";
import { commitPersistedMutation } from "./persistenceContract";

describe("persistence mutation contract", () => {
	it("publishes an isolated value only after persistence succeeds", async () => {
		const current = { nested: { name: "before" } };
		const persist = vi.fn(async (candidate: typeof current) => {
			expect(candidate.nested.name).toBe("after");
			expect(current.nested.name).toBe("before");
		});

		const committed = await commitPersistedMutation(
			current,
			(candidate) => (candidate.nested.name = "after"),
			persist,
		);

		expect(committed).toEqual({ nested: { name: "after" } });
		expect(current).toEqual({ nested: { name: "before" } });
	});

	it.each([
		new DOMException("quota", "QuotaExceededError"),
		new DOMException("aborted", "AbortError"),
	])(
		"retains the exact prior snapshot when persistence rejects",
		async (error) => {
			const current = { values: ["one", "two"], enabled: false };
			const before = structuredClone(current);

			await expect(
				commitPersistedMutation(
					current,
					(candidate) => {
						candidate.values.splice(0, 1);
						candidate.enabled = true;
					},
					async () => {
						throw error;
					},
				),
			).rejects.toBe(error);
			expect(current).toEqual(before);
		},
	);
});
