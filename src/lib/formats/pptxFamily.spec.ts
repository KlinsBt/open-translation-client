// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import { makeUserData } from "../../test/fixtures";
import {
	applyTranslationsToPresentationPart,
	getPresentationSlides,
	segmentPresentationPackage,
} from "$lib/functions/parsing/parsingPptx";
import { buildPptxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationPptx";
import {
	combineSegmentData,
	splitSegmentData,
} from "$lib/functions/parsing/segmentationLogic";
import { importPptxFile, validatePptxFile } from "./importers";
import {
	PPTX_FAMILY_MIME_TYPES,
	detectPptxFamilyExtension,
	pptxFamilyOutputName,
} from "./pptxPackage";
import { safeParseXml } from "./safeInput";

const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
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

async function presentationFile(
	entries: Record<string, string | Uint8Array | Blob>,
	name = "slides.pptx",
) {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	const bytes = await zip.generateAsync({ type: "uint8array" });
	const extension = name
		.split(".")
		.at(-1) as keyof typeof PPTX_FAMILY_MIME_TYPES;
	return {
		bytes,
		file: new File([bytes], name, {
			type: PPTX_FAMILY_MIME_TYPES[extension] ?? "application/octet-stream",
		}),
	};
}

function projectFromImport(result: Awaited<ReturnType<typeof importPptxFile>>) {
	if (result.kind !== "segments") throw new Error("Expected PPTX segments");
	return makeUserData({
		type: "pptx",
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

const presentationXml = `<p:presentation xmlns:p="${P}" xmlns:r="${R}"><p:sldIdLst><p:sldId id="300" r:id="rIdA"/><p:sldId id="256" r:id="rIdB"/></p:sldIdLst></p:presentation>`;
const presentationRels = `<Relationships xmlns="${PR}"><Relationship Id="rIdB" Type="${R}/slide" Target="slides/slide2.xml"/><Relationship Id="rIdA" Type="${R}/slide" Target="slides/slide10.xml"/></Relationships>`;
const slide10 = `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>
<p:grpSp><p:sp><p:nvSpPr><p:cNvPr id="2" name="Grouped" title="Group title" descr="Group description"/></p:nvSpPr><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>First </a:t></a:r><a:r><a:rPr i="1"/><a:t>slide.</a:t></a:r></a:p></p:txBody></p:sp></p:grpSp>
<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Table cell.</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>
<p:sp><p:txBody><a:p><a:fld id="1" type="slidenum"><a:t>Protected field</a:t></a:fld></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:timing><p:tnLst/></p:timing></p:sld>`;
const slide2 = `<p:sld xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Second slide.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const slide10Rels = `<Relationships xmlns="${PR}">
<Relationship Id="rNote" Type="${R}/notesSlide" Target="../notesSlides/notesSlide7.xml"/>
<Relationship Id="rChart" Type="${R}/chart" Target="../charts/chart4.xml"/>
<Relationship Id="rDiagram" Type="${R}/diagramData" Target="../diagrams/data3.xml"/>
<Relationship Id="rComment" Type="${R}/comments" Target="../comments/comment5.xml"/>
<Relationship Id="rModernComment" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments" Target="../comments/commentModern.xml"/>
<Relationship Id="rMedia" Type="${R}/image" Target="../media/image1.png"/>
</Relationships>`;
const notes = `<p:notes xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Protected thumbnail</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Speaker note.</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;
const chart = `<c:chartSpace xmlns:c="urn:chart" xmlns:a="${A}"><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Chart title.</a:t></a:r></a:p></c:rich></c:tx></c:title><c:ser><c:f>Sheet1!$A$1</c:f><c:strCache><c:pt><c:v>Cached label</c:v></c:pt></c:strCache></c:ser></c:chart></c:chartSpace>`;
const diagram = `<dgm:dataModel xmlns:dgm="urn:diagram" xmlns:a="${A}"><dgm:ptLst><dgm:pt><dgm:t><a:p><a:r><a:t>SmartArt node.</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>`;
const comments = `<p:cmLst xmlns:p="${P}"><p:cm authorId="4" idx="1"><p:pos x="1" y="2"/><p:text>Review this slide.</p:text></p:cm></p:cmLst>`;
const modernComments = `<p188:cmLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main" xmlns:a="${A}"><p188:cm authorId="modern-author"><p188:txBody><a:p><a:r><a:t>Modern review note.</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>`;
const master = `<p:sldMaster xmlns:p="${P}" xmlns:a="${A}"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Master wording.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sldMaster>`;

const packageParts: Record<string, string | Blob> = {
	"[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
	"ppt/presentation.xml": presentationXml,
	"ppt/_rels/presentation.xml.rels": presentationRels,
	"ppt/slides/slide10.xml": slide10,
	"ppt/slides/slide2.xml": slide2,
	"ppt/slides/_rels/slide10.xml.rels": slide10Rels,
	"ppt/notesSlides/notesSlide7.xml": notes,
	"ppt/charts/chart4.xml": chart,
	"ppt/diagrams/data3.xml": diagram,
	"ppt/comments/comment5.xml": comments,
	"ppt/comments/commentModern.xml": modernComments,
	"ppt/slideMasters/slideMaster1.xml": master,
	"ppt/media/image1.png": new Blob([new Uint8Array([137, 80, 78, 71])]),
};

describe("PPTX package extraction", () => {
	it("follows presentation relationship order and extracts grouped shapes and tables", () => {
		expect(
			getPresentationSlides(packageParts).map((slide) => slide.path),
		).toEqual(["ppt/slides/slide10.xml", "ppt/slides/slide2.xml"]);
		const parsed = segmentPresentationPackage(packageParts, [], {
			includeNotes: false,
			includeChartText: false,
			includeSmartArtText: false,
			includeAltText: false,
		});
		expect(
			parsed.segments.map((segment) => `${segment.text}${segment.separator}`),
		).toEqual(["First slide.", "Table cell.", "Second slide."]);
		expect(parsed.segments.map((segment) => segment.text)).not.toContain(
			"Protected field",
		);
	});

	it("filters slides and safely includes notes, charts, SmartArt, alt text, and optional masters", () => {
		const parsed = segmentPresentationPackage(packageParts, [], {
			slides: new Set([1]),
			includeNotes: true,
			includeChartText: true,
			includeSmartArtText: true,
			includeAltText: true,
			includeMastersLayouts: true,
		});
		const sources = parsed.segments.map(
			(segment) => `${segment.text}${segment.separator}`,
		);
		expect(sources).toEqual([
			"First slide.",
			"Table cell.",
			"Group title",
			"Group description",
			"Speaker note.",
			"Chart title.",
			"SmartArt node.",
			"Master wording.",
		]);
		expect(sources).not.toContain("Protected thumbnail");
		expect(sources).not.toContain("Cached label");
	});

	it("preserves run properties while replacing text and attributes", () => {
		const parsed = segmentPresentationPackage(packageParts, [], {
			includeNotes: false,
			includeChartText: false,
			includeSmartArtText: false,
			includeAltText: true,
			slides: new Set([1]),
		});
		const meta = parsed.segments
			.filter((segment) => segment.meta.part === "ppt/slides/slide10.xml")
			.map((segment) => segment.meta);
		const output = applyTranslationsToPresentationPart(
			slide10,
			["Translated slide.", "Translated table.", "Titel", "Beschreibung"],
			meta,
		);
		const document = safeParseXml(output);
		expect(document.documentElement.textContent).toContain("Translated slide.");
		expect(output).toContain("Translated table.");
		expect(output).toContain('title="Titel"');
		expect(output).toContain('descr="Beschreibung"');
		expect(Array.from(document.getElementsByTagName("a:rPr"))).toHaveLength(2);
		expect(output).toContain("<p:timing>");
	});
});

describe("PPTX import and lossless package export", () => {
	it("validates, imports comments as notes, and changes only addressed XML parts", async () => {
		const source = await presentationFile(packageParts);
		await expect(validatePptxFile(source.file)).resolves.toEqual({
			valid: true,
		});
		const imported = await importPptxFile(source.file, {
			includeMastersLayouts: false,
		});
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.document.units[0].notes).toEqual([
			{
				category: "pptx-slide-comment",
				text: "[Author 4] Review this slide.",
			},
			{
				category: "pptx-slide-comment",
				text: "[Author modern-author] Modern review note.",
			},
		]);
		const project = projectFromImport(imported);
		project.translationData.seg2 = imported.segments.map(
			(segment) => `DE ${segment}`,
		);
		const output = await buildPptxTranslationPackage(project);
		const [before, after] = await Promise.all([
			JSZip.loadAsync(source.bytes),
			JSZip.loadAsync(await output.arrayBuffer()),
		]);
		for (const path of [
			"ppt/presentation.xml",
			"ppt/comments/comment5.xml",
			"ppt/comments/commentModern.xml",
			"ppt/media/image1.png",
			"ppt/slides/_rels/slide10.xml.rels",
		])
			expect(await after.file(path)!.async("uint8array")).toEqual(
				await before.file(path)!.async("uint8array"),
			);
		const chartOutput = await after
			.file("ppt/charts/chart4.xml")!
			.async("string");
		expect(chartOutput).toContain("DE Chart title.");
		expect(chartOutput).toContain("Sheet1!$A$1");
		expect(chartOutput).toContain("Cached label");
	});

	it("returns identity bytes exactly and preserves macro-family packages", async () => {
		const macroParts = {
			...packageParts,
			"ppt/vbaProject.bin": new Uint8Array([1, 2, 3, 4]),
			"[Content_Types].xml": `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"/></Types>`,
		};
		const source = await presentationFile(macroParts, "automation.pptm");
		const project = projectFromImport(await importPptxFile(source.file));
		const identity = new Uint8Array(
			await (await buildPptxTranslationPackage(project)).arrayBuffer(),
		);
		expect(identity).toEqual(source.bytes);
		project.translationData.seg2[0] = "Changed slide.";
		const translated = await buildPptxTranslationPackage(project);
		expect(translated.type).toBe(PPTX_FAMILY_MIME_TYPES.pptm);
		const zip = await JSZip.loadAsync(await translated.arrayBuffer());
		const originalZip = await JSZip.loadAsync(source.bytes);
		expect(await zip.file("ppt/vbaProject.bin")!.async("uint8array")).toEqual(
			new Uint8Array([1, 2, 3, 4]),
		);
		expect(
			await zip.file("ppt/slides/slide2.xml")!.async("uint8array"),
		).toEqual(
			await originalZip.file("ppt/slides/slide2.xml")!.async("uint8array"),
		);
	});

	it("rejects malformed presentation XML and broken slide relationships", async () => {
		const malformed = await presentationFile({
			"ppt/presentation.xml": "<p:presentation>",
		});
		await expect(validatePptxFile(malformed.file)).resolves.toMatchObject({
			valid: false,
		});
		const broken = await presentationFile({
			"ppt/presentation.xml": presentationXml,
			"ppt/_rels/presentation.xml.rels": `<Relationships xmlns="${PR}"/>`,
		});
		await expect(validatePptxFile(broken.file)).resolves.toMatchObject({
			valid: false,
		});
	});

	it("imports and exports the repository's real small presentation", async () => {
		const bytes = await readFile("Test files/pptx_test_file_small.pptx");
		const file = new File([bytes], "pptx_test_file_small.pptx", {
			type: PPTX_FAMILY_MIME_TYPES.pptx,
		});
		await expect(validatePptxFile(file)).resolves.toEqual({ valid: true });
		const imported = await importPptxFile(file);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments.length).toBeGreaterThan(0);
		const project = projectFromImport(imported);
		project.translationData.seg2[0] = `Translated ${project.translationData.seg2[0]}`;
		const output = await buildPptxTranslationPackage(project);
		await expect(
			validatePptxFile(
				new File([output], "translated.pptx", { type: output.type }),
			),
		).resolves.toEqual({ valid: true });
	});
});

describe("PPTX family and structural safety", () => {
	it.each([
		["pptx", false, "presentation"],
		["pptm", true, "presentation"],
		["potx", false, "template"],
		["potm", true, "template"],
		["ppsx", false, "slideshow"],
		["ppsm", true, "slideshow"],
	] as const)("retains .%s family identity", (extension, macro, family) => {
		const parts: Record<string, string | Blob> = {
			"[Content_Types].xml": `<Types><Override ContentType="application/vnd.${family}${macro ? ".macroEnabled" : ""}.main+xml"/></Types>`,
			...(macro ? { "ppt/vbaProject.bin": new Blob(["macro"]) } : {}),
		};
		const sourceName = `source.${extension}`;
		expect(detectPptxFamilyExtension(parts, sourceName)).toBe(extension);
		expect(pptxFamilyOutputName("Translation.pptx", parts, sourceName)).toBe(
			`Translation.${extension}`,
		);
	});

	it("blocks split and join when shape/run metadata would be invalidated", () => {
		const data = makeUserData({
			type: "pptx",
			seg1: ["First", "Second"],
			seg2: ["Erste", "Zweite"],
			checked: [false, false],
		});
		expect(splitSegmentData(data.translationData, 0, 2).error).toMatch(
			/cannot be split/i,
		);
		expect(combineSegmentData(data.translationData, 0).error).toMatch(
			/cannot be split or joined/i,
		);
	});
});
