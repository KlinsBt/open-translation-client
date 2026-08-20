// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildSvgTranslation,
	buildSvgTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationSvg";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import { importSvgFile, validateSvgFile } from "./svg";
import type { FormatOptionValues } from "./types";

const XMLLINT_AVAILABLE =
	spawnSync("xmllint", ["--version"], { timeout: 5_000 }).status === 0;

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "diagram.svg", { type: "image/svg+xml" });
	const result = await importSvgFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected SVG segments");
	return {
		result,
		project: makeUserData({
			type: "svg",
			name: "diagram.svg",
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

describe("SVG localization profile", () => {
	it("extracts visible text, textPath content, titles/descriptions, and selected accessibility attributes", async () => {
		const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
<title>Diagram title</title><desc>Diagram description</desc>
<path id="curve" d="M0,50 C20,0 80,100 100,50" transform="rotate(2)"/>
<text id="label" style="font-weight:bold">Hello <tspan>world</tspan> <textPath xlink:href="#curve">on curve</textPath></text>
<g aria-label="Accessible group"><rect width="10" height="10"/></g>
<text display="none">Hidden text</text><text translate="no">Locked text</text>
<metadata><rdf:RDF xmlns:rdf="urn:rdf"><rdf:Description>Metadata text</rdf:Description></rdf:RDF></metadata>
<style>.label{fill:red}</style><script>globalThis.__svgExecuted=true</script>
</svg>`;
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual([
			"Diagram title",
			"Diagram description",
			"Hello",
			"world",
			"on curve",
			"Accessible group",
		]);
		expect(
			(globalThis as { __svgExecuted?: boolean }).__svgExecuted,
		).toBeUndefined();
		project.translationData.seg2 = [
			"Diagrammtitel",
			"Diagrammbeschreibung",
			"Hallo",
			"Welt",
			"auf Kurve",
			"Barrierefreie Gruppe",
		];
		const output = buildSvgTranslation(project);
		expect(output).toContain(
			'd="M0,50 C20,0 80,100 100,50" transform="rotate(2)"',
		);
		expect(output).toContain(
			'<text id="label" style="font-weight:bold">Hallo <tspan>Welt</tspan> <textPath xlink:href="#curve">auf Kurve</textPath>',
		);
		expect(output).toContain('<g aria-label="Barrierefreie Gruppe">');
		expect(output).toContain("globalThis.__svgExecuted=true");
	});

	it("supports explicit element/attribute selectors and hidden/metadata controls", async () => {
		const source = `<svg xmlns="http://www.w3.org/2000/svg"><title>Title</title><desc>Desc</desc><text visibility="hidden">Hidden</text><metadata><label>Metadata</label></metadata><rect data-label="Rectangle"/></svg>`;
		const result = await importSvgFile(new File([source], "diagram.svg"), {
			elementSelectors: "desc",
			attributeSelectors: "data-label",
			includeHiddenText: true,
			includeMetadata: true,
		});
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Desc", "Metadata", "Rectangle"]);
	});

	it("respects inherited SVG and ITS translate metadata", async () => {
		const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:its="http://www.w3.org/2005/11/its"><g translate="no"><text>Plain locked</text></g><g its:translate="no"><text>ITS locked</text></g><text>Open</text></svg>`;
		const respected = await importSvgFile(new File([source], "diagram.svg"));
		const ignored = await importSvgFile(new File([source], "diagram.svg"), {
			respectTranslateMetadata: false,
		});
		if (respected.kind !== "segments" || ignored.kind !== "segments")
			throw new Error("Expected segments");
		expect(respected.segments).toEqual(["Open"]);
		expect(ignored.segments).toEqual(["Plain locked", "ITS locked", "Open"]);
	});

	it("preserves UTF-16 identity bytes and escapes changed XML safely", async () => {
		const bytes = encodeTextBytes(
			'<svg xmlns="http://www.w3.org/2000/svg"><text>Café</text></svg>',
			"utf-16be",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(await buildSvgTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ['Tea & <"coffee">'];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildSvgTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16be", hasBom: true });
		expect(decoded.text).toContain('Tea &amp; &lt;"coffee"&gt;');
	});

	it("rejects non-SVG roots, malformed XML, doctypes, and entity declarations", async () => {
		const invalid = [
			"<html><p>Not SVG</p></html>",
			'<svg xmlns="http://www.w3.org/2000/svg"><text>broken</svg>',
			'<!DOCTYPE svg SYSTEM "http://example.com/svg.dtd"><svg/>',
			'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
		];
		for (const content of invalid)
			await expect(
				validateSvgFile(new File([content], "bad.svg")),
			).resolves.toMatchObject({
				valid: false,
			});
	});

	it("blocks placeholders, structural edits, and stale mappings", async () => {
		const { project } = await importProject(
			'<svg xmlns="http://www.w3.org/2000/svg"><text>Hello {name}</text></svg>',
			{},
			["Hallo"],
		);
		expect(() => buildSvgTranslation(project)).toThrow(/Export blocked/);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		project.translationData.seg2 = ["Hallo {name}"];
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 8;
		expect(() => buildSvgTranslation(project)).toThrow(/do not align uniquely/);
	});

	it("imports 1,000 text nodes deterministically", async () => {
		const source = `<svg xmlns="http://www.w3.org/2000/svg">${Array.from(
			{ length: 1_000 },
			(_, index) => `<text x="${index}">Message ${index}</text>`,
		).join("")}</svg>`;
		const first = await importSvgFile(new File([source], "large.svg"));
		const second = await importSvgFile(new File([source], "large.svg"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it.skipIf(!XMLLINT_AVAILABLE)(
		"produces SVG accepted by xmllint when available",
		async () => {
			const { project } = await importProject(
				'<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>',
				{},
				["Hallo"],
			);
			const directory = mkdtempSync(join(tmpdir(), "opentlc-svg-"));
			try {
				const path = join(directory, "translated.svg");
				writeFileSync(path, buildSvgTranslation(project));
				const checked = spawnSync("xmllint", ["--noout", "--nonet", path], {
					encoding: "utf8",
					timeout: 5_000,
				});
				expect(checked.status, checked.stderr).toBe(0);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
