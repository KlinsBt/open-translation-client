// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { buildDitaTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationDita";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import { importDitaFile, maskKnownDitaDoctype, validateDitaFile } from "./dita";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name = "topic.dita",
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "application/dita+xml" });
	const result = await importDitaFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected DITA segments");
	return {
		file,
		result,
		project: makeUserData({
			type: "dita",
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

async function bundleFile(entries: Record<string, string | Uint8Array>) {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		"manual.ditazip",
		{ type: "application/zip" },
	);
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

describe("DITA and DITAMAP workflow", () => {
	it("extracts topic prose and inline elements while preserving IDs, references, profiling, and fixed doctypes", async () => {
		const source = `<?xml version="1.0"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="welcome" audience="admin"><title>Welcome</title><body><p id="intro">Hello <ph product="suite">world</ph>.</p><image href="hero.png" alt="Hero image"/><codeblock>const locked = true;</codeblock><p translate="no">Locked</p></body></topic>`;
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual([
			"Welcome",
			"Hello",
			"world",
			".",
			"Hero image",
		]);
		expect(result.document.units[0].contexts).toContainEqual({
			type: "dita-part",
			value: "topic.dita",
		});
		project.translationData.seg2 = [
			"Willkommen",
			"Hallo",
			"Welt",
			"!",
			"Titelbild",
		];
		const output = await (await buildDitaTranslationBlob(project)).text();
		expect(output).toContain("<!DOCTYPE topic PUBLIC");
		expect(output).toContain('id="intro"');
		expect(output).toContain('audience="admin"');
		expect(output).toContain('<ph product="suite">Welt</ph>!');
		expect(output).toContain('<image href="hero.png" alt="Titelbild"/>');
		expect(output).toContain("const locked = true;");
	});

	it("supports map navigation, metadata, code, specialization classes, and translate controls", async () => {
		const specialized = `<guide class="- map/map "><title>Guide</title><topicmeta><shortdesc>Metadata</shortdesc></topicmeta><topicref navtitle="Chapter"/></guide>`;
		const hidden = await importDitaFile(
			new File([specialized], "guide.ditamap"),
			{
				includeNavigation: false,
				includeMetadata: true,
			},
		);
		const visible = await importDitaFile(
			new File([specialized], "guide.ditamap"),
			{
				includeNavigation: true,
				includeMetadata: true,
			},
		);
		if (hidden.kind !== "segments" || visible.kind !== "segments")
			throw new Error("Expected DITA segments");
		expect(hidden.segments).toEqual(["Chapter"]);
		expect(visible.segments).toEqual(["Guide", "Metadata", "Chapter"]);

		const topic = `<topic id="t"><prolog><author>Writer</author></prolog><body><codeblock>Code</codeblock><p translate="no">Locked</p><p>Open</p></body></topic>`;
		const defaults = await importDitaFile(new File([topic], "topic.dita"));
		const expanded = await importDitaFile(new File([topic], "topic.dita"), {
			includeMetadata: true,
			includeCode: true,
			respectTranslateMetadata: false,
		});
		if (defaults.kind !== "segments" || expanded.kind !== "segments")
			throw new Error("Expected DITA segments");
		expect(defaults.segments).toEqual(["Open"]);
		expect(expanded.segments).toEqual(["Writer", "Code", "Locked", "Open"]);
	});

	it("validates a complete root-map graph, keys, conrefs, and preserves non-XML assets", async () => {
		const asset = new Uint8Array([0, 1, 2, 255]);
		const file = await bundleFile({
			"root.ditamap": `<map id="root"><title>Manual</title><keydef keys="product" href="topics/a.dita#a"/><topicref href="topics/a.dita#a"/><topicref href="shared.dita#shared/note"/></map>`,
			"topics/a.dita": `<topic id="a"><title>First topic</title><body><p keyref="product">Product</p><p conref="../shared.dita#shared/note">Fallback</p></body></topic>`,
			"shared.dita": `<topic id="shared"><title>Shared</title><body><p id="note">Shared note</p></body></topic>`,
			"images/hero.png": asset,
		});
		const result = await importDitaFile(file);
		if (result.kind !== "segments") throw new Error("Expected DITA segments");
		expect(result.document.metadata).toMatchObject({
			profile: "DITA multi-file bundle",
			rootMap: "root.ditamap",
			documents: 3,
		});
		expect(result.segments).toContain("First topic");
		const project = makeUserData({
			type: "dita",
			name: "manual.ditazip",
			seg1: result.segments,
			seg2: result.segments.map((value) =>
				value === "First topic" ? "Erstes Thema" : value,
			),
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		});
		const output = await buildDitaTranslationBlob(project);
		const zip = await JSZip.loadAsync(await output.arrayBuffer());
		expect(await zip.file("topics/a.dita")!.async("string")).toContain(
			"Erstes Thema",
		);
		expect(await zip.file("images/hero.png")!.async("uint8array")).toEqual(
			asset,
		);
		await expect(
			importDitaFile(new File([output], "manual.ditazip")),
		).resolves.toMatchObject({ kind: "segments" });
	});

	it("rejects missing documents, fragments, keys, unsafe paths, and ambiguous root maps", async () => {
		const invalidBundles: Array<Record<string, string | Uint8Array>> = [
			{
				"root.ditamap": '<map><topicref href="missing.dita"/></map>',
			},
			{
				"root.ditamap": '<map><topicref href="topic.dita#missing"/></map>',
				"topic.dita": '<topic id="present"><title>Topic</title></topic>',
			},
			{
				"root.ditamap": '<map><topicref href="topic.dita"/></map>',
				"topic.dita":
					'<topic id="topic"><p keyref="undefined">Text</p></topic>',
			},
			{
				"root.ditamap": '<map><topicref href="../escape.dita"/></map>',
			},
			{
				"one.ditamap": "<map/>",
				"two.ditamap": "<map/>",
			},
		];
		for (const entries of invalidBundles)
			await expect(
				validateDitaFile(await bundleFile(entries)),
			).resolves.toMatchObject({
				valid: false,
			});
	});

	it("rejects unsafe declarations, malformed XML, duplicate IDs, and non-DITA roots", async () => {
		const invalid = [
			'<!DOCTYPE topic [<!ENTITY x SYSTEM "file:///etc/passwd">]><topic id="t"><title>&x;</title></topic>',
			'<!DOCTYPE topic SYSTEM "http://example.com/evil.dtd"><topic id="t"/>',
			'<topic id="same"><body><p id="same">Duplicate</p></body></topic>',
			"<topic><title>broken</topic>",
			"<html><p>Not DITA</p></html>",
		];
		for (const content of invalid)
			await expect(
				validateDitaFile(new File([content], "bad.dita")),
			).resolves.toMatchObject({
				valid: false,
			});
		expect(() =>
			maskKnownDitaDoctype('<!DOCTYPE topic SYSTEM "topic.dtd"><topic/>'),
		).not.toThrow();
	});

	it("preserves UTF-16 identity bytes and escapes changed XML values", async () => {
		const bytes = encodeTextBytes(
			'<topic id="t"><title>Café</title></topic>',
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(
				await (await buildDitaTranslationBlob(project)).arrayBuffer(),
			),
		).toEqual(bytes);
		project.translationData.seg2 = ['Tea & <"coffee">'];
		const decoded = decodeTextBytes(
			new Uint8Array(
				await (await buildDitaTranslationBlob(project)).arrayBuffer(),
			),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain('Tea &amp; &lt;"coffee"&gt;');
	});

	it("round-trips sentence segmentation without duplication", async () => {
		const { result, project } = await importProject(
			'<topic id="t"><body><p>First sentence. Second sentence.</p></body></topic>',
			"topic.dita",
			{ segmentationMode: "sentences" },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = await (await buildDitaTranslationBlob(project)).text();
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
	});

	it("blocks placeholder loss, structural edits, and stale mappings", async () => {
		const { project } = await importProject(
			'<topic id="t"><title>Hello {name}</title></topic>',
			"topic.dita",
			{},
			["Hallo"],
		);
		await expect(buildDitaTranslationBlob(project)).rejects.toThrow(
			/Export blocked/,
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		project.translationData.seg2 = ["Hallo {name}"];
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		await expect(buildDitaTranslationBlob(project)).rejects.toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 topic paragraphs deterministically and validates output independently", async () => {
		const source = `<topic id="large"><title>Large</title><body>${Array.from(
			{ length: 1_000 },
			(_, index) => `<p id="p${index}">Message ${index}</p>`,
		).join("")}</body></topic>`;
		const first = await importDitaFile(new File([source], "large.dita"));
		const second = await importDitaFile(new File([source], "large.dita"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected DITA segments");
		expect(first.segments).toHaveLength(1_001);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);

		if (spawnSync("xmllint", ["--version"], { timeout: 5_000 }).status === 0) {
			const { project } = await importProject(source, "large.dita");
			const directory = mkdtempSync(join(tmpdir(), "opentlc-dita-"));
			try {
				const path = join(directory, "translated.dita");
				writeFileSync(
					path,
					new Uint8Array(
						await (await buildDitaTranslationBlob(project)).arrayBuffer(),
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
		}
	});

	it.runIf(process.env.OPENTLC_RUN_DITA_OT === "1")(
		"publishes a generated topic with DITA-OT when explicitly enabled",
		async () => {
			const executable = spawnSync("dita", ["--version"], { timeout: 10_000 });
			expect(executable.status, executable.stderr?.toString()).toBe(0);
			const { project } = await importProject(
				'<topic id="t"><title>Hello</title><body><p>Text</p></body></topic>',
			);
			const directory = mkdtempSync(join(tmpdir(), "opentlc-dita-ot-"));
			try {
				const input = join(directory, "topic.dita");
				const output = join(directory, "out");
				writeFileSync(
					input,
					new Uint8Array(
						await (await buildDitaTranslationBlob(project)).arrayBuffer(),
					),
				);
				const published = spawnSync(
					"dita",
					["--input", input, "--format", "html5", "--output", output],
					{ encoding: "utf8", timeout: 120_000 },
				);
				expect(published.status, published.stderr).toBe(0);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
