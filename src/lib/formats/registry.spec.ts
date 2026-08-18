// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { FORMAT_IDS } from "./formatIds";
import {
	detectFormat,
	detectFormatWithConfidence,
	FORMAT_ADAPTERS,
	getFormatAcceptValue,
	getFormatAdapter,
	getSupportedFormatLabels,
} from "./registry";
import {
	detectProjectFileFormat,
	getFileExtension,
	normalizeMimeType,
} from "./detect";
import { validateOdfFile } from "./odf";

const storage = new Map<string, string>();

beforeEach(() => {
	storage.clear();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

afterEach(() => vi.unstubAllGlobals());

function textFile(
	content: string,
	name: string,
	type = "application/octet-stream",
): File {
	return new File([content], name, { type });
}

async function zipFile(
	entries: Record<string, string>,
	name: string,
	type = "application/octet-stream",
): Promise<File> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	const bytes = await zip.generateAsync({ type: "uint8array" });
	return new File([bytes], name, { type });
}

describe("format adapter registry", () => {
	it("registers every format ID exactly once with complete capabilities", () => {
		expect(FORMAT_ADAPTERS.map((adapter) => adapter.id)).toEqual(FORMAT_IDS);
		expect(new Set(FORMAT_ADAPTERS.map((adapter) => adapter.id)).size).toBe(
			FORMAT_ADAPTERS.length,
		);

		for (const id of FORMAT_IDS) {
			const adapter = getFormatAdapter(id);
			expect(adapter.id).toBe(id);
			expect(adapter.extensions.length).toBeGreaterThan(0);
			expect(adapter.mimeTypes.length).toBeGreaterThan(0);
			expect(adapter.capabilities).toEqual({
				import: true,
				export: true,
				roundTrip: true,
			});
			expect(adapter.importOptions.length).toBeGreaterThan(0);
			expect(
				new Set(adapter.importOptions.map((option) => option.id)).size,
			).toBe(adapter.importOptions.length);
			for (const option of adapter.importOptions) {
				expect(option.id).not.toBe("");
				expect(option.label).not.toBe("");
			}
			expect(adapter.importFile).toBeTypeOf("function");
			expect(adapter.exportFile).toBeTypeOf("function");
			expect(adapter.validate).toBeTypeOf("function");
			expect(adapter.sniff).toBeTypeOf("function");
		}
	});

	it("derives upload hints and labels from the registry", () => {
		expect(getFormatAcceptValue()).toBe(
			".txt,.csv,.tsv,.json,.arb,.locjson,.yaml,.yml,.po,.pot,.xml,.strings,.stringsdict,.xcstrings,.properties,.resx,.ts,.ini,.desktop,.lang,.php,.md,.markdown,.adoc,.asciidoc,.srt,.vtt,.sbv,.odt,.ods,.odp,.epub,.svg,.docx,.docm,.dotx,.dotm,.xlsx,.xlsm,.xltx,.xltm,.pptx,.pptm,.potx,.potm,.ppsx,.ppsm,.html,.htm,.xhtml",
		);
		expect(getSupportedFormatLabels()).toBe(
			"TXT, CSV/TSV, JSON families, YAML 1.2, GNU gettext PO/POT, Android resources, Apple localization, Java/Mozilla properties, .NET RESX, Qt Linguist TS, INI/desktop/lang, PHP localization arrays, Markdown/AsciiDoc, SRT/WebVTT/SBV subtitles, OpenDocument ODT/ODS/ODP, EPUB 2/3, SVG, XML + ITS 2.0, DOCX, XLSX, PPTX, HTML",
		);
	});

	it("uses content and exact metadata while handling uppercase extensions", async () => {
		await expect(
			detectFormat(textFile("{}", "wrong.TXT", "application/json")),
		).resolves.toMatchObject({ id: "json" });
		await expect(
			detectFormat(textFile('{"hello":"Hi"}', "APP_EN.ARB", "")),
		).resolves.toMatchObject({ id: "json" });
		await expect(
			detectFormat(textFile('{"units":[]}', "CATALOG.LOCJSON", "")),
		).resolves.toMatchObject({ id: "json" });
		await expect(
			detectFormat(textFile("message: Hello", "MESSAGES.YAML", "")),
		).resolves.toMatchObject({ id: "yaml" });
		await expect(
			detectFormat(textFile('msgid "Hello"\nmsgstr ""\n', "MESSAGES.PO", "")),
		).resolves.toMatchObject({ id: "po" });
		await expect(
			detectFormat(textFile('"hello" = "Hello";\n', "LOCALIZABLE.STRINGS", "")),
		).resolves.toMatchObject({ id: "apple" });
		await expect(
			detectFormat(textFile("hello=Hello\n", "MESSAGES.PROPERTIES", "")),
		).resolves.toMatchObject({ id: "properties" });
		await expect(
			detectFormat(textFile("[ui]\ntitle=Hello\n", "MESSAGES.INI", "")),
		).resolves.toMatchObject({ id: "ini" });
		await expect(
			detectFormat(
				textFile("<?php return ['hello' => 'Hello'];", "MESSAGES.PHP", ""),
			),
		).resolves.toMatchObject({ id: "php" });
		await expect(
			detectFormat(textFile("# Hello\n\nText", "GUIDE.MARKDOWN", "")),
		).resolves.toMatchObject({ id: "markup" });
		await expect(
			detectFormat(textFile("= Hello\n\nText", "GUIDE.ASCIIDOC", "")),
		).resolves.toMatchObject({ id: "markup" });
		await expect(
			detectFormat(
				textFile(
					'<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>',
					"DIAGRAM.SVG",
					"image/svg+xml",
				),
			),
		).resolves.toMatchObject({ id: "svg" });
		await expect(
			detectFormat(
				textFile("1\n00:00:00,000 --> 00:00:05,000\nHello", "CAPTIONS.SRT", ""),
			),
		).resolves.toMatchObject({ id: "subtitles" });
		const odf = await zipFile(
			{
				mimetype: "application/vnd.oasis.opendocument.text",
				"content.xml":
					'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body><office:text><p>Hello</p></office:text></office:body></office:document-content>',
				"META-INF/manifest.xml":
					'<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/></manifest:manifest>',
			},
			"DOCUMENT.ODT",
		);
		expect(await validateOdfFile(odf)).toEqual({ valid: true });
		await expect(detectFormat(odf)).resolves.toMatchObject({ id: "odf" });
		await expect(
			detectFormat(
				textFile(
					"WEBVTT\n\n00:00.000 --> 00:05.000\nHello",
					"CAPTIONS.VTT",
					"",
				),
			),
		).resolves.toMatchObject({ id: "subtitles" });
		await expect(
			detectFormat(
				textFile(
					'<root><data name="hello"><value>Hello</value></data></root>',
					"RESOURCES.RESX",
					"application/xml",
				),
			),
		).resolves.toMatchObject({ id: "resx" });
		await expect(
			detectFormat(
				textFile(
					'<resources><string name="hello">Hi</string></resources>',
					"STRINGS.XML",
					"application/xml",
				),
			),
		).resolves.toMatchObject({ id: "android" });
		await expect(
			detectFormat(
				textFile("<catalog><message>Hi</message></catalog>", "DATA.XML", ""),
			),
		).resolves.toMatchObject({ id: "xml" });
		await expect(
			detectFormat(textFile("plain", "NOTES.TXT", "")),
		).resolves.toMatchObject({ id: "text" });
		await expect(
			detectFormat(textFile("Key,Source\n1,Hello", "MESSAGES.CSV", "text/csv")),
		).resolves.toMatchObject({ id: "csv" });
		await expect(
			detectFormat(
				textFile(
					"Key\tSource\n1\tHello",
					"MESSAGES.TSV",
					"text/tab-separated-values",
				),
			),
		).resolves.toMatchObject({ id: "csv" });
		await expect(
			detectFormat(textFile("<p>Hi</p>", "page.HTM", "")),
		).resolves.toMatchObject({ id: "html" });
	});

	it("sniffs structured content when metadata is unavailable", async () => {
		await expect(
			detectFormat(textFile('{"message":"Hello"}', "payload", "")),
		).resolves.toMatchObject({ id: "json" });
		await expect(
			detectFormat(
				textFile("<!doctype html><html><body>Hi</body></html>", "page", ""),
			),
		).resolves.toMatchObject({ id: "html" });

		const docx = await zipFile(
			{
				"word/document.xml":
					'<w:document xmlns:w="urn:test"><w:body/></w:document>',
			},
			"package",
		);
		await expect(detectFormat(docx)).resolves.toMatchObject({ id: "docx" });
	});

	it("returns undefined for unsupported content", async () => {
		await expect(
			detectFormat(textFile("not a known structured format", "payload.bin")),
		).resolves.toBeUndefined();
	});

	it("normalizes MIME parameters and extracts only exact final extensions", () => {
		expect(normalizeMimeType(" Application/JSON; charset=utf-8 ")).toBe(
			"application/json",
		);
		expect(getFileExtension("REPORT.XLSX")).toBe("xlsx");
		expect(getFileExtension("report.xlsx.exe")).toBe("exe");
		expect(getFileExtension(".json")).toBeUndefined();
		expect(getFileExtension("name.")).toBeUndefined();
	});

	it("reports supported detections with confidence and evidence", async () => {
		await expect(
			detectFormatWithConfidence(
				textFile('{"message":"Hello"}', "PAYLOAD.JSON", "application/json"),
			),
		).resolves.toMatchObject({
			formatId: "json",
			label: "JSON families",
			supported: true,
			confidence: "high",
			evidence: ["content", "extension", "mime"],
		});

		await expect(
			detectFormatWithConfidence(
				textFile('{"message":"Hello"}', "payload.bin", ""),
			),
		).resolves.toMatchObject({
			formatId: "json",
			confidence: "medium",
			evidence: ["content"],
		});
	});

	it("does not advertise or silently route legacy Office binaries", async () => {
		const ole = new Uint8Array([
			0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0,
		]);
		const legacy = new File([ole], "accounts.XLS", {
			type: "application/vnd.ms-excel",
		});
		await expect(detectFormat(legacy)).resolves.toBeUndefined();
		await expect(detectFormatWithConfidence(legacy)).resolves.toMatchObject({
			formatId: null,
			label: "Legacy Excel (.xls)",
			supported: false,
			confidence: "high",
			evidence: ["signature", "extension"],
		});
		await expect(
			detectFormat(textFile("plain", "not-a-workbook.xls", "")),
		).resolves.toBeUndefined();
	});

	it("lets OOXML package structure override misleading names and MIME types", async () => {
		const renamedDocx = await zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"word/document.xml": "<document/>",
			},
			"renamed.XLSX",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);
		await expect(
			detectFormatWithConfidence(renamedDocx),
		).resolves.toMatchObject({
			formatId: "docx",
			label: "DOCX",
			confidence: "high",
			evidence: ["package", "signature"],
		});

		const renamedXlsx = await zipFile(
			{ "xl/workbook.xml": "<workbook/>" },
			"renamed.docx",
		);
		await expect(
			detectFormatWithConfidence(renamedXlsx),
		).resolves.toMatchObject({ formatId: "xlsx", label: "XLSX" });
	});

	it.each(["docm", "dotx", "dotm"])(
		"detects Word %s packages as the DOCX-family adapter",
		async (extension) => {
			const file = await zipFile(
				{
					"[Content_Types].xml": `<Types><Override ContentType="application/vnd.ms-word.${extension.includes("m") ? "macroEnabled" : "template"}.main+xml"/></Types>`,
					"word/document.xml": "<document/>",
					...(extension.includes("m")
						? { "word/vbaProject.bin": "opaque macro bytes" }
						: {}),
				},
				`document.${extension}`,
			);
			await expect(detectFormatWithConfidence(file)).resolves.toMatchObject({
				formatId: "docx",
				label: "DOCX",
				supported: true,
				confidence: "high",
			});
		},
	);

	it.each(["xlsm", "xltx", "xltm"])(
		"detects Excel %s packages as the XLSX-family adapter",
		async (extension) => {
			const file = await zipFile(
				{
					"[Content_Types].xml": `<Types><Override ContentType="application/vnd.ms-excel.${extension.includes("m") ? "macroEnabled" : "template"}.main+xml"/></Types>`,
					"xl/workbook.xml": "<workbook/>",
					...(extension.includes("m")
						? { "xl/vbaProject.bin": "opaque macro bytes" }
						: {}),
				},
				`workbook.${extension}`,
			);
			await expect(detectFormatWithConfidence(file)).resolves.toMatchObject({
				formatId: "xlsx",
				label: "XLSX",
				supported: true,
				confidence: "high",
			});
		},
	);

	it("distinguishes supported PPTX/OpenDocument/EPUB from generic ZIP packages", async () => {
		const pptx = await zipFile(
			{ "ppt/presentation.xml": "<presentation/>" },
			"slides.pptx",
		);
		await expect(detectFormatWithConfidence(pptx)).resolves.toMatchObject({
			formatId: "pptx",
			label: "PPTX",
			supported: true,
		});
		const odf = await zipFile(
			{
				mimetype: "application/vnd.oasis.opendocument.text",
				"META-INF/manifest.xml": "<manifest/>",
				"content.xml": "<document/>",
			},
			"document.odt",
		);
		await expect(detectFormatWithConfidence(odf)).resolves.toMatchObject({
			formatId: "odf",
			label: "OpenDocument ODT/ODS/ODP",
			supported: true,
		});
		const epub = await zipFile(
			{
				mimetype: "application/epub+zip",
				"META-INF/container.xml": "<container/>",
			},
			"book.epub",
		);
		await expect(detectFormatWithConfidence(epub)).resolves.toMatchObject({
			formatId: "epub",
			label: "EPUB 2/3",
			supported: true,
		});
		await expect(
			detectFormatWithConfidence(
				await zipFile({ "other.txt": "data" }, "archive.zip"),
			),
		).resolves.toMatchObject({
			formatId: null,
			label: "ZIP archive",
			supported: false,
		});
	});

	it("recognizes generic XML MIME types without treating them as HTML", async () => {
		await expect(
			detectFormatWithConfidence(
				textFile(
					'<?xml version="1.0"?><resources><string>Hello</string></resources>',
					"strings.XML",
					"application/xml; charset=utf-8",
				),
			),
		).resolves.toMatchObject({
			formatId: "xml",
			label: "XML + ITS 2.0",
			supported: true,
			confidence: "high",
			evidence: ["content", "extension", "mime"],
		});

		await expect(
			detectFormatWithConfidence(
				textFile(
					'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>Hello</body></html>',
					"page.xhtml",
					"application/xhtml+xml",
				),
			),
		).resolves.toMatchObject({
			formatId: "html",
			label: "HTML",
			supported: true,
			confidence: "high",
		});
	});

	it("detects project JSON and XLIFF from content rather than misleading extensions", async () => {
		await expect(
			detectProjectFileFormat(
				textFile(
					'<?xml version="1.0"?><xliff version="1.2"><file/></xliff>',
					"BACKUP.JSON",
					"application/xml",
				),
			),
		).resolves.toMatchObject({
			format: "xliff",
			label: "XLIFF 1.2",
			confidence: "high",
			evidence: ["content", "mime"],
		});

		await expect(
			detectProjectFileFormat(
				textFile('{"translationData":{}}', "project.xlf", ""),
			),
		).resolves.toMatchObject({
			format: "json",
			label: "Open TLC JSON",
			confidence: "medium",
			evidence: ["content"],
		});

		await expect(
			detectProjectFileFormat(
				textFile("<resources/>", "not-xliff.xlf", "application/xml"),
			),
		).resolves.toBeUndefined();
	});
});

