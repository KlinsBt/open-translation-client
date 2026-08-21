import { describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	calcPercentageOfTotalSegmentsChecked,
	getProjectsProgressStatistics,
	getTotalWordCount,
	getWordsAmountFromFullText,
} from "./statistics";
import {
	sortUserDataByDateAscending,
	sortUserDataByDateDescending,
	sortUserDataByNameAscending,
	sortUserDataByNameDescending,
} from "./sorting";
import {
	getTranslationMemoryMatches,
	searchForMatches,
	translationUnitValidationError,
} from "../components/translationMemory/tmFunctions";
import { getTermMatches } from "../components/termBase/tbFunctions";
import {
	tbDataValidationError,
	tmDataValidationError,
} from "../components/resources/resourceDataValidation";

describe("statistics", () => {
	it("handles empty and partial completion", () => {
		expect(calcPercentageOfTotalSegmentsChecked([])).toBe(0);
		expect(calcPercentageOfTotalSegmentsChecked([true, false, true])).toBe(67);
	});

	it("does not count a rounded 99.5 percent project as finished", () => {
		const checked = Array.from({ length: 200 }, (_, index) => index !== 199);
		const project = makeUserData({
			seg1: checked.map(() => "word"),
			seg2: checked.map(() => "Wort"),
			checked,
		});
		expect(calcPercentageOfTotalSegmentsChecked(checked)).toBe(99);
		expect(getProjectsProgressStatistics([project])[1]).toBe(0);
		checked[199] = true;
		expect(getProjectsProgressStatistics([project])[1]).toBe(1);
	});

	it("counts whitespace-separated words consistently", async () => {
		expect(await getWordsAmountFromFullText("  one\n two\tthree ")).toBe(3);
		expect(await getWordsAmountFromFullText("   ")).toBe(0);
		expect(getTotalWordCount(["one two", "three\nfour", ""])).toBe(4);
	});

	it("uses Unicode word boundaries for languages without spaces", async () => {
		expect(await getWordsAmountFromFullText("你好世界")).toBe(2);
		expect(getTotalWordCount(["こんにちは世界", "ภาษาไทย"])).toBe(4);
	});

	it("aggregates project progress and word counts", () => {
		const projects = [
			makeUserData({ seg1: ["one two"], seg2: ["eins zwei"], checked: [true] }),
			makeUserData({ seg1: ["three"], seg2: [""], checked: [false] }),
		];
		expect(getProjectsProgressStatistics(projects)).toEqual([50, 1, 3, 2]);
	});
});

describe("translation-memory entry validation", () => {
	it("requires complete text and language metadata before adding a unit", () => {
		expect(translationUnitValidationError("", "Hallo", "en", "de")).toMatch(
			/source segment is empty/i,
		);
		expect(translationUnitValidationError("Hello", "  ", "en", "de")).toMatch(
			/target translation/i,
		);
		expect(translationUnitValidationError("Hello", "Hallo", "", "de")).toMatch(
			/valid source and target languages/i,
		);
		expect(
			translationUnitValidationError("Hello", "Hallo", "en", "de"),
		).toBeUndefined();
	});

	it("allows empty resource libraries but rejects every incomplete stored record", () => {
		expect(
			tmDataValidationError({ name: "Empty TM", terms: [] }),
		).toBeUndefined();
		expect(
			tmDataValidationError({
				terms: [
					{
						source: { lang: "en", segment: "Source" },
						target: [],
					},
				],
			}),
		).toMatch(/at least one target/i);
		expect(
			tmDataValidationError({
				terms: [
					{
						source: { lang: "en", segment: " \n " },
						target: [{ lang: "ar", segment: "هدف" }],
					},
				],
			}),
		).toMatch(/source text/i);

		expect(
			tbDataValidationError({ name: "Empty TB", entries: [] }),
		).toBeUndefined();
		expect(
			tbDataValidationError({
				entries: [{ terms: [{ lang: "", term: "مصطلح", notes: [] }] }],
			}),
		).toMatch(/needs a language/i);
		expect(
			tbDataValidationError({
				entries: [
					{
						terms: [
							{ lang: "ar", term: "مصطلح", notes: [{ type: "", text: " " }] },
						],
					},
				],
			}),
		).toMatch(/note text or remove/i);
	});
});

describe("sorting", () => {
	const projects = () => [
		makeUserData({ name: "Zulu", creationDate: "20" }),
		makeUserData({ name: "Alpha", creationDate: "10" }),
	];

	it("sorts by date in both directions", () => {
		expect(
			sortUserDataByDateAscending(projects())[0].translationData.creationDate,
		).toBe("10");
		expect(
			sortUserDataByDateDescending(projects())[0].translationData.creationDate,
		).toBe("20");
	});

	it("sorts by name in both directions", () => {
		expect(
			sortUserDataByNameAscending(projects())[0].translationData.name,
		).toBe("Alpha");
		expect(
			sortUserDataByNameDescending(projects())[0].translationData.name,
		).toBe("Zulu");
	});
});

describe("translation matches", () => {
	it("ranks translation-memory matches by similarity", () => {
		const matches = getTranslationMemoryMatches(
			["hello world", "hello"],
			["hallo welt", "hallo"],
			"hello world",
			40,
		);
		expect(matches[0]).toEqual({
			segment: "hello world",
			match: "hallo welt",
			percentage: "100.00%",
		});
	});

	it("filters a TM by source and target language", () => {
		const matches = searchForMatches(
			{
				terms: [
					{
						source: { lang: "en", segment: "Save file" },
						target: [
							{ lang: "de", segment: "Datei speichern" },
							{ lang: "fr", segment: "Enregistrer" },
						],
					},
				],
			},
			"Save file",
			"en",
			"de",
		);
		expect(matches).toHaveLength(1);
		expect(matches[0].match).toBe("Datei speichern");
	});

	it("normalizes structured terminology notes for display", () => {
		const matches = getTermMatches(
			{
				entries: [
					{
						terms: [
							{ lang: "en", term: "file", notes: [] },
							{
								lang: "de",
								term: "Datei",
								notes: [{ type: "usage", text: "Computing" }],
							},
						],
					},
				],
			},
			"Open the file",
			"en",
			"de",
		);
		expect(matches).toEqual([
			{ searchEntry: "file", foundEntry: "Datei", notes: ["usage: Computing"] },
		]);
	});
});
