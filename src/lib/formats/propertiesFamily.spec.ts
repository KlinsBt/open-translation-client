// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildPropertiesTranslation,
	buildPropertiesTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationProperties";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import {
	importPropertiesFile,
	parseProperties,
	validatePropertiesFile,
} from "./propertiesFamily";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "messages.properties", {
		type: "text/x-java-properties",
	});
	const result = await importPropertiesFile(file, options);
	if (result.kind !== "segments")
		throw new Error("Expected properties segments");
	return {
		result,
		project: makeUserData({
			type: "properties",
			name: "messages.properties",
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

describe("Java and Mozilla properties workflow", () => {
	it("preserves comments, separators, escaped keys, order, and duplicate warnings", async () => {
		const source = `# Home
home\\:title : Hello\\ World
! Button
action=Save
action = Duplicate`;
		const { result } = await importProject(source);
		expect(result.segments).toEqual(["Hello World", "Save", "Duplicate"]);
		expect(result.document.units[0].id).toBe("home:title");
		expect(result.document.units[0].notes[0]?.text).toBe("Home");
		expect(result.document.metadata?.warnings).toContain(
			"Duplicate properties key action.",
		);
	});

	it("edits continued logical values while retaining physical layout", async () => {
		const source = "long = first\\\r\n\tsecond\\\r\n  third\r\nkeep:yes\r\n";
		const { result, project } = await importProject(source, {}, [
			"erstezweitedritte",
			"yes",
		]);
		expect(result.segments).toEqual(["firstsecondthird", "yes"]);
		const output = buildPropertiesTranslation(project);
		expect(output).toMatch(/^long = .+\\\r\n\t.+\\\r\n  .+\r\nkeep:yes/m);
		expect(parseProperties(output).entries[0].value).toBe("erstezweitedritte");
	});

	it("decodes Java escapes and safely re-encodes control and leading whitespace", async () => {
		const { result, project } = await importProject(
			"escaped=Tab\\tLine\\nUnicode\\u00E9\\\\end",
			{},
			[" leading\tline\n"],
		);
		expect(result.segments).toEqual(["Tab\tLine\nUnicodeé\\end"]);
		const output = buildPropertiesTranslation(project);
		expect(output).toBe("escaped=\\ leading\\tline\\n");
		expect(parseProperties(output).entries[0].value).toBe(" leading\tline\n");
	});

	it("auto-detects legacy single-byte files and preserves identity bytes", async () => {
		const source = new Uint8Array([
			0x63, 0x61, 0x66, 0x65, 0x3d, 0x43, 0x61, 0x66, 0xe9, 0x0a,
		]);
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual(["Café"]);
		expect(result.document.metadata?.encoding).toBe("iso-8859-1");
		expect(
			new Uint8Array(
				await buildPropertiesTranslationBlob(project).arrayBuffer(),
			),
		).toEqual(source);
		project.translationData.seg2 = ["Tea ☕"];
		const output = new TextDecoder().decode(
			await buildPropertiesTranslationBlob(project).arrayBuffer(),
		);
		expect(output).toContain("Tea \\u2615");
	});

	it("keeps empty values optional and keys protected", async () => {
		const source = "empty=\nkey.only\nvisible=Value\n";
		expect((await importProject(source)).result.segments).toEqual(["Value"]);
		const { result } = await importProject(source, { includeEmpty: true });
		expect(result.segments).toEqual(["", "", "Value"]);
		expect(result.document.units.map((unit) => unit.id)).toEqual([
			"empty",
			"key.only",
			"visible",
		]);
	});

	it("blocks MessageFormat and printf placeholder regressions", async () => {
		const { project } = await importProject("message=Hello {0}, %1$s", {}, [
			"Hallo",
		]);
		expect(() => buildPropertiesTranslation(project)).toThrow(/Export blocked/);
	});

	it("rejects invalid Unicode escapes and dangling continuations", async () => {
		for (const source of ["bad=\\u12G4", "bad=value\\"])
			await expect(
				validatePropertiesFile(new File([source], "bad.properties")),
			).resolves.toMatchObject({
				valid: false,
				errorCode: "PROPERTIES_MALFORMED",
			});
	});

	it("blocks structural edits and stale mappings", async () => {
		const { project } = await importProject("hello=Hello", {}, ["Hallo"]);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		expect(() => buildPropertiesTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 entries deterministically", async () => {
		const source = Array.from(
			{ length: 1_000 },
			(_, index) => `message_${index}=Message ${index}`,
		).join("\n");
		const first = await importPropertiesFile(
			new File([source], "messages.properties"),
		);
		const second = await importPropertiesFile(
			new File([source], "messages.properties"),
		);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
