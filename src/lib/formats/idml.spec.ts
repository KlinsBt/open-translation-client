// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { buildInDesignTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationIdml";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import {
	IDML_MIME_TYPE,
	importInDesignFile,
	validateInDesignFile,
} from "./idml";
import { decodeTextBytes } from "./safeInput";
import type { FormatOptionValues } from "./types";

const packagingNamespace =
	"http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging";

async function idmlFile(entries: Record<string, string | Uint8Array>) {
	const zip = new JSZip();
	zip.file("mimetype", IDML_MIME_TYPE, { compression: "STORE" });
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		"layout.idml",
		{ type: IDML_MIME_TYPE },
	);
}

async function importProject(
	content: BlobPart,
	name = "story.icml",
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, {
		type: name.endsWith(".idml")
			? IDML_MIME_TYPE
			: "application/vnd.adobe.incopy-icml",
	});
	const result = await importInDesignFile(file, options);
	if (result.kind !== "segments")
		throw new Error("Expected IDML/ICML segments");
	return {
		file,
		result,
		project: makeUserData({
			type: "idml",
			name,
			seg1: result.segments,
			seg2: targets ?? [...result.segments],
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

function storyXml(self: string, text: string): string {
	return `<idPkg:Story xmlns:idPkg="${packagingNamespace}" DOMVersion="18.0"><Story Self="${self}"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/$ID/[No character style]"><Content>${text}</Content></CharacterStyleRange></ParagraphStyleRange></Story></idPkg:Story>`;
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("Adobe IDML and ICML workflow", () => {
	it("recognizes native INX XML and preserves its complete single-file DOM", async () => {
		const source = `<?xml version="1.0" encoding="UTF-8"?><?aid style="50" type="document" readerVersion="6.0" featureSet="257" product="6.0(352)"?><Document DOMVersion="6.0"><Color Self="Color/Protected"/><Story Self="story"><ParagraphStyleRange><CharacterStyleRange><Content>Hello INX مرحبا</Content></CharacterStyleRange></ParagraphStyleRange></Story><ScriptLabel Self="inert">never executed</ScriptLabel></Document>`;
		const { file, result, project } = await importProject(source, "layout.inx");
		expect(result.segments).toEqual(["Hello INX مرحبا"]);
		expect(result.typeRef).toMatchObject({ profile: "inx" });
		const identity = await buildInDesignTranslationBlob(project);
		expect(new Uint8Array(await identity.arrayBuffer())).toEqual(
			new Uint8Array(await file.arrayBuffer()),
		);
		project.translationData.seg2 = ["Hallo INX عالم"];
		const output = await (await buildInDesignTranslationBlob(project)).text();
		expect(output).toContain("<Content>Hallo INX عالم</Content>");
		expect(output).toContain('<Color Self="Color/Protected"/>');
		expect(output).toContain(
			'<ScriptLabel Self="inert">never executed</ScriptLabel>',
		);
		await expect(
			validateInDesignFile(new File([output], "layout.inx")),
		).resolves.toEqual({ valid: true });
	});

	it("rejects extension-only INX and INX without native document metadata", async () => {
		for (const source of [
			"plain text",
			"<Document><Story><Content>Missing DOMVersion</Content></Story></Document>",
			'<Story DOMVersion="6.0"><Content>Wrong root</Content></Story>',
		])
			await expect(
				validateInDesignFile(new File([source], "fake.inx")),
			).resolves.toMatchObject({ valid: false });
	});

	it("extracts ICML content in story/style order and preserves tables, anchored objects, tags, and cross-references", async () => {
		const source = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Document DOMVersion="18.0"><Story Self="u1"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange AppliedCharacterStyle="CharacterStyle/Emphasis"><Content>Hello</Content><Rectangle Self="anchored"><TextFrame ParentStory="u1"/></Rectangle><Content> world</Content></CharacterStyleRange></ParagraphStyleRange><Table Self="table"><Row><Cell><Content>Cell text</Content></Cell></Row></Table><XMLElement MarkupTag="XMLTag/term"><Content>Tagged text</Content></XMLElement><HyperlinkTextSource Self="link" Name="Cross reference"><Content>Link text</Content></HyperlinkTextSource></Story></Document>`;
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual([
			"Hello",
			"world",
			"Cell text",
			"Tagged text",
			"Link text",
		]);
		expect(result.document.units[0].contexts).toContainEqual({
			type: "indesign-paragraph-style",
			value: "ParagraphStyle/Body",
		});
		project.translationData.seg2 = [
			"Hallo",
			"Welt",
			"Zellentext",
			"Markierter Text",
			"Linktext",
		];
		const output = await (await buildInDesignTranslationBlob(project)).text();
		expect(output).toContain('<Rectangle Self="anchored">');
		expect(output).toContain('<Table Self="table">');
		expect(output).toContain('MarkupTag="XMLTag/term"');
		expect(output).toContain('Name="Cross reference"');
		expect(output).toContain("<Content>Hallo</Content>");
	});

	it("uses designmap story order, validates package relationships, and preserves binary assets", async () => {
		const asset = new Uint8Array([0, 1, 2, 255]);
		const file = await idmlFile({
			"designmap.xml": `<Document xmlns:idPkg="${packagingNamespace}"><idPkg:Story src="Stories/Story_second.xml"/><idPkg:Story src="Stories/Story_first.xml"/><idPkg:Spread src="Spreads/Spread_1.xml"/></Document>`,
			"Stories/Story_second.xml": storyXml("second", "Second story"),
			"Stories/Story_first.xml": storyXml("first", "First story"),
			"Spreads/Spread_1.xml":
				'<idPkg:Spread xmlns:idPkg="urn:test"><Spread Self="spread"/></idPkg:Spread>',
			"Links/image.png": asset,
		});
		const { result, project } = await importProject(file, "layout.idml");
		expect(result.segments).toEqual(["Second story", "First story"]);
		expect(result.document.metadata).toMatchObject({
			profile: "IDML",
			stories: 2,
		});
		project.translationData.seg2 = ["Zweite Geschichte", "Erste Geschichte"];
		const output = await buildInDesignTranslationBlob(project);
		const zip = await JSZip.loadAsync(await output.arrayBuffer());
		expect(
			await zip.file("Stories/Story_second.xml")!.async("string"),
		).toContain("Zweite Geschichte");
		expect(await zip.file("Links/image.png")!.async("uint8array")).toEqual(
			asset,
		);
		await expect(
			validateInDesignFile(new File([output], "layout.idml")),
		).resolves.toEqual({ valid: true });
	});

	it("supports notes, conditional content, and accessibility filters", async () => {
		const source = `<Document><Story Self="u1"><Content>Visible</Content><Note><Content>Note text</Content></Note><HiddenText><Content>Hidden text</Content></HiddenText><XMLElement Visible="false"><Content>Conditional text</Content></XMLElement><ObjectExportOption CustomAltText="Alt text" ActualText="Actual text"/></Story></Document>`;
		const defaults = await importInDesignFile(new File([source], "story.icml"));
		const expanded = await importInDesignFile(
			new File([source], "story.icml"),
			{
				includeNotes: false,
				includeHiddenText: true,
				includeAccessibilityText: false,
			},
		);
		if (defaults.kind !== "segments" || expanded.kind !== "segments")
			throw new Error("Expected IDML/ICML segments");
		expect(defaults.segments).toEqual([
			"Visible",
			"Note text",
			"Alt text",
			"Actual text",
		]);
		expect(expanded.segments).toEqual([
			"Visible",
			"Hidden text",
			"Conditional text",
		]);
	});

	it("rejects malformed containers, missing relationships, duplicate stories/IDs, signatures, and unsafe XML", async () => {
		const invalidFiles = [
			new File(["not zip"], "bad.idml"),
			await idmlFile({
				"designmap.xml": `<Document xmlns:idPkg="${packagingNamespace}"><idPkg:Story src="Stories/missing.xml"/></Document>`,
			}),
			await idmlFile({
				"designmap.xml": `<Document xmlns:idPkg="${packagingNamespace}"><idPkg:Story src="Stories/a.xml"/><idPkg:Story src="Stories/a.xml"/></Document>`,
				"Stories/a.xml": storyXml("same", "Text"),
			}),
			await idmlFile({
				"designmap.xml": `<Document xmlns:idPkg="${packagingNamespace}"><idPkg:Story src="Stories/a.xml"/></Document>`,
				"Stories/a.xml": storyXml("same", "Text"),
				"META-INF/signatures.xml": "<signatures/>",
			}),
			new File(
				[
					'<!DOCTYPE Document [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document><Story><Content>&x;</Content></Story></Document>',
				],
				"bad.icml",
			),
		];
		for (const file of invalidFiles)
			await expect(validateInDesignFile(file)).resolves.toMatchObject({
				valid: false,
			});
	});

	it("preserves UTF-16 ICML identity bytes and escapes translated XML", async () => {
		const bytes = encodeTextBytes(
			'<Document><Story Self="u1"><Content>Café</Content></Story></Document>',
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(
				await (await buildInDesignTranslationBlob(project)).arrayBuffer(),
			),
		).toEqual(bytes);
		project.translationData.seg2 = ['Tea & <"coffee">'];
		const decoded = decodeTextBytes(
			new Uint8Array(
				await (await buildInDesignTranslationBlob(project)).arrayBuffer(),
			),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain('Tea &amp; &lt;"coffee"&gt;');
	});

	it("round-trips sentence segmentation without duplicating Content", async () => {
		const { result, project } = await importProject(
			'<Document><Story Self="u1"><Content>First sentence. Second sentence.</Content></Story></Document>',
			"story.icml",
			{ segmentationMode: "sentences" },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = await (await buildInDesignTranslationBlob(project)).text();
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
	});

	it("blocks placeholder loss, structural edits, and stale mappings", async () => {
		const { project } = await importProject(
			'<Document><Story Self="u1"><Content>Hello {name}</Content></Story></Document>',
			"story.icml",
			{},
			["Hallo"],
		);
		await expect(buildInDesignTranslationBlob(project)).rejects.toThrow(
			/Export blocked/,
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		project.translationData.seg2 = ["Hallo {name}"];
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 8;
		await expect(buildInDesignTranslationBlob(project)).rejects.toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 Content nodes deterministically and passes independent XML validation", async () => {
		const source = `<Document><Story Self="large">${Array.from(
			{ length: 1_000 },
			(_, index) =>
				`<ParagraphStyleRange><Content>Message ${index}</Content></ParagraphStyleRange>`,
		).join("")}</Story></Document>`;
		const first = await importInDesignFile(new File([source], "large.icml"));
		const second = await importInDesignFile(new File([source], "large.icml"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected IDML/ICML segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
		if (spawnSync("xmllint", ["--version"], { timeout: 5_000 }).status !== 0)
			return;
		const { project } = await importProject(source);
		const directory = mkdtempSync(join(tmpdir(), "opentlc-icml-"));
		try {
			const path = join(directory, "translated.icml");
			writeFileSync(
				path,
				new Uint8Array(
					await (await buildInDesignTranslationBlob(project)).arrayBuffer(),
				),
			);
			const checked = spawnSync("xmllint", ["--noout", "--nonet", path], {
				encoding: "utf8",
				timeout: 5_000,
			});
			expect(checked.status, checked.stderr).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
