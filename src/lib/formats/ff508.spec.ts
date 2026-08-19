// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { buildDitaTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationDita";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { importDitaFile } from "./dita";
import {
	buildSpecialistXmlTranslation,
	buildSpecialistXmlTranslationBlob,
	importSpecialistXmlFile,
	inspectSpecialistXmlText,
	validateSpecialistXmlFile,
} from "./specialistXml";
import { detectFormat, detectFormatWithConfidence } from "./registry";
import type { FormatImportResult } from "./types";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

function project(name: string, result: FormatImportResult, targets?: string[]) {
	if (result.kind !== "segments") throw new Error("Expected segments");
	return makeUserData({
		type: "specialist-xml",
		name,
		seg1: result.segments,
		seg2: targets ?? result.targetSegments ?? [...result.segments],
		checked: result.segments.map(() => false),
		typeRef: result.typeRef ?? {},
		segmentsMeta: result.segmentsMeta,
		documentModel: result.document,
		skeleton: result.skeleton,
		filterOptions: result.filterOptions,
	});
}

async function specialist(
	content: string,
	name: string,
	options: Record<string, string | boolean> = {},
) {
	const file = new File([content], name, { type: "application/xml" });
	const result = await importSpecialistXmlFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected segments");
	return { file, result, project: project(name, result) };
}

async function bytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

function expectIndependentXmlParse(content: string): void {
	const parsed = new DOMParser().parseFromString(content, "application/xml");
	expect(parsed.querySelector("parsererror")).toBeNull();
}

