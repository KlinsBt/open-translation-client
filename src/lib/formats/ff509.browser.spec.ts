import { describe, expect, it } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { makeUserData } from "../../test/fixtures";
import { buildSubtitleTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationSubtitles";
import { importSubtitleFile, parseSubtitles } from "./subtitles";

describe("FF-509 browser persistence", () => {
	it("restores ASS positional mappings and exports a translated native file", async () => {
		const name = `ff509-${Date.now()}.ass`;
		const source = `[Script Info]
Title: Browser subtitle
ScriptType: v4.00+
[V4+ Styles]
Format: Name, Fontname, Fontsize
Style: Default,Arial,20
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Keep this comment
Dialogue: 0,0:00:01.00,0:00:04.00,Default,Speaker,0,0,0,,{\\an8}Browser source\\Nمرحبا`;
		const imported = await importSubtitleFile(new File([source], name), {
			maxCharactersPerLine: 200,
			maxLinesPerCue: 5,
			maxReadingSpeed: 200,
			maxExpansionPercent: 1_000,
		});
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const project = makeUserData({
			type: "subtitles",
			name,
			seg1: imported.segments,
			seg2: ["{\\an8}Browser target\\Nأهلاً"],
			checked: [true],
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});

		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored?.translationData.typeRef).toMatchObject({
			profile: "ass-cues",
		});
		expect(restored?.translationData.skeleton?.replacements[0]).toMatchObject({
			kind: "subtitle-cue",
			profile: "ass",
			style: "Default",
		});
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);

		const output = buildSubtitleTranslationBlob(restored!);
		const reopened = parseSubtitles(await output.text(), "ass");
		expect(reopened.cues[0].text).toBe("{\\an8}Browser target\\Nأهلاً");
		expect(await output.text()).toContain("Keep this comment");
	});
});
