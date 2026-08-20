import { get } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";
import { showLoading } from "./saveData/stores.svelte";
import {
	activeLoadingOperations,
	beginLoading,
	withLoading,
} from "./uiHelpers";

afterEach(() => {
	const active = activeLoadingOperations();
	showLoading.set(false);
	if (active !== 0)
		throw new Error("A loading operation leaked from its test.");
});

describe("reference-counted loading state", () => {
	it("always clears after an exception", async () => {
		await expect(
			withLoading(async () => {
				throw new Error("read failed");
			}),
		).rejects.toThrow("read failed");
		expect(get(showLoading)).toBe(false);
		expect(activeLoadingOperations()).toBe(0);
	});

	it("does not clear while a nested operation remains active", async () => {
		const endOuter = beginLoading();
		const endInner = beginLoading();
		expect(get(showLoading)).toBe(true);
		endOuter();
		expect(get(showLoading)).toBe(true);
		endInner();
		expect(get(showLoading)).toBe(false);
	});
});
