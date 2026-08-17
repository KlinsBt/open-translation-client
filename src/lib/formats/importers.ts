import {
	segmentDocxParts,
	type DocxTrackedChangesPolicy,
} from "$lib/functions/parsing/parsingDocx";
import { segmentHtmlContent } from "$lib/functions/parsing/parsingHtml";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import { segmentWorkbookStrings } from "$lib/functions/parsing/parsingXlsx";
import { createTextSegmentsWithRegexGeneralTextAlgo } from "$lib/functions/parsing/parsingText";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
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
import {
	normalizeImportOptions,
	parseColumns,
	parseList,
	parsePositiveRanges,
	matchesJsonSelector,
} from "./options";
import {
	createSkeletonSource,
	parseSafeJson,
	readSafeTextFile,
	readSafeZipPackage,
	safeParseXml,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { readStreamingTextFile } from "./streaming";

function invalidResult(
	error: unknown,
	fallbackReason: string,
): FormatValidationResult {
	return error instanceof SafeInputError
		? { valid: false, reason: error.message, errorCode: error.code }
		: { valid: false, reason: fallbackReason };
}

export async function validateDocxFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { parts } = await readSafeZipPackage(file, context);
		const documentXml = parts["word/document.xml"];
		if (typeof documentXml !== "string") {
			return {
				valid: false,
				reason: "The DOCX package has no word/document.xml.",
			};
		}
		const document = safeParseXml(documentXml, context);
		if (document.documentElement.localName !== "document") {
			return {
				valid: false,
				reason: "word/document.xml has no Word document root element.",
			};
		}
		for (const [path, content] of Object.entries(parts)) {
			if (typeof content !== "string") continue;
			const expectedRoot =
				path === "[Content_Types].xml"
					? "Types"
					: /(?:^|\/)_rels\/[^/]+\.rels$/i.test(path)
						? "Relationships"
						: undefined;
			if (!expectedRoot) continue;
			const packageXml = safeParseXml(content, context);
			if (packageXml.documentElement.localName !== expectedRoot) {
				return {
					valid: false,
					reason: `${path} has an invalid package root element.`,
				};
			}
		}
		return { valid: true };
	} catch (error) {
		return invalidResult(error, "The file is not a readable DOCX package.");
	}
}

export async function importDocxFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("docx", options);
	const archive = await readSafeZipPackage(file, context);
	const content = archive.parts;
	const documentXml = content["word/document.xml"];
	if (typeof documentXml !== "string") {
		throw new Error("The DOCX package has no word/document.xml.");
	}

	const parsed = segmentDocxParts(content, undefined, {
		trackedChanges: filterOptions.trackedChanges as DocxTrackedChangesPolicy,
		includeHeadersFooters: Boolean(filterOptions.includeHeadersFooters),
		includeNotes: Boolean(filterOptions.includeNotes),
		includeComments: Boolean(filterOptions.includeComments),
		includeTextBoxes: Boolean(filterOptions.includeTextBoxes),
		includeDrawingText: Boolean(filterOptions.includeDrawingText),
	});
	const lastParagraph = parsed.meta
		.filter((entry) => entry.part === "word/document.xml")
		.reduce(
			(maximum, entry) =>
				Math.max(maximum, (entry.fragments[0]?.paragraphIndex ?? -1) + 1),
			0,
		);
	const paragraphs = parsePositiveRanges(
		filterOptions.paragraphs,
		lastParagraph,
	);
	const includedIndexes = parsed.meta
		.map((entry, index) => ({ entry, index }))
		.filter(({ entry }) => {
			const paragraph = entry.fragments[0]?.paragraphIndex;
			return (
				entry.part !== "word/document.xml" ||
				paragraphs === null ||
				(paragraph !== undefined && paragraphs.has(paragraph + 1))
			);
		});
	const segments = includedIndexes.map(({ index }) => parsed.segments[index]);
	const meta = includedIndexes.map(({ entry }) => entry);
	const sourceSegments = segments.map(
		(segment) => `${segment.text}${segment.separator ?? ""}`,
	);
	const replacements: DocxTextReplacement[] = meta.map((entry, unitIndex) => ({
		kind: "docx-text",
		unitIndex,
		part: entry.part ?? "word/document.xml",
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
				part: entry.part ?? "word/document.xml",
				paragraph: entry.fragments[0]?.paragraphIndex,
				segmentIndex: index,
				metadata: {
					fragments: entry.fragments.map((fragment) => ({ ...fragment })),
				},
			})),
		}),
		skeleton: await createPackageSkeleton(
			file,
			"docx",
			content,
			replacements,
			archive.source,
		),
		filterOptions,
		typeRef: content,
		segmentsMeta: meta,
	};
}

export async function validateJsonFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseSafeJson(text);
		return { valid: true };
	} catch (error) {
		return invalidResult(error, "The file does not contain valid JSON.");
	}
}

