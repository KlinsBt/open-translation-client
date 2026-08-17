import JSZip from "jszip";
import type { FormatConformanceFixture } from "./formatConformance";
import {
	CONFORMANCE_UNICODE_SOURCE,
	CONFORMANCE_UNICODE_TARGET,
} from "./formatConformance";

const encoder = new TextEncoder();

function textFile(content: string, name: string, type: string): File {
	return new File([content], name, { type });
}

async function zipFile(
	entries: Record<string, string | Uint8Array>,
	name: string,
	type: string,
): Promise<File> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	return new File([await zip.generateAsync({ type: "uint8array" })], name, {
		type,
	});
}

function invalidUtf8(name: string, type: string): File {
	return new File([new Uint8Array([0xc3, 0x28])], name, { type });
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (character) => {
		return {
			"<": "&lt;",
			">": "&gt;",
			"&": "&amp;",
			"'": "&apos;",
			'"': "&quot;",
		}[character]!;
	});
}

const textFixture: FormatConformanceFixture = {
	id: "text",
	fileName: "unicode.txt",
	mimeType: "text/plain",
	importOptions: { segmentationMode: "document" },
	createValidFile: async () =>
		textFile(CONFORMANCE_UNICODE_SOURCE, "unicode.txt", "text/plain"),
	createMalformedFile: async () => invalidUtf8("broken.txt", "text/plain"),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: { segmentationMode: "document" },
		skeleton: { kind: "text", replacementKinds: ["text-range"] },
		units: [{ id: "unit-1", part: "unicode.txt", path: null }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			Array.from({ length: units }, (_, index) => `Message ${index}`).join(
				"\n",
			),
			"performance.txt",
			"text/plain",
		),
	performanceOptions: { segmentationMode: "lines" },
};

const jsonFixture: FormatConformanceFixture = {
	id: "json",
	fileName: "unicode.json",
	mimeType: "application/json",
	createValidFile: async () =>
		textFile(
			`{\n  "message": ${JSON.stringify(CONFORMANCE_UNICODE_SOURCE)},\n  "locked": { "skip": true }\n}\n`,
			"unicode.json",
			"application/json",
		),
	createMalformedFile: async () =>
		textFile('{"message":', "broken.json", "application/json"),
	expectMalformedImportFailure: true,
	importOptions: {
		pathSelectors: "message",
		includeNonStringValues: false,
	},
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			pathSelectors: "message",
			includeNonStringValues: false,
		},
		skeleton: { kind: "text", replacementKinds: ["json-value"] },
		units: [{ id: "unit-1", part: "unicode.json", path: ["message"] }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			JSON.stringify(
				Object.fromEntries(
					Array.from({ length: units }, (_, index) => [
						`message_${index}`,
						`Message ${index}`,
					]),
				),
			),
			"performance.json",
			"application/json",
		),
	performanceOptions: { pathSelectors: "", includeNonStringValues: false },
};

const htmlFixture: FormatConformanceFixture = {
	id: "html",
	fileName: "unicode.html",
	mimeType: "text/html",
	createValidFile: async () =>
		textFile(
			`<!doctype html><html><body><p data-locked="yes">${CONFORMANCE_UNICODE_SOURCE}</p></body></html>`,
			"unicode.html",
			"text/html",
		),
	createMalformedFile: async () => textFile("", "broken.html", "text/html"),
	expectMalformedImportFailure: false,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeTextNodes: true,
			translatableAttributes: "placeholder,value,alt,title",
		},
		skeleton: { kind: "text", replacementKinds: ["html-text"] },
		units: [{ id: "unit-1", part: "unicode.html", path: [0, 0] }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<!doctype html><html><body>${Array.from(
				{ length: units },
				(_, index) => `<p>Message ${index}</p>`,
			).join("")}</body></html>`,
			"performance.html",
			"text/html",
		),
};

const docxMime =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const docxFixture: FormatConformanceFixture = {
	id: "docx",
	fileName: "unicode.docx",
	mimeType: docxMime,
	createValidFile: async () =>
		zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"word/document.xml": `<w:document xmlns:w="w" xmlns:vendor="urn:test"><w:body><vendor:keep/><w:p><w:r><w:t>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</w:t></w:r></w:p></w:body></w:document>`,
				"custom/keep.bin": encoder.encode("untouched DOCX data"),
			},
			"unicode.docx",
			docxMime,
		),
	createMalformedFile: async () =>
		textFile("not a zip", "broken.docx", docxMime),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			paragraphs: "",
			trackedChanges: "current",
			includeHeadersFooters: true,
			includeNotes: true,
			includeComments: true,
			includeTextBoxes: true,
			includeDrawingText: true,
		},
		skeleton: { kind: "package", replacementKinds: ["docx-text"] },
		units: [{ id: "unit-1", part: "word/document.xml", path: null }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		zipFile(
			{
				"word/document.xml": `<w:document xmlns:w="w"><w:body>${Array.from(
					{ length: units },
					(_, index) => `<w:p><w:r><w:t>Message ${index}</w:t></w:r></w:p>`,
				).join("")}</w:body></w:document>`,
			},
			"performance.docx",
			docxMime,
		),
	expectedPackageChanges: ["word/document.xml"],
};

const xlsxMime =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xlsxFixture: FormatConformanceFixture = {
	id: "xlsx",
	fileName: "unicode.xlsx",
	mimeType: xlsxMime,
	createValidFile: async () =>
		zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"xl/workbook.xml": '<workbook xmlns="urn:test"/>',
				"xl/sharedStrings.xml": `<sst xmlns="urn:test"><si><t>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</t></si></sst>`,
				"custom/keep.bin": encoder.encode("untouched XLSX data"),
			},
			"unicode.xlsx",
			xlsxMime,
		),
	createMalformedFile: async () =>
		textFile("not a zip", "broken.xlsx", xlsxMime),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			importMode: "all-text",
			worksheetPaths: "",
			columns: "",
			rows: "",
			includeHiddenSheets: true,
			keyColumn: "A",
			sourceColumn: "B",
			targetColumn: "C",
			headerRows: 1,
			includeCellComments: true,
			includeSharedStrings: true,
			includeCellValues: false,
		},
		skeleton: { kind: "package", replacementKinds: ["xlsx-text"] },
		units: [{ id: "unit-1", part: "xl/sharedStrings.xml", path: null }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		zipFile(
			{
				"xl/workbook.xml": '<workbook xmlns="urn:test"/>',
				"xl/sharedStrings.xml": `<sst xmlns="urn:test">${Array.from(
					{ length: units },
					(_, index) => `<si><t>Message ${index}</t></si>`,
				).join("")}</sst>`,
			},
			"performance.xlsx",
			xlsxMime,
		),
	expectedPackageChanges: ["xl/sharedStrings.xml"],
};

export const FORMAT_CONFORMANCE_FIXTURES = [
	textFixture,
	jsonFixture,
	docxFixture,
	xlsxFixture,
	htmlFixture,
] as const satisfies readonly FormatConformanceFixture[];
