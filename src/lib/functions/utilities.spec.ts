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
} from "../components/translationMemory/tmFunctions";
import { getTermMatches } from "../components/termBase/tbFunctions";

describe("statistics", () => {
	it("handles empty and partial completion", () => {
		expect(calcPercentageOfTotalSegmentsChecked([])).toBe(0);
		expect(calcPercentageOfTotalSegmentsChecked([true, false, true])).toBe(67);
	});

	it("counts whitespace-separated words consistently", async () => {
		expect(await getWordsAmountFromFullText("  one\n two\tthree ")).toBe(3);
		expect(await getWordsAmountFromFullText("   ")).toBe(0);
		expect(getTotalWordCount(["one two", "three\nfour", ""])).toBe(4);
	});

	it("aggregates project progress and word counts", () => {
		const projects = [
			makeUserData({ seg1: ["one two"], seg2: ["eins zwei"], checked: [true] }),
			makeUserData({ seg1: ["three"], seg2: [""], checked: [false] }),
		];
		expect(getProjectsProgressStatistics(projects)).toEqual([50, 1, 3, 2]);
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
