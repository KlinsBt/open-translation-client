// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateXML } from "xmllint-wasm/index-node.js";
import officialSchema from "../../test/fixtures/srx20/srx20.xsd?raw";
import xmlSchema from "../../test/fixtures/xliff2/xml.xsd?raw";
import {
	buildSrx20Blob,
	findSrxBreakPositions,
	getSrxRulesForLanguage,
	importSrx20File,
	parseSrx20,
	serializeSrx20,
	validateSrx20,
	type SrxDocument,
} from "./srx20";
import {
	addSrxParsingPreference,
	getActiveSrxProfile,
	setActiveParsingPreference,
} from "$lib/functions/parsing/parsingPreferences";
import { importTextFile } from "./importers";
import { makeUserData } from "../../test/fixtures";
import { buildTextTranslationFromProject } from "$lib/functions/outputGeneration/outputGenerationText";
import { getFormatAcceptValue } from "./registry";

const values = new Map<string, string>();

beforeEach(() => {
	values.clear();
	vi.stubGlobal("window", {});
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		clear: () => values.clear(),
	});
});

function exampleDocument(cascade = true): SrxDocument {
	return {
		version: "2.0",
		header: {
			segmentSubflows: true,
			cascade,
			formatHandles: [
				{ type: "start", include: false },
				{ type: "end", include: true },
			],
			extensions: [
				'<meta:profile xmlns:meta="urn:example:srx">OpenTLC</meta:profile>',
			],
		},
		languageRules: [
			{
				name: "English",
				rules: [
					{
						break: false,
						beforeBreak: "\\sMr\\.",
						afterBreak: "\\s",
					},
					{
						break: false,
						beforeBreak: "\\sU\\.K\\.",
						afterBreak: "\\s",
					},
				],
			},
			{
				name: "Default",
				rules: [
					{
						break: false,
						beforeBreak: "^\\s*\\d+\\.",
						afterBreak: "\\s",
					},
					{
						break: true,
						beforeBreak: "[\\.?!]+",
						afterBreak: "\\s",
					},
				],
			},
		],
		languageMaps: [
			{ languagePattern: "(?i)^en(?:-.*)?$", languageRuleName: "English" },
			{ languagePattern: ".*", languageRuleName: "Default" },
		],
	};
}

function splitAt(text: string, boundaries: readonly number[]): string[] {
	const pieces: string[] = [];
	let cursor = 0;
	for (const boundary of boundaries) {
		pieces.push(text.slice(cursor, boundary).trim());
		cursor = boundary;
	}
	pieces.push(text.slice(cursor).trim());
	return pieces.filter(Boolean);
}

