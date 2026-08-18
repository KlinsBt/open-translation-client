import { describe, expect, it, vi } from "vitest";
import { buildTranslatedWebVtt } from "$lib/functions/outputGeneration/outputGenerationLocalMedia";
import {
	importTranscriptionFile,
	transcriptUnitsFromResult,
} from "./localTranscription";
import type { UserData } from "$lib/types/types";

const wav = new File(
	[
		new Uint8Array([
			0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 1, 2,
		]),
	],
	"speech.wav",
	{ type: "audio/wav" },
);

const transcription = {
	text: "Hello world. Second sentence.",
	chunks: [
		{ text: " Hello world.", timestamp: [0, 1.25] as [number, number] },
		{ text: " Second sentence.", timestamp: [1.25, 3.5] as [number, number] },
	],
};

describe("local media transcription", () => {
	it("converts Whisper timestamp chunks into translation units", () => {
		expect(transcriptUnitsFromResult(transcription)).toEqual([
			{ text: "Hello world.", startMs: 0, endMs: 1250, confidence: 1 },
			{ text: "Second sentence.", startMs: 1250, endMs: 3500, confidence: 1 },
		]);
	});

	it("runs against local decoded samples without consent or file upload", async () => {
		const transcribe = vi.fn().mockResolvedValue(transcription);
		const imported = await importTranscriptionFile(
			wav,
			{
				model: "onnx-community/whisper-tiny",
				language: "english",
				chunkSeconds: 20,
			},
			undefined,
			{ transcribe },
			new Float32Array([0, 0.1, -0.1]),
		);
		expect(transcribe).toHaveBeenCalledWith(
			expect.any(Float32Array),
			expect.objectContaining({ language: "english", chunkSeconds: 20 }),
			expect.any(Function),
		);
		expect(imported.document.metadata).toMatchObject({
			processing: "on-device",
			fileUploaded: false,
		});
		expect(imported.skeleton.source.originalFile).toBeInstanceOf(Blob);
	});

	it("exports translated timestamped WebVTT", async () => {
		const imported = await importTranscriptionFile(
			wav,
			undefined,
			undefined,
			{ transcribe: vi.fn().mockResolvedValue(transcription) },
			new Float32Array([0]),
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const project = {
			translationData: {
				name: "speech",
				sourceLang: "English (en)",
				targetLang: "German (de)",
				creationDate: "1",
				seg1: imported.segments,
				seg2: ["Hallo Welt.", "Zweiter Satz."],
				checked: [true, true],
				type: "media-transcription",
				typeRef: imported.typeRef ?? {},
				segmentsMeta: imported.segmentsMeta,
				documentModel: imported.document,
				skeleton: imported.skeleton,
				filterOptions: imported.filterOptions,
				tm: { id: null, name: null, active: false },
				tb: { id: null, name: null, active: false },
			},
		} as UserData;
		const vtt = buildTranslatedWebVtt(project);
		expect(vtt).toContain("00:00:00.000 --> 00:00:01.250");
		expect(vtt).toContain("Hallo Welt.");
		expect(vtt).toContain("00:00:01.250 --> 00:00:03.500");
	});
});
