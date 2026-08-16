import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateXML } from "xmllint-wasm/index-node.js";
import { importXliffProjectStreaming } from "./streamingImporters";
import { validateNeutralDocument } from "./documentModel";
import {
	XLIFF_2_NAMESPACE,
	XLIFF_20_SCHEMA,
	XLIFF_21_SCHEMA,
	buildXliff2,
	validateXliff2Xml,
	type Xliff2DocumentMetadata,
	type Xliff2UnitMetadata,
} from "./xliff2";
import { makeUserData } from "../../test/fixtures";
import {
	buildXliff2_0,
	buildXliff2_1,
} from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
import official20Schema from "../../test/fixtures/xliff2/xliff-core-2.0.xsd?raw";
import official21Schema from "../../test/fixtures/xliff2/xliff-core-2.1.xsd?raw";
import xmlSchema from "../../test/fixtures/xliff2/xml.xsd?raw";

const fixturePath = (name: string) =>
	fileURLToPath(new URL(`../../test/fixtures/xliff2/${name}`, import.meta.url));

async function fixture(name: string): Promise<string> {
	return readFile(fixturePath(name), "utf8");
}

function textFile(xml: string, name = "document.xlf"): File {
	return new File([xml], name, { type: "application/xliff+xml" });
}

async function validateWithOfficialSchema(
	xml: string,
	version: "2.0" | "2.1" = "2.1",
) {
	const contents = version === "2.0" ? official20Schema : official21Schema;
	return validateXML({
		xml: { fileName: "document.xlf", contents: xml },
		schema: { fileName: `xliff-core-${version}.xsd`, contents },
		preload: [{ fileName: "xml.xsd", contents: xmlSchema }],
	});
}

