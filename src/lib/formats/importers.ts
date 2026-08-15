import JSZip from "jszip";
import { segmentDocxXml } from "$lib/functions/parsing/parsingDocx";
import { segmentHtmlContent } from "$lib/functions/parsing/parsingHtml";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import { segmentWorkbookStrings } from "$lib/functions/parsing/parsingXlsx";
import type { FormatImportResult, FormatValidationResult } from "./types";
import type { TypeRef } from "$lib/types/types";

type PackageContent = { [key: string]: string | Blob };

async function readZipPackage(file: File): Promise<PackageContent> {
	const zip = await JSZip.loadAsync(await file.arrayBuffer());
	const content: PackageContent = {};

	for (const [filePath, entry] of Object.entries(zip.files)) {
		const isMedia =
			filePath.startsWith("word/media") || filePath.startsWith("xl/media");
		content[filePath] = await entry.async(isMedia ? "blob" : "string");
	}

	return content;
}

export async function validateDocxFile(
	file: File,
): Promise<FormatValidationResult> {
	try {
		const zip = await JSZip.loadAsync(await file.arrayBuffer());
		return zip.file("word/document.xml")
			? { valid: true }
			: { valid: false, reason: "The DOCX package has no word/document.xml." };
	} catch {
		return { valid: false, reason: "The file is not a readable DOCX package." };
	}
}

export async function importDocxFile(file: File): Promise<FormatImportResult> {
	const content = await readZipPackage(file);
	const documentXml = content["word/document.xml"];
	if (typeof documentXml !== "string") {
		throw new Error("The DOCX package has no word/document.xml.");
	}

	const { segments, meta } = segmentDocxXml(documentXml);
	return {
		kind: "segments",
		segments: segments.map(
			(segment) => `${segment.text}${segment.separator ?? ""}`,
		),
		typeRef: content,
		segmentsMeta: meta,
	};
}

export async function validateJsonFile(
	file: File,
): Promise<FormatValidationResult> {
	try {
		JSON.parse(await file.text());
		return { valid: true };
	} catch {
		return { valid: false, reason: "The file does not contain valid JSON." };
	}
}

export async function importJsonFile(file: File): Promise<FormatImportResult> {
	const jsonData = JSON.parse(await file.text());
	const segments: string[] = [];
	const meta: { path: string[]; separator?: string }[] = [];
	const pathStack: string[] = [];

	function traverse(value: unknown): void {
		if (typeof value !== "object" || value === null) return;

		for (const [key, child] of Object.entries(value)) {
			if (typeof child === "object" && child !== null) {
				pathStack.push(key);
				traverse(child);
				pathStack.pop();
				continue;
			}

			const text = String(child);
			const pieces = splitTextWithPreferences(text).filter(
				(piece) => piece.text.trim().length > 0,
			);
			if (pieces.length === 0) {
				segments.push(text);
				meta.push({ path: [...pathStack, key], separator: "" });
				continue;
			}

			for (const piece of pieces) {
				segments.push(`${piece.text}${piece.separator ?? ""}`);
				meta.push({
					path: [...pathStack, key],
					separator: piece.separator ?? "",
				});
			}
		}
	}

	traverse(jsonData);
	return {
		kind: "segments",
		segments,
		typeRef: { data: jsonData, meta } as unknown as TypeRef,
		segmentsMeta: meta,
	};
}

export async function validateTextFile(): Promise<FormatValidationResult> {
	return { valid: true };
}

export async function importTextFile(file: File): Promise<FormatImportResult> {
	return { kind: "text", text: await file.text() };
}

export async function validateXlsxFile(
	file: File,
): Promise<FormatValidationResult> {
	try {
		const zip = await JSZip.loadAsync(await file.arrayBuffer());
		return zip.file("xl/workbook.xml")
			? { valid: true }
			: { valid: false, reason: "The XLSX package has no xl/workbook.xml." };
	} catch {
		return { valid: false, reason: "The file is not a readable XLSX package." };
	}
}

export async function importXlsxFile(file: File): Promise<FormatImportResult> {
	const content = await readZipPackage(file);
	if (typeof content["xl/workbook.xml"] !== "string") {
		throw new Error("The XLSX package has no xl/workbook.xml.");
	}

	const { allSegments } = segmentWorkbookStrings(content);
	return {
		kind: "segments",
		segments: allSegments,
		typeRef: content,
	};
}

export async function validateHtmlFile(
	file: File,
): Promise<FormatValidationResult> {
	const text = await file.text();
	return text.trim().length > 0
		? { valid: true }
		: { valid: false, reason: "The HTML file is empty." };
}

export async function importHtmlFile(file: File): Promise<FormatImportResult> {
	const html = await file.text();
	const { allSegments, meta } = segmentHtmlContent(html);
	return {
		kind: "segments",
		segments: allSegments,
		typeRef: html,
		segmentsMeta: meta,
	};
}
