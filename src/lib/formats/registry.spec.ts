// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { FORMAT_IDS } from "./formatIds";
import {
	detectFormat,
	FORMAT_ADAPTERS,
	getFormatAcceptValue,
	getFormatAdapter,
	getSupportedFormatLabels,
} from "./registry";

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
			".txt,.json,.docx,.xlsx,.xls,.html,.htm",
		);
		expect(getSupportedFormatLabels()).toBe("TXT, JSON, DOCX, XLSX, HTML");
	});

	it("detects MIME types before extensions and handles uppercase extensions", async () => {
		await expect(
			detectFormat(textFile("{}", "wrong.TXT", "application/json")),
		).resolves.toMatchObject({ id: "json" });
		await expect(
			detectFormat(textFile("plain", "NOTES.TXT", "")),
		).resolves.toMatchObject({ id: "text" });
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
			filterOptions: { segmentationMode: "lines" },
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
		expect(result.segmentsMeta).toEqual([
			{ path: ["title"], separator: "" },
			{ path: ["nested", "count"], separator: "" },
		]);
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
		).resolves.toMatchObject({ valid: false });

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
