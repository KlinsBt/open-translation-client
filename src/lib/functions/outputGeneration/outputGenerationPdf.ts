import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import type { PdfSegmentMeta, UserData } from "$lib/types/types";
import notoSansArabicUrl from "@fontsource/noto-sans-arabic/files/noto-sans-arabic-arabic-400-normal.woff?url";
import notoSansBengaliUrl from "@fontsource/noto-sans-bengali/files/noto-sans-bengali-bengali-400-normal.woff?url";
import notoSansDevanagariUrl from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url";
import notoSansHebrewUrl from "@fontsource/noto-sans-hebrew/files/noto-sans-hebrew-hebrew-400-normal.woff?url";
import notoSansThaiUrl from "@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff?url";
import notoSansCyrillicUrl from "@fontsource/noto-sans/files/noto-sans-cyrillic-400-normal.woff?url";
import notoSansGreekUrl from "@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff?url";
import notoSansLatinUrl from "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff?url";

interface JpegPage {
	bytes: Uint8Array;
	width: number;
	height: number;
	pdfWidth?: number;
	pdfHeight?: number;
}

interface SearchableJpegPage extends JpegPage {
	text: Array<{
		value: string;
		x: number;
		y: number;
		fontSize: number;
		maxWidth: number;
	}>;
}

const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;
const DELIVERY_WIDTH = 1240;
const DELIVERY_HEIGHT = 1754;

