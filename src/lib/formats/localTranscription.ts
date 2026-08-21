import type { TranscriptionSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	assertSafeFileSize,
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
		signal?: AbortSignal,
	): Promise<{ text: string; chunks?: TranscriptChunk[] }>;
}

const MEDIA_HEADER_BYTES = 64 * 1024;
const MAX_DECODED_AUDIO_SECONDS = 60 * 60;

function uint32Le(bytes: Uint8Array, offset: number): number {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
		offset,
		true,
	);
}

function containsBytes(bytes: Uint8Array, needle: readonly number[]): boolean {
	outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
		for (let offset = 0; offset < needle.length; offset += 1)
			if (bytes[index + offset] !== needle[offset]) continue outer;
		return true;
	}
	return false;
}

export function hasMediaSignature(bytes: Uint8Array, fileSize = bytes.length): boolean {
	if (bytes.length < 16 || fileSize < 16) return false;
	const ascii = (start: number, length: number) =>
		String.fromCharCode(...bytes.slice(start, start + length));
	if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") {
		if (bytes.length < 44 || uint32Le(bytes, 4) + 8 > fileSize) return false;
		let offset = 12;
		let format = false;
		let audioData = false;
		while (offset + 8 <= bytes.length) {
			const id = ascii(offset, 4);
			const size = uint32Le(bytes, offset + 4);
			if (id === "fmt " && size >= 16) format = true;
			if (id === "data" && size > 0 && offset + 8 + size <= fileSize)
				audioData = true;
			if (format && audioData) return true;
			offset += 8 + size + (size % 2);
			if (offset > fileSize || offset > bytes.length) break;
		}
		return false;
	}
	if (ascii(0, 3) === "ID3") {
		if (bytes.length < 10) return false;
		const tagSize =
			((bytes[6] & 0x7f) << 21) |
			((bytes[7] & 0x7f) << 14) |
			((bytes[8] & 0x7f) << 7) |
			(bytes[9] & 0x7f);
		const searchFrom = Math.min(10 + tagSize, bytes.length - 2);
		return bytes
			.slice(searchFrom)
			.some((byte, index, rest) => byte === 0xff && (rest[index + 1] & 0xe0) === 0xe0);
	}
	if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
		return fileSize >= 4 && bytes.length >= 4;
	if (ascii(0, 4) === "OggS")
		return bytes[4] === 0 && bytes.length >= 27 + bytes[26] && fileSize > 27;
	if (ascii(0, 4) === "fLaC")
		return (
			bytes.length >= 42 &&
			(bytes[4] & 0x7f) === 0 &&
			((bytes[5] << 16) | (bytes[6] << 8) | bytes[7]) === 34
		);
	if (
		bytes[0] === 0x1a &&
			bytes[1] === 0x45 &&
			bytes[2] === 0xdf &&
			bytes[3] === 0xa3
	)
		return containsBytes(bytes, [0x18, 0x53, 0x80, 0x67]);
	if (ascii(4, 4) === "ftyp") {
		const size = new DataView(
			bytes.buffer,
			bytes.byteOffset,
			bytes.byteLength,
		).getUint32(0, false);
		return size >= 16 && size <= fileSize && bytes.length >= Math.min(size, 24);
	}
	return false;
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

async function decodeLocalAudio(
	file: File,
	signal?: AbortSignal,
): Promise<Float32Array> {
	if (typeof AudioContext === "undefined")
		throw new Error(
			"This browser does not provide the Web Audio API required for local transcription.",
		);
	const context = new AudioContext();
	const cancel = () => void context.close();
	signal?.addEventListener("abort", cancel, { once: true });
	try {
		throwIfAborted(signal);
		const decoded = await context.decodeAudioData(await file.arrayBuffer());
		throwIfAborted(signal);
		if (decoded.duration > MAX_DECODED_AUDIO_SECONDS)
			throw new SafeInputError(
				"MEDIA_INVALID",
				"This media file exceeds the one-hour local transcription limit.",
				{ durationSeconds: Math.ceil(decoded.duration), limitSeconds: MAX_DECODED_AUDIO_SECONDS },
			);
		const length = Math.ceil(
			(decoded.duration || decoded.length / decoded.sampleRate) * 16000,
		);
		const offline = new OfflineAudioContext(1, Math.max(1, length), 16000);
		const source = offline.createBufferSource();
		source.buffer = decoded;
		source.connect(offline.destination);
		source.start();
		const rendered = await offline.startRendering();
		throwIfAborted(signal);
		return new Float32Array(rendered.getChannelData(0));
	} catch (error) {
		if (signal?.aborted) throwIfAborted(signal);
		if (error instanceof SafeInputError) throw error;
		throw new Error(
			`This browser could not decode the selected audio/video codec locally: ${error instanceof Error ? error.message : "unsupported codec"}`,
		);
	} finally {
		signal?.removeEventListener("abort", cancel);
		if (context.state !== "closed") await context.close();
	}
}

async function defaultTranscriptionEngine(): Promise<LocalTranscriptionEngine> {
	return {
		async transcribe(audio, options, onProgress, signal) {
			const { pipeline } = await import("@huggingface/transformers");
			const transcriber = await pipeline(
				"automatic-speech-recognition",
				options.model,
				{
					dtype: "q8",
					progress_callback: (progress: {
						progress?: number;
						status?: string;
					}) => {
						throwIfAborted(signal);
						onProgress(
							(progress.progress ?? 0) / 100,
							progress.status ?? "Loading local model",
						);
					},
				},
			);
			try {
				throwIfAborted(signal);
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
		throwIfAborted(context?.signal);
		assertSafeFileSize(file);
		const bytes = new Uint8Array(
			await file.slice(0, MEDIA_HEADER_BYTES).arrayBuffer(),
		);
		throwIfAborted(context?.signal);
		return hasMediaSignature(bytes, file.size)
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
	const audio = decodedAudio ?? (await decodeLocalAudio(file, context?.signal));
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
		context?.signal,
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
