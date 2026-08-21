// @vitest-environment happy-dom

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateXML } from "xmllint-wasm/index-node.js";
import { buildTbx } from "$lib/functions/saveFileGeneration/generateTbx3SaveFile";
import type { TbData } from "$lib/types/types";
import { migrateTbData } from "./persistenceMigrations";
import { importTbxStreaming } from "./streamingImporters";
import {
	tbxSchemaAssets,
	validateTbxData,
	validateTbxDocument,
	type BuildTbxOptions,
} from "./tbx";
import minDctFixture from "./fixtures/tbx/min-dct.tbx?raw";
import basicDcaFixture from "./fixtures/tbx/basic-dca.tbx?raw";
import legacyFixture from "./fixtures/tbx/basic-v2-martif.tbx?raw";

function tbxFile(xml: string, name = "terms.tbx"): File {
	return new File([xml], name, { type: "application/tbx+xml" });
}

function parse(xml: string): Document {
	return new DOMParser().parseFromString(xml, "application/xml");
}

function fixturePath(name: string): string {
	return resolve("static", "schemas", "tbx", name);
}

describe("TBX dialect interoperability", () => {
	it("imports TBX-Min DCT without flattening languages, synonyms, IDs, or term metadata", async () => {
		const result = await importTbxStreaming(
			tbxFile(minDctFixture, "min-dct.tbx"),
		);
		const data = result.data;
		expect(data).toMatchObject({
			id: 71,
			name: "Astronomy terms",
			tbx: { version: 3, dialect: "TBX-Min", style: "dct" },
		});
		expect(data.entries[0].tbx).toMatchObject({
			id: "black-hole",
			recordName: "conceptEntry",
		});
		expect(data.entries[0].terms).toHaveLength(3);
		expect(data.entries[0].terms[0]).toMatchObject({
			lang: "en-GB",
			term: "black hole",
			partOfSpeech: "noun",
			status: "preferredTerm-admn-sts",
			tbx: { id: "term-en-1", languageSectionIndex: 0 },
		});
		expect(data.entries[0].terms[1]).toMatchObject({
			lang: "en-GB",
			term: "collapsed star",
		});
		expect(data.entries[0].terms[2].lang).toBe("de-DE");
		expect(validateTbxData(data)).toEqual([]);
		expect(result.metrics.recordCount).toBe(1);
	});

	it("overlays edited terms into the native DCT skeleton without duplicating text or losing metadata", async () => {
		const data = (await importTbxStreaming(tbxFile(minDctFixture))).data;
		data.entries[0].terms[0].term = "black-hole object";
		data.name = "Renamed astronomy terms";
		data.id = 99;
		const output = buildTbx("en-GB", data);
		const document = parse(output);
		expect(document.getElementsByTagName("parsererror")).toHaveLength(0);
		expect(output.match(/black-hole object/g)).toHaveLength(1);
		expect(output).not.toContain(">black hole<");
		expect(output).toMatch(/<min:partOfSpeech\b[^>]*>noun<\/min:partOfSpeech>/);
		expect(output).toContain('id="term-en-2"');
		expect(output).toContain('target="https://example.test/black-hole"');
		expect(output).toContain("<title>Renamed astronomy terms</title>");
		expect(output).toContain("OpenTLC ID: 99");
		expect(validateTbxDocument(document.documentElement)).toEqual([]);
	});

	it("preserves legacy TBX-Basic martif, ntig/termGrp, groups, IDs, references, and regional languages", async () => {
		const data = (
			await importTbxStreaming(tbxFile(legacyFixture, "legacy.tbx"))
		).data;
		expect(data).toMatchObject({
			id: 72,
			name: "Legacy terminology",
			tbx: { version: 2, dialect: "TBX-Basic", rootName: "martif" },
		});
		expect(data.entries[0].terms).toMatchObject([
			{ lang: "en-US", term: "file", partOfSpeech: "noun" },
			{
				lang: "en-US",
				term: "computer file",
				status: "admittedTerm-admn-sts",
				tbx: { containerName: "ntig" },
			},
			{ lang: "de-DE", term: "Datei" },
		]);
		expect(data.entries[0].terms[0].definition).toBe(
			"A named collection of data.",
		);
		data.entries[0].terms[1].term = "digital file";
		const output = buildTbx("en", data);
		expect(output).toContain(
			'<!DOCTYPE martif SYSTEM "TBXBasiccoreStructV02.dtd">',
		);
		expect(output).toContain("<ntig");
		expect(output).toContain("<term>digital file</term>");
		expect(output).toContain('target="legacy-folder"');
		expect(output).toContain("Legacy CAT export");
	});

	it("preserves Basic DCA concept/language/term metadata and internal cross references", async () => {
		const data = (await importTbxStreaming(tbxFile(basicDcaFixture))).data;
		const save = data.entries[0].terms[0];
		expect(save).toMatchObject({
			lang: "en-US",
			definition: "Command that persists a document.",
			partOfSpeech: "verb",
			status: "preferredTerm-admn-sts",
		});
		expect(data.entries[0].tbx?.dataCategories).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "subjectField", text: "software" }),
				expect.objectContaining({ localName: "descripGrp" }),
				expect.objectContaining({ type: "crossReference" }),
			]),
		);
		expect(validateTbxData(data)).toEqual([]);
	});

	it("keeps native entry metadata when a merge or reorder requires a new document wrapper", async () => {
		const data = (await importTbxStreaming(tbxFile(basicDcaFixture))).data;
		data.tbx!.documentSkeletonXml = undefined;
		data.entries.reverse();
		data.entries[1].terms[0].term = "Save document";
		const output = buildTbx("en", data);
		expect(output).toContain("Command that persists a document.");
		expect(output).toContain('target="open-command"');
		expect(output).toContain("<term>Save document</term>");
		expect(output).not.toContain("__OPENTLC_TBX_TERM_");
		expect(validateTbxDocument(parse(output).documentElement)).toEqual([]);
	});

	it.each([
		[{ dialect: "TBX-Core", style: "dca", version: 3 }, "TBX-Core", "dca"],
		[{ dialect: "TBX-Min", style: "dca", version: 3 }, "TBX-Min", "dca"],
		[{ dialect: "TBX-Min", style: "dct", version: 3 }, "TBX-Min", "dct"],
		[{ dialect: "TBX-Basic", style: "dca", version: 3 }, "TBX-Basic", "dca"],
		[{ dialect: "TBX-Basic", style: "dct", version: 3 }, "TBX-Basic", "dct"],
	] as Array<[Required<BuildTbxOptions>, string, string]>)(
		"emits a valid new %s %s document",
		(options, dialect, style) => {
			const output = buildTbx(
				"English (en)",
				{
					name: "Generated terms",
					entries: [
						{
							terms: [
								{
									lang: "en",
									term: "file",
									notes: ["A plain note"],
									...(dialect === "TBX-Core"
										? {}
										: {
												partOfSpeech: "noun",
												status: "preferredTerm-admn-sts",
											}),
								},
							],
						},
					],
				},
				options,
			);
			const document = parse(output);
			expect(document.documentElement.getAttribute("type")).toBe(dialect);
			expect(document.documentElement.getAttribute("style")).toBe(style);
			expect(validateTbxDocument(document.documentElement)).toEqual([]);
		},
	);

	it.each([
		[
			"term unit without terms",
			{ entries: [{ terms: [] }] },
			/at least one term/i,
		],
		[
			"term without a language",
			{ entries: [{ terms: [{ lang: " ", term: "file", notes: [] }] }] },
			/needs a language/i,
		],
		[
			"blank term value",
			{ entries: [{ terms: [{ lang: "en", term: "\n", notes: [] }] }] },
			/needs a value/i,
		],
		[
			"empty note",
			{
				entries: [
					{
						terms: [
							{ lang: "en", term: "file", notes: [{ type: "", text: " " }] },
						],
					},
				],
			},
			/is empty/i,
		],
	] as Array<[string, TbData, RegExp]>)(
		"refuses to export a TBX with %s",
		(_label, data, message) => {
			expect(() => buildTbx("en", data)).toThrow(message);
			expect(validateTbxData(data)[0]?.message).toMatch(message);
		},
	);

	it("rejects rogue categories, invalid pick-list values, bad placement, and unresolved references", async () => {
		const invalid = basicDcaFixture
			.replace(
				'<termNote type="partOfSpeech">verb</termNote>',
				'<termNote type="partOfSpeech">proper noun</termNote><descrip type="definition">Wrong level</descrip><termNote type="rogueCategory">x</termNote>',
			)
			.replace('target="open-command"', 'target="missing-command"');
		await expect(importTbxStreaming(tbxFile(invalid))).rejects.toThrow(
			/not permitted|unsupported value|existing id/,
		);
	});

	it("rejects DCT categories from the wrong module namespace", async () => {
		const wrongNamespace = minDctFixture.replace(
			"http://www.tbxinfo.net/ns/min",
			"https://vendor.example/tbx/min",
		);
		await expect(importTbxStreaming(tbxFile(wrongNamespace))).rejects.toThrow(
			/wrong DCT module namespace/,
		);
	});

	it("rejects records outside the required text/body hierarchy", async () => {
		const wrapped = basicDcaFixture
			.replace("<text><body>", "<text><body><group>")
			.replace("</body></text>", "</group></body></text>");
		await expect(importTbxStreaming(tbxFile(wrapped))).rejects.toThrow(
			/direct children of text\/body/,
		);
	});

	it("uses checked-in grammar and dialect profiles and validates the DCA fixture offline", async () => {
		for (const [dialect, expectedProfile] of [
			["TBX-Core", "tbx-core-v3.constraints.json"],
			["TBX-Min", "tbx-min-v3.constraints.json"],
			["TBX-Basic", "tbx-basic-v3.constraints.json"],
		] as const) {
			const assets = tbxSchemaAssets(dialect, "dca", 3);
			expect(assets).toContain(`/schemas/tbx/${expectedProfile}`);
			const profile = JSON.parse(
				await readFile(fixturePath(expectedProfile), "utf8"),
			);
			expect(profile.dialect).toBe(dialect);
		}
		const schema = await readFile(fixturePath("tbx-core-v3.rng"), "utf8");
		const validation = await validateXML({
			xml: { fileName: "basic-dca.tbx", contents: basicDcaFixture },
			schema: { fileName: "tbx-core-v3.rng", contents: schema },
			extension: "relaxng",
		});
		expect(validation.valid, validation.rawOutput).toBe(true);
	});

	it("persists hierarchy metadata and native skeletons through the termbase migration", async () => {
		const imported = (await importTbxStreaming(tbxFile(minDctFixture))).data;
		const restored = migrateTbData(JSON.parse(JSON.stringify(imported)));
		expect(restored.tbx).toEqual(imported.tbx);
		expect(restored.entries[0].tbx).toEqual(imported.entries[0].tbx);
		expect(restored.entries[0].terms[0].tbx).toEqual(
			imported.entries[0].terms[0].tbx,
		);
	});

	it("streams a 1,500-concept termbase with bounded record buffering", async () => {
		const entries = Array.from(
			{ length: 1_500 },
			(_, index) =>
				`<conceptEntry id="c${index}"><langSec xml:lang="en"><termSec><term>source ${index}</term></termSec></langSec><langSec xml:lang="de"><termSec><term>target ${index}</term></termSec></langSec></conceptEntry>`,
		).join("");
		const xml = `<?xml version="1.0"?><tbx style="dca" type="TBX-Core" xml:lang="en" xmlns="urn:iso:std:iso:30042:ed-2"><tbxHeader><fileDesc><sourceDesc><p>generated</p></sourceDesc></fileDesc></tbxHeader><text><body>${entries}</body></text></tbx>`;
		const result = await importTbxStreaming(tbxFile(xml, "large.tbx"));
		expect(result.data.entries).toHaveLength(1_500);
		expect(result.metrics.recordCount).toBe(1_500);
		expect(result.metrics.maxBufferedChars).toBeLessThan(400_000);
		expect(result.metrics.yieldCount).toBeGreaterThan(0);
	});
});
