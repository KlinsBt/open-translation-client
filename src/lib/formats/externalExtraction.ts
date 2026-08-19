import type { SafeInputContext } from "./safeInput";

export type ExternalExtractionModality = "ocr" | "transcription";

export interface ExternalExtractionProviderProfile {
	id: string;
	mode: "local" | "remote";
	modalities: readonly ExternalExtractionModality[];
	modelVersion: string;
	maxFileBytes: number;
	sendsFileOffDevice: boolean;
	requiresExplicitConsent: boolean;
	retentionPolicy: string;
	privacyPolicyUrl?: string;
	endpoint?: string;
}

export interface ExternalExtractionConsent {
	providerId: string;
	privacyPolicyUrl: string;
	retentionPolicy: string;
	grantedAt: string;
	fileName: string;
	fileSize: number;
}

export interface DetectedLanguage {
	language: string;
	confidence: number;
}

export interface OcrExtractionUnit {
	kind: "ocr";
	text: string;
	page: number;
	bbox: [number, number, number, number];
	confidence: number;
	language?: string;
}

export interface TranscriptionExtractionUnit {
	kind: "transcription";
	text: string;
	startMs: number;
	endMs: number;
	confidence: number;
	language?: string;
	speaker?: string;
}

export interface ExternalExtractionResult {
	providerId: string;
	modelVersion: string;
	modality: ExternalExtractionModality;
	detectedLanguages: DetectedLanguage[];
	units: Array<OcrExtractionUnit | TranscriptionExtractionUnit>;
	warnings: string[];
}

export interface ExternalExtractionClient {
	extract(
		file: File,
		profile: ExternalExtractionProviderProfile,
		consent: ExternalExtractionConsent | undefined,
		context?: SafeInputContext,
	): Promise<ExternalExtractionResult>;
}

export interface ExternalMediaCandidate {
	label: string;
	modality: ExternalExtractionModality;
	extensions: readonly string[];
	mimeTypes: readonly string[];
	reason: string;
}

const IMAGE_CANDIDATES: readonly ExternalMediaCandidate[] = [
	{
		label: "PNG image requiring OCR",
		modality: "ocr",
		extensions: ["png"],
		mimeTypes: ["image/png"],
		reason:
			"A PNG signature was detected, but no local OCR engine is configured.",
	},
	{
		label: "JPEG image requiring OCR",
		modality: "ocr",
		extensions: ["jpg", "jpeg", "jpe", "jif", "jfif", "jfi"],
		mimeTypes: ["image/jpeg", "image/pjpeg"],
		reason:
			"A JPEG signature was detected, but no local OCR engine is configured.",
	},
	{
		label: "BMP or DIB image requiring OCR",
		modality: "ocr",
		extensions: ["bmp", "dib"],
		mimeTypes: ["image/bmp", "image/x-bmp", "image/x-ms-bmp", "image/x-dib"],
		reason:
			"A BMP/DIB signature was detected, but no local OCR engine is configured.",
	},
	{
		label: "GIF image requiring OCR",
		modality: "ocr",
		extensions: ["gif"],
		mimeTypes: ["image/gif"],
		reason:
			"A GIF signature was detected, but no local OCR engine is configured.",
	},
	{
		label: "TIFF image requiring OCR",
		modality: "ocr",
		extensions: ["tif", "tiff"],
		mimeTypes: ["image/tiff"],
		reason:
			"A TIFF signature was detected, but no local OCR engine is configured.",
	},
];

const MEDIA_CANDIDATE: ExternalMediaCandidate = {
	label: "Audio/video requiring transcription",
	modality: "transcription",
	extensions: ["wav", "mp3", "m4a", "ogg", "flac", "mp4", "mov", "webm"],
	mimeTypes: [
		"audio/wav",
		"audio/x-wav",
		"audio/mpeg",
		"audio/mp4",
		"audio/ogg",
		"audio/flac",
		"video/mp4",
		"video/quicktime",
		"video/webm",
	],
	reason:
		"A supported media-container signature was detected, but no local transcription engine is configured.",
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
	return signature.every((value, index) => bytes[index] === value);
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return String.fromCharCode(...bytes.slice(start, start + length));
}

export function detectExternalMediaCandidate(
	bytes: Uint8Array,
): ExternalMediaCandidate | undefined {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return IMAGE_CANDIDATES[0];
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return IMAGE_CANDIDATES[1];
	if (
		startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
		startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
	)
		return IMAGE_CANDIDATES[4];
	if (
		ascii(bytes, 0, 2) === "BM" ||
		[12, 40, 52, 56, 64, 108, 124].includes(
			(bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0,
		)
	)
		return IMAGE_CANDIDATES[2];
	if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)))
		return IMAGE_CANDIDATES[3];
	if (
		ascii(bytes, 0, 4) === "RIFF" &&
		["WAVE", "AVI "].includes(ascii(bytes, 8, 4))
	)
		return MEDIA_CANDIDATE;
	if (
		ascii(bytes, 0, 3) === "ID3" ||
		(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
		ascii(bytes, 0, 4) === "OggS" ||
		ascii(bytes, 0, 4) === "fLaC" ||
		startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]) ||
		ascii(bytes, 4, 4) === "ftyp"
	)
		return MEDIA_CANDIDATE;
	return undefined;
}

