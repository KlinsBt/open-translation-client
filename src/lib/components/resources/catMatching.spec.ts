import { describe, expect, it } from "vitest";
import {
	getTranslationMemoryMatches,
	normalizeForMatch,
} from "$lib/components/translationMemory/tmFunctions";
import {
	containsWholeTerm,
	getTermMatches,
} from "$lib/components/termBase/tbFunctions";

describe("CAT resource matching", () => {
	it("normalizes Unicode, case, and whitespace for TM matches", () => {
		expect(normalizeForMatch("  CAFÉ\nTest  ")).toBe("café test");
		expect(
			getTranslationMemoryMatches(
				["Café   Test"],
				["اختبار"],
				"cafe\u0301 test",
				90,
			),
		).toMatchObject([{ match: "اختبار", percentage: "100.00%" }]);
	});

	it("caps results and handles long inputs without a quadratic matrix", () => {
		const source = "word ".repeat(1_000);
		const matches = getTranslationMemoryMatches(
			Array.from({ length: 100 }, () => source),
			Array.from({ length: 100 }, (_, index) => `target ${index}`),
			source,
			55,
		);
		expect(matches).toHaveLength(50);
	});

	it("matches Unicode terms at word boundaries, not inside other words", () => {
		expect(containsWholeTerm("The cat sleeps", "cat")).toBe(true);
		expect(containsWholeTerm("concatenate", "cat")).toBe(false);
		expect(containsWholeTerm("هذا كتاب عربي", "كتاب")).toBe(true);
		const matches = getTermMatches(
			{
				name: "terms",
				entries: [
					{
						terms: [
							{ lang: "en", term: "cat", notes: [] },
							{ lang: "de", term: "Katze", notes: [] },
						],
					},
				],
			},
			"concatenate",
			"en",
			"de",
		);
		expect(matches).toEqual([]);
	});
});
