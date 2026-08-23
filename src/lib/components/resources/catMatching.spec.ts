import { describe, expect, it } from "vitest";
import {
	getCachedTranslationMemoryLanguagePairCount,
	getPreparedTranslationMemoryIndexStats,
	getTranslationMemoryMatches,
	normalizeForMatch,
	prepareTranslationMemoryIndex,
	searchForMatches,
	similarityPercentage,
} from "$lib/components/translationMemory/tmFunctions";
import {
	containsWholeTerm,
	getTermMatches,
} from "$lib/components/termBase/tbFunctions";
import {
	bestLanguageMatches,
	canonicalizeLanguageTag,
	languageMatchRank,
} from "./languageMatching";

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

	it("preserves order and multiplicity for long-segment similarity", () => {
		const ordered = Array.from({ length: 320 }, (_, index) => `token${index}`);
		const original = ordered.join(" ");
		const reordered = [...ordered].reverse().join(" ");
		expect(similarityPercentage(original, original)).toBe(100);
		expect(similarityPercentage(original, reordered)).toBeLessThan(70);

		const repeated = `${"alpha ".repeat(180)}${"beta ".repeat(80)}gamma`;
		const changedMultiplicity = `${"alpha ".repeat(80)}${"beta ".repeat(180)}gamma`;
		expect(similarityPercentage(repeated, changedMultiplicity)).toBeLessThan(
			100,
		);
		expect(
			similarityPercentage(
				`${"مرحبا، بالعالم! ".repeat(80)}نهاية`,
				`${"بالعالم! مرحبا، ".repeat(80)}نهاية`,
			),
		).toBeLessThan(100);
		expect(
			similarityPercentage("中文标点。".repeat(120), "。点标文中".repeat(120)),
		).toBeLessThan(100);
	});

	it("normalizes combining marks and treats punctuation as ordered evidence", () => {
		expect(
			getTranslationMemoryMatches(
				["Cafe\u0301 — مرحبا؟"],
				["match"],
				"CAFÉ — مرحبا؟",
				100,
			),
		).toHaveLength(1);
		const first = `${"alpha, beta; gamma! ".repeat(40)}end?`;
		const second = `${"gamma! beta; alpha, ".repeat(40)}end?`;
		expect(similarityPercentage(first, second)).toBeLessThan(100);
	});

	it("matches 10,000 TM entries within a bounded regression budget", () => {
		const sources = Array.from(
			{ length: 10_000 },
			(_, index) => `Checkout message ${index} — العربية`,
		);
		const targets = sources.map((_, index) => `Ziel ${index}`);
		const started = performance.now();
		const matches = getTranslationMemoryMatches(
			sources,
			targets,
			"Checkout message 9999 — العربية",
			95,
		);
		expect(matches[0]).toMatchObject({
			match: "Ziel 9999",
			percentage: "100.00%",
		});
		expect(performance.now() - started).toBeLessThan(5_000);
	});

	it("reuses revisioned language indexes and invalidates them after TM edits", () => {
		const memory = {
			persistenceRevision: 7,
			terms: Array.from({ length: 10_000 }, (_, index) => ({
				source: { lang: "en", segment: `Message ${index}` },
				target: [{ lang: "de", segment: `Nachricht ${index}` }],
			})),
		};
		const first = prepareTranslationMemoryIndex(memory, "en", "de");
		const reused = prepareTranslationMemoryIndex(memory, "English (EN)", "DE");
		expect(reused).toBe(first);
		expect(
			searchForMatches(memory, "Message 9999", "en", "de")[0],
		).toMatchObject({ match: "Nachricht 9999", percentage: "100.00%" });

		memory.terms[9_999].target[0].segment = "Aktualisiert";
		memory.persistenceRevision += 1;
		const rebuilt = prepareTranslationMemoryIndex(memory, "en", "de");
		expect(rebuilt).not.toBe(first);
		expect(
			searchForMatches(memory, "Message 9999", "en", "de")[0],
		).toMatchObject({ match: "Aktualisiert" });
	});

	it("does not retain potentially stale indexes for unsaved in-memory TMs", () => {
		const memory = {
			terms: [
				{
					source: { lang: "en", segment: "Open" },
					target: [{ lang: "de", segment: "Öffnen" }],
				},
			],
		};
		const first = prepareTranslationMemoryIndex(memory, "en", "de");
		memory.terms[0].target[0].segment = "Aufmachen";
		const rebuilt = prepareTranslationMemoryIndex(memory, "en", "de");
		expect(rebuilt).not.toBe(first);
		expect(searchForMatches(memory, "Open", "en", "de")[0].match).toBe(
			"Aufmachen",
		);
	});

	it("bounds retained sketches and keeps only the active language-pair index", () => {
		const longText = `${"Long translation-memory source with Unicode العربية 日本語. ".repeat(12)}end`;
		const memory = {
			persistenceRevision: 1,
			terms: Array.from({ length: 6_200 }, (_, index) => ({
				source: { lang: "en", segment: `${longText} ${index}` },
				target: [
					{ lang: "de", segment: `Deutsch ${index}` },
					{ lang: "fr", segment: `Français ${index}` },
				],
			})),
		};
		const german = prepareTranslationMemoryIndex(memory, "en", "de");
		const stats = getPreparedTranslationMemoryIndexStats(german);
		expect(stats.candidates).toBe(6_200);
		expect(stats.sketchedCandidates).toBeLessThan(stats.candidates);
		expect(stats.sketchBytes).toBeLessThanOrEqual(48 * 1024 * 1024);
		expect(getCachedTranslationMemoryLanguagePairCount(memory)).toBe(1);

		prepareTranslationMemoryIndex(memory, "en", "fr");
		expect(getCachedTranslationMemoryLanguagePairCount(memory)).toBe(1);
	});

	it("canonicalizes BCP 47 tags and prefers exact locales before base fallback", () => {
		expect(canonicalizeLanguageTag("English (EN_us)")).toBe("en-US");
		expect(canonicalizeLanguageTag("zh-hant-tw")).toBe("zh-Hant-TW");
		expect(canonicalizeLanguageTag("not a language")).toBeNull();
		expect(languageMatchRank("en-US", "EN_us")).toBe(2);
		expect(languageMatchRank("en-GB", "en-AU")).toBe(1);
		expect(languageMatchRank("legacy label", "LEGACY LABEL")).toBe(2);
		expect(languageMatchRank("legacy label", "legacy")).toBe(0);
		expect(
			bestLanguageMatches(
				[{ lang: "en-GB" }, { lang: "en-US" }, { lang: "fr" }],
				"English (en_US)",
				(value) => value.lang,
			),
		).toEqual([{ lang: "en-US" }]);
	});

	it("applies exact-first then base-language fallback consistently to TM and TB", () => {
		const memory = {
			terms: [
				{
					source: { lang: "en-US", segment: "Color" },
					target: [
						{ lang: "de-DE", segment: "Farbe DE" },
						{ lang: "de-AT", segment: "Farbe AT" },
					],
				},
				{
					source: { lang: "en-GB", segment: "Colour" },
					target: [{ lang: "de-DE", segment: "Farbe GB" }],
				},
			],
		};
		expect(searchForMatches(memory, "Color", "EN_us", "de-AT")).toMatchObject([
			{ match: "Farbe AT" },
		]);
		expect(
			searchForMatches(memory, "Colour", "en-AU", "de-CH")[0],
		).toMatchObject({ match: "Farbe GB" });

		const termBase = {
			name: "regional terms",
			entries: [
				{
					terms: [
						{ lang: "en-US", term: "elevator", notes: [] },
						{ lang: "en-GB", term: "lift", notes: [] },
						{ lang: "de-DE", term: "Aufzug", notes: [] },
					],
				},
			],
		};
		expect(getTermMatches(termBase, "Take the lift", "en-AU", "de-AT")).toEqual(
			[{ searchEntry: "lift", foundEntry: "Aufzug", notes: [] }],
		);
		expect(
			getTermMatches(termBase, "Use the elevator", "en-US", "de-DE"),
		).toEqual([{ searchEntry: "elevator", foundEntry: "Aufzug", notes: [] }]);
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
