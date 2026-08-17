import { expect, it } from "vitest";
import JSZip from "jszip";
import { makeUserData } from "../../test/fixtures";
import { importXlsxFile } from "./importers";
import { buildXlsxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationXlsx";

const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";

async function multilingualWorkbook(): Promise<File> {
	const zip = new JSZip();
	zip.file(
		"xl/workbook.xml",
		`<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Strings" sheetId="1" r:id="rId1"/></sheets></workbook>`,
	);
	zip.file(
		"xl/_rels/workbook.xml.rels",
		`<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
	);
	zip.file(
		"xl/sharedStrings.xml",
		`<sst xmlns="${S}" count="2" uniqueCount="2"><si><t>greeting</t></si><si><t>Hallo</t></si></sst>`,
	);
	zip.file(
		"xl/worksheets/sheet1.xml",
		`<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Key</t></is></c><c r="B1" t="inlineStr"><is><t>English</t></is></c><c r="C1" t="inlineStr"><is><t>German</t></is></c></row><row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="inlineStr"><is><t>Hello</t></is></c><c r="C2" t="s"><v>1</v></c></row></sheetData></worksheet>`,
	);
	return new File(
		[await zip.generateAsync({ type: "uint8array" })],
		"multilingual.xlsx",
		{
			type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		},
	);
}

it("round-trips a multilingual-column workbook in Chromium", async () => {
	const options = {
		importMode: "multilingual-columns",
		keyColumn: "A",
		sourceColumn: "B",
		targetColumn: "C",
		headerRows: 1,
	};
	const imported = await importXlsxFile(await multilingualWorkbook(), options);
	if (imported.kind !== "segments") throw new Error("Expected XLSX segments");
	expect(imported.segments).toEqual(["Hello"]);
	expect(imported.targetSegments).toEqual(["Hallo"]);
	const project = makeUserData({
		type: "xlsx",
		typeRef: imported.typeRef!,
		seg1: imported.segments,
		seg2: ["Guten Tag"],
		checked: [false],
		documentModel: imported.document,
		skeleton: imported.skeleton,
		filterOptions: imported.filterOptions,
	});
	const output = await buildXlsxTranslationPackage(project);
	const reimported = await importXlsxFile(
		new File([output], "translated.xlsx", { type: output.type }),
		options,
	);
	expect(reimported).toMatchObject({
		segments: ["Hello"],
		targetSegments: ["Guten Tag"],
	});
});
