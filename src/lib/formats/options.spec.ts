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
			normalizeImportOptions("yaml", {
				includeNonStringScalars: "true",
				segmentationMode: "invalid",
			}),
		).toEqual({
			pathSelectors: "",
			includeNonStringScalars: true,
			segmentationMode: "value",
		});
		expect(
			normalizeImportOptions("po", {
				includeFuzzy: "false",
				includeObsolete: "true",
			}),
		).toEqual({
			includeFuzzy: false,
			includeObsolete: true,
			segmentationMode: "value",
		});
		expect(
			normalizeImportOptions("android", {
				includeNonTranslatable: "true",
			}),
		).toEqual({ includeNonTranslatable: true, includeEmpty: false });
		expect(normalizeImportOptions("apple", { includeStale: "false" })).toEqual({
			profile: "auto",
			sourceLanguage: "",
			targetLanguage: "",
			includeStale: false,
		});
		expect(
			normalizeImportOptions("properties", { includeEmpty: "true" }),
		).toEqual({ sourceEncoding: "auto", includeEmpty: true });
		expect(
			normalizeImportOptions("resx", {
				includeExplicitSystemStrings: "false",
			}),
		).toEqual({ includeEmpty: false, includeExplicitSystemStrings: false });
		expect(
			normalizeImportOptions("qt-ts", { includeObsolete: "true" }),
		).toEqual({
			includeUnfinished: true,
			includeVanished: false,
			includeObsolete: true,
		});
		expect(normalizeImportOptions("ini", { includeEmpty: "true" })).toEqual({
			profile: "auto",
			keySelectors: "",
			targetLocale: "",
			includeEmpty: true,
		});
		expect(normalizeImportOptions("php", { includeEmpty: "true" })).toEqual({
			pathSelectors: "",
			includeEmpty: true,
		});
		expect(normalizeImportOptions("markup", { profile: "invalid" })).toEqual({
			profile: "auto",
			includeHtmlText: true,
		});
		expect(
			normalizeImportOptions("subtitles", { overlapPolicy: "invalid" }),
		).toEqual({
			profile: "auto",
			overlapPolicy: "warn",
			maxCharactersPerLine: 42,
			maxLinesPerCue: 2,
			maxReadingSpeed: 20,
			maxExpansionPercent: 50,
		});
		expect(normalizeImportOptions("odf", { includeNotes: "false" })).toEqual({
			trackedChanges: "final",
			includeNotes: false,
			includeComments: false,
			includeHeadersFooters: true,
			includeAccessibilityText: true,
		});
		expect(normalizeImportOptions("epub", { contentScope: "invalid" })).toEqual(
			{
				contentScope: "spine",
				includeNavigation: true,
				includeMetadata: true,
				includeSvgText: true,
				includeAccessibilityText: true,
			},
		);
		expect(
			normalizeImportOptions("svg", { includeHiddenText: "true" }),
		).toEqual({
			elementSelectors: "text,tspan,textPath,title,desc",
			attributeSelectors: "aria-label,aria-description,title",
			includeHiddenText: true,
			includeMetadata: false,
			respectTranslateMetadata: true,
			segmentationMode: "value",
		});
		expect(normalizeImportOptions("dita", { contentScope: "invalid" })).toEqual(
			{
				contentScope: "map",
				includeNavigation: true,
				includeMetadata: false,
				includeCode: false,
				attributeSelectors: "alt,title,navtitle",
				respectTranslateMetadata: true,
				segmentationMode: "value",
			},
		);
		expect(normalizeImportOptions("docbook", { includeCode: "true" })).toEqual({
			includeMetadata: true,
			includeCode: true,
			includeIndexTerms: false,
			attributeSelectors: "alt,title",
			respectTranslateMetadata: true,
			segmentationMode: "value",
		});
		expect(normalizeImportOptions("xml", { respectIts: "false" })).toEqual({
			elementSelectors: "//*",
			attributeSelectors: "",
			respectIts: false,
			includeCdata: true,
			segmentationMode: "value",
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
