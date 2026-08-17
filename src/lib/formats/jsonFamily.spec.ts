// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildJsonTranslation,
	buildJsonTranslationBlob,
	getJsonOutputExtension,
} from "$lib/functions/outputGeneration/outputGenerationJson";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { runProjectExportQuality } from "./qualityAssurance";
import { importJsonFile, validateJsonFile } from "./importers";
import { decodeTextBytes } from "./safeInput";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name = "messages.json",
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "application/json" });
	const result = await importJsonFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected JSON segments");
	return {
		file,
		result,
		project: makeUserData({
			type: "json",
			name,
			seg1: result.segments,
			seg2: targets ?? result.targetSegments ?? result.segments.map(() => ""),
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

describe("lossless JSON families", () => {
	it("preserves duplicate keys, their unique syntax addresses, and unrelated numeric spelling", async () => {
		const source =
			'{\n  "message": "First",\n  "message": "Second",\n  "huge": 900719925474099312345,\n  "exponent": 1e+30\n}\n';
		const { result, project } = await importProject(
			source,
			"duplicates.json",
			{
				pathSelectors: "message",
				includeNonStringValues: false,
			},
			["Erste", "Zweite"],
		);

		expect(result.segments).toEqual(["First", "Second"]);
		expect(result.document.metadata?.duplicateKeys).toEqual([
			{ path: ["message"], occurrences: 2 },
		]);
		expect(result.document.units.every((unit) => unit.notes.length === 1)).toBe(
			true,
		);
		expect(
			result.segmentsMeta?.map((entry) => "address" in entry && entry.address),
		).toEqual([[0], [1]]);
		expect(buildJsonTranslation(project)).toBe(
			'{\n  "message": "Erste",\n  "message": "Zweite",\n  "huge": 900719925474099312345,\n  "exponent": 1e+30\n}\n',
		);
	});

	it("uses generic sibling key/context fields without translating those fields", async () => {
		const source = JSON.stringify([
			{ id: "welcome", text: "Hello", description: "Homepage heading" },
			{ id: "bye", text: "Goodbye", description: "Exit action" },
		]);
		const { result } = await importProject(source, "records.json", {
			pathSelectors: "*.text",
			includeNonStringValues: false,
			keyField: "id",
			contextField: "description",
		});

		expect(result.segments).toEqual(["Hello", "Goodbye"]);
		expect(result.document.units[0].contexts).toEqual([
			{ type: "json-key", value: "welcome" },
			{ type: "json-context", value: "Homepage heading" },
		]);
	});

	it("keeps each JSON value intact by default and allows explicit sentence segmentation", async () => {
		const source = '{"message":"First sentence. Second sentence!"}';
		const intact = await importProject(source, "intact.json", {
			includeNonStringValues: false,
		});
		expect(intact.result.segments).toEqual([
			"First sentence. Second sentence!",
		]);

		const segmented = await importProject(source, "segmented.json", {
			includeNonStringValues: false,
			segmentationMode: "sentences",
		});
		expect(segmented.result.segments).toEqual([
			"First sentence. ",
			"Second sentence!",
		]);
	});

	it("imports ARB messages while protecting locale metadata, descriptions, placeholders, and ICU plurals", async () => {
		const source = `{
  "@@locale": "en",
  "hello": "Hello {user}",
  "@hello": {"description":"Greeting", "placeholders":{"user":{"type":"String"}}},
  "items": "{count, plural, =0{None} one{One item} other{{count} items}}",
  "@items": {"description":"Cart quantity", "placeholders":{"count":{"type":"int"}}}
}`;
		const { result, project } = await importProject(source, "app_en.arb", {}, [
			"Hallo {user}",
			"{count, plural, =0{Keine} one{Ein Artikel} other{{count} Artikel}}",
		]);

		expect(result.document.metadata).toMatchObject({
			profile: "arb",
			locale: "en",
		});
		expect(result.segments).toHaveLength(2);
		expect(result.document.units[0].notes[0]).toMatchObject({
			category: "arb-description",
			text: "Greeting",
		});
		expect(result.document.units[0].contexts).toContainEqual({
			type: "arb-placeholders",
			value: "user",
		});
		const output = buildJsonTranslation(project);
		expect(output).toContain('"@@locale": "en"');
		expect(output).toContain('"description":"Greeting"');
		expect(output).toContain('"hello": "Hallo {user}"');
	});

	it("requires i18next to be explicit and records plural/context-bearing resource keys", async () => {
		const source = JSON.stringify({
			translation: {
				welcome: "Hello {{name}}",
				item_one: "One item",
				item_other: "{{count}} items",
			},
			version: 4,
		});
		const generic = await importProject(source, "en.json", {
			includeNonStringValues: false,
		});
		expect(generic.result.document.metadata?.profile).toBe("generic");

		const i18next = await importProject(source, "en.json", {
			profile: "i18next",
		});
		expect(i18next.result.segments).toEqual([
			"Hello {{name}}",
			"One item",
			"{{count}} items",
		]);
		expect(i18next.result.document.units[1].contexts).toContainEqual({
			type: "i18next-plural",
			value: "one",
		});
	});

	it("auto-detects Chrome messages.json, preserves descriptions, and QA-checks dollar placeholders", async () => {
		const source = `{
  "hello": {
    "message": "Hello, $USER$",
    "description": "Greeting",
    "placeholders": {"user":{"content":"$1", "example":"Ada"}}
  }
}`;
		const { result, project } = await importProject(
			source,
			"messages.json",
			{},
			["Hallo"],
		);
		expect(result.document.metadata?.profile).toBe("chrome");
		expect(result.segments).toEqual(["Hello, $USER$"]);
		expect(result.document.units[0].notes[0].text).toBe("Greeting");
		expect(runProjectExportQuality(project).issues).toContainEqual(
			expect.objectContaining({ code: "MISSING_PLACEHOLDER", token: "$USER$" }),
		);
		project.translationData.seg2 = ["Hallo, $user$"];
		expect(runProjectExportQuality(project).valid).toBe(true);
		expect(buildJsonTranslation(project)).toContain(
			'"message": "Hallo, $user$"',
		);
		expect(buildJsonTranslation(project)).toContain(
			'"description": "Greeting"',
		);
	});

	it("round-trips bilingual LocJSON arrays as one ordered unit and changes only target fragments", async () => {
		const source = `{
    "properties": {"version": 1, "x-tool-file": "keep"},
    "units": [{
        "key": "welcome",
        "properties": {"comments": ["Shown on home"], "x-tool-id": "42"},
        "source": ["Hello, ", "world!"],
        "target": ["Hallo, ", "Welt!"]
    }]
}`;
		const { result, project } = await importProject(
			source,
			"home.locjson",
			{},
			["Guten Morgen, Welt!"],
		);
		expect(result.document.metadata?.profile).toBe("locjson");
		expect(result.segments).toEqual(["Hello, world!"]);
		expect(result.targetSegments).toEqual(["Hallo, Welt!"]);
		expect(result.document.units[0].notes[0].text).toBe("Shown on home");
		const output = buildJsonTranslation(project);
		const parsed = JSON.parse(output);
		expect(parsed.units[0].source).toEqual(["Hello, ", "world!"]);
		expect(parsed.units[0].target.join("")).toBe("Guten Morgen, Welt!");
		expect(parsed.units[0].properties["x-tool-id"]).toBe("42");
		expect(parsed.properties["x-tool-file"]).toBe("keep");
	});

	it("supports monolingual LocJSON without inventing a target property", async () => {
		const source = '{"units":[{"key":"one","source":["Hello"]}]}';
		const { result, project } = await importProject(
			source,
			"mono.locjson",
			{},
			["Hallo"],
		);
		expect(result.targetSegments).toEqual([""]);
		expect(buildJsonTranslation(project)).toBe(
			'{"units":[{"key":"one","source":["Hallo"]}]}',
		);
		expect(buildJsonTranslation(project)).not.toContain("target");
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/format-level unit/,
		);
	});

	it("rejects invalid LocJSON contracts and duplicate unit keys", async () => {
		await expect(
			importJsonFile(
				new File(
					[
						'{"units":[{"key":"same","source":["A"]},{"key":"same","source":["B"]}]}',
					],
					"bad.locjson",
				),
			),
		).rejects.toThrow(/duplicated/);
		await expect(
			importJsonFile(
				new File(['{"units":[{"key":"missing"}]}'], "bad.locjson"),
			),
		).rejects.toThrow(/source array/);
	});

	it("keeps valid numeric spellings exact and turns invalid translated primitives into strings", async () => {
		const source = '{"precise":1e+30,"flag":true,"nothing":null}';
		const { project } = await importProject(source, "types.json", {}, [
			"01",
			"yes",
			"none",
		]);
		const output = buildJsonTranslation(project);
		expect(JSON.parse(output)).toEqual({
			precise: "01",
			flag: "yes",
			nothing: "none",
		});

		project.translationData.seg2 = ["-12.50e+2", "false", "null"];
		expect(buildJsonTranslation(project)).toBe(
			'{"precise":-12.50e+2,"flag":false,"nothing":null}',
		);
	});

	it("preserves UTF-16 encoding/BOM and exact identity bytes", async () => {
		const source = encodeTextBytes(
			'{\r\n  "message": "Hello"\r\n}',
			"utf-16be",
			true,
		);
		const identity = await importProject(source, "utf16.json", {}, ["Hello"]);
		expect(await bytes(buildJsonTranslationBlob(identity.project))).toEqual(
			source,
		);

		identity.project.translationData.seg2 = ["Hallo"];
		expect(
			decodeTextBytes(await bytes(buildJsonTranslationBlob(identity.project))),
		).toMatchObject({
			encoding: "utf-16be",
			hasBom: true,
			text: '\ufeff{\r\n  "message": "Hallo"\r\n}',
		});
	});

	it("rejects malformed JSON grammar with safe error codes", async () => {
		for (const source of [
			'{"number":01}',
			'{"trailing":true,}',
			'{"control":"line\nbreak"}',
			'{"space":\u00a0true}',
		]) {
			await expect(
				validateJsonFile(new File([source], "broken.json")),
			).resolves.toMatchObject({ valid: false, errorCode: "JSON_MALFORMED" });
		}
	});

	it("preserves family extensions for downloads", () => {
		expect(getJsonOutputExtension("app_en.arb")).toBe("arb");
		expect(getJsonOutputExtension("catalog.locjson")).toBe("locjson");
		expect(getJsonOutputExtension("messages.json")).toBe("json");
	});

	it("refuses export when persisted syntax mappings no longer align", async () => {
		const { project } = await importProject('{"message":"Hello"}');
		if (!project.translationData.skeleton)
			throw new Error("Expected a JSON skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		expect(() => buildJsonTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports a large generic resource deterministically", async () => {
		const source = JSON.stringify(
			Object.fromEntries(
				Array.from({ length: 1_000 }, (_, index) => [
					`message_${index}`,
					`Message ${index}`,
				]),
			),
		);
		const first = await importJsonFile(new File([source], "large.json"), {
			includeNonStringValues: false,
		});
		const second = await importJsonFile(new File([source], "large.json"), {
			includeNonStringValues: false,
		});
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segments).toEqual(first.segments);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
