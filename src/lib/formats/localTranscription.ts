import type { TranscriptionSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	readSafeFileBytes,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import { createPackageSkeleton } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export const TRANSCRIPTION_EXTENSIONS = [
	"wav",
	"mp3",
	"m4a",
	"ogg",
	"flac",
	"mp4",
	"mov",
	"webm",
] as const;
export const TRANSCRIPTION_MIME_TYPES = [
	"audio/wav",
	"audio/x-wav",
	"audio/mpeg",
	"audio/mp4",
	"audio/ogg",
	"audio/flac",
	"video/mp4",
	"video/quicktime",
	"video/webm",
] as const;

export interface TranscriptChunk {
	text: string;
	timestamp: [number | null, number | null];
	confidence?: number;
}

export interface LocalTranscriptionEngine {
	transcribe(
		audio: Float32Array,
		options: { model: string; language?: string; chunkSeconds: number },
		onProgress: (progress: number, status: string) => void,
	): Promise<{ text: string; chunks?: TranscriptChunk[] }>;
}

function hasMediaSignature(bytes: Uint8Array): boolean {
	const ascii = (start: number, length: number) =>
		String.fromCharCode(...bytes.slice(start, start + length));
	return (
		(ascii(0, 4) === "RIFF" && ["WAVE", "AVI "].includes(ascii(8, 4))) ||
		ascii(0, 3) === "ID3" ||
		(bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) ||
		ascii(0, 4) === "OggS" ||
		ascii(0, 4) === "fLaC" ||
		(bytes[0] === 0x1a &&
			bytes[1] === 0x45 &&
			bytes[2] === 0xdf &&
			bytes[3] === 0xa3) ||
		ascii(4, 4) === "ftyp"
	);
}

export function transcriptUnitsFromResult(result: {
	text: string;
	chunks?: TranscriptChunk[];
}): Array<{
	text: string;
	startMs: number;
	endMs: number;
	confidence: number;
}> {
	const chunks = (result.chunks ?? [])
		.map((chunk) => ({
			text: chunk.text.replace(/\s+/g, " ").trim(),
			startMs: Math.max(0, Math.round((chunk.timestamp[0] ?? 0) * 1000)),
			endMs: Math.max(
				0,
				Math.round((chunk.timestamp[1] ?? chunk.timestamp[0] ?? 0) * 1000),
			),
			confidence: Math.max(0, Math.min(1, chunk.confidence ?? 1)),
		}))
		.filter((chunk) => chunk.text && chunk.endMs > chunk.startMs);
	if (chunks.length > 0) return chunks;
	const text = result.text.replace(/\s+/g, " ").trim();
	return text ? [{ text, startMs: 0, endMs: 1, confidence: 1 }] : [];
}

async function decodeLocalAudio(file: File): Promise<Float32Array> {
	if (typeof AudioContext === "undefined")
		throw new Error(
			"This browser does not provide the Web Audio API required for local transcription.",
		);
	const context = new AudioContext();
	try {
		const decoded = await context.decodeAudioData(await file.arrayBuffer());
		const length = Math.ceil(
			(decoded.duration || decoded.length / decoded.sampleRate) * 16000,
		);
		const offline = new OfflineAudioContext(1, Math.max(1, length), 16000);
		const source = offline.createBufferSource();
		source.buffer = decoded;
		source.connect(offline.destination);
		source.start();
		const rendered = await offline.startRendering();
		return new Float32Array(rendered.getChannelData(0));
	} catch (error) {
		throw new Error(
			`This browser could not decode the selected audio/video codec locally: ${error instanceof Error ? error.message : "unsupported codec"}`,
		);
	} finally {
		await context.close();
	}
}

async function defaultTranscriptionEngine(): Promise<LocalTranscriptionEngine> {
	return {
		async transcribe(audio, options, onProgress) {
			const { pipeline } = await import("@huggingface/transformers");
			const transcriber = await pipeline(
				"automatic-speech-recognition",
				options.model,
				{
					dtype: "q8",
					progress_callback: (progress: {
						progress?: number;
						status?: string;
					}) =>
						onProgress(
							(progress.progress ?? 0) / 100,
							progress.status ?? "Loading local model",
						),
				},
			);
			try {
				return await transcriber(audio, {
					return_timestamps: true,
					chunk_length_s: options.chunkSeconds,
					...(options.language ? { language: options.language } : {}),
				});
			} finally {
				await transcriber.dispose();
			}
		},
	};
}

export async function validateTranscriptionFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const bytes = await readSafeFileBytes(file, context);
		return hasMediaSignature(bytes)
			? { valid: true }
			: {
					valid: false,
					reason: "The file is not a recognized local audio/video container.",
				};
	} catch (error) {
		return {
			valid: false,
			reason: error instanceof Error ? error.message : "Unreadable media file.",
		};
	}
}

export async function importTranscriptionFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
	engine?: LocalTranscriptionEngine,
	decodedAudio?: Float32Array,
): Promise<FormatImportResult> {
	const validation = await validateTranscriptionFile(file, context);
	if (!validation.valid)
		throw new SafeInputError(
			"MEDIA_INVALID",
			validation.reason ?? "Invalid media file.",
		);
	const normalized = normalizeImportOptions("media-transcription", options);
	throwIfAborted(context?.signal);
	const audio = decodedAudio ?? (await decodeLocalAudio(file));
	throwIfAborted(context?.signal);
	const selectedEngine = engine ?? (await defaultTranscriptionEngine());
	const result = await selectedEngine.transcribe(
		audio,
		{
			model: String(normalized.model),
			language: String(normalized.language || "") || undefined,
			chunkSeconds: Math.max(
				5,
				Math.min(60, Number(normalized.chunkSeconds) || 30),
			),
		},
		(progress, status) =>
			context?.onProgress?.({
				phase: "extracting",
				completed: Math.round(progress * 1000),
				total: 1000,
				message: status || "Running local transcription",
			}),
	);
	throwIfAborted(context?.signal);
	const units = transcriptUnitsFromResult(result);
	if (units.length === 0)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"Local transcription found no speech in this file.",
		);
	const segments = units.map((unit) => unit.text);
	const meta: TranscriptionSegmentMeta[] = units.map((unit) => ({
		profile: "local-media-transcription",
		startMs: unit.startMs,
		endMs: unit.endMs,
		confidence: unit.confidence,
	}));
	const document = createNeutralDocument({
		format: "media-transcription",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			segmentIndex,
			metadata: { startMs: entry.startMs, endMs: entry.endMs },
		})),
	});
	document.metadata = {
		profile: "Local Whisper transcription",
		sourceOnly: true,
		processing: "on-device",
		fileUploaded: false,
		exportPolicy: "webvtt",
		model: normalized.model,
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(file, "media-transcription", {}, []),
		filterOptions: normalized,
		typeRef: {
			profile: "local-media-transcription",
			model: String(normalized.model),
		} as TypeRef,
		segmentsMeta: meta,
	};
}
