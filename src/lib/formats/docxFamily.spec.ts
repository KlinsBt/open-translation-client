// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { makeUserData } from "../../test/fixtures";
import {
	DOCX_FAMILY_MIME_TYPES,
	detectDocxFamilyExtension,
	docxFamilyOutputName,
} from "./docxPackage";
import { importDocxFile, validateDocxFile } from "./importers";
import { safeParseXml } from "./safeInput";
import {
	applyTranslationsToDocxXml,
	segmentDocxParts,
	segmentDocxXml,
} from "$lib/functions/parsing/parsingDocx";
import { buildDocxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationDocx";

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

async function wordFile(
	entries: Record<string, string | Uint8Array>,
	name = "document.docx",
) {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	const bytes = await zip.generateAsync({ type: "uint8array" });
	const extension = name
		.split(".")
		.at(-1) as keyof typeof DOCX_FAMILY_MIME_TYPES;
	return {
		bytes,
		file: new File([bytes], name, {
			type: DOCX_FAMILY_MIME_TYPES[extension] ?? "application/octet-stream",
		}),
	};
}

function projectFromImport(result: Awaited<ReturnType<typeof importDocxFile>>) {
	if (result.kind !== "segments") throw new Error("Expected segmented DOCX");
	return makeUserData({
		type: "docx",
		typeRef: result.typeRef!,
		seg1: result.segments,
		seg2: [...result.segments],
		checked: result.segments.map(() => false),
		segmentsMeta: result.segmentsMeta,
		documentModel: result.document,
		skeleton: result.skeleton,
		filterOptions: result.filterOptions,
	});
}

const mainDocument = `<w:document xmlns:w="${W}" xmlns:a="${A}">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Hello </w:t></w:r><w:hyperlink w:anchor="target"><w:r><w:t>world.</w:t></w:r></w:hyperlink></w:p>
<w:p><w:r><w:t>Before tab</w:t><w:tab/><w:t>After tab.</w:t><w:br/><w:t>After break.</w:t></w:r></w:p>
<w:p><w:fldSimple w:instr="DATE"><w:r><w:t>Protected simple field</w:t></w:r></w:fldSimple></w:p>
<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText>DATE</w:instrText></w:r><w:r><w:t>Protected complex field</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>
<w:p><w:del><w:r><w:delText>Old wording.</w:delText></w:r></w:del><w:ins><w:r><w:t>New wording.</w:t></w:r></w:ins></w:p>
<w:sdt><w:sdtContent><w:p><w:r><w:t>Controlled text.</w:t></w:r></w:p></w:sdtContent></w:sdt>
<w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>Text box.</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p>
<w:p><w:r><w:drawing><a:graphic><a:p><a:r><a:t>Drawing text.</a:t></a:r></a:p></a:graphic></w:drawing></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Table cell.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

const storyParts: Record<string, string> = {
	"word/document.xml": mainDocument,
	"word/header1.xml": `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header text.</w:t></w:r></w:p></w:hdr>`,
	"word/footer1.xml": `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Footer text.</w:t></w:r></w:p></w:ftr>`,
	"word/footnotes.xml": `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:r><w:t>Footnote text.</w:t></w:r></w:p></w:footnote></w:footnotes>`,
	"word/endnotes.xml": `<w:endnotes xmlns:w="${W}"><w:endnote w:id="1"><w:p><w:r><w:t>Endnote text.</w:t></w:r></w:p></w:endnote></w:endnotes>`,
	"word/comments.xml": `<w:comments xmlns:w="${W}"><w:comment w:id="0"><w:p><w:r><w:t>Comment text.</w:t></w:r></w:p></w:comment></w:comments>`,
};

describe("DOCX story extraction", () => {
	it("extracts all common Word stories without duplicating nested text boxes", () => {
		const parsed = segmentDocxParts(storyParts, []);
		const sources = parsed.segments.map(
			(segment) => `${segment.text}${segment.separator}`,
		);

		expect(sources).toEqual([
			"Hello world.",
			"Before tab",
			"After tab.",
			"After break.",
			"New wording.",
			"Controlled text.",
			"Text box.",
			"Drawing text.",
			"Table cell.",
			"Header text.",
			"Footer text.",
			"Footnote text.",
			"Endnote text.",
			"Comment text.",
		]);
		expect(sources.filter((source) => source === "Text box.")).toHaveLength(1);
		expect(new Set(parsed.meta.map((entry) => entry.part))).toEqual(
			new Set(Object.keys(storyParts)),
		);
		expect(sources.join(" ")).not.toContain("Protected");
		expect(parsed.meta[0].fragments).toHaveLength(2);
	});

	it("applies tracked-change and optional-story policies without modifying XML", () => {
		const revisionXml = `<w:document xmlns:w="${W}"><w:body><w:p><w:del><w:r><w:delText>Old.</w:delText></w:r></w:del><w:ins><w:r><w:t>New.</w:t></w:r></w:ins></w:p></w:body></w:document>`;
		expect(
			segmentDocxXml(revisionXml, [], {
				trackedChanges: "current",
			}).segments.map((segment) => segment.text),
		).toEqual(["New."]);
		expect(
			segmentDocxXml(revisionXml, [], {
				trackedChanges: "original",
			}).segments.map((segment) => segment.text),
		).toEqual(["Old."]);
		expect(
			segmentDocxXml(revisionXml, [], { trackedChanges: "all" }).segments.map(
				(segment) => segment.text,
			),
		).toEqual(["Old.", "New."]);

		const selected = segmentDocxParts(storyParts, [], {
			includeHeadersFooters: false,
			includeNotes: false,
			includeComments: false,
			includeTextBoxes: false,
			includeDrawingText: false,
		});
		expect(selected.parts).toEqual(["word/document.xml"]);
		const selectedSources = selected.segments.map(
			(segment) => `${segment.text}${segment.separator}`,
		);
		expect(selectedSources).not.toContain("Text box.");
		expect(selectedSources).not.toContain("Drawing text.");
	});

	it("preserves unmapped whitespace and run structure during ranged replacement", () => {
		const xml = `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">  Hello.\u00a0 </w:t></w:r></w:p></w:body></w:document>`;
		const parsed = segmentDocxXml(xml, []);
		const output = applyTranslationsToDocxXml(
			xml,
			["Hallo.\u00a0 "],
			[],
			parsed.meta,
		);
		const document = safeParseXml(output);
		const text = document.getElementsByTagName("w:t")[0];
		expect(text.textContent).toBe("  Hallo.\u00a0 ");
		expect(text.getAttribute("xml:space")).toBe("preserve");
		expect(output.match(/xml:space=/g)).toHaveLength(1);
		expect(output).not.toContain("&nbsp;");
		expect(document.getElementsByTagName("w:i")).toHaveLength(1);
	});
});

