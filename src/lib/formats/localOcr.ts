import type { OcrSegmentMeta, TypeRef } from "$lib/types/types";
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

const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/tiff"] as const;
export const OCR_IMAGE_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"tif",
	"tiff",
] as const;
export const OCR_IMAGE_MIME_TYPES = IMAGE_MIME_TYPES;

interface OcrBox {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface LocalOcrUnit {
	text: string;
	confidence: number;
	bbox: OcrBox;
	direction: "ltr" | "rtl";
}

interface TesseractPageLike {
	text: string;
	confidence: number;
	blocks: Array<{
		paragraphs: Array<{
			text: string;
			confidence: number;
			bbox: OcrBox;
			is_ltr: boolean;
			lines: Array<{
				text: string;
				confidence: number;
				bbox: OcrBox;
			}>;
		}>;
	}> | null;
}

export interface LocalOcrEngine {
	recognize(
		file: File,
		language: string,
		onProgress: (progress: number, status: string) => void,
	): Promise<TesseractPageLike>;
}

function hasImageSignature(bytes: Uint8Array): boolean {
	const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
		(value, index) => bytes[index] === value,
	);
	const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
	const tiff =
		(bytes[0] === 0x49 &&
			bytes[1] === 0x49 &&
			bytes[2] === 0x2a &&
			bytes[3] === 0) ||
		(bytes[0] === 0x4d &&
			bytes[1] === 0x4d &&
			bytes[2] === 0 &&
			bytes[3] === 0x2a);
	return png || jpeg || tiff;
}

export function ocrUnitsFromPage(
	page: TesseractPageLike,
	grouping: "paragraphs" | "lines" = "paragraphs",
): LocalOcrUnit[] {
	const paragraphs = (page.blocks ?? []).flatMap((block) => block.paragraphs);
	const candidates =
		grouping === "lines"
			? paragraphs.flatMap((paragraph) =>
					paragraph.lines.map((line) => ({
						...line,
						is_ltr: paragraph.is_ltr,
					})),
				)
			: paragraphs;
	const units = candidates
		.map((candidate) => ({
			text: candidate.text.replace(/\s+/g, " ").trim(),
			confidence: Math.max(0, Math.min(1, candidate.confidence / 100)),
			bbox: candidate.bbox,
			direction:
				candidate.is_ltr === false ? ("rtl" as const) : ("ltr" as const),
		}))
		.filter((unit) => unit.text.length > 0);
	if (units.length > 0) return units;
	const text = page.text.replace(/\s+/g, " ").trim();
	return text
		? [
				{
					text,
					confidence: Math.max(0, Math.min(1, page.confidence / 100)),
					bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
					direction: "ltr",
				},
			]
		: [];
}

async function defaultOcrEngine(): Promise<LocalOcrEngine> {
	return {
		async recognize(file, language, onProgress) {
			const { createWorker, OEM } = await import("tesseract.js");
			const worker = await createWorker(language, OEM.LSTM_ONLY, {
				logger: (message) => onProgress(message.progress, message.status),
			});
			try {
				const result = await worker.recognize(
					file,
					{ rotateAuto: true },
					{ text: true, blocks: true },
				);
				return result.data;
			} finally {
				await worker.terminate();
			}
		},
	};
}

export async function validateOcrImageFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const bytes = await readSafeFileBytes(file, context);
		return hasImageSignature(bytes)
			? { valid: true }
			: {
					valid: false,
					reason: "The file is not a valid PNG, JPEG, or TIFF image.",
				};
	} catch (error) {
		return {
			valid: false,
			reason:
				error instanceof Error
					? error.message
					: "The image could not be read safely.",
		};
	}
}

export async function importOcrImageFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
	engine?: LocalOcrEngine,
): Promise<FormatImportResult> {
	const validation = await validateOcrImageFile(file, context);
	if (!validation.valid)
		throw new SafeInputError(
			"OCR_INVALID",
			validation.reason ?? "Invalid OCR image.",
		);
	const normalized = normalizeImportOptions("image-ocr", options);
	const language = String(normalized.ocrLanguage || "eng");
	const grouping =
		String(normalized.grouping) === "lines" ? "lines" : "paragraphs";
	throwIfAborted(context?.signal);
	const selectedEngine = engine ?? (await defaultOcrEngine());
	const page = await selectedEngine.recognize(
		file,
		language,
		(progress, status) => {
			context?.onProgress?.({
				phase: "extracting",
				completed: Math.round(progress * 1000),
				total: 1000,
				message: status || "Running local OCR",
			});
		},
	);
	throwIfAborted(context?.signal);
	const units = ocrUnitsFromPage(page, grouping);
	if (units.length === 0)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"Local OCR found no readable text in this image.",
		);
	const segments = units.map((unit) => unit.text);
	const meta: OcrSegmentMeta[] = units.map((unit) => ({
		profile: "local-image-ocr",
		page: 1,
		bbox: [
			unit.bbox.x0,
			unit.bbox.y0,
			unit.bbox.x1 - unit.bbox.x0,
			unit.bbox.y1 - unit.bbox.y0,
		],
		confidence: unit.confidence,
		direction: unit.direction,
	}));
	const document = createNeutralDocument({
		format: "image-ocr",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			page: 1,
			segmentIndex,
			metadata: { bbox: entry.bbox, confidence: entry.confidence },
		})),
	});
	document.metadata = {
		profile: "Local Tesseract image OCR",
		sourceOnly: true,
		lossy: true,
		processing: "on-device",
		fileUploaded: false,
		exportPolicy: "derived-bilingual-html",
		languageModel: language,
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(file, "image-ocr", {}, []),
		filterOptions: normalized,
		typeRef: {
			profile: "local-image-ocr",
			engine: "tesseract.js",
			languageModel: language,
		} as TypeRef,
		segmentsMeta: meta,
	};
}
