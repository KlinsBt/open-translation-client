// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAllDocuments } from "yaml";
import { makeUserData } from "../../test/fixtures";
import {
	buildYamlTranslation,
	buildYamlTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationYaml";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import {
	combineSegmentData,
	splitSegmentData,
} from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	importYamlFile,
	parseYamlSyntax,
	validateYamlFile,
} from "./yamlFamily";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name = "messages.yaml",
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "application/yaml" });
	const result = await importYamlFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected YAML segments");
	return {
		file,
		result,
		project: makeUserData({
			type: "yaml",
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

async function bytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
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

describe("lossless YAML 1.2 workflow", () => {
	it("extracts mapping values while retaining comments, anchors, aliases, tags, styles, and document boundaries", async () => {
		const source = `%YAML 1.2
---
title: Hello # translator note
shared: &welcome 'Welcome'
alias: *welcome
tagged: !product "Tagged text"
count: 12
body: |-
  First line
  Second line
...
---
title: Second document
`;
		const { result } = await importProject(source, "catalog.yaml", {
			pathSelectors: "title,shared,alias,tagged,body",
		});

		expect(result.segments).toEqual([
			"Hello",
			"Welcome",
			"Tagged text",
			"First line\nSecond line",
			"Second document",
		]);
		expect(result.segments).not.toContain("welcome");
		expect(result.document.metadata).toMatchObject({ documentCount: 2 });
		expect(result.document.units[0].notes).toContainEqual(
			expect.objectContaining({
				category: "yaml-comment",
				text: "translator note",
			}),
		);
		expect(result.document.units[1].contexts).toContainEqual({
			type: "yaml-anchor",
			value: "welcome",
		});
		expect(result.document.units[2].contexts).toContainEqual({
			type: "yaml-tag",
			value: "!product",
		});
		expect(
			result.segmentsMeta?.map((entry) => "style" in entry && entry.style),
		).toEqual([
			"PLAIN",
			"QUOTE_SINGLE",
			"QUOTE_DOUBLE",
			"BLOCK_LITERAL",
			"PLAIN",
		]);
	});

	it("changes only scalar ranges and keeps source presentation authored", async () => {
		const source = `# keep
plain: Hello
single: 'It''s fine'
double: "Welcome"
anchor: &copy Copyright
alias: *copy
tagged: !product Original
number: 1_000
`;
		const { project } = await importProject(
			source,
			"styles.yml",
			{
				includeNonStringScalars: false,
				pathSelectors: "plain,single,double,anchor,tagged",
			},
			["Hallo: Welt", "Das ist's", "Willkommen", "Urheberrecht", "Übersetzt"],
		);
		const output = buildYamlTranslation(project);

		expect(output).toContain("# keep");
		expect(output).toContain('plain: "Hallo: Welt"');
		expect(output).toContain("single: 'Das ist''s'");
		expect(output).toContain('double: "Willkommen"');
		expect(output).toContain("anchor: &copy Urheberrecht");
		expect(output).toContain("alias: *copy");
		expect(output).toContain("tagged: !product Übersetzt");
		expect(output).toContain("number: 1_000");
	});

	it("preserves literal and folded block styles, indentation, and chomping semantics", async () => {
		const source = `literal: |-
    First line
    Second line
folded: >-
    First folded
    line
kept: |+
    Original

`;
		const { result, project } = await importProject(source, "blocks.yaml", {}, [
			"Erste Zeile\nZweite Zeile",
			"Erste gefaltete Zeile",
			"Neu\n\n",
		]);
		expect(result.segments).toEqual([
			"First line\nSecond line",
			"First folded line",
			"Original\n\n",
		]);
		const output = buildYamlTranslation(project);
		expect(output).toContain("literal: |-\n    Erste Zeile\n    Zweite Zeile");
		expect(output).toContain("folded: >-");
		expect(output).toContain("kept: |+");
		const values = parseAllDocuments(output)[0].toJS() as Record<
			string,
			string
		>;
		expect(values).toEqual({
			literal: "Erste Zeile\nZweite Zeile",
			folded: "Erste gefaltete Zeile",
			kept: "Neu\n\n",
		});
	});

	it("preserves duplicate mapping members and gives each occurrence an exact range", async () => {
		const source = "message: First\nmessage: Second\n";
		const { result, project } = await importProject(
			source,
			"duplicates.yml",
			{},
			["Erste", "Zweite"],
		);
		expect(result.segments).toEqual(["First", "Second"]);
		expect(result.document.metadata?.duplicateKeys).toEqual([
			{
				documentIndex: 0,
				path: ["message"],
				key: "message",
				occurrences: 2,
			},
		]);
		expect(result.document.units.every((unit) => unit.notes.length === 1)).toBe(
			true,
		);
		expect(buildYamlTranslation(project)).toBe(
			"message: Erste\nmessage: Zweite\n",
		);
	});

	it("keeps non-string types only when translated values remain valid YAML 1.2 scalars", async () => {
		const source = "count: 12\nflag: true\nnothing: null\n";
		const { project } = await importProject(
			source,
			"types.yaml",
			{ includeNonStringScalars: true },
			["-12.5", "yes", "none"],
		);
		const output = buildYamlTranslation(project);
		expect(output).toBe('count: -12.5\nflag: "yes"\nnothing: "none"\n');
		const values = parseAllDocuments(output)[0].toJS() as Record<
			string,
			unknown
		>;
		expect(values).toEqual({ count: -12.5, flag: "yes", nothing: "none" });
	});

	it("keeps unresolved custom tags opaque without constructing application objects", async () => {
		const source = "payload: !<tag:example.test,2026:object> harmless\n";
		const syntax = parseYamlSyntax(source);
		expect(syntax.warnings).toContainEqual(
			expect.stringMatching(/Unresolved tag/),
		);
		expect(syntax.scalars[0]).toMatchObject({
			value: "harmless",
			tag: "tag:example.test,2026:object",
		});
		const { project } = await importProject(source, "tagged.yaml", {}, [
			"safe",
		]);
		expect(buildYamlTranslation(project)).toBe(
			"payload: !<tag:example.test,2026:object> safe\n",
		);
	});

	it("selects array and multi-document paths deterministically", async () => {
		const source = `---
items:
  - title: One
    id: 1
  - title: Two
    id: 2
---
items:
  - title: Three
`;
		const first = await importYamlFile(new File([source], "items.yaml"), {
			pathSelectors: "items.*.title",
		});
		const second = await importYamlFile(new File([source], "items.yaml"), {
			pathSelectors: "items.*.title",
		});
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toEqual(["One", "Two", "Three"]);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it("preserves UTF-16 BOM identity and translated encoding", async () => {
		const source = encodeTextBytes("message: Hello\r\n", "utf-16le", true);
		const identity = await importProject(source, "utf16.yaml", {}, ["Hello"]);
		expect(await bytes(buildYamlTranslationBlob(identity.project))).toEqual(
			source,
		);
		identity.project.translationData.seg2 = ["Hallo"];
		expect(
			decodeTextBytes(await bytes(buildYamlTranslationBlob(identity.project))),
		).toMatchObject({
			encoding: "utf-16le",
			hasBom: true,
			text: "\ufeffmessage: Hallo\r\n",
		});
	});

	it("rejects malformed YAML with a safe error code", async () => {
		for (const source of [
			'message: "unterminated\n',
			"mapping: {one: 1, two\n",
			"flow: [one, two\n",
		]) {
			await expect(
				validateYamlFile(new File([source], "broken.yaml")),
			).resolves.toMatchObject({ valid: false, errorCode: "YAML_MALFORMED" });
		}
	});

	it("blocks structural edits and refuses corrupted scalar mappings", async () => {
		const { project } = await importProject("message: Hello\n");
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		const duplicated = makeUserData({
			...project.translationData,
			seg1: ["One", "Two"],
			seg2: ["Eins", "Zwei"],
			checked: [false, false],
		}).translationData;
		expect(combineSegmentData(duplicated, 0).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton)
			throw new Error("Expected YAML skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 5;
		expect(() => buildYamlTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports a 1,000-value catalog deterministically", async () => {
		const source = Array.from(
			{ length: 1_000 },
			(_, index) => `message_${index}: Message ${index}`,
		).join("\n");
		const first = await importYamlFile(new File([source], "large.yaml"));
		const second = await importYamlFile(new File([source], "large.yaml"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
