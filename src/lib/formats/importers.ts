import JSZip from "jszip";
import { segmentDocxXml } from "$lib/functions/parsing/parsingDocx";
import { segmentHtmlContent } from "$lib/functions/parsing/parsingHtml";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import { segmentWorkbookStrings } from "$lib/functions/parsing/parsingXlsx";
import { createTextSegmentsWithRegexGeneralTextAlgo } from "$lib/functions/parsing/parsingText";
import type { FormatImportResult, FormatValidationResult } from "./types";
import type { TypeRef } from "$lib/types/types";
import { createNeutralDocument, type SourceLocation } from "./documentModel";

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
	const sourceSegments = segments.map(
		(segment) => `${segment.text}${segment.separator ?? ""}`,
	);
	return {
		kind: "segments",
		segments: sourceSegments,
		document: createNeutralDocument({
			format: "docx",
			sourceSegments,
			sourceLocations: meta.map((entry, index) => ({
				part: "word/document.xml",
				paragraph: entry.fragments[0]?.paragraphIndex,
				segmentIndex: index,
				metadata: {
					fragments: entry.fragments.map((fragment) => ({ ...fragment })),
				},
			})),
		}),
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
		document: createNeutralDocument({
			format: "json",
			sourceSegments: segments,
			sourceLocations: meta.map((entry, index) => ({
				part: file.name,
				path: entry.path,
				segmentIndex: index,
			})),
		}),
		typeRef: { data: jsonData, meta } as unknown as TypeRef,
		segmentsMeta: meta,
	};
}

export async function validateTextFile(): Promise<FormatValidationResult> {
	return { valid: true };
}

export async function importTextFile(file: File): Promise<FormatImportResult> {
	const text = await file.text();
	const [segments] = createTextSegmentsWithRegexGeneralTextAlgo(text);
	return {
		kind: "text",
		text,
		document: createNeutralDocument({
			format: "text",
			sourceSegments: segments,
			sourceLocations: segments.map((_, index) => ({
				part: file.name,
				segmentIndex: index,
			})),
		}),
	};
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

	const workbook = segmentWorkbookStrings(content);
	const { allSegments } = workbook;
	const sourceLocations: SourceLocation[] = [];
	for (const [index] of workbook.shared.segments.entries()) {
		sourceLocations.push({
			part: "xl/sharedStrings.xml",
			segmentIndex: sourceLocations.length,
			metadata: { sharedStringSegment: index },
		});
	}
	for (const sheet of workbook.sheets) {
		for (const segment of sheet.inlineSegments) {
			sourceLocations.push({
				part: sheet.sheetPath,
				segmentIndex: sourceLocations.length,
				metadata: { fragmentCount: segment.fragments.length },
			});
		}
		for (const _segment of sheet.valueSegments) {
			sourceLocations.push({
				part: sheet.sheetPath,
				segmentIndex: sourceLocations.length,
			});
		}
	}
	return {
		kind: "segments",
		segments: allSegments,
		document: createNeutralDocument({
			format: "xlsx",
			sourceSegments: allSegments,
			sourceLocations,
		}),
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
		document: createNeutralDocument({
			format: "html",
			sourceSegments: allSegments,
			sourceLocations: meta.map(
				(entry, index) =>
					({
						part: file.name,
						path: entry.path,
						segmentIndex: index,
						metadata:
							entry.kind === "attribute"
								? { kind: entry.kind, attribute: entry.attribute }
								: { kind: entry.kind },
					}) satisfies SourceLocation,
			),
		}),
		typeRef: html,
		segmentsMeta: meta,
	};
}
