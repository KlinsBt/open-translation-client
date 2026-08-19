// @vitest-environment happy-dom

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildSubtitleTranslation,
	buildSubtitleTranslationBlob,
	subtitleTranslationDownloadName,
} from "$lib/functions/outputGeneration/outputGenerationSubtitles";
import { detectFormat } from "./registry";
import {
	detectSubtitleProfileFromContent,
	importSubtitleFile,
	parseSubtitles,
	validateSubtitleFile,
} from "./subtitles";
import type { FormatOptionValues } from "./types";

const ASS = `[Script Info]
; preserved author comment
Title: Unicode demo
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[Aegisub Project Garbage]
Last Style Storage: Default

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,42,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,24,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:01.00,Default,Editor,0,0,0,,Do not translate this comment
Dialogue: 2,0:00:01.00,0:00:04.00,Default,Narrator,0010,0020,0030,Banner;10;20;30,{\\an8\\pos(640,80)}Hello, world\\Nمرحبا
Dialogue: 0,0:00:05.00,0:00:07.00,Default,,0,0,0,,Second line
Dialogue: 0,0:00:08.00,0:00:09.00,Default,,0,0,0,,{\\p1}m 0 0 l 20 20{\\p0}
`;

const SSA = `[Script Info]
ScriptType: v4.00
Title: Legacy SSA

[V4 Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, TertiaryColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, AlphaLevel, Encoding
Style: Default,Arial,20,16777215,65535,0,0,-1,0,1,2,0,2,10,10,10,0,1

[Events]
Format: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: Marked=0,0:00:01.00,0:00:03.00,Default,Speaker,0,0,0,,Legacy text
`;

const STL = `$FontName = Arial
$FontSize = 24
// producer comment stays opaque
00:00:01:00 , 00:00:04:00 ,{\\i}First line|مرحبا بالعالم
$FontSize = 28
00:00:05:12 , 00:00:08:00 ,Second, cue
`;

const QA_OPTIONS: Readonly<FormatOptionValues> = {
	maxCharactersPerLine: 500,
	maxLinesPerCue: 20,
	maxReadingSpeed: 1_000,
	maxExpansionPercent: 10_000,
};

const temporaryDirectories: string[] = [];