export async function importJsonFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("json", options);
	const selectors = parseList(filterOptions.pathSelectors);
	const read = await readSafeTextFile(file, context);
	const content = read.text;
	const jsonData = parseSafeJson(content);
	const segments: string[] = [];
	const meta: { path: string[]; separator?: string }[] = [];
	const replacements: JsonValueReplacement[] = [];
	for (const location of findJsonPrimitiveLocations(content)) {
		if (!matchesJsonSelector(location.path, selectors)) continue;
		if (
			filterOptions.includeNonStringValues === false &&
			location.valueType !== "string"
		)
			continue;
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
		skeleton: await createTextSkeleton(
			file,
			"json",
			content,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { data: jsonData, meta } as unknown as TypeRef,
		segmentsMeta: meta,
	};
}

export async function validateTextFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await readStreamingTextFile(file, context);
		return { valid: true };
	} catch (error) {
		return invalidResult(error, "The file is not readable text.");
	}
}

export async function importTextFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("text", options);
	const read = await readStreamingTextFile(file, context);
	const text = read.text;
	const mode = filterOptions.segmentationMode;
	let segments: string[];
	if (mode === "document") {
		segments = text.trim().length > 0 ? [text] : [];
	} else if (mode === "lines") {
		segments = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
	} else if (mode === "paragraphs") {
		segments = text
			.split(/(?:\r?\n){2,}/)
			.map((paragraph) => paragraph.trim())
			.filter(Boolean);
	} else {
		[segments] = createTextSegmentsWithRegexGeneralTextAlgo(text);
	}
	return {
		kind: "segments",
		segments,
		document: createNeutralDocument({
			format: "text",
			sourceSegments: segments,
			sourceLocations: segments.map((_, index) => ({
				part: file.name,
				segmentIndex: index,
			})),
		}),
		skeleton: await createPlainTextSkeleton(file, text, segments, {
			name: file.name,
			mimeType: file.type,
			encoding: read.encoding,
			hasBom: read.hasBom,
			originalFile: file,
		}),
		filterOptions,
	};
}

export async function validateXlsxFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { parts } = await readSafeZipPackage(file, context);
		const workbookXml = parts["xl/workbook.xml"];
		if (typeof workbookXml !== "string") {
			return {
				valid: false,
				reason: "The XLSX package has no xl/workbook.xml.",
			};
		}
		const workbook = safeParseXml(workbookXml, context);
		if (workbook.documentElement.localName !== "workbook") {
			return {
				valid: false,
				reason: "xl/workbook.xml has no SpreadsheetML workbook root.",
			};
		}
		for (const [path, content] of Object.entries(parts)) {
			if (typeof content !== "string") continue;
			const expectedRoot =
				path === "[Content_Types].xml"
					? "Types"
					: /(?:^|\/)_rels\/[^/]*\.rels$/i.test(path)
						? "Relationships"
						: /^xl\/worksheets\/[^/]+\.xml$/i.test(path)
							? "worksheet"
							: path === "xl/sharedStrings.xml"
								? "sst"
								: undefined;
			if (!expectedRoot) continue;
			const packageXml = safeParseXml(content, context);
			if (packageXml.documentElement.localName !== expectedRoot) {
				return {
					valid: false,
					reason: `${path} has an invalid package root element.`,
				};
			}
		}
		return { valid: true };
	} catch (error) {
		return invalidResult(error, "The file is not a readable XLSX package.");
	}
}

export async function importXlsxFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("xlsx", options);
	const archive = await readSafeZipPackage(file, context);
	const content = archive.parts;
	if (typeof content["xl/workbook.xml"] !== "string") {
		throw new Error("The XLSX package has no xl/workbook.xml.");
	}

	const workbook = segmentWorkbookStrings(content, undefined, {
		worksheetPaths: parseList(filterOptions.worksheetPaths),
		columns: parseColumns(filterOptions.columns),
		rows: parsePositiveRanges(filterOptions.rows),
		includeHiddenSheets: filterOptions.includeHiddenSheets === true,
		includeSharedStrings: filterOptions.includeSharedStrings === true,
		includeCellValues: filterOptions.includeCellValues === true,
	});
	const { allSegments } = workbook;
	const sourceLocations: SourceLocation[] = [];
	const replacements: XlsxTextReplacement[] = [];
	for (const [index] of workbook.shared.segments.entries()) {
		sourceLocations.push({
			part: "xl/sharedStrings.xml",
			segmentIndex: sourceLocations.length,
			metadata: {
				sharedStringSegment: index,
				sharedStringItem: workbook.shared.segments[index].itemIndex,
			},
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
		skeleton: await createPackageSkeleton(
			file,
			"xlsx",
			content,
			replacements,
			archive.source,
		),
		filterOptions,
		typeRef: content,
	};
}

export async function validateHtmlFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		return text.trim().length > 0
			? { valid: true }
			: { valid: false, reason: "The HTML file is empty." };
	} catch (error) {
		return invalidResult(error, "The HTML file is not readable text.");
	}
}

export async function importHtmlFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("html", options);
	const read = await readSafeTextFile(file, context);
	const html = read.text;
	const { allSegments, meta } = segmentHtmlContent(html, undefined, {
		includeTextNodes: filterOptions.includeTextNodes === true,
		translatableAttributes: parseList(filterOptions.translatableAttributes),
	});
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
		skeleton: await createTextSkeleton(
			file,
			"html",
			html,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: html,
		segmentsMeta: meta,
	};
}
