// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildSubtitleTranslation,
	buildSubtitleTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationSubtitles";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	importSubtitleFile,
	parseSubtitles,
	validateSubtitleFile,
} from "./subtitles";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name: string,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "text/plain" });
	const result = await importSubtitleFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected subtitle segments");
	return {
		result,
		project: makeUserData({
			type: "subtitles",
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

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("SRT, WebVTT, and SBV subtitle workflow", () => {
	it("imports multiline SRT cues and preserves IDs, timecodes, order, and CRLF", async () => {
		const source =
			"1\r\n00:00:01,000 --> 00:00:04,000\r\nHello\r\nworld\r\n\r\ncue-two\r\n00:00:05,000 --> 00:00:08,000 position:50%\r\n<i>Second cue</i>\r\n";
		const { result, project } = await importProject(source, "captions.srt");
		expect(result.segments).toEqual(["Hello\r\nworld", "<i>Second cue</i>"]);
		expect(result.document.units[0].contexts).toContainEqual({
			type: "subtitle-cue-id",
			value: "1",
		});
		expect(result.document.units[1].contexts).toContainEqual({
			type: "subtitle-settings",
			value: "position:50%",
		});
		project.translationData.seg2 = ["Hallo\r\nWelt", "<i>Zweiter Cue</i>"];
		const output = buildSubtitleTranslation(project);
		expect(output).toContain("00:00:01,000 --> 00:00:04,000\r\nHallo\r\nWelt");
		expect(output).toContain(
			"cue-two\r\n00:00:05,000 --> 00:00:08,000 position:50%",
		);
	});

	it("imports WebVTT header metadata, NOTE/STYLE blocks, cue settings, and inline markup", async () => {
		const source = `WEBVTT Example
Language: en

NOTE This stays protected
developer details

STYLE
::cue { color: lime; }

intro
00:01.000 --> 00:05.000 align:start position:10%
<v Roger><b>Hello</b> world
`;
		const { result, project } = await importProject(source, "captions.vtt");
		expect(result.segments).toEqual(["<v Roger><b>Hello</b> world"]);
		expect(result.document.metadata).toMatchObject({
			profile: "vtt",
			noteBlocks: 2,
		});
		expect(result.document.units[0].contexts).toContainEqual({
			type: "subtitle-settings",
			value: "align:start position:10%",
		});
		project.translationData.seg2 = ["<v Roger><b>Hallo</b> Welt"];
		const output = buildSubtitleTranslation(project);
		expect(output).toContain("NOTE This stays protected");
		expect(output).toContain("::cue { color: lime; }");
		expect(parseSubtitles(output, "vtt").cues[0].text).toBe(
			"<v Roger><b>Hallo</b> Welt",
		);
	});

	it("imports and exports SBV timing syntax", async () => {
		const source =
			"0:00:01.000,0:00:04.500\nFirst line\n\n0:00:05.000,0:00:09.000\nSecond";
		const { result, project } = await importProject(
			source,
			"captions.sbv",
			{},
			["Erste Zeile", "Zweite"],
		);
		expect(result.segments).toEqual(["First line", "Second"]);
		const output = buildSubtitleTranslation(project);
		expect(output).toContain("0:00:01.000,0:00:04.500\nErste Zeile");
		expect(parseSubtitles(output, "sbv").cues).toHaveLength(2);
	});

	it("warns, allows, or rejects overlapping cues according to policy", async () => {
		const source = `1
00:00:01,000 --> 00:00:04,000
First

2
00:00:03,500 --> 00:00:05,000
Second`;
		const warned = await importSubtitleFile(new File([source], "captions.srt"));
		expect(warned.document.metadata?.warnings).toContain(
			"Cue 2 overlaps cue 1 by 500 ms.",
		);
		const allowed = await importSubtitleFile(
			new File([source], "captions.srt"),
			{ overlapPolicy: "allow" },
		);
		expect(allowed.document.metadata?.warnings).not.toContain(
			"Cue 2 overlaps cue 1 by 500 ms.",
		);
		await expect(
			importSubtitleFile(new File([source], "captions.srt"), {
				overlapPolicy: "error",
			}),
		).rejects.toMatchObject({ code: "SUBTITLE_INVALID" });
	});

	it("enforces target line count, line length, reading speed, and expansion", async () => {
		const source = "1\n00:00:00,000 --> 00:00:01,000\nShort";
		const limits = {
			maxCharactersPerLine: 5,
			maxLinesPerCue: 1,
			maxReadingSpeed: 5,
			maxExpansionPercent: 10,
		};
		const { project } = await importProject(source, "captions.srt", limits, [
			"Much longer\nsecond line",
		]);
		expect(() => buildSubtitleTranslation(project)).toThrow(
			/Subtitle export blocked by 4 timing\/readability issues/,
		);
	});

	it("rejects invalid timing ranges and malformed format signatures", async () => {
		const invalid = [
			["1\n00:00:05,000 --> 00:00:04,000\nBackwards", "bad.srt"],
			["NOTVTT\n\n00:01.000 --> 00:02.000\nText", "bad.vtt"],
			["0:61:00.000,0:62:00.000\nText", "bad.sbv"],
			["1\nnot a timing line\nText", "bad.srt"],
		] as const;
		for (const [content, name] of invalid)
			await expect(
				validateSubtitleFile(new File([content], name)),
			).resolves.toMatchObject({
				valid: false,
				errorCode: "SUBTITLE_INVALID",
			});
	});

	it("preserves UTF-16 identity and blocks inline-markup regressions", async () => {
		const bytes = encodeTextBytes(
			"1\r\n00:00:00,000 --> 00:00:05,000\r\n<i>Café</i>\r\n",
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes, "captions.srt");
		expect(
			new Uint8Array(await buildSubtitleTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ["Kaffee"];
		expect(() => buildSubtitleTranslation(project)).toThrow(/Export blocked/);
		project.translationData.seg2 = ["<i>Kaffee</i>"];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildSubtitleTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain("<i>Kaffee</i>");
	});

	it("blocks structural edits and stale mappings", async () => {
		const { project } = await importProject(
			"1\n00:00:00,000 --> 00:00:05,000\nHello",
			"captions.srt",
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 5;
		expect(() => buildSubtitleTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 ordered cues deterministically", async () => {
		const source = Array.from({ length: 1_000 }, (_, index) => {
			const hour = String(Math.floor(index / 3_600)).padStart(2, "0");
			const minute = String(Math.floor((index % 3_600) / 60)).padStart(2, "0");
			const second = String(index % 60).padStart(2, "0");
			return `${index + 1}\n${hour}:${minute}:${second},000 --> ${hour}:${minute}:${second},900\nMessage ${index}`;
		}).join("\n\n");
		const first = parseSubtitles(source, "srt");
		const second = parseSubtitles(source, "srt");
		expect(first.cues).toHaveLength(1_000);
		expect(second.cues).toEqual(first.cues);
	});
});
