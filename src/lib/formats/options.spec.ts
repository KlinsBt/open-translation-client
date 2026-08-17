import { describe, expect, it } from "vitest";
import {
	columnFromCellReference,
	matchesJsonSelector,
	normalizeImportOptions,
	parseColumns,
	parseList,
	parsePositiveRanges,
} from "./options";

describe("format import options", () => {
	it("normalizes defaults, coercions, and unknown values", () => {
		expect(
			normalizeImportOptions("json", {
				includeNonStringValues: "false",
				unknown: "ignored",
			}),
		).toEqual({
			profile: "auto",
			pathSelectors: "",
			includeNonStringValues: false,
			segmentationMode: "value",
			keyField: "",
			contextField: "",
		});
		expect(
			normalizeImportOptions("text", { segmentationMode: "invalid" }),
		).toEqual({
			segmentationMode: "preferences",
			outputEncoding: "source",
			byteOrderMark: "preserve",
			unicodeNormalization: "preserve",
		});
		expect(
			normalizeImportOptions("xlsx", {
				importMode: "invalid",
				headerRows: "2",
				includeCellComments: "false",
			}),
		).toMatchObject({
			importMode: "all-text",
			headerRows: 2,
			includeCellComments: false,
			keyColumn: "A",
			sourceColumn: "B",
			targetColumn: "C",
		});
	});

	it("parses lists, paragraph ranges, and spreadsheet columns", () => {
		expect(parseList("one, two\nthree")).toEqual(["one", "two", "three"]);
		expect([...parsePositiveRanges("1-3, 6")!]).toEqual([1, 2, 3, 6]);
		expect([...parseColumns("A, C-E")!]).toEqual([1, 3, 4, 5]);
		expect(columnFromCellReference("AA42")).toBe(27);
		expect(parsePositiveRanges("all")).toBeNull();
		expect(parseColumns("")).toBeNull();
	});

	it("matches exact, single-level, and recursive JSON selectors", () => {
		expect(matchesJsonSelector(["messages", "title"], ["messages.*"])).toBe(
			true,
		);
		expect(
			matchesJsonSelector(["messages", "nested", "title"], ["messages.*"]),
		).toBe(false);
		expect(
			matchesJsonSelector(["messages", "nested", "title"], ["$.messages.**"]),
		).toBe(true);
		expect(matchesJsonSelector(["ignored"], ["messages.**"])).toBe(false);
		expect(matchesJsonSelector(["anything"], [])).toBe(true);
	});
});
