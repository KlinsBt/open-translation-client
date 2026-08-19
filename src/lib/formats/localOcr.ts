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
import {
	inspectOcrImage,
	type OcrImageInspection,
	wrapDibAsBmp,
} from "./ocrImageInspection";

const IMAGE_MIME_TYPES = [
	"image/png",
	"image/jpeg",
	"image/pjpeg",
	"image/tiff",
	"image/bmp",
	"image/x-bmp",
	"image/x-ms-bmp",
	"image/x-dib",
	"image/gif",
] as const;
export const OCR_IMAGE_EXTENSIONS = [
	"png",
	"jpg",
	"jpeg",
	"jpe",
	"jif",
	"jfif",
	"jfi",
	"tif",
	"tiff",
	"bmp",
	"dib",
	"gif",
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

export interface LocalOcrImageDecoder {
	decode(
		file: File,
		bytes: Uint8Array,
		inspection: OcrImageInspection,
	): Promise<File>;
}

async function canvasPng(
	canvas: OffscreenCanvas | HTMLCanvasElement,
): Promise<Blob> {
	if ("convertToBlob" in canvas)
		return canvas.convertToBlob({ type: "image/png" });
	return new Promise((resolve, reject) =>
		canvas.toBlob(
			(blob) =>
				blob ? resolve(blob) : reject(new Error("Canvas PNG encoding failed.")),
			"image/png",
		),
	);
}

const browserImageDecoder: LocalOcrImageDecoder = {
	async decode(file, bytes, inspection) {
		if (typeof createImageBitmap !== "function")
			throw new SafeInputError(
				"OCR_DECODE_FAILED",
				"This browser cannot safely decode BMP, DIB, or GIF images locally.",
			);
		const source =
			inspection.profile === "dib"
				? new Blob([wrapDibAsBmp(bytes)], { type: "image/bmp" })
				: file;
		let bitmap: ImageBitmap;
		try {
			bitmap = await createImageBitmap(source, {
				imageOrientation: "from-image",
				premultiplyAlpha: "default",
				colorSpaceConversion: "default",
			});
		} catch {
			throw new SafeInputError(
				"OCR_DECODE_FAILED",
				`The browser could not decode this ${inspection.profile.toUpperCase()} image safely.`,
			);
		}
		try {
			if (
				bitmap.width !== inspection.width ||
				bitmap.height !== inspection.height
			)
				throw new SafeInputError(
					"OCR_DECODE_FAILED",
					"The decoded image dimensions do not match its validated header.",
					{
						headerWidth: inspection.width,
						headerHeight: inspection.height,
						decodedWidth: bitmap.width,
						decodedHeight: bitmap.height,
					},
				);
			const canvas =
				typeof OffscreenCanvas === "function"
					? new OffscreenCanvas(bitmap.width, bitmap.height)
					: Object.assign(document.createElement("canvas"), {
							width: bitmap.width,
							height: bitmap.height,
						});
			const drawing = canvas.getContext("2d");
			if (!drawing)
				throw new SafeInputError(
					"OCR_DECODE_FAILED",
					"A local 2D image decoder is unavailable.",
				);
			drawing.drawImage(bitmap, 0, 0);
			const blob = await canvasPng(canvas);
			return new File(
				[blob],
				`${file.name.replace(/\.[^.]+$/, "")}.normalized.png`,
				{ type: "image/png" },
			);
		} catch (error) {
			if (error instanceof SafeInputError) throw error;
			throw new SafeInputError(
				"OCR_DECODE_FAILED",
				`The browser could not normalize this ${inspection.profile.toUpperCase()} image for local OCR.`,
			);
		} finally {
			bitmap.close();
		}
	},
};

function validateBox(box: OcrBox, width?: number, height?: number): void {
	const values = [box.x0, box.y0, box.x1, box.y1];
	if (
		!values.every(Number.isFinite) ||
		box.x0 < 0 ||
		box.y0 < 0 ||
		box.x1 < box.x0 ||
		box.y1 < box.y0 ||
		(width !== undefined && box.x1 > width) ||
		(height !== undefined && box.y1 > height)
	)
		throw new SafeInputError(
			"OCR_INVALID_RESULT",
			"The local OCR engine returned a text box outside the validated image bounds.",
		);
}

export function ocrUnitsFromPage(
	page: TesseractPageLike,
	grouping: "paragraphs" | "lines" = "paragraphs",
	imageBounds?: Readonly<{ width: number; height: number }>,
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
	for (const unit of units)
		validateBox(unit.bbox, imageBounds?.width, imageBounds?.height);
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
		inspectOcrImage(bytes);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			errorCode: error instanceof SafeInputError ? error.code : "OCR_INVALID",
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
	decoder: LocalOcrImageDecoder = browserImageDecoder,
): Promise<FormatImportResult> {
	const bytes = await readSafeFileBytes(file, context);
	const inspection = inspectOcrImage(bytes);
	const normalized = normalizeImportOptions("image-ocr", options);
	const language = String(normalized.ocrLanguage || "eng");
	const grouping =
		String(normalized.grouping) === "lines" ? "lines" : "paragraphs";
	const gifAnimationPolicy = String(normalized.gifAnimationPolicy || "reject");
	if (
		inspection.profile === "gif" &&
		inspection.animated &&
		gifAnimationPolicy !== "first-frame"
	)
		throw new SafeInputError(
			"OCR_ANIMATED_GIF",
			`This GIF contains ${inspection.frameCount} frames. Choose “Use first frame” to OCR only its first frame.`,
			{ frameCount: inspection.frameCount },
		);
	throwIfAborted(context?.signal);
	const requiresNormalization = ["bmp", "dib", "gif"].includes(
		inspection.profile,
	);
	const ocrFile = requiresNormalization
		? await decoder.decode(file, bytes, inspection)
		: file;
	throwIfAborted(context?.signal);
	const selectedEngine = engine ?? (await defaultOcrEngine());
	const page = await selectedEngine.recognize(
		ocrFile,
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
	const units = ocrUnitsFromPage(page, grouping, inspection);
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
		imageProfile: inspection.profile,
		imageWidth: inspection.width,
		imageHeight: inspection.height,
		imageOrientation: inspection.orientation,
		imageFrames: inspection.frameCount,
		imageAlpha: inspection.hasAlpha,
		imageColorProfile: inspection.hasColorProfile,
		gifFramePolicy:
			inspection.profile === "gif" ? gifAnimationPolicy : "not-applicable",
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
			imageProfile: inspection.profile,
			imageWidth: String(inspection.width),
			imageHeight: String(inspection.height),
			imageOrientation: String(inspection.orientation),
			imageFrames: String(inspection.frameCount),
			imageAlpha: String(inspection.hasAlpha),
			imageColorProfile: String(inspection.hasColorProfile),
			gifFramePolicy:
				inspection.profile === "gif" ? gifAnimationPolicy : "not-applicable",
		} as TypeRef,
		segmentsMeta: meta,
	};
}
