// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
	detectExternalMediaCandidate,
	type ExternalExtractionProviderProfile,
	type ExternalExtractionResult,
	validateExternalExtractionConsent,
	validateExternalExtractionProvider,
	validateExternalExtractionResult,
} from "./externalExtraction";
import { detectFormatWithConfidence, getFormatAcceptValue } from "./registry";

const localOcr: ExternalExtractionProviderProfile = {
	id: "local-ocr",
	mode: "local",
	modalities: ["ocr"],
	modelVersion: "fixture-1",
	maxFileBytes: 10_000_000,
	sendsFileOffDevice: false,
	requiresExplicitConsent: false,
	retentionPolicy: "No retention; processing remains in browser memory.",
};

const remoteTranscription: ExternalExtractionProviderProfile = {
	id: "remote-transcription",
	mode: "remote",
	modalities: ["transcription"],
	modelVersion: "fixture-2",
	maxFileBytes: 20_000_000,
	sendsFileOffDevice: true,
	requiresExplicitConsent: true,
	retentionPolicy: "Deleted within 24 hours.",
	privacyPolicyUrl: "https://example.test/privacy/v2",
	endpoint: "https://example.test/extract",
};

describe("external OCR/transcription boundary", () => {
	it.each([
		["PNG", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "ocr"],
		["JPEG", [0xff, 0xd8, 0xff, 0xe0], "ocr"],
		["little-endian TIFF", [0x49, 0x49, 0x2a, 0x00], "ocr"],
		["big-endian TIFF", [0x4d, 0x4d, 0x00, 0x2a], "ocr"],
		[
			"WAV",
			[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45],
			"transcription",
		],
		["MP3", [0x49, 0x44, 0x33, 4, 0, 0], "transcription"],
		["Ogg", [0x4f, 0x67, 0x67, 0x53], "transcription"],
		["FLAC", [0x66, 0x4c, 0x61, 0x43], "transcription"],
		["WebM", [0x1a, 0x45, 0xdf, 0xa3], "transcription"],
		["MP4/MOV", [0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70], "transcription"],
	])("recognizes %s by signature", (_label, bytes, modality) => {
		expect(detectExternalMediaCandidate(new Uint8Array(bytes))).toMatchObject({
			modality,
		});
	});

	it("does not trust an image or media extension without a matching signature", async () => {
		expect(
			detectExternalMediaCandidate(new Uint8Array([1, 2, 3])),
		).toBeUndefined();
		await expect(
			detectFormatWithConfidence(
				new File(["not an image"], "renamed.png", { type: "image/png" }),
			),
		).resolves.toMatchObject({
			formatId: null,
			supported: false,
			label: "Unrecognized image",
		});
	});

	it("routes recognized media to local adapters and advertises their inputs", async () => {
		const png = new File(
			[new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
			"page.PNG",
			{ type: "image/png" },
		);
		await expect(detectFormatWithConfidence(png)).resolves.toMatchObject({
			formatId: "image-ocr",
			label: "PNG/JPEG/TIFF local OCR → bilingual HTML",
			supported: true,
			confidence: "high",
			evidence: ["content", "extension", "mime"],
		});
		const accepted = getFormatAcceptValue().split(",");
		for (const extension of [
			".png",
			".jpg",
			".jpeg",
			".tif",
			".tiff",
			".wav",
			".mp3",
			".mp4",
			".webm",
		])
			expect(accepted).toContain(extension);
	});

	it("rejects unsafe or incomplete provider profiles", () => {
		expect(validateExternalExtractionProvider(localOcr)).toEqual([]);
		expect(validateExternalExtractionProvider(remoteTranscription)).toEqual([]);
		expect(
			validateExternalExtractionProvider({
				...remoteTranscription,
				sendsFileOffDevice: false,
				requiresExplicitConsent: false,
				endpoint: "http://example.test/extract",
				privacyPolicyUrl: undefined,
			}),
		).toEqual(
			expect.arrayContaining([
				"A remote provider must disclose that files leave the device.",
				"A remote provider must require explicit per-file consent.",
				"A remote provider endpoint must use HTTPS.",
				"A remote provider must declare an HTTPS privacy policy.",
			]),
		);
		expect(
			validateExternalExtractionProvider({
				...localOcr,
				sendsFileOffDevice: true,
				endpoint: "https://example.test",
			}),
		).toEqual([
			"A local provider cannot send files off-device.",
			"A local provider cannot declare a remote endpoint.",
		]);
	});

	it("binds remote consent to the provider, policy, retention, and exact file", () => {
		const file = new File(["audio"], "interview.wav");
		const consent = {
			providerId: remoteTranscription.id,
			privacyPolicyUrl: remoteTranscription.privacyPolicyUrl!,
			retentionPolicy: remoteTranscription.retentionPolicy,
			grantedAt: "2026-08-18T12:00:00.000Z",
			fileName: file.name,
			fileSize: file.size,
		};
		expect(
			validateExternalExtractionConsent(remoteTranscription, consent, file),
		).toEqual([]);
		expect(
			validateExternalExtractionConsent(
				remoteTranscription,
				{
					...consent,
					providerId: "other",
					fileName: "other.wav",
					privacyPolicyUrl: "https://example.test/old-policy",
					retentionPolicy: "indefinite",
					grantedAt: "not-a-date",
				},
				file,
			),
		).toHaveLength(5);
	});

	it("validates reproducible confidence, language, layout, and timestamp output", () => {
		const ocrResult: ExternalExtractionResult = {
			providerId: "local-ocr",
			modelVersion: "fixture-1",
			modality: "ocr",
			detectedLanguages: [{ language: "ar", confidence: 0.97 }],
			units: [
				{
					kind: "ocr",
					text: "مرحبا 🌍",
					page: 1,
					bbox: [10, 20, 200, 40],
					confidence: 0.82,
					language: "ar",
				},
			],
			warnings: [],
		};
		expect(validateExternalExtractionResult(ocrResult, localOcr)).toEqual([]);
		expect(
			validateExternalExtractionResult(
				{
					...ocrResult,
					detectedLanguages: [{ language: "", confidence: 1.2 }],
					units: [
						{
							kind: "transcription",
							text: " ",
							startMs: 500,
							endMs: 100,
							confidence: -1,
						},
					],
				},
				localOcr,
			),
		).toEqual(
			expect.arrayContaining([
				"Detected language metadata is invalid.",
				"Extraction unit 1 has invalid text/confidence.",
				"Extraction unit 1 has the wrong modality.",
				"Transcript unit 1 has invalid timestamps.",
			]),
		);
	});
});
