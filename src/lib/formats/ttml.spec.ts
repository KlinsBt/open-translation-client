// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildTtmlTranslation,
	buildTtmlTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationTtml";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	importTtmlFile,
	parseTtmlDocument,
	parseTtmlTime,
	validateTtmlFile,
} from "./ttml";
import type { FormatOptionValues } from "./types";

const namespaces =
	'xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"';

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "captions.ttml", {
		type: "application/ttml+xml",
	});
	const result = await importTtmlFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected TTML segments");
	return {
		result,
		project: makeUserData({
			type: "ttml",
			name: "captions.ttml",
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

describe("TTML/DFXP timed-text workflow", () => {
	it("extracts nested spans with inherited timing, style, region, language, and whitespace", async () => {
		const source = `<tt ${namespaces} xml:lang="en" xml:space="preserve"><head><styling><style xml:id="speaker" tts:color="yellow"/></styling><layout><region xml:id="bottom" tts:origin="10% 80%"/></layout></head><body><div begin="1s"><p xml:id="cue1" begin="500ms" dur="4s" style="speaker" region="bottom">Hello <span>world</span><br/>again</p></div></body></tt>`;
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual(["Hello", "world", "again"]);
		expect(result.document.units[0].contexts).toEqual(
			expect.arrayContaining([
				{ type: "subtitle-time-range-ms", value: "1500-5500" },
				{ type: "ttml-region", value: "bottom" },
				{ type: "ttml-style", value: "speaker" },
				{ type: "ttml-language", value: "en" },
			]),
		);
		project.translationData.seg2 = ["Hallo", "Welt", "erneut"];
		const output = buildTtmlTranslation(project);
		expect(output).toContain('tts:origin="10% 80%"');
		expect(output).toContain(
			'begin="500ms" dur="4s" style="speaker" region="bottom">Hallo <span>Welt</span><br/>erneut',
		);
	});

	it("parses clock, frame, subframe, tick, and offset timing expressions", () => {
		const parameters = { frameRate: 25, subFrameRate: 10, tickRate: 1_000 };
		expect(parseTtmlTime("00:01:02.500", parameters)).toBe(62_500);
		expect(parseTtmlTime("00:00:01:12.5", parameters)).toBe(1_500);
		expect(parseTtmlTime("75f", parameters)).toBe(3_000);
		expect(parseTtmlTime("2500t", parameters)).toBe(2_500);
		expect(parseTtmlTime("1.5s", parameters)).toBe(1_500);
		const model = parseTtmlDocument(
			`<tt ${namespaces} ttp:frameRate="50" ttp:frameRateMultiplier="1 2" ttp:subFrameRate="10" ttp:tickRate="1000"><body><div><p begin="00:00:01:12.5" dur="2s">Frame cue</p></div></body></tt>`,
		);
		expect(model.timing).toEqual({
			frameRate: 25,
			subFrameRate: 10,
			tickRate: 1_000,
		});
		expect(model.cues[0]).toMatchObject({ startMs: 1_500, endMs: 3_500 });
	});

	it("detects TTML 1/2 and IMSC profiles and optionally includes metadata", async () => {
		const source = `<tt ${namespaces} ttp:version="2" ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1/text"><head><metadata><ttm:title>Program title</ttm:title></metadata></head><body><div><p begin="0s" end="5s">Caption</p></div></body></tt>`;
		const defaults = await importTtmlFile(new File([source], "captions.ttml"));
		const metadata = await importTtmlFile(new File([source], "captions.ttml"), {
			profile: "imsc1",
			includeMetadata: true,
		});
		if (defaults.kind !== "segments" || metadata.kind !== "segments")
			throw new Error("Expected TTML segments");
		expect(defaults.filterOptions.profile).toBe("imsc1");
		expect(defaults.segments).toEqual(["Caption"]);
		expect(metadata.segments).toEqual(["Program title", "Caption"]);
		await expect(
			importTtmlFile(new File([source], "captions.ttml"), { profile: "ttml2" }),
		).rejects.toThrow(/declares imsc1/);
	});

	it("rejects malformed XML, unsafe declarations, unsupported namespaces/times, and missing style/region references", async () => {
		const invalid = [
			`<tt xmlns="urn:wrong"><body><div><p begin="0s" end="1s">Text</p></div></body></tt>`,
			`<!DOCTYPE tt [<!ENTITY x SYSTEM "file:///etc/passwd">]><tt ${namespaces}><body><p begin="0s" end="1s">&x;</p></body></tt>`,
			`<tt ${namespaces}><body><div><p begin="later" end="1s">Text</p></div></body></tt>`,
			`<tt ${namespaces}><body><div><p begin="2s" end="1s">Text</p></div></body></tt>`,
			`<tt ${namespaces}><body><div><p begin="0s" end="1s" style="missing">Text</p></div></body></tt>`,
			`<tt ${namespaces}><body><div><p begin="0s" end="1s" region="missing">Text</p></div></body></tt>`,
			`<tt ${namespaces}><body/></tt>`,
		];
		for (const content of invalid)
			await expect(
				validateTtmlFile(new File([content], "bad.ttml")),
			).resolves.toMatchObject({
				valid: false,
			});
	});

	it("enforces overlap and subtitle readability QA without WebVTT assumptions", async () => {
		const overlap = `<tt ${namespaces}><body><div><p begin="0s" end="3s">First</p><p begin="2s" end="4s">Second</p></div></body></tt>`;
		await expect(
			importTtmlFile(new File([overlap], "captions.ttml"), {
				overlapPolicy: "error",
			}),
		).rejects.toThrow(/overlaps/);
		const { project } = await importProject(
			`<tt ${namespaces}><body><div><p begin="0s" end="1s">Short</p></div></body></tt>`,
			{ maxReadingSpeed: 5, maxCharactersPerLine: 10, maxExpansionPercent: 10 },
			["This target is much too long"],
		);
		expect(() => buildTtmlTranslation(project)).toThrow(/timing\/readability/);
	});

	it("preserves UTF-16 identity bytes and escapes translated XML", async () => {
		const bytes = encodeTextBytes(
			`<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="0s" end="5s">Café</p></div></body></tt>`,
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes, {
			maxExpansionPercent: 500,
		});
		expect(
			new Uint8Array(await buildTtmlTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ['Tea & <"coffee">'];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildTtmlTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain('Tea &amp; &lt;"coffee"&gt;');
	});

	it("round-trips sentence segmentation and blocks stale structural edits", async () => {
		const { result, project } = await importProject(
			`<tt ${namespaces}><body><div><p begin="0s" end="10s">First sentence. Second sentence.</p></div></body></tt>`,
			{ segmentationMode: "sentences", maxReadingSpeed: 100 },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = buildTtmlTranslation(project);
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		expect(() => buildTtmlTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 cues deterministically and passes independent XML validation", async () => {
		const source = `<tt ${namespaces}><body><div>${Array.from(
			{ length: 1_000 },
			(_, index) => `<p begin="${index * 5}s" dur="5s">Message ${index}</p>`,
		).join("")}</div></body></tt>`;
		const first = await importTtmlFile(new File([source], "large.ttml"));
		const second = await importTtmlFile(new File([source], "large.ttml"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected TTML segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
		if (spawnSync("xmllint", ["--version"], { timeout: 5_000 }).status !== 0)
			return;
		const { project } = await importProject(source, { maxReadingSpeed: 100 });
		const directory = mkdtempSync(join(tmpdir(), "opentlc-ttml-"));
		try {
			const path = join(directory, "translated.ttml");
			writeFileSync(path, buildTtmlTranslation(project));
			const checked = spawnSync("xmllint", ["--noout", "--nonet", path], {
				encoding: "utf8",
				timeout: 5_000,
			});
			expect(checked.status, checked.stderr).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