describe("SRX 2.0 workflow interoperability", () => {
	it("serializes schema-valid SRX and preserves ordered rules, maps, handles, and extensions", async () => {
		const source = exampleDocument();
		const xml = serializeSrx20(source);
		const parsed = parseSrx20(xml);
		const schema = officialSchema.replace(
			"http://www.w3.org/2001/xml.xsd",
			"xml.xsd",
		);
		const validation = await validateXML({
			xml: { fileName: "rules.srx", contents: xml },
			schema: { fileName: "srx20.xsd", contents: schema },
			preload: [{ fileName: "xml.xsd", contents: xmlSchema }],
		});

		expect(validation.valid).toBe(true);
		expect(parsed.header).toMatchObject({
			segmentSubflows: true,
			cascade: true,
			formatHandles: source.header.formatHandles,
		});
		expect(parsed.header.extensions[0]).toContain("urn:example:srx");
		expect(parsed.languageRules).toEqual(source.languageRules);
		expect(parsed.languageMaps).toEqual(source.languageMaps);
		expect(await buildSrx20Blob(source).text()).toBe(xml);
		expect(getFormatAcceptValue()).not.toContain(".srx");
	});

	it("applies the first matching rule at each position and protects abbreviations", () => {
		const text = "Hello. Mr. Smith met the U.K. team. Next.";
		const boundaries = findSrxBreakPositions(text, exampleDocument(), "en-US");
		expect(splitAt(text, boundaries)).toEqual([
			"Hello.",
			"Mr. Smith met the U.K. team.",
			"Next.",
		]);
	});

	it("honors language-map order and cascade behavior", () => {
		const cascading = exampleDocument(true);
		expect(getSrxRulesForLanguage(cascading, "EN-gb")).toHaveLength(4);
		expect(getSrxRulesForLanguage(cascading, "fr-FR")).toHaveLength(2);

		const firstMatchOnly = exampleDocument(false);
		expect(getSrxRulesForLanguage(firstMatchOnly, "en")).toHaveLength(2);
		expect(findSrxBreakPositions("Hello. Next.", firstMatchOnly, "en")).toEqual(
			[],
		);

		firstMatchOnly.languageMaps.reverse();
		expect(
			findSrxBreakPositions("Mr. Smith. Next.", firstMatchOnly, "en"),
		).not.toEqual([]);
	});

	it("adapts common ICU Unicode escapes and classes without splitting surrogate pairs", () => {
		const document = exampleDocument(false);
		document.languageRules = [
			{
				name: "Japanese",
				rules: [
					{
						break: true,
						beforeBreak: "[\\xff61\\x3002\\U0000ff01]+",
						afterBreak: "",
					},
				],
			},
		];
		document.languageMaps = [
			{ languagePattern: "\\Qja-JP\\E", languageRuleName: "Japanese" },
		];
		const text = "絵文字🌍。次！終わり";
		const boundaries = findSrxBreakPositions(text, document, "ja-JP");

		expect(splitAt(text, boundaries)).toEqual(["絵文字🌍。", "次！", "終わり"]);
		expect(boundaries).not.toContain(text.indexOf("🌍") + 1);
	});

	it("rejects malformed schema structure, references, unsafe XML, and incompatible regex", () => {
		const valid = serializeSrx20(exampleDocument());
		expect(validateSrx20(valid)).toEqual({ valid: true });
		expect(
			validateSrx20(valid.replace('version="2.0"', 'version="1.0"')),
		).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/version 2\.0/),
		});
		expect(
			validateSrx20(
				valid.replace(
					'languagerulename="Default"/>',
					'languagerulename="Missing"/>',
				),
			),
		).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/missing rule/i),
		});
		expect(validateSrx20(valid.replace("[\\.?!]+", "a++"))).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/possessive quantifier/),
		});
		expect(
			validateSrx20(
				`<!DOCTYPE srx [<!ENTITY x SYSTEM "file:///etc/passwd">]>${valid}`,
			),
		).toMatchObject({ valid: false });
	});

	it("imports SRX files safely and rejects invalid text encoding", async () => {
		const xml = serializeSrx20(exampleDocument());
		await expect(
			importSrx20File(
				new File([xml], "rules.srx", { type: "application/srx+xml" }),
			),
		).resolves.toMatchObject({ version: "2.0" });
		await expect(
			importSrx20File(new File([new Uint8Array([0xc3, 0x28])], "broken.srx")),
		).rejects.toThrow(/UTF-8/);
	});

	it("stores, activates, and resolves SRX as a workflow preference", () => {
		let preferences = addSrxParsingPreference(
			"English SRX",
			"en-GB",
			exampleDocument(),
		);
		const srx = preferences.find((preference) => preference.kind === "srx")!;
		preferences = setActiveParsingPreference(srx.id);

		expect(
			preferences.find((preference) => preference.id === srx.id)?.active,
		).toBe(true);
		expect(getActiveSrxProfile()).toMatchObject({ languageCode: "en-GB" });
		expect(() =>
			addSrxParsingPreference("Broken", "not_a_language", exampleDocument()),
		).toThrow(/BCP 47/);
	});

	it("segments TXT with the active SRX profile and preserves exact source gaps", async () => {
		const preferences = addSrxParsingPreference(
			"English SRX",
			"en",
			exampleDocument(),
		);
		setActiveParsingPreference(
			preferences.find((preference) => preference.kind === "srx")!.id,
		);
		const result = await importTextFile(
			new File(["Hello.  Mr. Smith.\r\nNext."], "source.txt", {
				type: "text/plain",
			}),
			{ segmentationMode: "srx" },
		);
		if (result.kind !== "segments") throw new Error("Expected TXT segments");
		expect(result.segments).toEqual(["Hello.", "Mr. Smith.", "Next."]);
		expect(result.document.metadata).toMatchObject({
			segmentation: "srx-2.0",
			srxLanguageCode: "en",
			srxDocument: { version: "2.0" },
		});
		const project = makeUserData({
			type: "text",
			seg1: result.segments,
			seg2: ["Hallo.", "Herr Schmidt.", "Weiter."],
			checked: [false, false, false],
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		});
		expect(buildTextTranslationFromProject(project)).toBe(
			"Hallo.  Herr Schmidt.\r\nWeiter.",
		);
	});

	it("fails clearly when SRX segmentation is selected without an active SRX asset", async () => {
		await expect(
			importTextFile(new File(["Hello. Next."], "source.txt"), {
				segmentationMode: "srx",
			}),
		).rejects.toThrow(/active SRX profile/);
	});

	it("segments a large deterministic input without losing or duplicating text", () => {
		const text = Array.from(
			{ length: 250 },
			(_, index) => `Message ${index}.`,
		).join(" ");
		const boundaries = findSrxBreakPositions(text, exampleDocument(), "en");
		const segments = splitAt(text, boundaries);
		expect(segments).toHaveLength(250);
		expect(segments[0]).toBe("Message 0.");
		expect(segments.at(-1)).toBe("Message 249.");
	});
});
