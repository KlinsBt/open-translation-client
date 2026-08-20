import type { PdfSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parsePositiveRanges } from "./options";
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

interface PdfJsTextItem {
	str: string;
	dir: string;
	transform: number[];
	width: number;
	height: number;
	hasEOL: boolean;
}

interface ExtractedPdfLine {
	text: string;
	page: number;
	x: number;
	y: number;
	width: number;
	height: number;
	direction: string;
	itemCount: number;
}

export interface PdfExtraction {
	version?: string;
	pageCount: number;
	selectedPages: number[];
	textPages: number[];
	ocrRequiredPages: number[];
	blankPages: number[];
	lines: ExtractedPdfLine[];
}

const MAX_PDF_PAGES = 2_000;
const MAX_PDF_TEXT_ITEMS = 500_000;
const MAX_PDF_TEXT_CHARACTERS = 20_000_000;

function invalidPdf(
	code:
		| "PDF_INVALID"
		| "PDF_PASSWORD_REQUIRED"
		| "PDF_OCR_REQUIRED"
		| "PDF_LIMIT_EXCEEDED",
	message: string,
): SafeInputError {
	return new SafeInputError(code, message);
}

function isTextItem(value: unknown): value is PdfJsTextItem {
	return (
		!!value &&
		typeof value === "object" &&
		"str" in value &&
		typeof value.str === "string" &&
		"transform" in value &&
		Array.isArray(value.transform)
	);
}

function groupTextItems(
	items: readonly PdfJsTextItem[],
	page: number,
	mode: string,
): ExtractedPdfLine[] {
	const output: ExtractedPdfLine[] = [];
	let current: ExtractedPdfLine | undefined;
	const flush = () => {
		if (current?.text.trim()) output.push(current);
		current = undefined;
	};
	for (const item of items) {
		const text = item.str;
		if (!text.trim()) continue;
		const x = Number(item.transform[4] ?? 0);
		const y = Number(item.transform[5] ?? 0);
		const width = Math.max(0, Number(item.width) || 0);
		const height = Math.max(
			0.1,
			Number(item.height) || Math.abs(Number(item.transform[3] ?? 0)) || 1,
		);
		if (mode === "items") {
			flush();
			output.push({
				text,
				page,
				x,
				y,
				width,
				height,
				direction: item.dir || "ltr",
				itemCount: 1,
			});
			continue;
		}
		const sameLine =
			current &&
			Math.abs(current.y - y) <= Math.max(current.height, height) * 0.45 &&
			x >= current.x - height;
		if (!sameLine) flush();
		if (!current) {
			current = {
				text,
				page,
				x,
				y,
				width,
				height,
				direction: item.dir || "ltr",
				itemCount: 1,
			};
		} else {
			const previousEnd = current.x + current.width;
			const gap = x - previousEnd;
			const separator =
				current.text.endsWith(" ") ||
				text.startsWith(" ") ||
				gap <= height * 0.1
					? ""
					: " ";
			current.text += `${separator}${text}`;
			current.width = Math.max(previousEnd, x + width) - current.x;
			current.height = Math.max(current.height, height);
			current.itemCount++;
		}
		if (item.hasEOL) flush();
	}
	flush();
	return output;
}

function hasRasterImage(
	fnArray: readonly number[],
	ops: Readonly<Record<string, number>>,
): boolean {
	const imageOps = new Set(
		[
			ops.paintImageXObject,
			ops.paintImageXObjectRepeat,
			ops.paintInlineImageXObject,
			ops.paintImageMaskXObject,
		].filter((value): value is number => typeof value === "number"),
	);
	return fnArray.some((operation) => imageOps.has(operation));
}