describe("registered importers and validators", () => {
	it("imports text with configurable segmentation without altering its skeleton", async () => {
		const file = textFile(
			"First line\r\nSecond line",
			"notes.txt",
			"text/plain",
		);
		await expect(getFormatAdapter("text").validate(file)).resolves.toEqual({
			valid: true,
		});
		await expect(
			getFormatAdapter("text").importFile(file, { segmentationMode: "lines" }),
		).resolves.toMatchObject({
			kind: "segments",
			segments: ["First line", "Second line"],
			filterOptions: {
				segmentationMode: "lines",
				outputEncoding: "source",
				byteOrderMark: "preserve",
				unicodeNormalization: "preserve",
			},
			document: {
				format: "text",
				schemaVersion: 1,
			},
			skeleton: {
				schemaVersion: 1,
				format: "text",
				payload: { kind: "text", content: "First line\r\nSecond line" },
			},
		});
	});

	it("filters JSON primitives by wildcard path and value type", async () => {
		const file = textFile(
			JSON.stringify({ messages: { title: "Hello", count: 2 }, ignored: "No" }),
			"messages.json",
			"application/json",
		);
		const result = await getFormatAdapter("json").importFile(file, {
			pathSelectors: "messages.*",
			includeNonStringValues: false,
		});
		expect(result).toMatchObject({
			kind: "segments",
			segments: ["Hello"],
			filterOptions: {
				pathSelectors: "messages.*",
				includeNonStringValues: false,
			},
		});
	});

	it("imports JSON values with structural paths", async () => {
		const file = textFile(
			JSON.stringify({ title: "Hello", nested: { count: 2 } }),
			"messages.json",
			"application/json",
		);
		const result = await getFormatAdapter("json").importFile(file);

		expect(result.kind).toBe("segments");
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Hello", "2"]);
		expect(result.segmentsMeta).toMatchObject([
			{ path: ["title"], separator: "" },
			{ path: ["nested", "count"], separator: "" },
		]);
		expect(
			result.segmentsMeta?.map((entry) => "address" in entry && entry.address),
		).toEqual([[0], [1, 0]]);
		expect(result.document.units.map((unit) => unit.id)).toEqual([
			"unit-1",
			"unit-2",
		]);
		expect(result.document.units[1].sourceLocation?.path).toEqual([
			"nested",
			"count",
		]);
		expect(result.skeleton.replacements).toHaveLength(2);
	});

	it("detects and imports BOM-marked UTF-16 JSON", async () => {
		const source = '{"message":"Hello"}';
		const bytes = new Uint8Array(2 + source.length * 2);
		bytes.set([0xff, 0xfe]);
		for (let index = 0; index < source.length; index++) {
			bytes[2 + index * 2] = source.charCodeAt(index);
		}
		const file = new File([bytes], "messages.json", {
			type: "application/json",
		});
		await expect(getFormatAdapter("json").validate(file)).resolves.toEqual({
			valid: true,
		});
		const result = await getFormatAdapter("json").importFile(file);
		expect(result).toMatchObject({ kind: "segments", segments: ["Hello"] });
		expect(result.skeleton.source).toMatchObject({
			encoding: "utf-16le",
			hasBom: true,
		});
	});

	it("imports HTML and retains replacement metadata", async () => {
		const file = textFile(
			"<!doctype html><html><body><p>Hello world.</p></body></html>",
			"page.html",
			"text/html",
		);
		const result = await getFormatAdapter("html").importFile(file);

		expect(result.kind).toBe("segments");
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Hello world."]);
		expect(result.segmentsMeta).toHaveLength(1);
		expect(result.typeRef).toContain("<p>Hello world.</p>");
		expect(result.document.units).toHaveLength(1);
		expect(result.skeleton.payload).toMatchObject({ kind: "text" });
	});

	it("can import only selected HTML attributes", async () => {
		const file = textFile(
			'<p title="Tooltip" aria-label="Accessible">Visible</p>',
			"page.html",
			"text/html",
		);
		const result = await getFormatAdapter("html").importFile(file, {
			includeTextNodes: false,
			translatableAttributes: "aria-label",
		});
		expect(result).toMatchObject({
			kind: "segments",
			segments: ["Accessible"],
		});
	});

	it("accepts HTML fragments but rejects empty HTML files", async () => {
		await expect(
			getFormatAdapter("html").validate(
				textFile("<p>Fragment</p>", "part.html"),
			),
		).resolves.toEqual({ valid: true });
		await expect(
			getFormatAdapter("html").validate(textFile("  \n", "empty.html")),
		).resolves.toMatchObject({ valid: false });
	});

	it("validates and imports a minimal DOCX package", async () => {
		const file = await zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"word/document.xml":
					'<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Hello.</w:t></w:r></w:p></w:body></w:document>',
			},
			"document.docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		await expect(getFormatAdapter("docx").validate(file)).resolves.toEqual({
			valid: true,
		});
		const result = await getFormatAdapter("docx").importFile(file);
		expect(result.kind).toBe("segments");
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Hello."]);
		expect(result.segmentsMeta).toHaveLength(1);
		expect(result.document.units[0].sourceLocation?.part).toBe(
			"word/document.xml",
		);
		expect(result.skeleton.payload).toMatchObject({ kind: "package" });
	});

	it("filters DOCX paragraphs using one-based ranges", async () => {
		const file = await zipFile(
			{
				"word/document.xml":
					'<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>First.</w:t></w:r></w:p><w:p><w:r><w:t>Second.</w:t></w:r></w:p></w:body></w:document>',
			},
			"document.docx",
		);
		const result = await getFormatAdapter("docx").importFile(file, {
			paragraphs: "2",
		});
		expect(result).toMatchObject({
			kind: "segments",
			segments: ["Second."],
			filterOptions: { paragraphs: "2" },
		});
	});

	it("validates and imports a minimal XLSX package", async () => {
		const file = await zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"xl/workbook.xml": '<workbook xmlns="urn:test"/>',
				"xl/sharedStrings.xml":
					'<sst xmlns="urn:test"><si><t>Hello.</t></si></sst>',
			},
			"workbook.xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);
		await expect(getFormatAdapter("xlsx").validate(file)).resolves.toEqual({
			valid: true,
		});
		const result = await getFormatAdapter("xlsx").importFile(file);
		expect(result).toMatchObject({ kind: "segments", segments: ["Hello."] });
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.document.units[0].sourceLocation).toMatchObject({
			segmentIndex: 0,
		});
		expect(result.skeleton.replacements[0]).toMatchObject({
			kind: "xlsx-text",
			part: "xl/sharedStrings.xml",
		});
	});

	it("filters XLSX worksheet columns and excludes cell values", async () => {
		const file = await zipFile(
			{
				"xl/workbook.xml": '<workbook xmlns="urn:test"/>',
				"xl/worksheets/sheet1.xml":
					'<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Keep</t></is></c><c r="B1" t="inlineStr"><is><t>Skip</t></is></c><c r="A2"><v>42</v></c></row></sheetData></worksheet>',
				"xl/worksheets/sheet2.xml":
					'<worksheet><sheetData><row><c r="A1" t="inlineStr"><is><t>Other sheet</t></is></c></row></sheetData></worksheet>',
			},
			"workbook.xlsx",
		);
		const result = await getFormatAdapter("xlsx").importFile(file, {
			worksheetPaths: "sheet1",
			columns: "A",
			includeSharedStrings: false,
			includeCellValues: false,
		});
		expect(result).toMatchObject({ kind: "segments", segments: ["Keep"] });
	});

	it("rejects malformed JSON and mislabeled Office packages", async () => {
		await expect(
			getFormatAdapter("json").validate(
				textFile("{broken", "broken.json", "application/json"),
			),
		).resolves.toMatchObject({ valid: false, errorCode: "JSON_MALFORMED" });

		const zip = await zipFile({ "other.xml": "<other/>" }, "wrong.docx");
		await expect(getFormatAdapter("docx").validate(zip)).resolves.toMatchObject(
			{
				valid: false,
			},
		);
		await expect(getFormatAdapter("xlsx").validate(zip)).resolves.toMatchObject(
			{
				valid: false,
			},
		);
	});
});
