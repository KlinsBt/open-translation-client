// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { buildEpubTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationEpub";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { EPUB_MIME_TYPE, importEpubFile, validateEpubFile } from "./epub";
import type { FormatOptionValues } from "./types";

interface EpubFixtureOptions {
	version?: "2" | "3";
	extra?: Record<string, string | Uint8Array>;
	opf?: string;
	content?: string;
	compressMimetype?: boolean;
}

async function epubFile(options: EpubFixtureOptions = {}): Promise<File> {
	const version = options.version ?? "3";
	const zip = new JSZip();
	zip.file("mimetype", EPUB_MIME_TYPE, {
		compression: options.compressMimetype ? "DEFLATE" : "STORE",
	});
	zip.file(
		"META-INF/container.xml",
		'<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
	);
	const content =
		options.content ??
		'<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Protected document title</title><link rel="stylesheet" href="style.css"/></head><body><h1>Heading</h1><p>Hello <span>world</span></p><img src="image.png" alt="Illustration"/><script src="app.js"></script></body></html>';
	zip.file("EPUB/chapter.xhtml", content);
	zip.file(
		"EPUB/nav.xhtml",
		'<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Navigation</title></head><body><nav><ol><li><a href="chapter.xhtml">Chapter One</a></li></ol></nav></body></html>',
	);
	zip.file(
		"EPUB/image.svg",
		'<svg xmlns="http://www.w3.org/2000/svg"><title>Diagram</title><text transform="rotate(5)">Axis</text><script>doNotRun()</script></svg>',
	);
	zip.file("EPUB/style.css", "body{font-family:BookFont}");
	zip.file("EPUB/app.js", "window.untrusted=true");
	zip.file("EPUB/image.png", new Uint8Array([1, 2, 3]));
	zip.file("EPUB/font.woff2", new Uint8Array([4, 5, 6]));
	zip.file("EPUB/audio.mp3", new Uint8Array([7, 8, 9]));
	zip.file(
		"EPUB/overlay.smil",
		'<smil xmlns="http://www.w3.org/ns/SMIL"><body><seq><par><text src="chapter.xhtml#p1"/><audio src="audio.mp3" clipBegin="0s" clipEnd="2s"/></par></seq></body></smil>',
	);
	if (version === "2")
		zip.file(
			"EPUB/toc.ncx",
			'<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd"><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><head/><docTitle><text>Book Navigation</text></docTitle><navMap><navPoint id="n1" playOrder="1"><navLabel><text>Chapter One NCX</text></navLabel><content src="chapter.xhtml"/></navPoint></navMap></ncx>',
		);
	const opf =
		options.opf ??
		`<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="${version}.0" unique-identifier="pub-id"><metadata><dc:identifier id="pub-id">urn:uuid:test-book</dc:identifier><dc:language>en</dc:language><dc:title>Book title</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml" media-overlay="overlay" properties="${version === "3" ? "scripted" : ""}"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"${version === "3" ? ' properties="nav"' : ""}/><item id="svg" href="image.svg" media-type="image/svg+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="js" href="app.js" media-type="text/javascript"/><item id="image" href="image.png" media-type="image/png"/><item id="font" href="font.woff2" media-type="font/woff2"/><item id="audio" href="audio.mp3" media-type="audio/mpeg"/><item id="overlay" href="overlay.smil" media-type="application/smil+xml"/>${version === "2" ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' : ""}</manifest><spine${version === "2" ? ' toc="ncx"' : ""}><itemref idref="chapter"/></spine></package>`;
	zip.file("EPUB/package.opf", opf);
	for (const [path, value] of Object.entries(options.extra ?? {}))
		zip.file(path, value);
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		"book.epub",
		{ type: EPUB_MIME_TYPE },
	);
}