afterEach(() => {
	for (const directory of temporaryDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

async function projectFrom(
	content: string,
	name: string,
	options: Readonly<FormatOptionValues> = {},
) {
	const imported = await importSubtitleFile(new File([content], name), {
		...QA_OPTIONS,
		...options,
	});
	if (imported.kind !== "segments")
		throw new Error("Expected subtitle segments");
	return {
		imported,
		project: makeUserData({
			type: "subtitles",
			name,
			seg1: imported.segments,
			seg2: [...imported.segments],
			checked: imported.segments.map(() => false),
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		}),
	};
}

function hasFfprobe(): boolean {
	try {
		execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

describe("FF-509 ASS, SSA, and Spruce STL subtitles", () => {
	it("detects subtitle profiles from content even when renamed", async () => {
		expect(detectSubtitleProfileFromContent(ASS, "renamed.txt")).toBe("ass");
		expect(detectSubtitleProfileFromContent(SSA, "renamed.bin")).toBe("ssa");
		expect(detectSubtitleProfileFromContent(STL, "renamed.txt")).toBe("stl");
		await expect(
			detectFormat(new File([ASS], "captions.txt")),
		).resolves.toMatchObject({
			id: "subtitles",
		});
		await expect(
			detectFormat(new File([STL], "captions.data")),
		).resolves.toMatchObject({
			id: "subtitles",
		});
		await expect(
			validateSubtitleFile(new File(["ordinary text"], "fake.ass")),
		).resolves.toMatchObject({ valid: false, errorCode: "SUBTITLE_INVALID" });
		const renamed = await projectFrom(ASS, "captions.txt");
		expect(subtitleTranslationDownloadName(renamed.project)).toBe(
			"captions.txt.ass",
		);
	});

	it("imports complex ASS while preserving style, actor, positioning, comments, unknown headers, commas, RTL, and drawings", async () => {
		const { imported, project } = await projectFrom(ASS, "captions.ass");
		expect(imported.segments).toEqual([
			"{\\an8\\pos(640,80)}Hello, world\\Nمرحبا",
			"Second line",
		]);
		expect(imported.document.metadata).toMatchObject({
			profile: "ass",
			noteBlocks: 2,
			protectedCues: 1,
		});
		expect(imported.document.units[0].contexts).toEqual(
			expect.arrayContaining([
				{ type: "subtitle-style", value: "Default" },
				{ type: "subtitle-actor", value: "Narrator" },
				{ type: "subtitle-settings", value: "0010,0020,0030" },
			]),
		);
		expect(await buildSubtitleTranslationBlob(project).arrayBuffer()).toEqual(
			await new File([ASS], "captions.ass").arrayBuffer(),
		);
		project.translationData.seg2[0] =
			"{\\an8\\pos(640,80)}Hallo, Welt\\Nأهلاً بالعالم";
		const output = buildSubtitleTranslation(project);
		expect(buildSubtitleTranslationBlob(project).type).toBe(
			"text/x-ass;charset=utf-8",
		);
		expect(output).toContain("Do not translate this comment");
		expect(output).toContain("[Aegisub Project Garbage]");
		expect(output).toContain("{\\p1}m 0 0 l 20 20{\\p0}");
		expect(parseSubtitles(output, "ass").cues[0].text).toBe(
			"{\\an8\\pos(640,80)}Hallo, Welt\\Nأهلاً بالعالم",
		);
	});

	it("round-trips legacy SSA event fields and generated IDs", async () => {
		const { imported, project } = await projectFrom(SSA, "captions.ssa");
		expect(imported.segments).toEqual(["Legacy text"]);
		expect(imported.segmentsMeta?.[0]).toMatchObject({
			profile: "ssa",
			cueId: "ssa-dialogue-1",
			actor: "Speaker",
			layer: "Marked=0",
			timebase: "centiseconds",
		});
		project.translationData.seg2 = ["نص قديم"];
		expect(
			parseSubtitles(buildSubtitleTranslation(project), "ssa").cues[0].text,
		).toBe("نص قديم");
	});

	it("imports Spruce commands, comments, line separators, commas, Unicode, and frame metadata without rewriting timecodes", async () => {
		const { imported, project } = await projectFrom(STL, "captions.stl", {
			spruceFrameRate: 30,
		});
		expect(imported.segments).toEqual([
			"{\\i}First line|مرحبا بالعالم",
			"Second, cue",
		]);
		expect(imported.document.metadata).toMatchObject({
			profile: "stl",
			frameRate: 30,
			timebase: "frames",
			headers: 3,
			noteBlocks: 1,
		});
		expect(imported.typeRef).toMatchObject({
			frameRate: "30",
			timebase: "frames",
		});
		project.translationData.seg2[1] = "Zweiter, Untertitel";
		const output = buildSubtitleTranslation(project);
		expect(output).toContain("$FontSize = 28");
		expect(output).toContain("00:00:05:12 , 00:00:08:00 ,Zweiter, Untertitel");
		expect(parseSubtitles(output, "stl", { frameRate: 30 }).cues).toHaveLength(
			2,
		);
	});

	it("blocks flattened or injected ASS and Spruce markup", async () => {
		const ass = await projectFrom(ASS, "captions.ass");
		ass.project.translationData.seg2[0] = "Hallo Welt";
		expect(() => buildSubtitleTranslation(ass.project)).toThrow(
			/override tags/,
		);
		ass.project.translationData.seg2[0] =
			"{\\an8\\pos(640,80)}Hallo\nWelt\\Nمرحبا";
		expect(() => buildSubtitleTranslation(ass.project)).toThrow(
			/physical line break/,
		);

		const stl = await projectFrom(STL, "captions.stl");
		stl.project.translationData.seg2[0] = "{\\i}Eine Zeile";
		expect(() => buildSubtitleTranslation(stl.project)).toThrow(
			/line separators/,
		);
		stl.project.translationData.seg2[0] = "First|line";
		expect(() => buildSubtitleTranslation(stl.project)).toThrow(/style tags/);
	});

	it("rejects malformed, adversarial, cross-profile, and binary EBU inputs with helpful errors", async () => {
		const invalid = [
			ASS.replace("ScriptType: v4.00+", "ScriptType: v4.00"),
			ASS.replace("Style: Default", "Style: Other"),
			ASS.replace("0:00:04.00", "0:00:00.50"),
			ASS.replace(", Effect, Text", ", Effect, Text, Extra"),
			STL.replace("00:00:05:12", "00:00:05:120"),
			STL.replace("00:00:04:00", "00:00:00:20"),
			"00:00:01:00,not-a-time,Text",
		] as const;
		for (const source of invalid)
			await expect(
				validateSubtitleFile(new File([source], "malformed.ass")),
			).resolves.toMatchObject({ valid: false, errorCode: "SUBTITLE_INVALID" });
		await expect(
			importSubtitleFile(new File([ASS], "wrong.ssa"), { profile: "ssa" }),
		).rejects.toThrow(/does not match/);
		await expect(
			importSubtitleFile(
				new File([STL.replace("00:00:05:12", "00:00:05:30")], "60fps.stl"),
				{ spruceFrameRate: 30 },
			),
		).rejects.toThrow(/30 fps/);
		await expect(
			importSubtitleFile(
				new File([STL.replace("00:00:05:12", "00:00:05:30")], "60fps.stl"),
				{ spruceFrameRate: 60 },
			),
		).resolves.toMatchObject({ kind: "segments" });
		await expect(
			validateSubtitleFile(
				new File([new Uint8Array([0x53, 0x54, 0x4c, 0, 1, 2])], "binary.stl"),
			),
		).resolves.toMatchObject({ valid: false });
	});

	it("supports cancellation and generated large subtitle files", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			importSubtitleFile(
				new File([ASS], "cancel.ass"),
				{},
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: "ABORTED" });

		const largeAss = ASS.replace(
			/Dialogue: 2,[^\n]+\nDialogue: 0,[^\n]+\nDialogue: 0,[^\n]+\n/,
			Array.from(
				{ length: 2_000 },
				(_, index) =>
					`Dialogue: 0,${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")}:00.00,${Math.floor(index / 60)}:${String(index % 60).padStart(2, "0")}:00.50,Default,,0,0,0,,Cue ${index} Ελληνικά עברית`,
			).join("\n") + "\n",
		);
		const imported = await importSubtitleFile(
			new File([largeAss], "large.ass"),
		);
		expect(imported.kind).toBe("segments");
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments).toHaveLength(2_000);
	});

	it.runIf(process.env.OPENTLC_RUN_FFPROBE === "1" && hasFfprobe())(
		"reopens generated ASS and Spruce STL with the independent FFmpeg demuxer",
		async () => {
			for (const [source, name, expectedCodec] of [
				[ASS, "translated.ass", "ass"],
				[STL, "translated.stl", "stl"],
			] as const) {
				const { project } = await projectFrom(source, name);
				const output = buildSubtitleTranslation(project);
				const directory = mkdtempSync(join(tmpdir(), "opentlc-ff509-"));
				temporaryDirectories.push(directory);
				const path = join(directory, name);
				writeFileSync(path, output, "utf8");
				const probe = JSON.parse(
					execFileSync(
						"ffprobe",
						[
							"-v",
							"error",
							"-select_streams",
							"s",
							"-show_entries",
							"stream=codec_name",
							"-of",
							"json",
							path,
						],
						{ encoding: "utf8" },
					),
				) as { streams: Array<{ codec_name: string }> };
				expect(probe.streams[0]?.codec_name).toBe(expectedCodec);
				expect(existsSync(path)).toBe(true);
			}
		},
	);
});
