// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildResxTranslation,
	buildResxTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationResx";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import { importResxFile, parseResx, validateResxFile } from "./resxFamily";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "Resources.resx", {
		type: "application/xml",
	});
	const result = await importResxFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected RESX segments");
	return {
		result,
		project: makeUserData({
			type: "resx",
			name: "Resources.resx",
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

describe("safe .NET RESX workflow", () => {
	it("imports plain and System.String data with comments and names as context", async () => {
		const source = `<root>
<resheader name="resmimetype"><value>text/microsoft-resx</value></resheader>
<data name="Greeting" xml:space="preserve"><value>Hello &amp; welcome</value><comment>Home title</comment></data>
<data name="Typed" type="System.String, mscorlib"><value>Typed text</value></data>
</root>`;
		const { result } = await importProject(source);
		expect(result.segments).toEqual(["Hello & welcome", "Typed text"]);
		expect(result.document.units[0].id).toBe("Greeting");
		expect(result.document.units[0].notes[0]?.text).toBe("Home title");
		expect(result.document.units[1].contexts).toContainEqual({
			type: "resx-type",
			value: "System.String, mscorlib",
		});
	});

	it("never exposes or deserializes typed, mimetype, binary, alias, or header records", async () => {
		const source = `<root>
<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema"/>
<resheader name="reader"><value>System.Resources.ResXResourceReader</value></resheader>
<assembly alias="drawing" name="System.Drawing"/>
<data name="Image" type="System.Drawing.Bitmap, System.Drawing"><value>base64</value></data>
<data name="Object" mimetype="application/x-microsoft.net.object.binary.base64"><value>AAEC</value></data>
<data name="Safe"><value>Translate</value></data>
</root>`;
		const { result, project } = await importProject(source, {}, ["Übersetzen"]);
		expect(result.segments).toEqual(["Translate"]);
		const output = buildResxTranslation(project);
		expect(output).toContain("<value>base64</value>");
		expect(output).toContain("<value>AAEC</value>");
		expect(output).toContain("<value>Übersetzen</value>");
	});

	it("can exclude explicit System.String and include empty paired values", async () => {
		const source = `<root><data name="Plain"><value></value></data><data name="Typed" type="System.String"><value>Typed</value></data></root>`;
		const { result } = await importProject(source, {
			includeEmpty: true,
			includeExplicitSystemStrings: false,
		});
		expect(result.segments).toEqual([""]);
	});

	it("preserves XML syntax while escaping text and splitting CDATA terminators", async () => {
		const source = `<root><!--keep--><data name='Text'><value>A &amp; B</value></data><data name="Raw"><value> <![CDATA[raw < text]]> </value></data></root>`;
		const { project } = await importProject(source, {}, [
			"X < Y & Z",
			"target ]]> tail",
		]);
		const output = buildResxTranslation(project);
		expect(output).toContain("<!--keep-->");
		expect(output).toContain("name='Text'");
		expect(output).toContain("X &lt; Y &amp; Z");
		expect(output).toContain("<![CDATA[target ]]]]><![CDATA[> tail]]>");
		expect(parseResx(output).values.map((value) => value.value)).toEqual([
			"X < Y & Z",
			"target ]]> tail",
		]);
	});

	it("preserves UTF-16 BOM identity bytes", async () => {
		const source = encodeTextBytes(
			'<?xml version="1.0" encoding="UTF-16"?>\r\n<root><data name="Cafe"><value>Café</value></data></root>\r\n',
			"utf-16be",
			true,
		);
		const { project } = await importProject(source);
		expect(
			new Uint8Array(await buildResxTranslationBlob(project).arrayBuffer()),
		).toEqual(source);
		project.translationData.seg2 = ["Kaffee"];
		expect(
			decodeTextBytes(
				new Uint8Array(await buildResxTranslationBlob(project).arrayBuffer()),
			),
		).toMatchObject({ encoding: "utf-16be", hasBom: true });
	});

	it("blocks placeholder regressions", async () => {
		const { project } = await importProject(
			'<root><data name="Format"><value>Hello {0}, %1$s</value></data></root>',
			{},
			["Hallo"],
		);
		expect(() => buildResxTranslation(project)).toThrow(/Export blocked/);
	});

	it("rejects malformed/unsafe XML, missing names, and protects nested value XML", async () => {
		for (const source of [
			"<catalog/>",
			"<root><data><value>X</value></data></root>",
			'<!DOCTYPE root [<!ENTITY x SYSTEM "file:///tmp/x">]><root/>',
		])
			await expect(
				validateResxFile(new File([source], "bad.resx")),
			).resolves.toMatchObject({ valid: false });
		const nested = await importProject(
			'<root><data name="Nested"><value><object>Never</object></value></data></root>',
		);
		expect(nested.result.segments).toEqual([]);
		expect(nested.result.document.metadata?.warnings).toContain(
			"String resource Nested contains nested XML and was protected.",
		);
	});

	it("blocks structural edits and stale mappings", async () => {
		const { project } = await importProject(
			'<root><data name="Hello"><value>Hello</value></data></root>',
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 7;
		expect(() => buildResxTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 string resources deterministically", async () => {
		const source = `<root>${Array.from(
			{ length: 1_000 },
			(_, index) =>
				`<data name="Message${index}"><value>Message ${index}</value></data>`,
		).join("")}</root>`;
		const first = await importResxFile(new File([source], "Resources.resx"));
		const second = await importResxFile(new File([source], "Resources.resx"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
