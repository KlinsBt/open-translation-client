// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { makeUserData } from "../../test/fixtures";
import {
	applyTranslationsToWorkbook,
	getWorkbookSheetCatalog,
	segmentWorkbookStrings,
} from "$lib/functions/parsing/parsingXlsx";
import { buildXlsxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationXlsx";
import { importXlsxFile, validateXlsxFile } from "./importers";
import { safeParseXml } from "./safeInput";
import {
	detectXlsxFamilyExtension,
	XLSX_FAMILY_MIME_TYPES,
	xlsxFamilyOutputName,
} from "./xlsxPackage";

const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PR = "http://schemas.openxmlformats.org/package/2006/relationships";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

async function spreadsheetFile(
	entries: Record<string, string | Uint8Array>,
	name = "workbook.xlsx",
) {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	const bytes = await zip.generateAsync({ type: "uint8array" });
	const extension = name
		.split(".")
		.at(-1) as keyof typeof XLSX_FAMILY_MIME_TYPES;
	return {
		bytes,
		file: new File([bytes], name, {
			type: XLSX_FAMILY_MIME_TYPES[extension] ?? "application/octet-stream",
		}),
	};
}

function projectFromImport(result: Awaited<ReturnType<typeof importXlsxFile>>) {
	if (result.kind !== "segments") throw new Error("Expected XLSX segments");
	return makeUserData({
		type: "xlsx",
		typeRef: result.typeRef!,
		seg1: result.segments,
		seg2: [...result.segments],
		checked: result.segments.map(() => false),
		documentModel: result.document,
		skeleton: result.skeleton,
		filterOptions: result.filterOptions,
	});
}

const workbookXml = `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="Visible" sheetId="1" r:id="rId10"/><sheet name="Hidden data" sheetId="2" state="hidden" r:id="rId2"/></sheets></workbook>`;
const workbookRelationships = `<Relationships xmlns="${PR}"><Relationship Id="rId10" Type="${R}/worksheet" Target="worksheets/sheet10.xml"/><Relationship Id="rId2" Type="${R}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>`;

describe("XLSX workbook extraction", () => {
	it("follows workbook relationship order and supports sheet names and hidden-sheet policy", () => {
		const parts = {
			"xl/workbook.xml": workbookXml,
			"xl/_rels/workbook.xml.rels": workbookRelationships,
			"xl/worksheets/sheet10.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>First.</t></is></c></row></sheetData></worksheet>`,
			"xl/worksheets/sheet2.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hidden.</t></is></c></row></sheetData></worksheet>`,
		};
		expect(getWorkbookSheetCatalog(parts).map((sheet) => sheet.name)).toEqual([
			"Visible",
			"Hidden data",
		]);
		expect(
			segmentWorkbookStrings(parts, [], { includeHiddenSheets: false })
				.allSegments,
		).toEqual(["First."]);
		expect(
			segmentWorkbookStrings(parts, [], {
				worksheetPaths: ["Hidden data"],
			}).allSegments,
		).toEqual(["Hidden."]);
	});

	it("filters rows and columns while always protecting formula results", () => {
		const parts = {
			"xl/workbook.xml": "<workbook/>",
			"xl/worksheets/sheet1.xml": `<worksheet xmlns="${S}"><sheetData>
			<row r="1"><c r="A1" t="inlineStr"><is><t>Header</t></is></c></row>
			<row r="2"><c r="A2" t="inlineStr"><is><t>Selected</t></is></c><c r="B2"><v>42</v></c><c r="C2" t="str"><f>CONCAT("Do"," not translate")</f><v>Cached result</v></c></row>
			</sheetData></worksheet>`,
		};
		const parsed = segmentWorkbookStrings(parts, [], {
			rows: new Set([2]),
			columns: new Set([1, 2, 3]),
			includeCellValues: true,
		});
		expect(parsed.allSegments).toEqual(["Selected", "42"]);
		expect(parsed.allSegments).not.toContain("Cached result");
	});

	it("preserves later source cells when a legacy caller supplies fewer targets", () => {
		const parts = {
			"xl/workbook.xml": "<workbook/>",
			"xl/worksheets/sheet1.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>First</t></is></c><c r="B1" t="inlineStr"><is><t>Second</t></is></c></row></sheetData></worksheet>`,
		};
		const output = applyTranslationsToWorkbook(parts, ["Translated"], []);
		expect(output["xl/worksheets/sheet1.xml"]).toContain("Translated");
		expect(output["xl/worksheets/sheet1.xml"]).toContain("Second");
	});

	it("preserves rich runs, leading whitespace, and XML-safe non-breaking spaces", () => {
		const parts = {
			"xl/workbook.xml": workbookXml,
			"xl/_rels/workbook.xml.rels": workbookRelationships,
			"xl/sharedStrings.xml": `<sst xmlns="${S}" count="1" uniqueCount="1"><si><r><rPr><b/></rPr><t xml:space="preserve">  Hello </t></r><r><t>world.\u00a0 </t></r></si></sst>`,
			"xl/worksheets/sheet10.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
			"xl/worksheets/sheet2.xml": `<worksheet xmlns="${S}"><sheetData/></worksheet>`,
		};
		const output = applyTranslationsToWorkbook(
			parts,
			["Hallo Welt.\u00a0 "],
			["."],
			{ worksheetPaths: ["Visible"] },
		);
		const shared = safeParseXml(output["xl/sharedStrings.xml"] as string);
		const items = Array.from(shared.getElementsByTagName("si"));
		expect(items).toHaveLength(2);
		expect(items[0].textContent).toBe("  Hello world.\u00a0 ");
		expect(items[1].textContent).toBe("  Hallo Welt.\u00a0 ");
		expect(items[1].getElementsByTagName("b")).toHaveLength(1);
		expect(output["xl/sharedStrings.xml"]).not.toContain("&nbsp;");
	});
});

describe("XLSX-family package round trips", () => {
	it("isolates filtered shared-string translations from unselected cells", async () => {
		const comments = `<comments xmlns="${S}"><authors><author>Reviewer</author></authors><commentList><comment ref="A1" authorId="0"><text><t>Keep this note.</t></text></comment></commentList></comments>`;
		const table = `<table xmlns="${S}" id="1" name="Table1" displayName="Table1" ref="A1:B1"/>`;
		const drawing = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>`;
		const chart = `<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>`;
		const source = await spreadsheetFile({
			"[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
			"_rels/.rels": `<Relationships xmlns="${PR}"/>`,
			"xl/workbook.xml": workbookXml,
			"xl/_rels/workbook.xml.rels": workbookRelationships,
			"xl/sharedStrings.xml": `<sst xmlns="${S}" count="2" uniqueCount="1"><si><t>Shared text.</t></si></sst>`,
			"xl/worksheets/sheet10.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" s="4" t="s"><v>0</v></c><c r="B1" t="s"><v>0</v></c></row></sheetData><hyperlinks><hyperlink ref="A1" r:id="link1" xmlns:r="${R}"/></hyperlinks></worksheet>`,
			"xl/worksheets/sheet2.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
			"xl/worksheets/_rels/sheet10.xml.rels": `<Relationships xmlns="${PR}"><Relationship Id="link1" Type="${R}/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>`,
			"xl/styles.xml": `<styleSheet xmlns="${S}"/>`,
			"xl/comments1.xml": comments,
			"xl/tables/table1.xml": table,
			"xl/drawings/drawing1.xml": drawing,
			"xl/charts/chart1.xml": chart,
		});
		const imported = await importXlsxFile(source.file, {
			worksheetPaths: "Visible",
			columns: "A",
		});
		const project = projectFromImport(imported);
		project.translationData.seg2 = ["Translated text."];
		const output = await JSZip.loadAsync(
			await (await buildXlsxTranslationPackage(project)).arrayBuffer(),
		);
		const shared = safeParseXml(
			await output.file("xl/sharedStrings.xml")!.async("string"),
		);
		expect(
			Array.from(shared.getElementsByTagName("si")).map(
				(item) => item.textContent,
			),
		).toEqual(["Shared text.", "Translated text."]);
		const visibleSheet = await output
			.file("xl/worksheets/sheet10.xml")!
			.async("string");
		expect(visibleSheet).toContain('<c r="A1" s="4" t="s"><v>1</v>');
		expect(visibleSheet).toContain('<c r="B1" t="s"><v>0</v>');
		expect(
			await output.file("xl/worksheets/sheet2.xml")!.async("string"),
		).toContain("<v>0</v>");
		expect(
			await output
				.file("xl/worksheets/_rels/sheet10.xml.rels")!
				.async("string"),
		).toContain("https://example.com");
		expect(await output.file("xl/styles.xml")!.async("string")).toContain(
			"styleSheet",
		);
		expect(await output.file("xl/comments1.xml")!.async("string")).toBe(
			comments,
		);
		expect(await output.file("xl/tables/table1.xml")!.async("string")).toBe(
			table,
		);
		expect(await output.file("xl/drawings/drawing1.xml")!.async("string")).toBe(
			drawing,
		);
		expect(await output.file("xl/charts/chart1.xml")!.async("string")).toBe(
			chart,
		);
	});

	it("preserves formulas, cached results, macros, and unknown package parts", async () => {
		const macro = new Uint8Array([0, 255, 80, 75, 3, 4, 19]);
		const formula = `<c r="B1"><f>SUM(1,2)</f><v>3</v></c>`;
		const source = await spreadsheetFile(
			{
				"[Content_Types].xml": `<Types><Override ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>`,
				"xl/workbook.xml": "<workbook/>",
				"xl/worksheets/sheet1.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Translate.</t></is></c>${formula}</row></sheetData></worksheet>`,
				"xl/vbaProject.bin": macro,
				"custom/opaque.bin": new Uint8Array([9, 8, 7]),
			},
			"source.xlsm",
		);
		vi.stubGlobal("macroExecuted", false);
		const imported = await importXlsxFile(source.file, {
			includeCellValues: true,
		});
		expect(imported).toMatchObject({
			kind: "segments",
			segments: ["Translate."],
		});
		const project = projectFromImport(imported);
		project.translationData.seg2 = ["Übersetzt."];
		const blob = await buildXlsxTranslationPackage(project);
		const output = await JSZip.loadAsync(await blob.arrayBuffer());
		expect(blob.type).toBe(XLSX_FAMILY_MIME_TYPES.xlsm);
		expect(await output.file("xl/vbaProject.bin")!.async("uint8array")).toEqual(
			macro,
		);
		expect(await output.file("custom/opaque.bin")!.async("uint8array")).toEqual(
			new Uint8Array([9, 8, 7]),
		);
		const sheet = await output
			.file("xl/worksheets/sheet1.xml")!
			.async("string");
		expect(sheet).toContain("SUM(1,2)");
		expect(sheet).toContain("<v>3</v>");
		expect(
			(globalThis as typeof globalThis & { macroExecuted: boolean })
				.macroExecuted,
		).toBe(false);
	});

	it("returns exact source bytes for an identity macro workbook", async () => {
		const source = await spreadsheetFile(
			{
				"xl/workbook.xml": "<workbook/>",
				"xl/worksheets/sheet1.xml": `<worksheet xmlns="${S}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Hello.</t></is></c></row></sheetData></worksheet>`,
				"xl/vbaProject.bin": new Uint8Array([1, 2, 3]),
			},
			"source.xlsm",
		);
		const output = await buildXlsxTranslationPackage(
			projectFromImport(await importXlsxFile(source.file)),
		);
		expect(new Uint8Array(await output.arrayBuffer())).toEqual(source.bytes);
	});

	it.each([
		["xlsx", false, false],
		["xlsm", true, false],
		["xltx", false, true],
		["xltm", true, true],
	] as const)("retains the .%s family type", (extension, macro, template) => {
		const parts: Record<string, string | Blob> = {
			"xl/workbook.xml": "<workbook/>",
			"[Content_Types].xml": template
				? `<Types><Override ContentType="application/vnd.${macro ? "ms-excel.template.macroEnabled" : "openxmlformats-officedocument.spreadsheetml.template"}.main+xml"/></Types>`
				: "<Types/>",
		};
		if (macro) parts["xl/vbaProject.bin"] = new Blob(["macro"]);
		expect(detectXlsxFamilyExtension(parts, `source.${extension}`)).toBe(
			extension,
		);
		expect(
			xlsxFamilyOutputName("Translation.xlsx", parts, `source.${extension}`),
		).toBe(`Translation.${extension}`);
	});

	it("rejects malformed workbook and worksheet XML", async () => {
		const malformedWorkbook = await spreadsheetFile({
			"xl/workbook.xml": "<workbook><broken></workbook>",
		});
		await expect(
			validateXlsxFile(malformedWorkbook.file),
		).resolves.toMatchObject({ valid: false, errorCode: "XML_MALFORMED" });
		const malformedSheet = await spreadsheetFile({
			"xl/workbook.xml": "<workbook/>",
			"xl/worksheets/sheet1.xml": "<notWorksheet/>",
		});
		await expect(validateXlsxFile(malformedSheet.file)).resolves.toMatchObject({
			valid: false,
			reason: expect.stringContaining("root"),
		});
		const malformedRelationships = await spreadsheetFile({
			"_rels/.rels": "<notRelationships/>",
			"xl/workbook.xml": "<workbook/>",
		});
		await expect(
			validateXlsxFile(malformedRelationships.file),
		).resolves.toMatchObject({
			valid: false,
			reason: expect.stringContaining("_rels/.rels"),
		});
	});
});
