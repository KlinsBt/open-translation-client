import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { makeUserData } from "../../test/fixtures";
import {
	importLegacyOfficeFile,
	buildLegacyOfficeTranslation,
} from "./legacyOffice";
import { importPptxFile, validatePptxFile } from "./importers";
import { buildPptxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationPptx";
import { importXmlFile } from "./xmlFamily";
import { buildXmlTranslation } from "$lib/functions/outputGeneration/outputGenerationXml";
import { detectFormatWithConfidence } from "./registry";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";

describe("FF-500 browser-native Office variants", () => {
	it("imports XLSB and creates a reopenable modern spreadsheet conversion", async () => {
		const XLSX = await import("xlsx");
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([["Hello שלום مرحبا 😀"], ["Second"]]),
			"Main",
		);
		const source = new File(
			[XLSX.write(workbook, { type: "array", bookType: "xlsb" })],
			"browser.xlsb",
			{ type: "application/vnd.ms-excel.sheet.binary.macroenabled.12" },
		);
		expect(await detectFormatWithConfidence(source)).toMatchObject({
			formatId: "legacy-office",
			supported: true,
		});
		const imported = await importLegacyOfficeFile(source);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const project = makeUserData({
			type: "legacy-office",
			name: source.name,
			typeRef: imported.typeRef!,
			seg1: imported.segments,
			seg2: ["Translated שלום مرحبا 😀", "Zweite"],
			checked: [true, true],
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		const output = await buildLegacyOfficeTranslation(project);
		expect(output.extension).toBe("xlsx");
		const reopened = XLSX.read(await output.blob.arrayBuffer(), {
			type: "array",
		});
		expect(reopened.Sheets.Main.A1.v).toBe("Translated שלום مرحبا 😀");

		project.translationData.name = `ff500-browser-${Date.now()}.xlsb`;
		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === project.translationData.name,
		);
		expect(restored?.translationData.typeRef).toMatchObject({
			sourceExtension: "xlsb",
		});
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);
	});

	it("edits and reopens an SLDX package without dropping opaque resources", async () => {
		const zip = new JSZip();
		zip.file(
			"[Content_Types].xml",
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/></Types>',
		);
		zip.file(
			"_rels/.rels",
			`<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="ppt/slides/slide1.xml"/></Relationships>`,
		);
		zip.file(
			"ppt/slides/slide1.xml",
			`<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Standalone 世界.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
		);
		zip.file("ppt/media/opaque.bin", new Uint8Array([9, 8, 7]));
		const source = new File(
			[await zip.generateAsync({ type: "uint8array" })],
			"slide.sldx",
			{
				type: "application/vnd.openxmlformats-officedocument.presentationml.slide",
			},
		);
		expect(await detectFormatWithConfidence(source)).toMatchObject({
			formatId: "pptx",
			supported: true,
		});
		expect(await validatePptxFile(source)).toEqual({ valid: true });
		const imported = await importPptxFile(source, {
			includeNotes: false,
			includeAltText: false,
		});
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const project = makeUserData({
			type: "pptx",
			name: source.name,
			typeRef: imported.typeRef!,
			seg1: imported.segments,
			seg2: ["Übersetzte שקופית شريحة."],
			checked: [true],
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		const output = await buildPptxTranslationPackage(project);
		const reopened = await importPptxFile(
			new File([output], "translated.sldx", { type: output.type }),
			{ includeNotes: false, includeAltText: false },
		);
		expect(reopened).toMatchObject({
			kind: "segments",
			segments: ["Übersetzte שקופית شريحة."],
		});
		const outputZip = await JSZip.loadAsync(await output.arrayBuffer());
		expect(
			await outputZip.file("ppt/media/opaque.bin")!.async("uint8array"),
		).toEqual(new Uint8Array([9, 8, 7]));
	});

	it("applies the SpreadsheetML 2003 profile in the browser", async () => {
		const source = `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Main"><Table><Row><Cell><Data ss:Type="String">Hello עולם</Data></Cell><Cell ss:Formula="=1+1"><Data ss:Type="Number">2</Data></Cell></Row></Table></Worksheet></Workbook>`;
		const imported = await importXmlFile(
			new File([source], "spreadsheet.xml", { type: "application/xml" }),
			{ segmentationMode: "value" },
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.typeRef).toMatchObject({ profile: "spreadsheetml-2003" });
		const project = makeUserData({
			type: "xml",
			name: "spreadsheet.xml",
			typeRef: imported.typeRef!,
			seg1: imported.segments,
			seg2: ["Hallo עולם"],
			checked: [true],
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		const output = buildXmlTranslation(project);
		expect(output).toContain("Hallo עולם");
		expect(output).toContain('ss:Formula="=1+1"');
	});
});
