// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { validateXML } from "xmllint-wasm/index-node.js";
import { makeUserData } from "../../test/fixtures";
import multiFileFixture from "../../test/fixtures/xliff12/multi-file-inline.xlf?raw";
import missingSourceFixture from "../../test/fixtures/xliff12/malformed-missing-source.xlf?raw";
import duplicateIdFixture from "../../test/fixtures/xliff12/malformed-duplicate-id.xlf?raw";
import strictSchema from "../../test/fixtures/xliff12/xliff-core-1.2-strict.xsd?raw";
import xmlSchema from "../../test/fixtures/xliff12/xml.xsd?raw";
import conformanceWrapper from "../../test/fixtures/xliff12/conformance-wrapper.xsd?raw";
import vendorSchema from "../../test/fixtures/xliff12/vendor-extension.xsd?raw";
import { importXliffProjectStreaming } from "./streamingImporters";
import { validateNeutralDocument } from "./documentModel";
import {
	XLIFF_12_NAMESPACE,
	XLIFF_12_SCHEMA,
	contentToEditableText,
	validateXliff12Xml,
	type Xliff12DocumentMetadata,
	type Xliff12UnitMetadata,
} from "./xliff12";
import { buildXliff1_2 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile1_2";

function xliffFile(xml: string, name = "project.xlf"): File {
	return new File([xml], name, { type: "application/xliff+xml" });
}

async function validateWithOfficialSchema(
	xml: string,
	withVendorExtension = false,
) {
	return validateXML({
		xml: { fileName: "document.xlf", contents: xml },
		schema: {
			fileName: withVendorExtension
				? "conformance-wrapper.xsd"
				: "xliff-core-1.2-strict.xsd",
			contents: withVendorExtension ? conformanceWrapper : strictSchema,
		},
		preload: [
			{ fileName: "xml.xsd", contents: xmlSchema },
			...(withVendorExtension
				? [
						{
							fileName: "xliff-core-1.2-strict.xsd",
							contents: strictSchema,
						},
						{
							fileName: "vendor-extension.xsd",
							contents: vendorSchema,
						},
					]
				: []),
		],
	});
}

describe("XLIFF 1.2 interoperability", () => {
	it("imports multiple files, groups, states, notes, candidates and segmented units", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(multiFileFixture, "catalog.xlf"),
		);
		const translation = imported.data.translationData;
		const document = translation.documentModel!;

		expect(translation.seg1).toEqual(["Welcome home now", "Un.", " Deux."]);
		expect(translation.seg2).toEqual([
			"Willkommen zu Hause jetzt",
			"Uno.",
			" Dos.",
		]);
		expect(document.units).toHaveLength(3);
		expect(document.sourceLanguage).toBe("en-US");
		expect(document.targetLanguage).toBe("de-DE");
		expect(validateNeutralDocument(document)).toEqual({
			valid: true,
			issues: [],
		});

		const welcome = document.units[0];
		expect(welcome).toMatchObject({
			id: "1:welcome",
			state: "reviewed",
			translatable: false,
			contexts: [
				{ type: "sourcefile", value: "site/index.html" },
				{ type: "linenumber", value: "12" },
			],
			notes: [
				{
					category: "reviewer",
					text: "Keep the product name.",
					appliesTo: "target",
					priority: 2,
				},
			],
		});
		expect(welcome.source).toMatchObject({
			language: "en-US",
			preserveWhitespace: true,
		});
		const codeXml = welcome.source.fragments
			.filter((fragment) => fragment.kind === "code")
			.map((fragment) => fragment.originalData)
			.join(" ");
		for (const tag of ["g", "x", "ph", "bx", "ex", "bpt", "ept", "it"])
			expect(codeXml).toMatch(new RegExp(`(?:<|/)(?:[\\w.-]+:)?${tag}\\b`));

		const firstMetadata = welcome.metadata?.xliff12 as Xliff12UnitMetadata;
		expect(firstMetadata).toMatchObject({
			fileIndex: 0,
			transUnitId: "welcome",
			groupPath: [{ attributes: { id: "menu", restype: "menu" } }],
		});
		expect(firstMetadata.altTrans[0]).toContain('match-quality="87"');
		expect(firstMetadata.extensions[0]).toContain("vendor:unit-data");

		const segmented = document.units.slice(1);
		expect(segmented.map((unit) => unit.id)).toEqual([
			"2:segmented:s1",
			"2:segmented:s2",
		]);
		expect(
			segmented.map(
				(unit) => (unit.metadata?.xliff12 as Xliff12UnitMetadata).segmentMid,
			),
		).toEqual(["s1", "s2"]);
		expect(segmented.map((unit) => unit.source.language)).toEqual(["fr", "fr"]);
		expect(segmented.map((unit) => unit.target.language)).toEqual(["es", "es"]);

		const metadata = document.metadata?.xliff12 as Xliff12DocumentMetadata;
		expect(metadata.files.map((file) => file.attributes.original)).toEqual([
			"site/index.html",
			"messages.txt",
		]);
		expect(metadata.rootAttributes["vendor:project"]).toBe("catalog-42");
	});

	it("preserves inline codes and foreign extensions through export and re-import", async () => {
		const first = await importXliffProjectStreaming(
			xliffFile(multiFileFixture, "catalog.xlf"),
		);
		first.data.translationData.seg2[0] = "Willkommen daheim jetzt!";
		first.data.translationData.seg2[2] = " Dos mensajes.";
		const output = buildXliff1_2(first.data);

		expect(validateXliff12Xml(output)).toEqual({ valid: true, issues: [] });
		expect(output).toContain('xmlns:vendor="urn:example:cat-extension"');
		expect(output).toContain('vendor:project="catalog-42"');
		expect(output).toContain("<vendor:project-data");
		expect(output).toContain("<vendor:group-data");
		expect(output).toContain("<vendor:unit-data");
		expect(output).toContain("<seg-source");
		expect(output).toContain('mid="s2"');
		expect(output).toContain("Dos mensajes.");
		expect(output).toContain("Willkommen");
		expect(output).toContain("jetzt!");
		expect(output).toContain(`urn:example:cat-extension vendor-extension.xsd`);
		expect(output).toContain(`${XLIFF_12_NAMESPACE} ${XLIFF_12_SCHEMA}`);

		const official = await validateWithOfficialSchema(output, true);
		expect(official.errors, official.rawOutput).toEqual([]);
		expect(official.valid).toBe(true);

		const second = await importXliffProjectStreaming(
			xliffFile(output, "round-trip.xlf"),
		);
		expect(second.data.translationData.seg1).toEqual(
			first.data.translationData.seg1,
		);
		expect(second.data.translationData.seg2).toEqual(
			first.data.translationData.seg2,
		);
		expect(
			contentToEditableText(
				second.data.translationData.documentModel!.units[0].source,
			),
		).toBe("Welcome home now");
	});

	it("emits new projects as strict-schema-valid standard XLIFF", async () => {
		const output = buildXliff1_2(
			makeUserData({
				name: 'UI & "messages"',
				seg1: ["Save", "Cancel"],
				seg2: ["Speichern", "Abbrechen"],
				checked: [true, false],
			}),
		);
		const document = new DOMParser().parseFromString(output, "application/xml");
		const root = document.documentElement;
		const header = document.getElementsByTagNameNS(
			XLIFF_12_NAMESPACE,
			"header",
		)[0];

		expect(root.namespaceURI).toBe(XLIFF_12_NAMESPACE);
		expect(root.getAttribute("version")).toBe("1.2");
		expect(root.getAttribute("xsi:schemaLocation")).toContain(XLIFF_12_SCHEMA);
		expect(
			header.getElementsByTagNameNS(XLIFF_12_NAMESPACE, "group"),
		).toHaveLength(0);
		expect(
			header
				.getElementsByTagNameNS(XLIFF_12_NAMESPACE, "note")[0]
				.getAttribute("from"),
		).toBe("OpenTLC");
		expect(validateXliff12Xml(output).valid).toBe(true);

		const official = await validateWithOfficialSchema(output);
		expect(official.errors, official.rawOutput).toEqual([]);
		expect(official.valid).toBe(true);
	});

	it.each([
		["missing source", missingSourceFixture],
		["duplicate trans-unit ID", duplicateIdFixture],
	])("rejects malformed documents with %s", async (_case, xml) => {
		await expect(
			importXliffProjectStreaming(xliffFile(xml, "malformed.xlf")),
		).rejects.toMatchObject({ code: "XML_MALFORMED" });
	});

	it("reports schema-relevant structural and inline-code errors", () => {
		const invalid = `<?xml version="1.0"?><xliff xmlns="${XLIFF_12_NAMESPACE}" version="1.2"><file original="x" source-language="en" datatype="plaintext"><header><group/></header><body><trans-unit id="u"><source><bpt id="1" rid="r">&lt;b&gt;</bpt>text</source></trans-unit></body></file></xliff>`;
		const validation = validateXliff12Xml(invalid);
		expect(validation.valid).toBe(false);
		expect(validation.issues).toEqual(
			expect.arrayContaining([
				expect.stringContaining("invalid group inside header"),
				expect.stringContaining("unbalanced"),
			]),
		);
	});
});