describe("XLIFF 2.0/2.1 interoperability", () => {
	it("imports multi-file units, segments, ignorables, notes, state, order, and inline codes", async () => {
		const result = await importXliffProjectStreaming(
			textFile(await fixture("complex-2.1.xlf")),
		);
		const data = result.data.translationData;
		expect(data.sourceLang).toBe("en-US");
		expect(data.targetLang).toBe("de-DE");
		expect(data.seg1).toEqual([
			"Hello world!",
			"layout",
			"Second sentence.",
			"Do not translate",
			"Done",
		]);
		expect(data.seg2).toEqual([
			"Hallo Welt!",
			"Layout",
			"Zweiter Satz.",
			"",
			"Fertig",
		]);
		expect(data.checked).toEqual([true, false, false, false, true]);
		const document = data.documentModel!;
		expect(document.units).toHaveLength(5);
		expect(validateNeutralDocument(document)).toEqual({
			valid: true,
			issues: [],
		});
		expect(document.units[0].notes).toHaveLength(2);
		expect(document.units[1].translatable).toBe(false);
		expect(document.units[3].translatable).toBe(false);
		expect(
			document.units[0].source.fragments.map((fragment) =>
				fragment.kind === "code" ? fragment.codeType : fragment.text,
			),
		).toEqual([
			"Hello ",
			"start",
			"start",
			"world",
			"end",
			"end",
			"standalone",
			"!",
		]);
		const firstMetadata = document.units[0].metadata
			?.xliff2 as Xliff2UnitMetadata;
		expect(firstMetadata.segmentAttributes.canResegment).toBe("no");
		expect(firstMetadata.targetAttributes.order).toBe("2");
		expect(firstMetadata.unitAttributes["acme:flag"]).toBe("keep");
		const documentMetadata = document.metadata
			?.xliff2 as Xliff2DocumentMetadata;
		expect(documentMetadata.version).toBe("2.1");
		expect(documentMetadata.skeletonXml).toContain("acme:groupInfo");
	});

	it("preserves original data, modules, extensions, grouping, and inline codes after edits", async () => {
		const imported = await importXliffProjectStreaming(
			textFile(await fixture("complex-2.1.xlf")),
		);
		imported.data.translationData.seg2[0] = "Guten Tag schöne Welt!";
		const output = buildXliff2(imported.data, "2.1");
		expect(output).toContain('version="2.1"');
		for (const marker of [
			"<originalData",
			"<mtc:matches",
			"<gls:glossary",
			"<val:validation",
			"<slr:profiles",
			"<acme:unitData",
			"<acme:groupInfo",
			'dataRefStart="d1"',
			'order="2"',
		])
			expect(output).toContain(marker);
		expect(validateXliff2Xml(output)).toEqual({ valid: true, issues: [] });
		const reimported = await importXliffProjectStreaming(textFile(output));
		expect(reimported.data.translationData.seg2[0]).toBe(
			"Guten Tag schöne Welt!",
		);
		expect(
			reimported.data.translationData.documentModel?.units[0].target.fragments.filter(
				(fragment) => fragment.kind === "code",
			),
		).toHaveLength(5);
	});

	it("accepts namespace-prefixed XLIFF and keeps file-local ids distinct", async () => {
		const result = await importXliffProjectStreaming(
			textFile(await fixture("prefixed-2.0.xlf")),
		);
		expect(result.data.translationData.seg1).toEqual(["Hello"]);
		expect(result.data.translationData.seg2).toEqual(["Bonjour"]);
		expect(result.data.translationData.documentModel?.units[0].id).toBe("u1");
	});

	it("uses separate conforming serializers for 2.0 and 2.1", () => {
		for (const [version, output] of [
			["2.0", buildXliff2_0(makeUserData())],
			["2.1", buildXliff2_1(makeUserData())],
		] as const) {
			const document = new DOMParser().parseFromString(
				output,
				"application/xml",
			);
			expect(document.documentElement.namespaceURI).toBe(XLIFF_2_NAMESPACE);
			expect(document.documentElement.getAttribute("version")).toBe(version);
			expect(
				document.documentElement.getAttribute("xsi:schemaLocation"),
			).toContain(version === "2.0" ? XLIFF_20_SCHEMA : XLIFF_21_SCHEMA);
			expect(validateXliff2Xml(output)).toEqual({ valid: true, issues: [] });
		}
	});

	it("validates generated 2.0 and 2.1 files against the official OASIS core schema", async () => {
		for (const [version, output] of [
			["2.0", buildXliff2_0(makeUserData())],
			["2.1", buildXliff2_1(makeUserData())],
		] as const) {
			const validation = await validateWithOfficialSchema(output, version);
			expect(validation.errors, validation.rawOutput).toEqual([]);
			expect(validation.valid).toBe(true);
		}
	});

	it("validates the complex module-bearing fixture against the official core schema", async () => {
		const validation = await validateWithOfficialSchema(
			await fixture("complex-2.1.xlf"),
		);
		expect(validation.errors, validation.rawOutput).toEqual([]);
		expect(validation.valid).toBe(true);
	});

	it.each([
		[
			"missing srcLang",
			'<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.1"><file id="f"><unit id="u"><segment><source>x</source></segment></unit></file></xliff>',
		],
		[
			"duplicate unit ids",
			'<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en"><file id="f"><unit id="u"><segment><source>a</source></segment></unit><unit id="u"><segment><source>b</source></segment></unit></file></xliff>',
		],
		[
			"broken sc/ec reference",
			'<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en"><file id="f"><unit id="u"><segment><source><sc id="a"/><ec startRef="missing"/></source></segment></unit></file></xliff>',
		],
		[
			"missing original-data reference",
			'<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="en"><file id="f"><unit id="u"><segment><source><ph id="p" dataRef="missing"/></source></segment></unit></file></xliff>',
		],
	])("rejects malformed %s documents", async (_label, xml) => {
		await expect(
			importXliffProjectStreaming(textFile(xml)),
		).rejects.toMatchObject({ code: "XML_MALFORMED" });
	});
});
