// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { makeUserData } from "../../test/fixtures";
import {
	importDocxFile,
	importHtmlFile,
	importJsonFile,
	importTextFile,
	importXlsxFile,
} from "./importers";
import { buildTextTranslationFromProject } from "$lib/functions/outputGeneration/outputGenerationText";
import { buildJsonTranslation } from "$lib/functions/outputGeneration/outputGenerationJson";
import { buildHtmlTranslation } from "$lib/functions/outputGeneration/outputGenerationHtml";
import { buildDocxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationDocx";
import { buildXlsxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationXlsx";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

async function zipFile(
	entries: Record<string, string | Uint8Array>,
	name: string,
	type: string,
): Promise<{ file: File; bytes: Uint8Array }> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	const bytes = await zip.generateAsync({ type: "uint8array" });
	return { file: new File([bytes], name, { type }), bytes };
}

function projectFromImport(
	result: Awaited<ReturnType<typeof importDocxFile>>,
	type: "docx" | "xlsx",
) {
	if (result.kind !== "segments") throw new Error("Expected segmented import");
	return makeUserData({
		type,
		typeRef: result.typeRef!,
		seg1: result.segments,
		seg2: [...result.segments],
		checked: result.segments.map(() => false),
		segmentsMeta: result.segmentsMeta,
		documentModel: result.document,
		skeleton: result.skeleton,
	});
}

describe("textual skeleton round trips", () => {
	it("keeps an identity TXT byte-for-byte and patches translations around original gaps", async () => {
		const content = "\ufeffFirst line.\r\n\r\nSecond line.";
		const result = await importTextFile(
			new File([content], "notes.txt", { type: "text/plain" }),
		);
		const identity = makeUserData({
			type: "text",
			seg1: result.document.units.map((unit) =>
				unit.source.fragments
					.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
					.join(""),
			),
			seg2: result.document.units.map((unit) =>
				unit.source.fragments
					.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
					.join(""),
			),
			checked: result.document.units.map(() => false),
			skeleton: result.skeleton,
		});
		expect(buildTextTranslationFromProject(identity)).toBe(content);
	});

	it("preserves JSON whitespace, order, and untouched values", async () => {
		const content = '{\n  "z": "Hello.",\n  "a": 2,\n  "flag": true\n}\n';
		const result = await importJsonFile(
			new File([content], "messages.json", { type: "application/json" }),
		);
		if (result.kind !== "segments") throw new Error("Expected segments");
		const project = makeUserData({
			type: "json",
			typeRef: result.typeRef!,
			seg1: result.segments,
			seg2: ["Hallo.", "2", "true"],
			checked: [false, false, false],
			segmentsMeta: result.segmentsMeta,
			skeleton: result.skeleton,
		});

		expect(buildJsonTranslation(project)).toBe(
			'{\n  "z": "Hallo.",\n  "a": 2,\n  "flag": true\n}\n',
		);
	});

	it("returns the untouched HTML source for an identity target", async () => {
		const content =
			'<!doctype html>\n<html><body><custom-box data-x="1">Hello.</custom-box><script>const label = "Hello.";</script></body></html>';
		const result = await importHtmlFile(
			new File([content], "page.html", { type: "text/html" }),
		);
		if (result.kind !== "segments") throw new Error("Expected segments");
		const project = makeUserData({
			type: "html",
			typeRef: result.typeRef!,
			seg1: result.segments,
			seg2: [...result.segments],
			checked: result.segments.map(() => false),
			segmentsMeta: result.segmentsMeta,
			skeleton: result.skeleton,
		});
		expect(buildHtmlTranslation(project)).toBe(content);

		project.translationData.seg2 = ["Hallo."];
		const translated = buildHtmlTranslation(project);
		expect(translated).toContain('<custom-box data-x="1">Hallo.</custom-box>');
		expect(translated).toContain('const label = "Hello.";');
	});
});

describe("package skeleton round trips", () => {
	it("preserves the original DOCX bytes for identity output", async () => {
		const source = await zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"word/document.xml":
					'<w:document xmlns:w="w" xmlns:vendor="urn:vendor"><w:body><vendor:keep vendor:flag="x"/><w:p><w:r><w:t>Hello.</w:t></w:r></w:p></w:body></w:document>',
				"_rels/.rels":
					'<Relationships><Relationship Id="custom" Target="custom/unknown.xml"/></Relationships>',
				"custom/unknown.xml": '<vendor:data xmlns:vendor="urn:vendor"/>',
				"word/media/image.bin": new Uint8Array([0, 1, 2, 255]),
			},
			"document.docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		const result = await importDocxFile(source.file);
		const project = projectFromImport(result, "docx");
		const output = new Uint8Array(
			await (await buildDocxTranslationPackage(project)).arrayBuffer(),
		);
		expect(output).toEqual(source.bytes);
	});

	it("patches DOCX document.xml without changing unknown parts or stored source", async () => {
		const source = await zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"word/document.xml":
					'<w:document xmlns:w="w" xmlns:vendor="urn:vendor"><w:body><vendor:keep vendor:flag="x"/><w:p><w:r><w:t>Hello.</w:t></w:r></w:p></w:body></w:document>',
				"_rels/.rels":
					'<Relationships><Relationship Id="custom" Target="custom/unknown.xml"/></Relationships>',
				"custom/unknown.xml":
					'<vendor:data xmlns:vendor="urn:vendor">keep</vendor:data>',
				"word/media/image.bin": new Uint8Array([7, 8, 9]),
			},
			"document.docx",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
		const result = await importDocxFile(source.file);
		const project = projectFromImport(result, "docx");
		project.translationData.seg2 = ["Hallo."];
		const output = await JSZip.loadAsync(
			await (await buildDocxTranslationPackage(project)).arrayBuffer(),
		);

		expect(await output.file("custom/unknown.xml")!.async("string")).toContain(
			">keep<",
		);
		expect(await output.file("_rels/.rels")!.async("string")).toContain(
			'Id="custom"',
		);
		expect(
			await output.file("word/media/image.bin")!.async("uint8array"),
		).toEqual(new Uint8Array([7, 8, 9]));
		const documentXml = await output.file("word/document.xml")!.async("string");
		expect(documentXml).toContain("Hallo.");
		expect(documentXml).toContain("vendor:keep");
		expect(documentXml).toContain('xmlns:vendor="urn:vendor"');
		expect(
			(result.skeleton.payload.kind === "package" &&
				result.skeleton.payload.parts["word/document.xml"]) ||
				"",
		).toContain("Hello.");
	});

	it("patches XLSX strings while preserving unrelated package parts", async () => {
		const source = await zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"xl/workbook.xml": '<workbook xmlns="urn:test"/>',
				"xl/sharedStrings.xml":
					'<sst xmlns="urn:test"><si><t>Hello.</t></si></sst>',
				"custom/unknown.bin": new Uint8Array([10, 20, 30]),
			},
			"book.xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		);
		const result = await importXlsxFile(source.file);
		const project = projectFromImport(result, "xlsx");
		project.translationData.seg2 = ["Hallo."];
		const output = await JSZip.loadAsync(
			await (await buildXlsxTranslationPackage(project)).arrayBuffer(),
		);

		expect(
			await output.file("custom/unknown.bin")!.async("uint8array"),
		).toEqual(new Uint8Array([10, 20, 30]));
		expect(
			await output.file("xl/sharedStrings.xml")!.async("string"),
		).toContain("Hallo.");
	});
});