describe("FF-508 specialist XML and SGML profiles", () => {
	it("recognizes ITS 2.0 rule files while protecting selectors and rule metadata", async () => {
		const source = `<?xml version="1.0"?>
<its:rules xmlns:its="http://www.w3.org/2005/11/its" version="2.0">
  <its:translateRule selector="//code | //path" translate="no"/>
  <its:locNoteRule selector="//title"><its:locNote>Shown to translators — مرحبا 👩🏽‍💻</its:locNote></its:locNoteRule>
</its:rules>`;
		const {
			file,
			result,
			project: data,
		} = await specialist(source, "rules.its");
		expect(result.segments).toEqual(["Shown to translators — مرحبا 👩🏽‍💻"]);
		expect(result.typeRef).toMatchObject({ profile: "its-rules" });
		expect(await detectFormat(file)).toMatchObject({ id: "specialist-xml" });
		data.translationData.seg2 = [...result.segments];
		expect(await bytes(buildSpecialistXmlTranslationBlob(data))).toEqual(
			new TextEncoder().encode(source),
		);
		data.translationData.seg2 = ["Hinweis für Übersetzer — שלום"];
		const output = buildSpecialistXmlTranslation(data);
		expect(output).toContain('selector="//code | //path" translate="no"');
		expect(output).toContain("Hinweis für Übersetzer — שלום");
		expectIndependentXmlParse(output);
		expect(inspectSpecialistXmlText(output, "its").profile).toBe("its-rules");
	});

	it("applies Author-it and MadCap vocabulary-specific text, metadata, attribute, and inline rules", async () => {
		const author = `<AuthorITroot><Objects><Object><ID>99</ID><Topic><Heading>Café العربية</Heading><Text>Hello <Variable><Name>PRODUCT</Name><Value>Do not translate</Value></Variable> world</Text><Description>Optional note</Description><Macro>never()</Macro></Topic></Object></Objects></AuthorITroot>`;
		const authorResult = await specialist(author, "job.xml", {
			includeMetadata: true,
		});
		expect(authorResult.result.segments).toEqual([
			"Café العربية",
			"Hello",
			"world",
			"Optional note",
		]);
		expect(authorResult.result.typeRef).toMatchObject({ profile: "author-it" });
		authorResult.project.translationData.seg2 = [
			"Titel",
			"Hallo",
			"Welt",
			"Notiz",
		];
		const authorOutput = buildSpecialistXmlTranslation(authorResult.project);
		expect(authorOutput).toContain("<Value>Do not translate</Value>");
		expect(authorOutput).toContain("<Macro>never()</Macro>");

		const madcap = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:MadCap="http://www.madcapsoftware.com/Schemas/MadCap.xsd"><head><meta name="description" content="Search summary"/><title>Page title</title></head><body><h1>שלום مرحبا</h1><p title="Helpful title">Hello <b>bold</b> tail</p><pre>const secret = 1;</pre><script>run()</script></body></html>`;
		const madcapResult = await specialist(madcap, "topic.htm", {
			includeMetadata: true,
		});
		expect(madcapResult.result.segments).toEqual([
			"Search summary",
			"Page title",
			"שלום مرحبا",
			"Helpful title",
			"Hello",
			"bold",
			"tail",
		]);
		madcapResult.project.translationData.seg2 = [
			"Zusammenfassung",
			"Seitentitel",
			"عنوان",
			"Hilfreich",
			"Hallo",
			"fett",
			"Ende",
		];
		const output = buildSpecialistXmlTranslation(madcapResult.project);
		expect(output).toContain('<p title="Hilfreich">Hallo <b>fett</b> Ende</p>');
		expect(output).toContain("<pre>const secret = 1;</pre>");
		expect(output).toContain("<script>run()</script>");
		expectIndependentXmlParse(output);
	});

	it("handles legacy TYPO3 and SpreadsheetML 2003 without exposing IDs, formulas, or control markup", async () => {
		const typo3 = `<T3locallang><data><languageKey index="default"><label index="welcome">Welcome 世界</label><label index="cta">Continue</label></languageKey><languageKey index="de"><label index="welcome">Vorhanden</label></languageKey></data></T3locallang>`;
		const typoResult = await specialist(typo3, "locallang.xml");
		expect(typoResult.result.segments).toEqual(["Welcome 世界", "Continue"]);
		expect(typoResult.result.typeRef).toMatchObject({ profile: "typo3" });

		const sheet = `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Main"><Table><Row><Cell><Data ss:Type="String">Hello العربية</Data></Cell><Cell><Data ss:Type="Number">42</Data></Cell></Row><Row><Cell ss:Formula="=R[-1]C"><Data ss:Type="String">Cached result</Data></Cell><Cell><Data ss:Type="String">Second</Data></Cell></Row></Table></Worksheet></Workbook>`;
		const sheetResult = await specialist(sheet, "workbook.xml");
		expect(sheetResult.result.segments).toEqual(["Hello العربية", "Second"]);
		expect(sheetResult.result.typeRef).toMatchObject({
			profile: "spreadsheetml-2003",
		});
		sheetResult.project.translationData.seg2 = ["Hallo", "Zweite"];
		const output = buildSpecialistXmlTranslation(sheetResult.project);
		expect(output).toContain('ss:Formula="=R[-1]C"');
		expect(output).toContain("Cached result");
		expect(output).toContain('<Data ss:Type="Number">42</Data>');
	});

	it("round-trips paired MULIX source and existing target values without flattening entries", async () => {
		const source = `<mulix source-language="en" target-language="de"><entry id="one"><source>Hello <b>world</b></source><target>Hallo <b>Welt</b></target><note>Keep</note></entry><entry id="two"><source>RTL مرحبا</source><target>RTL Hallo</target></entry></mulix>`;
		const { result } = await specialist(source, "catalog.mulix");
		expect(result.segments).toEqual(["Hello", "world", "RTL مرحبا"]);
		expect(result.targetSegments).toEqual(["Hallo", "Welt", "RTL Hallo"]);
		const data = project("catalog.mulix", result, result.targetSegments);
		expect(await bytes(buildSpecialistXmlTranslationBlob(data))).toEqual(
			new TextEncoder().encode(source),
		);
		data.translationData.seg2 = ["Bonjour", "monde", "RTL שלום"];
		const output = buildSpecialistXmlTranslation(data);
		expect(output).toContain("<source>Hello <b>world</b></source>");
		expect(output).toContain("<target>Bonjour <b>monde</b></target>");
		expect(output).toContain("<target>RTL שלום</target>");
		expect(output).toContain("<note>Keep</note>");
		expectIndependentXmlParse(output);
	});

	it("accepts only the explicit safe SGML subset and never resolves declarations", async () => {
		const source = `<!DOCTYPE ARTICLE PUBLIC "-//OASIS//DTD DocBook V4.5//EN" "https://example.invalid/docbook.dtd">
<ARTICLE><TITLE title="Document title">Café &amp; tea</TITLE><PARA>Hello <EM>world</EM>.</PARA><CODE>do_not_translate()</CODE></ARTICLE>`;
		const result = await specialist(source, "manual.sgml");
		expect(result.result.segments).toEqual([
			"Document title",
			"Café & tea",
			"Hello",
			"world",
			".",
		]);
		result.project.translationData.seg2 = [
			"Dokumenttitel",
			"Kaffee & Tee",
			"Hallo",
			"Welt",
			"!",
		];
		const output = buildSpecialistXmlTranslation(result.project);
		expect(output).toContain("https://example.invalid/docbook.dtd");
		expect(output).toContain("<CODE>do_not_translate()</CODE>");
		expect(output).toContain("Kaffee &amp; Tee");

		for (const [content, name] of [
			["plain text", "fake.sgml"],
			["<root>extension only</root>", "fake.sgm"],
			[
				'<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root><p>&x;</p></root>',
				"evil.sgml",
			],
			["<!DOCTYPE root><root><p unquoted=value>bad</p></root>", "bad.sgm"],
		] as const)
			await expect(
				validateSpecialistXmlFile(new File([content], name)),
			).resolves.toMatchObject({ valid: false });
		await expect(
			detectFormat(new File(["<root>extension only</root>"], "fake.sgm")),
		).resolves.not.toMatchObject({ id: "specialist-xml" });
		await expect(
			detectFormatWithConfidence(
				new File(["<root>extension only</root>"], "fake.sgm"),
			),
		).resolves.toMatchObject({ supported: false });
		const controller = new AbortController();
		controller.abort();
		await expect(
			importSpecialistXmlFile(
				new File([source], "cancel.sgml"),
				{},
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("registers and preserves native DITA bookmaps", async () => {
		const source = `<?xml version="1.0"?><!DOCTYPE bookmap PUBLIC "-//OASIS//DTD DITA BookMap//EN" "bookmap.dtd"><bookmap id="guide"><booktitle><mainbooktitle>Guide مرحبا</mainbooktitle></booktitle><chapter navtitle="Start" href="start.dita"/></bookmap>`;
		const file = new File([source], "guide.bookmap", {
			type: "application/dita+xml",
		});
		expect(await detectFormat(file)).toMatchObject({ id: "dita" });
		const imported = await importDitaFile(file, { includeMetadata: true });
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments).toContain("Guide مرحبا");
		const data = makeUserData({
			type: "dita",
			name: "guide.bookmap",
			seg1: imported.segments,
			seg2: [...imported.segments],
			checked: imported.segments.map(() => false),
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		expect(await bytes(await buildDitaTranslationBlob(data))).toEqual(
			new TextEncoder().encode(source),
		);
	});

	it("protects structural boundaries and imports generated large specialist documents deterministically", async () => {
		const source = `<AuthorITroot><Objects>${Array.from(
			{ length: 1_000 },
			(_, index) =>
				`<Object><ID>${index}</ID><Topic><Heading>Message ${index} 世界</Heading></Topic></Object>`,
		).join("")}</Objects></AuthorITroot>`;
		const first = await importSpecialistXmlFile(
			new File([source], "large.xml"),
		);
		const second = await importSpecialistXmlFile(
			new File([source], "large.xml"),
		);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
		expect(
			splitSegmentData(project("large.xml", first).translationData, 0, 3).error,
		).toMatch(/cannot be split or joined/);
	});
});
