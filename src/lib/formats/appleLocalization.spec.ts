// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildAppleLocalizationTranslation,
	buildAppleLocalizationTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationApple";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import {
	importAppleLocalizationFile,
	validateAppleLocalizationFile,
} from "./appleLocalization";
import { decodeTextBytes } from "./safeInput";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name: string,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "text/plain" });
	const result = await importAppleLocalizationFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected Apple segments");
	return {
		result,
		project: makeUserData({
			type: "apple",
			name,
			seg1: result.segments,
			seg2: targets ?? result.targetSegments ?? [...result.segments],
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("Apple localization workflows", () => {
	it("parses OpenStep strings with comments, escapes, ordering, and duplicate warnings", async () => {
		const source = `/* Home title */
"welcome" = "Hello\\nworld";
// Button
"action" = "Save \\"now\\"";
"action" = "Duplicate";`;
		const { result } = await importProject(source, "Localizable.strings");
		expect(result.segments).toEqual([
			"Hello\nworld",
			'Save "now"',
			"Duplicate",
		]);
		expect(result.document.units[0].notes[0]?.text).toBe("Home title");
		expect(result.document.metadata?.warnings).toContain(
			"Duplicate Apple .strings key action.",
		);
	});

	it("rewrites only quoted .strings values and preserves UTF-16 identity bytes", async () => {
		const source = encodeTextBytes(
			'/* keep */\r\n"hello" = "Café";\r\n',
			"utf-16le",
			true,
		);
		const identity = await importProject(source, "Localizable.strings", {}, [
			"Café",
		]);
		expect(
			new Uint8Array(
				await buildAppleLocalizationTranslationBlob(
					identity.project,
				).arrayBuffer(),
			),
		).toEqual(source);
		identity.project.translationData.seg2 = ['Ligne "une"\nDeux'];
		const decoded = decodeTextBytes(
			new Uint8Array(
				await buildAppleLocalizationTranslationBlob(
					identity.project,
				).arrayBuffer(),
			),
		);
		expect(decoded.encoding).toBe("utf-16le");
		expect(decoded.text).toContain('"hello" = "Ligne \\"une\\"\\nDeux";');
	});

	it("imports .stringsdict format strings and plural/device dictionaries safely", async () => {
		const source = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>cats</key><dict>
<key>NSStringLocalizedFormatKey</key><string>%#@count@</string>
<key>count</key><dict>
<key>NSStringFormatSpecTypeKey</key><string>NSStringPluralRuleType</string>
<key>NSStringFormatValueTypeKey</key><string>d</string>
<key>one</key><string>%d cat</string><key>other</key><string>%d cats</string>
</dict></dict></dict></plist>`;
		const { result, project } = await importProject(
			source,
			"Localizable.stringsdict",
			{},
			["%#@count@", "%d Katze", "%d Katzen"],
		);
		expect(result.segments).toEqual(["%#@count@", "%d cat", "%d cats"]);
		expect(result.document.units[1].relationships?.plural?.category).toBe(
			"one",
		);
		const output = buildAppleLocalizationTranslation(project);
		expect(output).toContain("<string>%d Katze</string>");
		expect(output).toContain("NSStringPluralRuleType");
		expect(output).toContain("<!DOCTYPE plist PUBLIC");
	});

	it("imports existing xcstrings targets, states, comments, plurals, and substitutions", async () => {
		const source = JSON.stringify({
			sourceLanguage: "en",
			version: "1.0",
			strings: {
				cats: {
					comment: "Shown in cart",
					extractionState: "manual",
					localizations: {
						en: {
							variations: {
								plural: {
									one: { stringUnit: { state: "new", value: "%lld cat" } },
									other: {
										stringUnit: { state: "new", value: "%lld cats" },
									},
								},
							},
						},
						de: {
							variations: {
								plural: {
									one: {
										stringUnit: { state: "translated", value: "%lld Katze" },
									},
									other: {
										stringUnit: { state: "translated", value: "%lld Katzen" },
									},
								},
							},
						},
					},
				},
			},
		});
		const { result, project } = await importProject(
			source,
			"Catalog.xcstrings",
		);
		expect(result.segments).toEqual(["%lld cat", "%lld cats"]);
		expect(result.targetSegments).toEqual(["%lld Katze", "%lld Katzen"]);
		expect(result.filterOptions).toMatchObject({
			sourceLanguage: "en",
			targetLanguage: "de",
		});
		expect(result.document.units[0].notes[0]?.text).toBe("Shown in cart");
		project.translationData.seg2[1] = "%lld Kätzchen";
		const parsed = JSON.parse(buildAppleLocalizationTranslation(project));
		expect(
			parsed.strings.cats.localizations.de.variations.plural.other.stringUnit
				.value,
		).toBe("%lld Kätzchen");
	});

	it("adds a missing xcstrings target localization without reserializing the catalog", async () => {
		const source = `{
  "sourceLanguage" : "en",
  "strings" : {
    "hello" : { "comment" : "Greeting", "localizations" : { "en" : { "stringUnit" : { "state" : "new", "value" : "Hello %@" } } } }
  },
  "version" : "1.0"
}`;
		const { project } = await importProject(
			source,
			"Catalog.xcstrings",
			{ targetLanguage: "fr" },
			["Bonjour %@"],
		);
		const output = buildAppleLocalizationTranslation(project);
		expect(output).toContain('"version" : "1.0"');
		const parsed = JSON.parse(output);
		expect(parsed.strings.hello.localizations.fr).toEqual({
			stringUnit: { state: "translated", value: "Bonjour %@" },
		});

		const keyAsSource = await importProject(
			'{"sourceLanguage":"en","strings":{"Save":{}},"version":"1.0"}',
			"Catalog.xcstrings",
			{ targetLanguage: "de" },
			["Speichern"],
		);
		expect(keyAsSource.result.segments).toEqual(["Save"]);
		expect(
			JSON.parse(buildAppleLocalizationTranslation(keyAsSource.project)).strings
				.Save.localizations.de.stringUnit,
		).toEqual({ state: "translated", value: "Speichern" });
	});

	it("can exclude stale xcstrings entries while retaining extraction metadata", async () => {
		const source = JSON.stringify({
			sourceLanguage: "en",
			strings: {
				old: {
					extractionState: "stale",
					localizations: {
						en: { stringUnit: { state: "new", value: "Old" } },
					},
				},
				current: {
					localizations: {
						en: { stringUnit: { state: "new", value: "Current" } },
					},
				},
			},
			version: "1.0",
		});
		const { result } = await importProject(source, "Catalog.xcstrings", {
			includeStale: false,
		});
		expect(result.segments).toEqual(["Current"]);
	});

	it("rejects placeholder regressions across Apple profiles", async () => {
		const { project } = await importProject(
			'"count" = "%1$lld items";',
			"Localizable.strings",
			{},
			["Elemente"],
		);
		expect(() => buildAppleLocalizationTranslation(project)).toThrow(
			/Export blocked/,
		);
		const dict = await importProject(
			"<plist><dict><key>items</key><dict><key>NSStringLocalizedFormatKey</key><string>%#@count@</string></dict></dict></plist>",
			"Localizable.stringsdict",
			{},
			["count"],
		);
		expect(() => buildAppleLocalizationTranslation(dict.project)).toThrow(
			/Export blocked/,
		);
	});

	it("rejects malformed files, unsafe plist DTDs, and catalog variation mismatches", async () => {
		const cases = [
			new File(['"key" = "missing semicolon"'], "bad.strings"),
			new File(
				['<!DOCTYPE plist SYSTEM "file:///tmp/x"><plist><dict/></plist>'],
				"bad.stringsdict",
			),
			new File(
				[
					JSON.stringify({
						sourceLanguage: "en",
						strings: {
							x: {
								localizations: {
									en: {
										stringUnit: { state: "new", value: "X" },
									},
									de: { variations: {} },
								},
							},
						},
					}),
				],
				"bad.xcstrings",
			),
		];
		for (const file of cases)
			await expect(validateAppleLocalizationFile(file)).resolves.toMatchObject({
				valid: false,
			});
	});

	it("blocks structural edits and stale mappings", async () => {
		const { project } = await importProject(
			'"hello" = "Hello";',
			"Localizable.strings",
			{},
			["Hallo"],
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 8;
		expect(() => buildAppleLocalizationTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 .strings entries deterministically", async () => {
		const source = Array.from(
			{ length: 1_000 },
			(_, index) => `"message_${index}" = "Message ${index}";`,
		).join("\n");
		const first = await importAppleLocalizationFile(
			new File([source], "Localizable.strings"),
		);
		const second = await importAppleLocalizationFile(
			new File([source], "Localizable.strings"),
		);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
