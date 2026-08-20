// @vitest-environment happy-dom

import { DOMParser as IndependentDomParser } from "@xmldom/xmldom";
import { parseRTF as parseRtfIndependently } from "@jonahschulte/rtf-toolkit";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "./persistenceMigrations";
import {
	buildLegacyBilingualTranslation,
	importLegacyBilingualFile,
	parseLegacyBilingualXml,
	validateLegacyBilingualFile,
} from "./legacyBilingual";
import { detectFormatWithConfidence } from "./registry";
import type { FormatImportResult } from "./types";
import type { UserData } from "$lib/types/types";
import {
	combineSegmentData,
	splitSegmentData,
} from "$lib/functions/parsing/segmentationLogic";

function file(content: string, name: string, type = "application/xml"): File {
	return new File([content], name, { type });
}

function project(
	imported: FormatImportResult,
	targets: readonly string[],
): UserData {
	if (imported.kind !== "segments") throw new Error("Expected segment import.");
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		translationData: {
			name: "legacy-job",
			sourceLang: "en",
			targetLang: "de",
			creationDate: "0",
			seg1: imported.segments,
			seg2: [...targets],
			checked: imported.segments.map(() => false),
			locked: imported.segments.map(() => false),
			type: "legacy-bilingual",
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

function ttx(units: string): string {
	return `<?xml version="1.0" encoding="UTF-8"?><TRADOStag Version="2.0"><FrontMatter><Opaque keep="yes">Do not touch</Opaque></FrontMatter><Body>${units}</Body></TRADOStag>`;
}

async function workbenchDocx(): Promise<File> {
	const zip = new JSZip();
	zip.file(
		"[Content_Types].xml",
		'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
	);
	zip.file(
		"_rels/.rels",
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
	);
	zip.file(
		"word/document.xml",
		'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>{0&gt;Hello&lt;}100{&gt;Hallo&lt;0{</w:t></w:r></w:p></w:body></w:document>',
	);
	zip.file(
		"word/styles.xml",
		'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="character" w:styleId="tw4winMark"/></w:styles>',
	);
	zip.file("word/media/opaque.bin", new Uint8Array([0, 1, 2, 255]));
	return new File(
		[await zip.generateAsync({ type: "uint8array" })],
		"job.docx",
		{
			type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		},
	);
}

describe("legacy bilingual CAT documents", () => {
	it("detects TTX structurally and preserves inline UT tags and unknown content", async () => {
		const input = file(
			ttx(
				'<Tu id="u1" MatchPercent="82"><Tuv Lang="EN"><ut Type="start">&lt;b&gt;</ut>Hello مرحبا<ut Type="end">&lt;/b&gt;</ut></Tuv><Tuv Lang="DE"><ut Type="start">&lt;b&gt;</ut>Hallo<ut Type="end">&lt;/b&gt;</ut></Tuv></Tu>',
			),
			"job.ttx",
		);
		await expect(detectFormatWithConfidence(input)).resolves.toMatchObject({
			formatId: "legacy-bilingual",
			confidence: "high",
		});
		const imported = await importLegacyBilingualFile(input);
		expect(imported.kind).toBe("segments");
		if (imported.kind !== "segments") return;
		expect(imported.segments[0]).toContain("Hello مرحبا");
		expect(imported.segments[0]).toContain("{ut1}");
		expect(imported.targetSegments?.[0]).toContain("{ut1}");
		const translated = (imported.targetSegments?.[0] ?? "").replace(
			"Hallo",
			"Übersetzt 👩🏽‍💻",
		);
		const output = await buildLegacyBilingualTranslation(
			project(imported, [translated]),
		);
		const xml = await output.blob.text();
		expect(xml).toContain('<Opaque keep="yes">Do not touch</Opaque>');
		expect(xml).toContain("Übersetzt 👩🏽‍💻");
		expect(xml).toContain('<ut Type="start">&lt;b&gt;</ut>');
		expect(
			new IndependentDomParser().parseFromString(xml, "application/xml")
				.documentElement.nodeName,
		).toBe("TRADOStag");
		const reopened = await importLegacyBilingualFile(
			new File([output.blob], "roundtrip.ttx", { type: "application/xml" }),
		);
		expect(
			reopened.kind === "segments" && reopened.targetSegments?.[0],
		).toContain("Übersetzt 👩🏽‍💻");
	});

	it("refuses missing inline tokens, source edits, and locked target edits", async () => {
		const input = file(
			ttx(
				'<Tu id="locked" translate="no"><Tuv Lang="EN"><ut>&lt;b&gt;</ut>Hello</Tuv><Tuv Lang="DE"><ut>&lt;b&gt;</ut>Hallo</Tuv></Tu>',
			),
			"locked.ttx",
		);
		const imported = await importLegacyBilingualFile(input);
		if (imported.kind !== "segments") throw new Error("Expected segments.");
		expect(imported.document.units[0].translatable).toBe(false);
		const changedLockedTarget = (imported.targetSegments?.[0] ?? "").replace(
			"Hallo",
			"Geändert",
		);
		await expect(
			buildLegacyBilingualTranslation(project(imported, [changedLockedTarget])),
		).rejects.toThrow(/Locked unit/);
		const editableInput = file(
			ttx(
				'<Tu id="editable"><Tuv Lang="EN"><ut>&lt;b&gt;</ut>Hello</Tuv><Tuv Lang="DE"><ut>&lt;b&gt;</ut>Hallo</Tuv></Tu>',
			),
			"editable.ttx",
		);
		const editable = await importLegacyBilingualFile(editableInput);
		if (editable.kind !== "segments") throw new Error("Expected segments.");
		await expect(
			buildLegacyBilingualTranslation(project(editable, ["Ohne Code"])),
		).rejects.toThrow(/placeholder|protected inline token/);
		const sourceChanged = project(editable, [
			editable.targetSegments?.[0] ?? "",
		]);
		sourceChanged.translationData.seg1[0] = editable.segments[0].replace(
			"Hello",
			"Changed source",
		);
		await expect(
			buildLegacyBilingualTranslation(sourceChanged),
		).rejects.toThrow(/Source unit/);
	});

	it.each([
		[
			"txml",
			'<txml localeSource="en-US" localeTarget="de-DE"><body><translatable><segment segmentId="s1"><source>Hello</source><target>Hallo</target></segment></translatable></body></txml>',
		],
		[
			"itd",
			'<ITD xmlns:sdl="http://www.sdl.com/itd"><Body><Segment id="s1" state="Translated"><Source>Hello</Source><Target>Hallo</Target></Segment></Body></ITD>',
		],
	] as const)(
		"round-trips %s targets in the same XML family",
		async (ext, xml) => {
			const imported = await importLegacyBilingualFile(file(xml, `job.${ext}`));
			if (imported.kind !== "segments") throw new Error("Expected segments.");
			expect(imported.segments).toEqual(["Hello"]);
			const output = await buildLegacyBilingualTranslation(
				project(imported, ["مرحبا بالعالم"]),
			);
			const reopened = await importLegacyBilingualFile(
				new File([output.blob], `reopened.${ext}`, { type: "application/xml" }),
			);
			expect(reopened.kind === "segments" && reopened.targetSegments).toEqual([
				"مرحبا بالعالم",
			]);
		},
	);

	it("round-trips Workbench RTF while retaining delimiters and hidden styles", async () => {
		const raw = String.raw`{\rtf1\ansi{\stylesheet{\s1\v tw4winMark;}}\v \{0>Hello<\}100\{>Hallo<0\{\v0\par}`;
		const input = file(raw, "workbench.rtf", "application/rtf");
		const imported = await importLegacyBilingualFile(input);
		if (imported.kind !== "segments") throw new Error("Expected segments.");
		expect(imported.segments).toEqual(["Hello"]);
		expect(imported.targetSegments).toEqual(["Hallo"]);
		const output = await buildLegacyBilingualTranslation(
			project(imported, ["Grüße مرحبا"]),
		);
		const text = await output.blob.text();
		expect(text).toContain("tw4winMark");
		expect(text).toContain(String.raw`\{0>Hello<\}100\{>`);
		expect(() => parseRtfIndependently(text)).not.toThrow();
		const reopened = await importLegacyBilingualFile(
			new File([output.blob], "again.rtf", { type: "application/rtf" }),
		);
		expect(reopened.kind === "segments" && reopened.targetSegments).toEqual([
			"Grüße مرحبا",
		]);
	});

	it.each(["doc", "bak"])(
		"recognizes an RTF-based Workbench bilingual .%s by structure and retains the family",
		async (extension) => {
			const raw = String.raw`{\rtf1\ansi{\stylesheet{\s1\v tw4winMark;}}\v \{0>Source<\}100\{>Target<0\{\v0\par}`;
			const input = file(raw, `workbench.${extension}`, "application/msword");
			await expect(detectFormatWithConfidence(input)).resolves.toMatchObject({
				formatId: "legacy-bilingual",
				confidence: "high",
			});
			const imported = await importLegacyBilingualFile(input);
			if (imported.kind !== "segments") throw new Error("Expected segments.");
			const output = await buildLegacyBilingualTranslation(
				project(imported, ["Zieltext"]),
			);
			expect(output.extension).toBe(extension);
			const reopened = await importLegacyBilingualFile(
				new File([output.blob], `again.${extension}`, {
					type: "application/msword",
				}),
			);
			expect(reopened.kind === "segments" && reopened.targetSegments).toEqual([
				"Zieltext",
			]);
		},
	);

	it("can omit locked units while preserving them untouched in the source skeleton", async () => {
		const input = file(
			ttx(
				'<Tu id="locked" translate="no"><Tuv>Locked source</Tuv><Tuv>Locked target</Tuv></Tu><Tu id="open"><Tuv>Open source</Tuv><Tuv>Open target</Tuv></Tu>',
			),
			"filtered.ttx",
		);
		const imported = await importLegacyBilingualFile(input, {
			includeLocked: false,
		});
		if (imported.kind !== "segments") throw new Error("Expected segments.");
		expect(imported.segments).toEqual(["Open source"]);
		const output = await buildLegacyBilingualTranslation(
			project(imported, ["Offenes Ziel"]),
		);
		const text = await output.blob.text();
		expect(text).toContain("Locked target");
		expect(text).toContain("Offenes Ziel");
	});

	it("blocks split and join operations at native bilingual unit boundaries", async () => {
		const imported = await importLegacyBilingualFile(
			file(
				ttx(
					'<Tu id="one"><Tuv>First source</Tuv><Tuv>First target</Tuv></Tu><Tu id="two"><Tuv>Second source</Tuv><Tuv>Second target</Tuv></Tu>',
				),
				"protected.ttx",
			),
		);
		const data = project(imported, [
			"First target",
			"Second target",
		]).translationData;
		expect(splitSegmentData(data, 0, 5).error).toMatch(/native unit IDs/i);
		expect(combineSegmentData(data, 0).error).toMatch(/native unit IDs/i);
	});

	it("updates only Workbench DOCX target runs and byte-preserves opaque resources", async () => {
		const input = await workbenchDocx();
		await expect(detectFormatWithConfidence(input)).resolves.toMatchObject({
			formatId: "legacy-bilingual",
		});
		const imported = await importLegacyBilingualFile(input);
		if (imported.kind !== "segments") throw new Error("Expected segments.");
		expect(imported.segments).toEqual(["Hello"]);
		const output = await buildLegacyBilingualTranslation(
			project(imported, ["Übersetzt"]),
		);
		const [before, after] = await Promise.all([
			JSZip.loadAsync(await input.arrayBuffer()),
			JSZip.loadAsync(await output.blob.arrayBuffer()),
		]);
		expect(
			await after.file("word/media/opaque.bin")!.async("uint8array"),
		).toEqual(await before.file("word/media/opaque.bin")!.async("uint8array"));
		const documentXml = await after.file("word/document.xml")!.async("string");
		expect(documentXml).toContain("Übersetzt");
		expect(documentXml).toContain("{0&gt;Hello&lt;}100{&gt;");
		expect(
			new IndependentDomParser().parseFromString(documentXml, "application/xml")
				.documentElement.nodeName,
		).toBe("w:document");
	});

	it("does not steal ordinary RTF, DOCX, or extension-only impostors", async () => {
		await expect(
			detectFormatWithConfidence(
				file(
					String.raw`{\rtf1\ansi Ordinary document\par}`,
					"ordinary.rtf",
					"application/rtf",
				),
			),
		).resolves.toMatchObject({ formatId: "rtf" });
		const ordinary = new JSZip();
		ordinary.file(
			"word/document.xml",
			'<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>Ordinary</w:t></w:r></w:p></w:body></w:document>',
		);
		ordinary.file("[Content_Types].xml", "<Types/>");
		await expect(
			detectFormatWithConfidence(
				new File(
					[await ordinary.generateAsync({ type: "uint8array" })],
					"ordinary.docx",
				),
			),
		).resolves.toMatchObject({ formatId: "docx" });
		await expect(
			detectFormatWithConfidence(
				file("plain text", "fake.ttx", "application/xml"),
			),
		).resolves.toMatchObject({ supported: false });
	});

	it("rejects malformed and unsafe XML and observes cancellation", async () => {
		await expect(
			validateLegacyBilingualFile(
				file(
					'<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]><TRADOStag>&y;</TRADOStag>',
					"unsafe.ttx",
				),
			),
		).resolves.toMatchObject({ valid: false });
		await expect(
			validateLegacyBilingualFile(file("<TRADOStag><Body>", "broken.ttx")),
		).resolves.toMatchObject({ valid: false });
		const controller = new AbortController();
		controller.abort();
		await expect(
			importLegacyBilingualFile(
				file(ttx("<Tu><Tuv>Hello</Tuv><Tuv>Hallo</Tuv></Tu>"), "cancel.ttx"),
				undefined,
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("imports a generated 1,500-unit TTX without committed large fixtures", async () => {
		const xml = ttx(
			Array.from(
				{ length: 1_500 },
				(_, index) =>
					`<Tu id="${index}"><Tuv Lang="EN">Source ${index}</Tuv><Tuv Lang="AR">هدف ${index}</Tuv></Tu>`,
			).join(""),
		);
		const imported = await importLegacyBilingualFile(file(xml, "large.ttx"));
		expect(imported.kind === "segments" && imported.segments).toHaveLength(
			1_500,
		);
	});

	it("parses XML families by signature rather than extension", () => {
		expect(
			parseLegacyBilingualXml(
				"<txml><body><segment><source>Source</source><target>Target</target></segment></body></txml>",
				"renamed.xml",
			).profile,
		).toBe("txml");
	});
});