export function validateExternalExtractionProvider(
	profile: ExternalExtractionProviderProfile,
): string[] {
	const issues: string[] = [];
	if (!/^[a-z0-9][a-z0-9._-]*$/i.test(profile.id))
		issues.push("Provider ID is invalid.");
	if (!profile.modalities.length)
		issues.push("Provider must declare at least one extraction modality.");
	if (!profile.modelVersion.trim()) issues.push("Model version is required.");
	if (!Number.isSafeInteger(profile.maxFileBytes) || profile.maxFileBytes <= 0)
		issues.push("Provider file-size limit must be a positive safe integer.");
	if (!profile.retentionPolicy.trim())
		issues.push("A concrete retention policy is required.");
	if (profile.mode === "local") {
		if (profile.sendsFileOffDevice)
			issues.push("A local provider cannot send files off-device.");
		if (profile.endpoint)
			issues.push("A local provider cannot declare a remote endpoint.");
	} else {
		if (!profile.sendsFileOffDevice)
			issues.push(
				"A remote provider must disclose that files leave the device.",
			);
		if (!profile.requiresExplicitConsent)
			issues.push("A remote provider must require explicit per-file consent.");
		if (!profile.endpoint?.startsWith("https://"))
			issues.push("A remote provider endpoint must use HTTPS.");
		if (!profile.privacyPolicyUrl?.startsWith("https://"))
			issues.push("A remote provider must declare an HTTPS privacy policy.");
	}
	return issues;
}

export function validateExternalExtractionConsent(
	profile: ExternalExtractionProviderProfile,
	consent: ExternalExtractionConsent | undefined,
	file: Pick<File, "name" | "size">,
): string[] {
	if (profile.mode === "local" && !profile.requiresExplicitConsent) return [];
	if (!consent) return ["Explicit per-file consent is required."];
	const issues: string[] = [];
	if (consent.providerId !== profile.id)
		issues.push("Consent was granted to a different provider.");
	if (consent.fileName !== file.name || consent.fileSize !== file.size)
		issues.push("Consent does not match the selected file.");
	if (consent.privacyPolicyUrl !== profile.privacyPolicyUrl)
		issues.push("Consent references a different privacy policy.");
	if (consent.retentionPolicy !== profile.retentionPolicy)
		issues.push("Consent references a different retention policy.");
	if (!Number.isFinite(Date.parse(consent.grantedAt)))
		issues.push("Consent timestamp is invalid.");
	return issues;
}

function validConfidence(value: number): boolean {
	return Number.isFinite(value) && value >= 0 && value <= 1;
}

export function validateExternalExtractionResult(
	result: ExternalExtractionResult,
	profile: ExternalExtractionProviderProfile,
): string[] {
	const issues: string[] = [];
	if (result.providerId !== profile.id)
		issues.push("Result provider does not match the requested provider.");
	if (result.modelVersion !== profile.modelVersion)
		issues.push("Result model version does not match the pinned model.");
	if (!profile.modalities.includes(result.modality))
		issues.push("Result modality was not declared by the provider.");
	for (const language of result.detectedLanguages) {
		if (!language.language.trim() || !validConfidence(language.confidence))
			issues.push("Detected language metadata is invalid.");
	}
	for (const [index, unit] of result.units.entries()) {
		if (!unit.text.trim() || !validConfidence(unit.confidence))
			issues.push(`Extraction unit ${index + 1} has invalid text/confidence.`);
		if (unit.kind !== result.modality)
			issues.push(`Extraction unit ${index + 1} has the wrong modality.`);
		if (unit.kind === "ocr") {
			if (
				!Number.isSafeInteger(unit.page) ||
				unit.page < 1 ||
				unit.bbox.length !== 4 ||
				unit.bbox.some((value) => !Number.isFinite(value))
			)
				issues.push(`OCR unit ${index + 1} has invalid page/layout metadata.`);
		} else if (
			!Number.isFinite(unit.startMs) ||
			!Number.isFinite(unit.endMs) ||
			unit.startMs < 0 ||
			unit.endMs <= unit.startMs
		)
			issues.push(`Transcript unit ${index + 1} has invalid timestamps.`);
	}
	return issues;
}

export function externalExtractionDisclosure(
	candidate: ExternalMediaCandidate,
): {
	primaryAction: string;
	steps: string[];
	privacyWarning: string;
	fidelityWarning: string;
} {
	return {
		primaryAction:
			candidate.modality === "ocr"
				? "Configure a local or consent-based OCR provider"
				: "Configure a local or consent-based transcription provider",
		steps: [
			"Choose an audited provider with a pinned model version and file-size limit.",
			"Review where processing occurs, the privacy policy, retention period, and whether the file leaves this device.",
			"Grant explicit consent for this exact file when remote processing is used.",
			"Review detected languages, confidence values, page boxes or timestamps, and correct low-confidence output before translation.",
		],
		privacyWarning:
			"No extraction provider is configured, so Open TLC will not upload or process this file. Remote processing must never start without explicit per-file consent.",
		fidelityWarning:
			candidate.modality === "ocr"
				? "OCR may lose reading order, tables, handwriting, columns, formatting, and characters; retain page boxes and confidence for review."
				: "Transcription may lose speakers, punctuation, timing, overlapping speech, music, and low-volume content; retain timestamps and confidence for review.",
	};
}
