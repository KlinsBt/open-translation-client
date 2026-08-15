import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../test/fixtures";
import {
	combineSegmentData,
	findSplitPoint,
	splitSegmentData,
} from "./segmentationLogic";

describe("segment editing", () => {
	it("splits source, target, checked state, and JSON metadata together", () => {
		const data = makeUserData({
			seg1: ["Hello world"],
			seg2: ["Hallo Welt"],
			checked: [true],
			segmentsMeta: [{ path: ["message"], separator: " " }],
		}).translationData;
		const result = splitSegmentData(data, 0, 6).data;

		expect(result.seg1).toEqual(["Hello ", "world"]);
		expect(result.seg2).toEqual(["Hallo ", "Welt"]);
		expect(result.checked).toEqual([false, false]);
		expect(result.segmentsMeta).toEqual([
			{ path: ["message"], separator: " " },
			{ path: ["message"], separator: "" },
		]);
	});

	it("combines adjacent segments and preserves checked semantics", () => {
		const data = makeUserData({
			seg1: ["One ", "two"],
			seg2: ["Eins ", "zwei"],
			checked: [true, false],
		}).translationData;
		const result = combineSegmentData(data, 0);

		expect(result.error).toBeUndefined();
		expect(result.data.seg1).toEqual(["One two"]);
		expect(result.data.seg2).toEqual(["Eins zwei"]);
		expect(result.data.checked).toEqual([false]);
	});

	it("rejects combining different JSON fields without mutating input", () => {
		const data = makeUserData({
			seg1: ["One", "Two"],
			seg2: ["Eins", "Zwei"],
			checked: [false, false],
			segmentsMeta: [{ path: ["one"] }, { path: ["two"] }],
		}).translationData;
		const result = combineSegmentData(data, 0);

		expect(result.error).toMatch(/different JSON fields/);
		expect(result.data).toBe(data);
		expect(data.seg1).toEqual(["One", "Two"]);
	});

	it("rejects invalid combine indices", () => {
		const data = makeUserData().translationData;
		expect(combineSegmentData(data, -1).error).toBe("Invalid index");
		expect(combineSegmentData(data, 0).error).toBe("Invalid index");
	});

	it("finds a readable split point near the middle", () => {
		expect(findSplitPoint("alpha beta gamma")).toBe(11);
		expect(findSplitPoint("ab")).toBe(1);
		expect(findSplitPoint("")).toBe(1);
	});
});
