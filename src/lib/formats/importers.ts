import JSZip from "jszip";
import { segmentDocxXml } from "$lib/functions/parsing/parsingDocx";
import { segmentHtmlContent } from "$lib/functions/parsing/parsingHtml";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import { segmentWorkbookStrings } from "$lib/functions/parsing/parsingXlsx";
import { createTextSegmentsWithRegexGeneralTextAlgo } from "$lib/functions/parsing/parsingText";
import type { FormatImportResult, FormatValidationResult } from "./types";
import type { TypeRef } from "$lib/types/types";
import { createNeutralDocument, type SourceLocation } from "./documentModel";
import {
	createPackageSkeleton,
	createPlainTextSkeleton,
	createTextSkeleton,
	findJsonPrimitiveLocations,
	type DocxTextReplacement,
	type HtmlAttributeReplacement,
	type HtmlTextReplacement,
	type JsonValueReplacement,
	type XlsxTextReplacement,
} from "./skeleton";

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
	const replacements: DocxTextReplacement[] = meta.map((entry, unitIndex) => ({
		kind: "docx-text",
		unitIndex,
		part: "word/document.xml",
		separator: entry.separator,
		fragments: entry.fragments.map((fragment) => ({ ...fragment })),
	}));
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
		skeleton: await createPackageSkeleton(file, "docx", content, replacements),
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
	const content = await file.text();
	const jsonData = JSON.parse(content);
	const segments: string[] = [];
	const meta: { path: string[]; separator?: string }[] = [];
	const replacements: JsonValueReplacement[] = [];
	for (const location of findJsonPrimitiveLocations(content)) {
		const text = String(location.value);
		const pieces = splitTextWithPreferences(text).filter(
			(piece) => piece.text.trim().length > 0,
		);
		const effectivePieces =
			pieces.length > 0 ? pieces : [{ text, separator: "" }];
		for (const piece of effectivePieces) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			meta.push({
				path: [...location.path],
				separator: piece.separator ?? "",
			});
			replacements.push({
				kind: "json-value",
				unitIndex,
				path: [...location.path],
				start: location.start,
				end: location.end,
				valueType: location.valueType,
				separator: piece.separator ?? "",
			});
		}
	}
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
		skeleton: await createTextSkeleton(file, "json", content, replacements),
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
		skeleton: await createPlainTextSkeleton(file, text, segments),
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
	const replacements: XlsxTextReplacement[] = [];
	for (const [index] of workbook.shared.segments.entries()) {
		sourceLocations.push({
			part: "xl/sharedStrings.xml",
			segmentIndex: sourceLocations.length,
			metadata: { sharedStringSegment: index },
		});
		replacements.push({
			kind: "xlsx-text",
			unitIndex: replacements.length,
			part: "xl/sharedStrings.xml",
			storage: "shared-string",
			localIndex: index,
		});
	}
	for (const sheet of workbook.sheets) {
		for (const [localIndex, segment] of sheet.inlineSegments.entries()) {
			sourceLocations.push({
				part: sheet.sheetPath,
				segmentIndex: sourceLocations.length,
				metadata: { fragmentCount: segment.fragments.length },
			});
			replacements.push({
				kind: "xlsx-text",
				unitIndex: replacements.length,
				part: sheet.sheetPath,
				storage: "inline-string",
				localIndex,
			});
		}
		for (const [localIndex] of sheet.valueSegments.entries()) {
			sourceLocations.push({
				part: sheet.sheetPath,
				segmentIndex: sourceLocations.length,
			});
			replacements.push({
				kind: "xlsx-text",
				unitIndex: replacements.length,
				part: sheet.sheetPath,
				storage: "cell-value",
				localIndex,
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
		skeleton: await createPackageSkeleton(file, "xlsx", content, replacements),
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
	const replacements = meta.map((entry, unitIndex) =>
		entry.kind === "attribute"
			? ({
					kind: "html-attribute",
					unitIndex,
					path: [...entry.path],
					attribute: entry.attribute,
					separator: entry.separator,
				} satisfies HtmlAttributeReplacement)
			: ({
					kind: "html-text",
					unitIndex,
					path: [...entry.path],
					separator: entry.separator,
				} satisfies HtmlTextReplacement),
	);
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
		skeleton: await createTextSkeleton(file, "html", html, replacements),
		typeRef: html,
		segmentsMeta: meta,
	};
}
