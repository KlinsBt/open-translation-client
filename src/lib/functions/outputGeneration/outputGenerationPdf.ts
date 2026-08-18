import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import type { PdfSegmentMeta, UserData } from "$lib/types/types";

interface JpegPage {
	bytes: Uint8Array;
	width: number;
	height: number;
}

const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;
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
		const pageObject = 3 + index * 3;
		const imageObject = pageObject + 1;
		const contentObject = pageObject + 2;
		objects[pageObject] = ascii(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_WIDTH} ${PDF_HEIGHT}] /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>`,
		);
		objects[imageObject] = concatBytes([
			ascii(
				`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
			),
			page.bytes,
			ascii("\nendstream"),
		]);
		const commands = `q\n${PDF_WIDTH} 0 0 ${PDF_HEIGHT} 0 0 cm\n/Im0 Do\nQ`;
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

function wrapText(
	context: CanvasRenderingContext2D,
	text: string,
	maxWidth: number,
): string[] {
	const paragraphs = text.split(/\r?\n/);
	const lines: string[] = [];
	for (const paragraph of paragraphs) {
		if (!paragraph) {
			lines.push("");
			continue;
		}
		let line = "";
		for (const word of paragraph.split(/\s+/)) {
			const candidate = line ? `${line} ${word}` : word;
			if (context.measureText(candidate).width <= maxWidth) {
				line = candidate;
				continue;
			}
			if (line) lines.push(line);
			if (context.measureText(word).width <= maxWidth) {
				line = word;
				continue;
			}
			let fragment = "";
			for (const character of word) {
				if (context.measureText(fragment + character).width > maxWidth) {
					lines.push(fragment);
					fragment = character;
				} else {
					fragment += character;
				}
			}
			line = fragment;
		}
		if (line) lines.push(line);
	}
	return lines;
}

function canvasJpeg(canvas: HTMLCanvasElement): Uint8Array {
	const encoded = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
	const binary = atob(encoded);
	return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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

	const measureCanvas = document.createElement("canvas");
	const measureContext = measureCanvas.getContext("2d");
	if (!measureContext) throw new Error("This browser cannot render PDF pages.");
	measureContext.font = "30px Arial, sans-serif";
	const items = (data.segmentsMeta as PdfSegmentMeta[]).map(
		(metadata, index) => ({
			page: metadata.page,
			segment: data.seg2[index]?.trim() || data.seg1[index] || "",
			index,
		}),
	);
	const renderedPages: JpegPage[] = [];
	let sourcePage = 0;
	let canvas!: HTMLCanvasElement;
	let context!: CanvasRenderingContext2D;
	let y = 0;

	function startPage(continuation = false) {
		canvas = document.createElement("canvas");
		canvas.width = PAGE_WIDTH;
		canvas.height = PAGE_HEIGHT;
		const nextContext = canvas.getContext("2d");
		if (!nextContext) throw new Error("This browser cannot render PDF pages.");
		context = nextContext;
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
		context.fillStyle = "#173f50";
		context.font = "700 26px Arial, sans-serif";
		context.fillText(data.name || "Translated PDF", 80, 72);
		context.fillStyle = "#6d838b";
		context.font = "20px Arial, sans-serif";
		context.fillText(
			`Translated page ${sourcePage}${continuation ? " — continued" : ""}`,
			80,
			106,
		);
		context.fillStyle = "#d8e8ec";
		context.fillRect(80, 128, PAGE_WIDTH - 160, 2);
		y = 178;
	}

	function finishPage() {
		renderedPages.push({
			bytes: canvasJpeg(canvas),
			width: canvas.width,
			height: canvas.height,
		});
	}

	for (const item of items) {
		if (!renderedPages.length && !sourcePage) {
			sourcePage = item.page;
			startPage();
		} else if (item.page !== sourcePage) {
			finishPage();
			sourcePage = item.page;
			startPage();
		}
		context.font = "30px Arial, sans-serif";
		const lines = wrapText(context, item.segment, PAGE_WIDTH - 190);
		const blockHeight = Math.max(58, lines.length * 42 + 34);
		if (y + blockHeight > PAGE_HEIGHT - 95) {
			finishPage();
			startPage(true);
		}
		context.fillStyle = "#2b829a";
		context.font = "700 18px Arial, sans-serif";
		context.fillText(String(item.index + 1).padStart(2, "0"), 80, y + 8);
		context.fillStyle = "#243f49";
		context.font = "30px Arial, sans-serif";
		for (const line of lines.length ? lines : [""]) {
			context.fillText(line, 145, y + 8);
			y += 42;
		}
		y += 28;
	}
	if (!items.length) {
		sourcePage = 1;
		startPage();
	}
	finishPage();
	return buildJpegPdf(renderedPages);
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
