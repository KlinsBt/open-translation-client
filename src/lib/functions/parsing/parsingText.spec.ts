import { describe, expect, it } from "vitest";
import {
	createTextSegmentsByArrayFilters,
	createTextSegmentsSimple,
	createTextSegmentsWithRegexGeneralTextAlgo,
	createTextSegmentsWithRegexSimple,
} from "./parsingText";

describe("text parsing", () => {
	it("segments general text and creates aligned target/check arrays", () => {
		expect(createTextSegmentsWithRegexGeneralTextAlgo("Hello. Next! ")).toEqual(
			[
				["Hello. ", "Next!"],
				["", ""],
				[false, false],
			],
		);
	});

	it("preserves a trailing sentence without punctuation", async () => {
		expect(await createTextSegmentsSimple("First. Last")).toEqual([
			["First. ", "Last"],
			["", ""],
			[false, false],
		]);
	});

	it("does not split ordinary text into individual characters", async () => {
		const [source, target, checked] = await createTextSegmentsByArrayFilters(
			"A complete sentence",
		);
		expect(source).toEqual(["A complete sentence"]);
		expect(target).toEqual([""]);
		expect(checked).toEqual([false]);
	});

	it("filters a trailing empty segment in the simple regex parser", async () => {
		expect(await createTextSegmentsWithRegexSimple("Done.")).toEqual([
			["Done."],
			[""],
			[false],
		]);
	});

	it("returns aligned empty arrays for blank input", () => {
		expect(createTextSegmentsWithRegexGeneralTextAlgo("  \n\n ")).toEqual([
			[],
			[],
			[],
		]);
	});
});
