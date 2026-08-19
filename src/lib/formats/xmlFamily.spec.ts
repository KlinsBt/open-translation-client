// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildXmlTranslation,
	buildXmlTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationXml";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import { importXmlFile, parseXmlSyntax, validateXmlFile } from "./xmlFamily";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name = "document.xml",
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "application/xml" });
	const result = await importXmlFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected XML segments");
	return {
		result,
		project: makeUserData({
			type: "xml",
			name,
			seg1: result.segments,
			seg2: targets ?? [...result.segments],
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

async function bytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
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

describe("lossless generic XML and ITS 2.0 workflow", () => {
	it("extracts selected text and attributes while preserving namespaces and source order", async () => {
		const source = `<?xml version="1.0"?>
<c:catalog xmlns:c="urn:catalog" version="1">
  <c:item id="one" title='Greeting'> Hello &amp; welcome </c:item>
  <c:item id="two" title="Locked">Second</c:item>
</c:catalog>`;
		const { result } = await importProject(source, "catalog.xml", {
			elementSelectors: "//item",
			attributeSelectors: "//item/@title",
		});
		expect(result.segments).toEqual([
			"Greeting",
			"Hello & welcome",
			"Locked",
			"Second",
		]);
		expect(result.document.units[0].sourceLocation?.path).toEqual([
			"c:catalog[1]",
			"c:item[1]",
			"@title",
		]);
		expect(result.document.units[0].contexts).toContainEqual({
			type: "xml-id",
			value: "one",
		});
	});

	it("honors inherited local ITS translate and records ITS contexts and localization notes", async () => {
		const source = `<root xmlns:i="http://www.w3.org/2005/11/its" i:version="2.0">
  <section i:translate="no"><p>Locked</p><p i:translate="yes">Override</p></section>
  <p xml:id="welcome" xml:lang="en" i:withinText="no" i:term="yes" i:localeFilterList="en de">Hello<i:locNote>Shown on home</i:locNote></p>
</root>`;
		const { result } = await importProject(source);
		expect(result.segments).toEqual(["Override", "Hello"]);
		expect(result.document.units[1].contexts).toEqual(
			expect.arrayContaining([
				{ type: "xml-id", value: "welcome" },
				{ type: "xml-language", value: "en" },
				{ type: "its-term", value: "yes" },
				{ type: "its-locale-filter", value: "en de" },
			]),
		);
		expect(result.document.units[1].notes).toContainEqual(
			expect.objectContaining({
				category: "its-localization-note",
				text: "Shown on home",
			}),
		);
	});

	it("supports the safe basic ITS translateRule subset and rejects unsupported XPath", async () => {
		const source = `<root xmlns:its="http://www.w3.org/2005/11/its">
  <its:rules version="2.0"><its:translateRule selector="//locked" translate="no"/></its:rules>
  <open>Translate</open><locked>Keep</locked>
</root>`;
		const imported = await importXmlFile(new File([source], "rules.xml"));
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments).toEqual(["Translate"]);

		const unsupported = source.replace("//locked", "//locked[position()=1]");
		await expect(
			validateXmlFile(new File([unsupported], "rules.xml")),
		).resolves.toMatchObject({
			valid: false,
			errorCode: "XML_UNSUPPORTED_ITS",
		});
	});

	it("patches text, CDATA, and quoted attributes without reserializing the document", async () => {
		const source = `<?keep processing?>
<root><!--comment--><text title='A &amp; B'>Hello &lt;world&gt;</text><raw><![CDATA[One < two]]></raw></root>`;
		const { project } = await importProject(
			source,
			"values.xml",
			{ attributeSelectors: "//text/@title" },
			["X & Y's", "Hallo <Welt>", "Drei ]]> vier"],
		);
		const output = buildXmlTranslation(project);
		expect(output).toContain("<?keep processing?>");
		expect(output).toContain("<!--comment-->");
		expect(output).toContain("title='X &amp; Y&apos;s'");
		expect(output).toContain("Hallo &lt;Welt&gt;");
		expect(output).toContain("<![CDATA[Drei ]]]]><![CDATA[> vier]]>");
		expect(() => parseXmlSyntax(output)).not.toThrow();
	});

	it("preserves identity bytes, entity spelling, whitespace, and UTF-16 BOMs", async () => {
		const source = encodeTextBytes(
			'<?xml version="1.0" encoding="UTF-16"?>\r\n<root> Café &#x26; tea </root>\r\n',
			"utf-16be",
			true,
		);
		const identity = await importProject(source, "utf16.xml", {}, [
			"Café & tea",
		]);
		expect(await bytes(buildXmlTranslationBlob(identity.project))).toEqual(
			source,
		);
		identity.project.translationData.seg2 = ["Kaffee & Tee"];
		expect(
			decodeTextBytes(await bytes(buildXmlTranslationBlob(identity.project))),
		).toMatchObject({
			encoding: "utf-16be",
			hasBom: true,
			text: expect.stringContaining("<root> Kaffee &amp; Tee </root>"),
		});
	});

	it("can disable CDATA extraction and ITS processing explicitly", async () => {
		const source = `<root xmlns:its="http://www.w3.org/2005/11/its"><a its:translate="no">Visible</a><b><![CDATA[Raw]]></b></root>`;
		const result = await importXmlFile(new File([source], "options.xml"), {
			respectIts: false,
			includeCdata: false,
		});
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Visible"]);
	});

	it("rejects malformed XML and unsafe entity declarations", async () => {
		for (const source of [
			"<root><open></root>",
			'<!DOCTYPE root [<!ENTITY x SYSTEM "file:///etc/passwd">]><root>&x;</root>',
			"<root attr=unquoted />",
		]) {
			await expect(
				validateXmlFile(new File([source], "bad.xml")),
			).resolves.toMatchObject({ valid: false });
		}
	});

	it("blocks structural edits and refuses stale positional mappings", async () => {
		const { project } = await importProject("<root>Hello</root>");
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton)
			throw new Error("Expected XML skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 7;
		expect(() => buildXmlTranslation(project)).toThrow(/do not align uniquely/);
	});

	it("imports 1,000 XML values deterministically", async () => {
		const source = `<root>${Array.from(
			{ length: 1_000 },
			(_, index) => `<message id="${index}">Message ${index}</message>`,
		).join("")}</root>`;
		const first = await importXmlFile(new File([source], "large.xml"), {
			elementSelectors: "//message",
		});
		const second = await importXmlFile(new File([source], "large.xml"), {
			elementSelectors: "//message",
		});
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it("uses the SpreadsheetML 2003 profile and protects formulas and workbook markup", async () => {
		const source = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:custom="urn:opaque">
  <Styles><Style ss:ID="Default"><Alignment ss:Horizontal="Left"/></Style></Styles>
  <Worksheet ss:Name="Report"><Table>
    <Row><Cell><Data ss:Type="String">Hello עולם مرحبا 😀</Data></Cell><Cell><Data ss:Type="Number">42</Data></Cell></Row>
    <Row><Cell ss:Formula="=R[-1]C[1]*2"><Data ss:Type="String">Cached formula text</Data></Cell><Cell><Data ss:Type="String">Second value</Data></Cell></Row>
  </Table><custom:Opaque custom:code="keep">Do not translate</custom:Opaque></Worksheet>
</Workbook>`;
		const { result, project } = await importProject(source, "workbook.xml", {
			segmentationMode: "value",
			elementSelectors: "//*",
			attributeSelectors: "//*[@*]",
		});
		expect(result.typeRef).toMatchObject({ profile: "spreadsheetml-2003" });
		expect(result.segments).toEqual(["Hello עולם مرحبا 😀", "Second value"]);
		expect(result.document.metadata).toMatchObject({
			profile: "SpreadsheetML 2003",
		});

		expect(await bytes(buildXmlTranslationBlob(project))).toEqual(
			new TextEncoder().encode(source),
		);
		project.translationData.seg2 = ["Translated שלום مرحبا", "Zweiter Wert"];
		const output = buildXmlTranslation(project);
		expect(output).toContain("Translated שלום مرحبا");
		expect(output).toContain("Zweiter Wert");
		expect(output).toContain('ss:Formula="=R[-1]C[1]*2"');
		expect(output).toContain("Cached formula text");
		expect(output).toContain(
			'<custom:Opaque custom:code="keep">Do not translate</custom:Opaque>',
		);
		const reopened = await importXmlFile(
			new File([output], "translated.xml", { type: "application/xml" }),
			{ segmentationMode: "value" },
		);
		expect(reopened.kind).toBe("segments");
		if (reopened.kind === "segments")
			expect(reopened.segments).toEqual([
				"Translated שלום مرحبا",
				"Zweiter Wert",
			]);
	});

	it("handles a generated large SpreadsheetML workbook deterministically", async () => {
		const rows = Array.from(
			{ length: 750 },
			(_, index) =>
				`<Row><Cell><Data ss:Type="String">Value ${index} 世界</Data></Cell></Row>`,
		).join("");
		const source = `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Large"><Table>${rows}</Table></Worksheet></Workbook>`;
		const imported = await importXmlFile(
			new File([source], "large-workbook.xml"),
			{ segmentationMode: "value" },
		);
		expect(imported.kind).toBe("segments");
		if (imported.kind === "segments") {
			expect(imported.segments).toHaveLength(750);
			expect(imported.segments.at(-1)).toBe("Value 749 世界");
		}
	});
});
