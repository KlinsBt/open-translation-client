import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import type { PdfSegmentMeta, UserData } from "$lib/types/types";

interface JpegPage {
	bytes: Uint8Array;
	width: number;
	height: number;
	pdfWidth?: number;
	pdfHeight?: number;
}

const PDF_WIDTH = 595.28;
const PDF_HEIGHT = 841.89;

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

function fitFontSize(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
	preferredSize: number,
): number {
	let size = Math.max(8, preferredSize);
	while (size > 8) {
		context.font = `${size}px Arial, sans-serif`;
		if (context.measureText(text).width <= maxWidth) break;
		size -= 0.5;
	}
	return size;
}

function targetIsRtl(language: string): boolean {
	const code = language.match(/\(([^)]+)\)\s*$/)?.[1] ?? language;
	return ["ar", "dv", "fa", "he", "ps", "ur", "yi"].includes(
		code.toLowerCase().split(/[-_]/)[0],
	);
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
	const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
	if (!pdfjs.GlobalWorkerOptions.workerSrc) {
		pdfjs.GlobalWorkerOptions.workerSrc = new URL(
			"pdfjs-dist/legacy/build/pdf.worker.mjs",
			import.meta.url,
		).toString();
	}
	const loadingTask = pdfjs.getDocument({
		data: new Uint8Array(await originalFile.arrayBuffer()),
		useSystemFonts: true,
		useWorkerFetch: false,
		useWasm: false,
	});
	const originalDocument = await loadingTask.promise;
	const metadata = data.segmentsMeta as PdfSegmentMeta[];
	const renderedPages: JpegPage[] = [];
	const rtl = targetIsRtl(data.targetLang);
	try {
		for (
			let pageNumber = 1;
			pageNumber <= originalDocument.numPages;
			pageNumber += 1
		) {
			const page = await originalDocument.getPage(pageNumber);
			const pdfViewport = page.getViewport({ scale: 1 });
			const viewport = page.getViewport({ scale: 1.75 });
			const canvas = document.createElement("canvas");
			canvas.width = Math.ceil(viewport.width);
			canvas.height = Math.ceil(viewport.height);
			const context = canvas.getContext("2d");
			if (!context) throw new Error("This browser cannot render PDF pages.");
			await page.render({
				canvas,
				canvasContext: context,
				viewport,
				background: "rgb(255, 255, 255)",
			}).promise;

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
				context.fillStyle = backgroundColor(
					context,
					left,
					top,
					boxWidth,
					boxHeight,
				);
				context.fillRect(
					left - padding,
					top - padding,
					boxWidth + padding * 2,
					boxHeight + padding * 2,
				);
				const fontSize = fitFontSize(
					context,
					translation,
					boxWidth,
					boxHeight * 0.92,
				);
				context.font = `${fontSize}px Arial, sans-serif`;
				context.fillStyle = "#111111";
				context.textBaseline = "middle";
				context.direction = rtl ? "rtl" : "ltr";
				context.textAlign = rtl ? "right" : "left";
				context.fillText(
					translation,
					rtl ? left + boxWidth : left,
					top + boxHeight / 2,
					boxWidth,
				);
			}

			renderedPages.push({
				bytes: canvasJpeg(canvas),
				width: canvas.width,
				height: canvas.height,
				pdfWidth: pdfViewport.width,
				pdfHeight: pdfViewport.height,
			});
			page.cleanup();
		}
		return buildJpegPdf(renderedPages);
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
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
