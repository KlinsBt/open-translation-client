import { describe, expect, it } from "vitest";
import { applyTranslationsToDocxXml, segmentDocxXml } from "./parsingDocx";
import {
	applyTranslationsToWorkbook,
	segmentSharedStringsXml,
	segmentWorkbookStrings,
} from "./parsingXlsx";

const docxXml = `<?xml version="1.0"?>
<w:document xmlns:w="urn:word"><w:body><w:p>
<w:r><w:t>Hello. </w:t></w:r><w:r><w:t>Next!</w:t></w:r>
</w:p></w:body></w:document>`;

const sharedStringsXml = `<?xml version="1.0"?>
<sst xmlns="urn:sheet"><si><t>Hello. Next!</t></si></sst>`;

const sheetXml = `<?xml version="1.0"?>
<worksheet xmlns="urn:sheet"><sheetData><row>
<c t="inlineStr"><is><t>Inline text</t></is></c>
<c><v>42</v></c>
</row></sheetData></worksheet>`;

describe("DOCX parsing and reconstruction", () => {
	it("segments text spanning multiple Word runs", () => {
		const result = segmentDocxXml(docxXml, [".", "!"]);
		expect(
			result.segments.map((segment) => `${segment.text}${segment.separator}`),
		).toEqual(["Hello. ", "Next!"]);
		expect(result.meta).toHaveLength(2);
		expect(result.meta[0].fragments).toHaveLength(1);
	});

	it("replaces translated segments using regenerated metadata", () => {
		const output = applyTranslationsToDocxXml(
			docxXml,
			["Hallo. ", "Weiter!"],
			[".", "!"],
		);
		const doc = new DOMParser().parseFromString(output, "application/xml");
		const text = Array.from(doc.getElementsByTagName("w:t"))
			.map((node) => node.textContent)
			.join("");
		expect(text).toBe("Hallo. Weiter!");
	});
});

describe("XLSX parsing and reconstruction", () => {
	it("honors a custom segmentation token in shared strings", () => {
		const xml = `<sst><si><t>left||right</t></si></sst>`;
		const result = segmentSharedStringsXml(xml, ["||"]);
		expect(result.segments.map((segment) => segment.text)).toEqual([
			"left",
			"right",
		]);
	});

	it("collects shared, inline, and value cells in export order", () => {
		const workbook = segmentWorkbookStrings(
			{
				"xl/sharedStrings.xml": sharedStringsXml,
				"xl/worksheets/sheet1.xml": sheetXml,
			},
			[".", "!"],
		);
		expect(workbook.allSegments).toEqual([
			"Hello. ",
			"Next!",
			"Inline text",
			"42",
		]);
	});

	it("updates all supported workbook string locations without mutating input", () => {
		const input = {
			"xl/sharedStrings.xml": sharedStringsXml,
			"xl/worksheets/sheet1.xml": sheetXml,
		};
		const output = applyTranslationsToWorkbook(
			input,
			["Hallo. ", "Weiter!", "Inline übersetzt", "43"],
			[".", "!"],
		);

		expect(output).not.toBe(input);
		expect(input["xl/sharedStrings.xml"]).toContain("Hello");
		expect(output["xl/sharedStrings.xml"]).toContain("Hallo. Weiter!");
		expect(output["xl/worksheets/sheet1.xml"]).toContain("Inline übersetzt");
		expect(output["xl/worksheets/sheet1.xml"]).toContain(">43<");
	});
});
