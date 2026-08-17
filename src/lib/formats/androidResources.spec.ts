// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildAndroidResourcesTranslation,
	buildAndroidResourcesTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationAndroid";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import {
	importAndroidResourcesFile,
	validateAndroidResourcesFile,
} from "./androidResources";
import { decodeTextBytes } from "./safeInput";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "strings.xml", { type: "application/xml" });
	const result = await importAndroidResourcesFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected Android segments");
	return {
		result,
		project: makeUserData({
			type: "android",
			name: "strings.xml",
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

describe("Android string resources workflow", () => {
	it("imports strings, arrays, plurals, comments, and resource relationships", async () => {
		const source = `<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2">
<!-- Home greeting --><string name="welcome">Hello <b>world</b>, <xliff:g id="user">%1$s</xliff:g></string>
<string-array name="days"><item>Monday</item><item>Tuesday</item></string-array>
<plurals name="cats"><item quantity="one">%d cat</item><item quantity="other">%d cats</item></plurals>
</resources>`;
		const { result } = await importProject(source);
		expect(result.segments).toEqual([
			'Hello <b>world</b>, <xliff:g id="user">%1$s</xliff:g>',
			"Monday",
			"Tuesday",
			"%d cat",
			"%d cats",
		]);
		expect(result.document.units[0].notes[0]?.text).toBe("Home greeting");
		expect(result.document.units[3].relationships?.plural).toEqual({
			groupId: "cats",
			category: "one",
		});
		expect(result.document.units[2].contexts).toContainEqual({
			type: "array-index",
			value: "1",
		});
	});

	it("skips translatable=false and empty values unless requested", async () => {
		const source = `<resources><string name="visible">Yes</string><string name="locked" translatable="false">No</string><string name="empty"></string></resources>`;
		expect((await importProject(source)).result.segments).toEqual(["Yes"]);
		const { result } = await importProject(source, {
			includeNonTranslatable: true,
			includeEmpty: true,
		});
		expect(result.segments).toEqual(["Yes", "No", ""]);
		expect(result.document.units[1].translatable).toBe(false);
	});

	it("patches only value ranges and safely preserves Android markup", async () => {
		const source = `<resources><!--keep--><string name='hello'>Hello &amp; <b>world</b></string><string name="quote">Old</string></resources>`;
		const { project } = await importProject(source, {}, [
			"Hallo & <b>Welt</b>",
			`L'utilisateur "actif"`,
		]);
		const output = buildAndroidResourcesTranslation(project);
		expect(output).toContain("<!--keep-->");
		expect(output).toContain("name='hello'");
		expect(output).toContain("Hallo &amp; <b>Welt</b>");
		expect(output).toContain(`L\\'utilisateur \\"actif\\"`);
	});

	it("blocks printf, markup, and xliff placeholder regressions", async () => {
		const source = `<resources xmlns:xliff="urn:oasis:names:tc:xliff:document:1.2"><string name="greet">Hi <xliff:g id="user">%1$s</xliff:g></string></resources>`;
		const missing = await importProject(source, {}, ["Hallo"]);
		expect(() => buildAndroidResourcesTranslation(missing.project)).toThrow(
			/Export blocked/,
		);
		const changedId = await importProject(source, {}, [
			'Hallo <xliff:g id="other">%1$s</xliff:g>',
		]);
		expect(() => buildAndroidResourcesTranslation(changedId.project)).toThrow(
			/Export blocked/,
		);
	});

	it("honors formatted=false when checking percent tokens", async () => {
		const source = `<resources><string name="literal" formatted="false">Literal %s token</string></resources>`;
		const { project } = await importProject(source, {}, ["Kein Token"]);
		expect(buildAndroidResourcesTranslation(project)).toContain("Kein Token");
	});

	it("preserves exact identity bytes and UTF-16 BOMs", async () => {
		const bytes = encodeTextBytes(
			'<?xml version="1.0" encoding="UTF-16"?>\r\n<resources><string name="cafe">Café &amp; tea</string></resources>\r\n',
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(
				await buildAndroidResourcesTranslationBlob(project).arrayBuffer(),
			),
		).toEqual(bytes);
		project.translationData.seg2 = ["Kaffee & Tee"];
		expect(
			decodeTextBytes(
				new Uint8Array(
					await buildAndroidResourcesTranslationBlob(project).arrayBuffer(),
				),
			),
		).toMatchObject({ encoding: "utf-16le", hasBom: true });
	});

	it("rejects malformed resource structures and unsafe XML declarations", async () => {
		for (const source of [
			"<catalog><string name='x'>X</string></catalog>",
			"<resources><string>Missing key</string></resources>",
			"<resources><plurals name='n'><item quantity='one'>One</item></plurals></resources>",
			"<resources><plurals name='n'><item quantity='other'>A</item><item quantity='other'>B</item></plurals></resources>",
			'<!DOCTYPE resources [<!ENTITY x SYSTEM "file:///etc/passwd">]><resources/>',
		])
			await expect(
				validateAndroidResourcesFile(new File([source], "strings.xml")),
			).resolves.toMatchObject({ valid: false });
	});

	it("blocks structural editing and stale replacement mappings", async () => {
		const { project } = await importProject(
			'<resources><string name="hello">Hello</string></resources>',
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 7;
		expect(() => buildAndroidResourcesTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 resources deterministically", async () => {
		const source = `<resources>${Array.from(
			{ length: 1_000 },
			(_, index) => `<string name="message_${index}">Message ${index}</string>`,
		).join("")}</resources>`;
		const first = await importAndroidResourcesFile(
			new File([source], "strings.xml"),
		);
		const second = await importAndroidResourcesFile(
			new File([source], "strings.xml"),
		);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