async function importProject(
	file: File,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const result = await importEpubFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected EPUB segments");
	return {
		result,
		project: makeUserData({
			type: "epub",
			name: file.name,
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

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("EPUB 2/3 package workflow", () => {
	it("extracts EPUB 3 metadata, spine, navigation, SVG, and accessibility text", async () => {
		const file = await epubFile();
		const { result, project } = await importProject(file);
		expect(result.segments).toEqual([
			"Book title",
			"Heading",
			"Hello",
			"world",
			"Illustration",
			"Chapter One",
			"Diagram",
			"Axis",
		]);
		expect(result.document.metadata).toMatchObject({
			profile: "EPUB 3",
			spine: ["chapter"],
			mediaOverlays: 1,
			scriptedItems: 1,
		});
		project.translationData.seg2 = [
			"Buchtitel",
			"Überschrift",
			"Hallo",
			"Welt",
			"Abbildung",
			"Kapitel Eins",
			"Diagramm",
			"Achse",
		];
		const output = await buildEpubTranslationPackage(project);
		const zip = await JSZip.loadAsync(await output.arrayBuffer());
		expect(await zip.file("EPUB/chapter.xhtml")!.async("string")).toContain(
			'<p>Hallo <span>Welt</span></p><img src="image.png" alt="Abbildung"/>',
		);
		expect(await zip.file("EPUB/package.opf")!.async("string")).toContain(
			"<dc:title>Buchtitel</dc:title>",
		);
		expect(await zip.file("EPUB/style.css")!.async("string")).toBe(
			"body{font-family:BookFont}",
		);
		expect(await zip.file("EPUB/app.js")!.async("string")).toBe(
			"window.untrusted=true",
		);
		expect(await zip.file("EPUB/audio.mp3")!.async("uint8array")).toEqual(
			new Uint8Array([7, 8, 9]),
		);
	});

	it("supports EPUB 2 XHTML 1.1 and NCX fixed doctypes without resolving them", async () => {
		const file = await epubFile({
			version: "2",
			content:
				'<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.1//EN" "http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd"><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Protected</title></head><body><p>EPUB two text</p></body></html>',
		});
		const result = await importEpubFile(file);
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual([
			"Book title",
			"EPUB two text",
			"Book Navigation",
			"Chapter One NCX",
			"Diagram",
			"Axis",
		]);
		expect(result.document.metadata?.profile).toBe("EPUB 2");
	});

	it("can include every manifest XHTML document instead of spine-only content", async () => {
		const extra = {
			"EPUB/appendix.xhtml":
				'<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Appendix text</p></body></html>',
		};
		const base = await epubFile();
		const zip = await JSZip.loadAsync(await base.arrayBuffer());
		zip.file("EPUB/appendix.xhtml", extra["EPUB/appendix.xhtml"]);
		const opf = await zip.file("EPUB/package.opf")!.async("string");
		zip.file(
			"EPUB/package.opf",
			opf.replace(
				"</manifest>",
				'<item id="appendix" href="appendix.xhtml" media-type="application/xhtml+xml"/></manifest>',
			),
		);
		zip.file("mimetype", EPUB_MIME_TYPE, { compression: "STORE" });
		const file = new File(
			[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
			"book.epub",
		);
		const spine = await importEpubFile(file);
		const all = await importEpubFile(file, { contentScope: "all" });
		if (spine.kind !== "segments" || all.kind !== "segments")
			throw new Error("Expected segments");
		expect(spine.segments).not.toContain("Appendix text");
		expect(all.segments).toContain("Appendix text");
	});

	it("preserves identity bytes and emits the required stored first mimetype entry", async () => {
		const file = await epubFile();
		const { project } = await importProject(file);
		expect(
			new Uint8Array(
				await (await buildEpubTranslationPackage(project)).arrayBuffer(),
			),
		).toEqual(new Uint8Array(await file.arrayBuffer()));
		project.translationData.seg2[0] = "Changed book title";
		const changed = new Uint8Array(
			await (await buildEpubTranslationPackage(project)).arrayBuffer(),
		);
		const view = new DataView(
			changed.buffer,
			changed.byteOffset,
			changed.byteLength,
		);
		const nameLength = view.getUint16(26, true);
		expect(new TextDecoder().decode(changed.slice(30, 30 + nameLength))).toBe(
			"mimetype",
		);
		expect(view.getUint16(8, true)).toBe(0);
	});

	it("rejects missing references, unsafe doctypes/entities, encryption, signatures, and compressed mimetype", async () => {
		const missing = await epubFile({
			opf: '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata><identifier>x</identifier></metadata><manifest><item id="missing" href="missing.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="missing"/></spine></package>',
		});
		const unsafe = await epubFile({
			content:
				'<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]><html xmlns="http://www.w3.org/1999/xhtml"><body><p>&x;</p></body></html>',
		});
		const encrypted = await epubFile({
			extra: {
				"META-INF/encryption.xml":
					'<encryption><EncryptedData><EncryptionMethod Algorithm="urn:private:drm"/></EncryptedData></encryption>',
			},
		});
		const signed = await epubFile({
			extra: { "META-INF/signatures.xml": "<signatures/>" },
		});
		const compressed = await epubFile({ compressMimetype: true });
		for (const file of [missing, unsafe, encrypted, signed, compressed])
			await expect(validateEpubFile(file)).resolves.toMatchObject({
				valid: false,
			});
	});

	it("blocks placeholders, inline-tag regressions, structural edits, and stale mappings", async () => {
		const file = await epubFile({
			content:
				'<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello <em>{name}</em></p></body></html>',
		});
		const { project } = await importProject(file);
		const index = project.translationData.seg1.indexOf("{name}");
		project.translationData.seg2[index] = "Name";
		await expect(buildEpubTranslationPackage(project)).rejects.toThrow(
			/Export blocked/,
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		project.translationData.seg2[index] = "{name}";
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 99;
		await expect(buildEpubTranslationPackage(project)).rejects.toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 XHTML paragraphs deterministically", async () => {
		const file = await epubFile({
			content: `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body>${Array.from(
				{ length: 1_000 },
				(_, index) => `<p>Message ${index}</p>`,
			).join("")}</body></html>`,
		});
		const first = await importEpubFile(file, {
			includeMetadata: false,
			includeNavigation: false,
			includeSvgText: false,
		});
		const second = await importEpubFile(file, {
			includeMetadata: false,
			includeNavigation: false,
			includeSvgText: false,
		});
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it.runIf(
		process.env.OPENTLC_RUN_EPUBCHECK === "1" &&
			spawnSync("epubcheck", ["--version"]).status === 0,
	)(
		"provides an opt-in EPUBCheck gate when the validator is installed",
		async () => {
			const file = await epubFile();
			const { project } = await importProject(file);
			const output = await buildEpubTranslationPackage(project);
			const directory = mkdtempSync(join(tmpdir(), "opentlc-epub-"));
			try {
				const path = join(directory, "translated.epub");
				writeFileSync(path, new Uint8Array(await output.arrayBuffer()));
				const checked = spawnSync("epubcheck", [path], {
					encoding: "utf8",
					timeout: 30_000,
				});
				if (checked.status !== 0)
					throw new Error(
						`EPUBCheck failed: ${checked.stderr || checked.stdout}`,
					);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