describe("DOCX-family package round trips", () => {
	it("patches every translated story while preserving relationships and opaque macro bytes", async () => {
		const macro = new Uint8Array([0, 255, 19, 80, 75, 3, 4, 42]);
		const relationships = `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdHeader" Target="header1.xml"/></Relationships>`;
		const contentTypes = `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.template.macroEnabled.main+xml"/></Types>`;
		const source = await wordFile(
			{
				...storyParts,
				"[Content_Types].xml": contentTypes,
				"_rels/.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
				"word/_rels/document.xml.rels": relationships,
				"word/vbaProject.bin": macro,
				"custom/opaque.bin": new Uint8Array([9, 8, 7]),
			},
			"source.dotm",
		);
		vi.stubGlobal("macroExecuted", false);
		const imported = await importDocxFile(source.file);
		const project = projectFromImport(imported);
		project.translationData.seg2 = project.translationData.seg2.map(
			(segment) => `DE:${segment}`,
		);
		const blob = await buildDocxTranslationPackage(project);
		const output = await JSZip.loadAsync(await blob.arrayBuffer());

		expect(blob.type).toBe(DOCX_FAMILY_MIME_TYPES.dotm);
		expect(
			await output.file("word/vbaProject.bin")!.async("uint8array"),
		).toEqual(macro);
		expect(await output.file("custom/opaque.bin")!.async("uint8array")).toEqual(
			new Uint8Array([9, 8, 7]),
		);
		expect(
			await output.file("word/_rels/document.xml.rels")!.async("string"),
		).toBe(relationships);
		for (const path of Object.keys(storyParts)) {
			expect(await output.file(path)!.async("string")).toContain("DE:");
		}
		expect(
			(globalThis as typeof globalThis & { macroExecuted: boolean })
				.macroExecuted,
		).toBe(false);
	});

	it("returns the exact original bytes for an identity macro package", async () => {
		const source = await wordFile(
			{
				"word/document.xml": `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Hello.</w:t></w:r></w:p></w:body></w:document>`,
				"word/vbaProject.bin": new Uint8Array([1, 2, 3, 4]),
			},
			"source.docm",
		);
		const output = await buildDocxTranslationPackage(
			projectFromImport(await importDocxFile(source.file)),
		);
		expect(new Uint8Array(await output.arrayBuffer())).toEqual(source.bytes);
	});

	it.each([
		["docx", false, false],
		["docm", true, false],
		["dotx", false, true],
		["dotm", true, true],
	] as const)("retains the .%s family type", (extension, macro, template) => {
		const parts: Record<string, string | Blob> = {
			"word/document.xml": "<document/>",
			"[Content_Types].xml": template
				? `<Types><Override ContentType="application/vnd.${macro ? "ms-word.template.macroEnabled" : "openxmlformats-officedocument.wordprocessingml.template"}.main+xml"/></Types>`
				: "<Types/>",
		};
		if (macro) parts["word/vbaProject.bin"] = new Blob(["macro"]);
		expect(detectDocxFamilyExtension(parts, `source.${extension}`)).toBe(
			extension,
		);
		expect(
			docxFamilyOutputName("Translation.docx", parts, `source.${extension}`),
		).toBe(`Translation.${extension}`);
	});

	it("rejects malformed document and relationship XML", async () => {
		const malformedDocument = await wordFile({
			"word/document.xml": "<w:document><broken></w:document>",
		});
		await expect(
			validateDocxFile(malformedDocument.file),
		).resolves.toMatchObject({
			valid: false,
			errorCode: "XML_MALFORMED",
		});

		const malformedRelationships = await wordFile({
			"word/document.xml": "<document/>",
			"word/_rels/document.xml.rels": "<NotRelationships/>",
		});
		await expect(
			validateDocxFile(malformedRelationships.file),
		).resolves.toMatchObject({
			valid: false,
			reason: expect.stringContaining("root"),
		});
	});
});
