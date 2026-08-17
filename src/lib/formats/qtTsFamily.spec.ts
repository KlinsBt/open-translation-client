// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildQtTsTranslation,
	buildQtTsTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationQtTs";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import { importQtTsFile, parseQtTs, validateQtTsFile } from "./qtTsFamily";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "catalog.ts", { type: "application/xml" });
	const result = await importQtTsFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected Qt TS segments");
	return {
		result,
		project: makeUserData({
			type: "qt-ts",
			name: "catalog.ts",
			seg1: result.segments,
			seg2: targets ?? result.targetSegments ?? [...result.segments],
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

describe("Qt Linguist TS workflow", () => {
	it("imports bilingual messages, IDs, context, locations, comments, and languages", async () => {
		const source = `<!DOCTYPE TS><TS version="2.1" language="de_DE" sourcelanguage="en_US"><context><name>MainWindow</name><message id="welcome"><location filename="main.cpp" line="42"/><source>Hello</source><oldsource>Hi</oldsource><comment>Button label</comment><extracomment>Home screen</extracomment><translation type="unfinished">Hallo</translation></message></context></TS>`;
		const { result } = await importProject(source);
		expect(result.segments).toEqual(["Hello"]);
		expect(result.targetSegments).toEqual(["Hallo"]);
		expect(result.document).toMatchObject({
			sourceLanguage: "en_US",
			targetLanguage: "de_DE",
		});
		expect(result.document.units[0].contexts).toEqual(
			expect.arrayContaining([
				{ type: "qt-context", value: "MainWindow" },
				{ type: "source-location", value: "main.cpp:42" },
				{ type: "qt-state", value: "unfinished" },
			]),
		);
		expect(result.document.units[0].notes.map((note) => note.text)).toEqual([
			"Hi",
			"Button label",
			"Home screen",
		]);
	});

	it("supports numerus forms and length variants as related units", async () => {
		const source = `<TS language="de"><context><name>Cart</name>
<message id="cats" numerus="yes"><source>%n cat(s)</source><translation><numerusform>%n Katze</numerusform><numerusform>%n Katzen</numerusform></translation></message>
<message id="open"><source>Open</source><translation variants="yes"><lengthvariant>Öffnen</lengthvariant><lengthvariant>Auf</lengthvariant></translation></message>
</context></TS>`;
		const { result } = await importProject(source);
		expect(result.segments).toEqual(["%n cat(s)", "%n cat(s)", "Open", "Open"]);
		expect(result.targetSegments).toEqual([
			"%n Katze",
			"%n Katzen",
			"Öffnen",
			"Auf",
		]);
		expect(result.document.units[1].relationships?.plural?.category).toBe("1");
		expect(result.document.units[3].relationships?.variant?.key).toBe("1");
	});

	it("updates target text, escapes inline markup, and clears unfinished only after translation", async () => {
		const source = `<TS><context><name>Main</name><message id="rich"><source>Hello &lt;b&gt;%1&lt;/b&gt;</source><translation type='unfinished'></translation></message></context></TS>`;
		const { project } = await importProject(source, {}, ["Hallo <b>%1</b>"]);
		const output = buildQtTsTranslation(project);
		expect(output).toContain(
			"<translation>Hallo &lt;b&gt;%1&lt;/b&gt;</translation>",
		);
		expect(output).not.toContain("unfinished");
		expect(parseQtTs(output).values[0].target).toBe("Hallo <b>%1</b>");
	});

	it("filters unfinished, vanished, and obsolete states independently", async () => {
		const source = `<TS><context><name>C</name>
<message><source>Done</source><translation>Fertig</translation></message>
<message><source>Draft</source><translation type="unfinished"></translation></message>
<message><source>Gone</source><translation type="vanished">Weg</translation></message>
<message><source>Old</source><translation type="obsolete">Alt</translation></message>
</context></TS>`;
		const { result } = await importProject(source, {
			includeUnfinished: false,
			includeVanished: true,
			includeObsolete: true,
		});
		expect(result.segments).toEqual(["Done", "Gone", "Old"]);
	});

	it("blocks Qt, printf, markup, and numerus placeholder regressions", async () => {
		const source = `<TS><context><name>C</name><message><source>%n files for %L1: &lt;b&gt;%1$s&lt;/b&gt;</source><translation></translation></message></context></TS>`;
		const { project } = await importProject(source, {}, ["Dateien"]);
		expect(() => buildQtTsTranslation(project)).toThrow(/Export blocked/);
	});

	it("preserves exact UTF-16 identity bytes", async () => {
		const source = encodeTextBytes(
			'<?xml version="1.0" encoding="UTF-16"?>\r\n<TS><context><name>C</name><message><source>Café</source><translation>Café</translation></message></context></TS>\r\n',
			"utf-16le",
			true,
		);
		const { project } = await importProject(source);
		expect(
			new Uint8Array(await buildQtTsTranslationBlob(project).arrayBuffer()),
		).toEqual(source);
		project.translationData.seg2 = ["Kaffee"];
		expect(
			decodeTextBytes(
				new Uint8Array(await buildQtTsTranslationBlob(project).arrayBuffer()),
			),
		).toMatchObject({ encoding: "utf-16le", hasBom: true });
	});

	it("rejects unsafe or malformed XML and protects complex nested nodes", async () => {
		for (const source of [
			"<root/>",
			"<TS><context><message></context></TS>",
			'<!DOCTYPE TS [<!ENTITY x SYSTEM "file:///tmp/x">]><TS/>',
		])
			await expect(
				validateQtTsFile(new File([source], "bad.ts")),
			).resolves.toMatchObject({ valid: false });
		const complex = await importProject(
			"<TS><context><name>C</name><message><source>A<byte value='x9'/>B</source><translation>AB</translation></message></context></TS>",
		);
		expect(complex.result.segments).toEqual([]);
		expect(complex.result.document.metadata?.warnings).toContain(
			"A structurally complex message in C was protected.",
		);
	});

	it("blocks structural edits and stale mappings", async () => {
		const { project } = await importProject(
			"<TS><context><name>C</name><message><source>Hello</source><translation>Hallo</translation></message></context></TS>",
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 8;
		expect(() => buildQtTsTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 messages deterministically", async () => {
		const source = `<TS><context><name>C</name>${Array.from(
			{ length: 1_000 },
			(_, index) =>
				`<message id="m${index}"><source>Message ${index}</source><translation></translation></message>`,
		).join("")}</context></TS>`;
		const first = await importQtTsFile(new File([source], "catalog.ts"));
		const second = await importQtTsFile(new File([source], "catalog.ts"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