export async function extractPdf(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<PdfExtraction> {
	const filterOptions = normalizeImportOptions("pdf", options);
	const bytes = await readSafeFileBytes(file, context);
	if (bytes.length < 8 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-")
		throw invalidPdf("PDF_INVALID", "PDF must begin with a %PDF- signature.");
	const header = new TextDecoder("iso-8859-1").decode(bytes.slice(0, 16));
	const trailer = new TextDecoder("iso-8859-1").decode(
		bytes.slice(Math.max(0, bytes.length - 4_096)),
	);
	if (
		!/^%PDF-\d\.\d(?:\r?\n|\r)/.test(header) ||
		!/(?:^|[\r\n])startxref\s+\d+\s+%%EOF\s*$/s.test(trailer)
	)
		throw invalidPdf(
			"PDF_INVALID",
			"PDF must contain a valid version header and a final startxref/%%EOF trailer before structural parsing.",
		);
	throwIfAborted(context?.signal);
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	if (
		typeof process !== "undefined" &&
		process.versions?.node &&
		!(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker
	) {
		(globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker =
			await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
	} else if (!pdfjs.GlobalWorkerOptions.workerSrc) {
		pdfjs.GlobalWorkerOptions.workerSrc = new URL(
			"pdfjs-dist/legacy/build/pdf.worker.mjs",
			import.meta.url,
		).toString();
	}
	const loadingTask = pdfjs.getDocument({
		data: bytes.slice(),
		verbosity: pdfjs.VerbosityLevel.ERRORS,
		useSystemFonts: false,
		useWorkerFetch: false,
		useWasm: false,
		maxImageSize: 50_000_000,
		stopAtErrors: true,
	});
	loadingTask.onProgress = ({
		loaded,
		total,
	}: {
		loaded: number;
		total: number;
	}) =>
		context?.onProgress?.({
			phase: "reading",
			completed: loaded,
			total: total || bytes.length,
			message: "Loading PDF structure",
		});
	const abort = () => void loadingTask.destroy();
	context?.signal?.addEventListener("abort", abort, { once: true });
	let document: Awaited<typeof loadingTask.promise> | undefined;
	try {
		try {
			document = await loadingTask.promise;
		} catch (error) {
			throwIfAborted(context?.signal);
			const name =
				error && typeof error === "object" && "name" in error
					? String(error.name)
					: "";
			if (name === "PasswordException")
				throw invalidPdf(
					"PDF_PASSWORD_REQUIRED",
					"Password-protected PDFs must be decrypted locally before import.",
				);
			throw invalidPdf(
				"PDF_INVALID",
				error instanceof Error ? error.message : "PDF structure is invalid.",
			);
		}
		if (document.numPages > MAX_PDF_PAGES)
			throw invalidPdf(
				"PDF_LIMIT_EXCEEDED",
				`PDF has ${document.numPages} pages; the safety limit is ${MAX_PDF_PAGES}.`,
			);
		const requested = parsePositiveRanges(String(filterOptions.pages));
		const selectedPages = Array.from(
			{ length: document.numPages },
			(_, index) => index + 1,
		).filter((page) => requested === null || requested.has(page));
		if (!selectedPages.length)
			throw invalidPdf(
				"PDF_INVALID",
				"The selected PDF page range contains no pages in this document.",
			);
		const lines: ExtractedPdfLine[] = [];
		const textPages: number[] = [];
		const ocrRequiredPages: number[] = [];
		const blankPages: number[] = [];
		let itemCount = 0;
		let characters = 0;
		for (const [pageOffset, pageNumber] of selectedPages.entries()) {
			throwIfAborted(context?.signal);
			context?.onProgress?.({
				phase: "extracting",
				completed: pageOffset,
				total: selectedPages.length,
				message: `Extracting PDF page ${pageNumber}`,
			});
			const page = await document.getPage(pageNumber);
			const textContent = await page.getTextContent({
				disableNormalization: false,
				includeMarkedContent: false,
			});
			const textItems = textContent.items.filter(isTextItem) as PdfJsTextItem[];
			itemCount += textItems.length;
			characters += textItems.reduce((sum, item) => sum + item.str.length, 0);
			if (
				itemCount > MAX_PDF_TEXT_ITEMS ||
				characters > MAX_PDF_TEXT_CHARACTERS
			)
				throw invalidPdf(
					"PDF_LIMIT_EXCEEDED",
					"PDF text extraction exceeded the safe item or character limit.",
				);
			const pageLines = groupTextItems(
				textItems,
				pageNumber,
				String(filterOptions.grouping),
			);
			if (pageLines.length) {
				textPages.push(pageNumber);
				lines.push(...pageLines);
			} else {
				const operatorList = await page.getOperatorList();
				if (hasRasterImage(operatorList.fnArray, pdfjs.OPS))
					ocrRequiredPages.push(pageNumber);
				else blankPages.push(pageNumber);
			}
			page.cleanup();
		}
		context?.onProgress?.({
			phase: "extracting",
			completed: selectedPages.length,
			total: selectedPages.length,
			message: "PDF extraction complete",
		});
		if (ocrRequiredPages.length && filterOptions.ocrPolicy === "error")
			throw invalidPdf(
				"PDF_OCR_REQUIRED",
				`PDF pages ${ocrRequiredPages.join(", ")} contain images but no extractable text; local or consent-based OCR is required.`,
			);
		if (!lines.length)
			throw invalidPdf(
				ocrRequiredPages.length ? "PDF_OCR_REQUIRED" : "PDF_INVALID",
				ocrRequiredPages.length
					? "This PDF has no born-digital text. OCR is required, but OCR is not enabled in the core importer."
					: "The selected PDF pages contain no extractable text.",
			);
		return {
			version: document.fingerprints?.[0] ?? undefined,
			pageCount: document.numPages,
			selectedPages,
			textPages,
			ocrRequiredPages,
			blankPages,
			lines,
		};
	} finally {
		context?.signal?.removeEventListener("abort", abort);
		await loadingTask.destroy();
	}
}

export async function validatePdfFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await extractPdf(file, { pages: "1", ocrPolicy: "skip" }, context);
		return { valid: true };
	} catch (error) {
		if (error instanceof SafeInputError && error.code === "PDF_OCR_REQUIRED")
			return { valid: true, reason: error.message, errorCode: error.code };
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not a safe, readable PDF." };
	}
}

export async function importPdfFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("pdf", options);
	const extraction = await extractPdf(file, filterOptions, context);
	const segments = extraction.lines.map((line) => line.text);
	const meta: PdfSegmentMeta[] = extraction.lines.map((line) => ({
		profile: "pdf-source-only",
		page: line.page,
		bbox: [line.x, line.y, line.width, line.height],
		direction: line.direction === "rtl" ? "rtl" : "ltr",
		itemCount: line.itemCount,
		extraction: "born-digital",
	}));
	const document = createNeutralDocument({
		format: "pdf",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: `page-${entry.page}`,
			page: entry.page,
			segmentIndex,
			metadata: { bbox: entry.bbox, extraction: entry.extraction },
		})),
	});
	for (const [index, entry] of meta.entries()) {
		document.units[index].source.direction = entry.direction;
		document.units[index].contexts.push({
			type: "pdf-page",
			value: String(entry.page),
		});
	}
	document.metadata = {
		profile: "PDF source-only extraction",
		sourceOnly: true,
		lossy: true,
		pageCount: extraction.pageCount,
		selectedPages: extraction.selectedPages,
		textPages: extraction.textPages,
		ocrRequiredPages: extraction.ocrRequiredPages,
		blankPages: extraction.blankPages,
		exportPolicy: "derived-translated-pdf",
		security:
			"Extraction runs locally in the app and its local PDF.js worker without remote worker/font/Wasm fetches; embedded scripts, actions, attachments, forms, and links are never requested or executed.",
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(file, "pdf", {}, [], {
			name: file.name,
			mimeType: file.type || "application/pdf",
			originalFile: file.slice(0, file.size, file.type || "application/pdf"),
		}),
		filterOptions,
		typeRef: {
			profile: "pdf-source-only",
			version: extraction.version ?? "unknown",
		} as TypeRef,
		segmentsMeta: meta,
	};
}