function ascii(value: string): Uint8Array {
	return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
	const length = parts.reduce((total, part) => total + part.length, 0);
	const output = new Uint8Array(length);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

export function buildJpegPdf(pages: readonly JpegPage[]): Blob {
	if (!pages.length) throw new Error("PDF export requires at least one page.");
	const objectCount = 2 + pages.length * 3;
	const objects: Uint8Array[] = new Array(objectCount + 1);
	objects[1] = ascii("<< /Type /Catalog /Pages 2 0 R >>");
	const pageReferences = pages.map((_, index) => `${3 + index * 3} 0 R`);
	objects[2] = ascii(
		`<< /Type /Pages /Count ${pages.length} /Kids [${pageReferences.join(" ")}] >>`,
	);

	for (const [index, page] of pages.entries()) {
		const pdfWidth = page.pdfWidth ?? PDF_WIDTH;
		const pdfHeight = page.pdfHeight ?? PDF_HEIGHT;
		const pageObject = 3 + index * 3;
		const imageObject = pageObject + 1;
		const contentObject = pageObject + 2;
		objects[pageObject] = ascii(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
		);
		objects[imageObject] = concatBytes([
			ascii(
				`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
			),
			page.bytes,
			ascii("\nendstream"),
		]);
		const commands = `q\n${pdfWidth} 0 0 ${pdfHeight} 0 0 cm\n/Im0 Do\nQ`;
		objects[contentObject] = ascii(
			`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`,
		);
	}

	const chunks: Uint8Array[] = [ascii("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n")];
	const offsets = new Array<number>(objectCount + 1).fill(0);
	let byteOffset = chunks[0].length;
	for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
		offsets[objectNumber] = byteOffset;
		const object = concatBytes([
			ascii(`${objectNumber} 0 obj\n`),
			objects[objectNumber],
			ascii("\nendobj\n"),
		]);
		chunks.push(object);
		byteOffset += object.length;
	}
	const xrefOffset = byteOffset;
	const xref = [
		"xref",
		`0 ${objectCount + 1}`,
		"0000000000 65535 f ",
		...offsets
			.slice(1)
			.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
		`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>`,
		`startxref\n${xrefOffset}`,
		"%%EOF",
	].join("\n");
	chunks.push(ascii(xref));
	return new Blob([concatBytes(chunks)], { type: "application/pdf" });
}

function isPdfMeta(value: unknown): value is PdfSegmentMeta {
	return (
		!!value &&
		typeof value === "object" &&
		"profile" in value &&
		value.profile === "pdf-source-only" &&
		"page" in value &&
		typeof value.page === "number"
	);
}

function canvasJpeg(canvas: HTMLCanvasElement): Uint8Array {
	const encoded = canvas.toDataURL("image/jpeg", 0.94).split(",")[1];
	const binary = atob(encoded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const fontBytes = new Map<string, Promise<Uint8Array>>();

function targetLanguageCode(language: string): string {
	return (language.match(/\(([^)]+)\)\s*$/)?.[1] ?? language)
		.toLowerCase()
		.split(/[-_]/)[0];
}

function searchableFontUrl(language: string): string {
	const code = targetLanguageCode(language);
	if (["ar", "fa", "ps", "sd", "ug", "ur"].includes(code))
		return notoSansArabicUrl;
	if (["bn", "as"].includes(code)) return notoSansBengaliUrl;
	if (["hi", "mr", "ne", "sa"].includes(code)) return notoSansDevanagariUrl;
	if (["he", "yi"].includes(code)) return notoSansHebrewUrl;
	if (code === "th") return notoSansThaiUrl;
	if (
		[
			"be",
			"bg",
			"kk",
			"ky",
			"mk",
			"mn",
			"ru",
			"sr",
			"tg",
			"uk",
		].includes(code)
	)
		return notoSansCyrillicUrl;
	if (code === "el") return notoSansGreekUrl;
	return notoSansLatinUrl;
}

async function loadSearchableFontBytes(language: string): Promise<Uint8Array> {
	const url = searchableFontUrl(language);
	let pending = fontBytes.get(url);
	if (!pending) {
		pending = fetch(url).then(async (response) => {
			if (!response.ok)
				throw new Error("The PDF text font could not be loaded.");
			return new Uint8Array(await response.arrayBuffer());
		});
		fontBytes.set(url, pending);
	}
	return pending;
}

async function buildSearchableJpegPdf(
	pages: readonly SearchableJpegPage[],
	language: string,
): Promise<Blob> {
	if (!pages.length) throw new Error("PDF export requires at least one page.");
	await import("regenerator-runtime/runtime.js");
	const [{ PDFDocument }, { default: fontkit }] = await Promise.all([
		import("pdf-lib"),
		import("@pdf-lib/fontkit"),
	]);
	const document = await PDFDocument.create();
	document.registerFontkit(fontkit);
	const font = await document.embedFont(await loadSearchableFontBytes(language), {
		subset: true,
	});
	for (const pageData of pages) {
		const pdfWidth = pageData.pdfWidth ?? PDF_WIDTH;
		const pdfHeight = pageData.pdfHeight ?? PDF_HEIGHT;
		const page = document.addPage([pdfWidth, pdfHeight]);
		const image = await document.embedJpg(pageData.bytes);
		page.drawImage(image, { x: 0, y: 0, width: pdfWidth, height: pdfHeight });
		const scaleX = pdfWidth / pageData.width;
		const scaleY = pdfHeight / pageData.height;
		for (const item of pageData.text) {
			for (const line of item.value.split(/\r?\n/)) {
				if (!line) continue;
				page.drawText(line, {
					font,
					size: Math.max(1, item.fontSize * scaleY),
					x: item.x * scaleX,
					y: pdfHeight - item.y * scaleY,
					maxWidth: item.maxWidth * scaleX,
					opacity: 0,
				});
			}
		}
	}
	return new Blob([await document.save()], { type: "application/pdf" });
}

function backgroundColor(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
): string {
	const points = [
		[x - 2, y - 2],
		[x + width + 2, y - 2],
		[x - 2, y + height + 2],
		[x + width + 2, y + height + 2],
	];
	const samples: number[][] = [];
	for (const [sampleX, sampleY] of points) {
		const safeX = Math.max(0, Math.min(context.canvas.width - 1, sampleX));
		const safeY = Math.max(0, Math.min(context.canvas.height - 1, sampleY));
		try {
			samples.push(Array.from(context.getImageData(safeX, safeY, 1, 1).data));
		} catch {
			return "rgb(255, 255, 255)";
		}
	}
	const channel = (index: number) =>
		Math.round(
			samples.reduce((total, sample) => total + sample[index], 0) /
				samples.length,
		);
	return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

function fitWrappedText(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	maxHeight: number,
	preferredSize: number,
): { fontSize: number; lineHeight: number; lines: string[] } {
	let fontSize = Math.max(6, preferredSize);
	while (fontSize >= 6) {
		context.font = `${fontSize}px Arial, sans-serif`;
		const lines = wrapDeliveryText(context, text, maxWidth);
		const lineHeight = fontSize * 1.18;
		if (lines.length * lineHeight <= maxHeight)
			return { fontSize, lineHeight, lines };
		fontSize -= 0.5;
	}
	context.font = "6px Arial, sans-serif";
	return {
		fontSize: 6,
		lineHeight: 7.08,
		lines: wrapDeliveryText(context, text, maxWidth),
	};
}

function targetIsRtl(language: string): boolean {
	return ["ar", "dv", "fa", "he", "ps", "sd", "ug", "ur", "yi"].includes(
		targetLanguageCode(language),
	);
}

function wrapDeliveryText(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string[] {
	const output: string[] = [];
	for (const paragraph of text.split(/\r?\n/)) {
		if (!paragraph.trim()) {
			output.push("");
			continue;
		}
		let line = "";
		for (const word of paragraph.split(/\s+/)) {
			const candidate = line ? `${line} ${word}` : word;
			if (context.measureText(candidate).width <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) output.push(line);
			line = word;
			while (context.measureText(line).width > maxWidth && line.length > 1) {
				let boundary = line.length - 1;
				while (
					boundary > 1 &&
					context.measureText(line.slice(0, boundary)).width > maxWidth
				)
					boundary -= 1;
				output.push(line.slice(0, boundary));
				line = line.slice(boundary);
			}
		}
		if (line) output.push(line);
	}
	return output;
}

/** Builds a clean target-language PDF when the source format is not itself PDF. */
export async function buildSegmentDeliveryPdf(
	project: UserData,
): Promise<Blob> {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const rtl = targetIsRtl(data.targetLang);
	const pages: SearchableJpegPage[] = [];
	const margin = 90;
	const maxWidth = DELIVERY_WIDTH - margin * 2;
	const lineHeight = 42;
	let canvas!: HTMLCanvasElement;
	let context!: CanvasRenderingContext2D;
	let y = 0;
	let pageText: SearchableJpegPage["text"] = [];

	function startPage() {
		canvas = document.createElement("canvas");
		canvas.width = DELIVERY_WIDTH;
		canvas.height = DELIVERY_HEIGHT;
		const pageContext = canvas.getContext("2d");
		if (!pageContext) throw new Error("This browser cannot render PDF pages.");
		context = pageContext;
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, DELIVERY_WIDTH, DELIVERY_HEIGHT);
		context.fillStyle = "#173f50";
		context.font = "700 32px Arial, sans-serif";
		context.textAlign = rtl ? "right" : "left";
		context.direction = rtl ? "rtl" : "ltr";
		context.fillText(
			data.name || "Translation",
			rtl ? DELIVERY_WIDTH - margin : margin,
			78,
			maxWidth,
		);
		context.fillStyle = "#667f88";
		context.font = "20px Arial, sans-serif";
		context.fillText(
			data.targetLang || "Translated document",
			rtl ? DELIVERY_WIDTH - margin : margin,
			116,
			maxWidth,
		);
		context.fillStyle = "#d8e8ec";
		context.fillRect(margin, 142, maxWidth, 2);
		y = 195;
		pageText = [];
	}

	function finishPage() {
		context.fillStyle = "#7b9097";
		context.font = "18px Arial, sans-serif";
		context.textAlign = "center";
		context.direction = "ltr";
		context.fillText(String(pages.length + 1), DELIVERY_WIDTH / 2, 1690);
		pages.push({
			bytes: canvasJpeg(canvas),
			width: canvas.width,
			height: canvas.height,
			text: pageText,
		});
	}

	startPage();
	context.fillStyle = "#243f49";
	context.font = "28px Arial, sans-serif";
	for (const segment of data.seg2) {
		const lines = wrapDeliveryText(context, segment ?? "", maxWidth);
		const requiredHeight = Math.max(lineHeight, lines.length * lineHeight) + 24;
		if (y + requiredHeight > 1630) {
			finishPage();
			startPage();
			context.fillStyle = "#243f49";
			context.font = "28px Arial, sans-serif";
		}
		context.textAlign = rtl ? "right" : "left";
		context.direction = rtl ? "rtl" : "ltr";
		const textStartY = y;
		for (const line of lines.length ? lines : [""]) {
			context.fillText(
				line,
				rtl ? DELIVERY_WIDTH - margin : margin,
				y,
				maxWidth,
			);
			y += lineHeight;
		}
		if (segment?.trim()) {
			pageText.push({
				value: segment,
				x: margin,
				y: textStartY,
				fontSize: 28,
				maxWidth,
			});
		}
		y += 24;
	}
	finishPage();
	return buildSearchableJpegPdf(pages, data.targetLang);
}

export async function buildTranslatedPdf(project: UserData): Promise<Blob> {
	assertProjectExportQuality(project);
	const data = project.translationData;
	if (data.type !== "pdf")
		throw new Error("PDF export requires a PDF project.");
	if (
		data.seg1.length !== data.seg2.length ||
		data.segmentsMeta?.length !== data.seg1.length ||
		!data.segmentsMeta.every(isPdfMeta)
	) {
		throw new Error(
			"PDF export cannot continue because page mappings are missing.",
		);
	}

	const originalFile = data.skeleton?.source.originalFile;
	if (!(originalFile instanceof Blob)) {
		throw new Error(
			"The original PDF is missing from this project. Reimport it once to enable layout-preserving PDF export.",
		);
	}
	const originalBytes = new Uint8Array(await originalFile.arrayBuffer());
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	if (!pdfjs.GlobalWorkerOptions.workerSrc) {
		pdfjs.GlobalWorkerOptions.workerSrc = new URL(
			"pdfjs-dist/legacy/build/pdf.worker.mjs",
			import.meta.url,
		).toString();
	}
	const loadingTask = pdfjs.getDocument({
		data: originalBytes.slice(),
		useSystemFonts: true,
		useWorkerFetch: false,
		useWasm: false,
	});
	const originalDocument = await loadingTask.promise;
	const metadata = data.segmentsMeta as PdfSegmentMeta[];
	const rtl = targetIsRtl(data.targetLang);
	const outputPages: SearchableJpegPage[] = [];
	try {
		for (
			let pageNumber = 1;
			pageNumber <= originalDocument.numPages;
			pageNumber += 1
		) {
			const page = await originalDocument.getPage(pageNumber);
			const viewport = page.getViewport({ scale: 1.75 });
			const sourceCanvas = document.createElement("canvas");
			sourceCanvas.width = Math.ceil(viewport.width);
			sourceCanvas.height = Math.ceil(viewport.height);
			const sourceContext = sourceCanvas.getContext("2d");
			if (!sourceContext)
				throw new Error("This browser cannot render PDF pages.");
			await page.render({
				canvas: sourceCanvas,
				canvasContext: sourceContext,
				viewport,
				background: "rgb(255, 255, 255)",
			}).promise;

			const searchableText: SearchableJpegPage["text"] = [];
			for (const [index, entry] of metadata.entries()) {
				if (entry.page !== pageNumber) continue;
				const translation = data.seg2[index]?.trim() ?? "";
				if (!translation || translation === data.seg1[index]) continue;
				const [x, y, width, height] = entry.bbox;
				const topLeft = viewport.convertToViewportPoint(x, y + height);
				const bottomRight = viewport.convertToViewportPoint(x + width, y);
				const rectangle = [
					topLeft[0],
					topLeft[1],
					bottomRight[0],
					bottomRight[1],
				];
				const left = Math.min(rectangle[0], rectangle[2]);
				const top = Math.min(rectangle[1], rectangle[3]);
				const boxWidth = Math.max(2, Math.abs(rectangle[2] - rectangle[0]));
				const boxHeight = Math.max(2, Math.abs(rectangle[3] - rectangle[1]));
				const padding = Math.max(2, viewport.scale);
				sourceContext.save();
				sourceContext.beginPath();
				sourceContext.rect(
					left - padding,
					top - padding,
					boxWidth + padding * 2,
					boxHeight + padding * 2,
				);
				sourceContext.clip();
				sourceContext.fillStyle = backgroundColor(
					sourceContext,
					left,
					top,
					boxWidth,
					boxHeight,
				);
				sourceContext.fillRect(
					left - padding,
					top - padding,
					boxWidth + padding * 2,
					boxHeight + padding * 2,
				);
				const layout = fitWrappedText(
					sourceContext,
					translation,
					boxWidth,
					boxHeight,
					boxHeight * 0.92,
				);
				sourceContext.font = `${layout.fontSize}px Arial, sans-serif`;
				sourceContext.fillStyle = "#111111";
				sourceContext.textBaseline = "top";
				sourceContext.direction = rtl ? "rtl" : "ltr";
				sourceContext.textAlign = rtl ? "right" : "left";
				const blockHeight = layout.lines.length * layout.lineHeight;
				let textY = top + Math.max(0, (boxHeight - blockHeight) / 2);
				for (const line of layout.lines) {
					sourceContext.fillText(
						line,
						rtl ? left + boxWidth : left,
						textY,
						boxWidth,
					);
					textY += layout.lineHeight;
				}
				sourceContext.restore();
				searchableText.push({
					value: translation,
					x: left,
					y: top + layout.fontSize,
					fontSize: layout.fontSize,
					maxWidth: boxWidth,
				});
			}
			outputPages.push({
				bytes: canvasJpeg(sourceCanvas),
				width: sourceCanvas.width,
				height: sourceCanvas.height,
				pdfWidth: viewport.width / viewport.scale,
				pdfHeight: viewport.height / viewport.scale,
				text: searchableText,
			});
			page.cleanup();
		}
		return await buildSearchableJpegPdf(outputPages, data.targetLang);
	} finally {
		await loadingTask.destroy();
	}
}

export async function generateTranslatedPdf(project: UserData): Promise<void> {
	const blob = await buildTranslatedPdf(project);
	const base = (project.translationData.name || "translation").replace(
		/\.pdf$/i,
		"",
	);
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${base}.translated.pdf`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
