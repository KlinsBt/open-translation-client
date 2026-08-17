import {
	segmentDocxParts,
	type DocxTrackedChangesPolicy,
} from "$lib/functions/parsing/parsingDocx";
import { segmentHtmlContent } from "$lib/functions/parsing/parsingHtml";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import {
	getWorkbookCellComments,
	getWorkbookCellValues,
	segmentWorkbookStrings,
	type WorkbookCellComment,
	type WorkbookCellValue,
} from "$lib/functions/parsing/parsingXlsx";
import {
	segmentPlainText,
	type PlainTextSegmentationMode,
} from "$lib/functions/parsing/parsingText";
import {
	getPresentationComments,
	getPresentationSlides,
	segmentPresentationPackage,
} from "$lib/functions/parsing/parsingPptx";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import type { TypeRef } from "$lib/types/types";
import {
	createNeutralDocument,
	type NeutralDocument,
	type SourceLocation,
	type UnitContext,
	type UnitNote,
} from "./documentModel";
import {
	createPackageSkeleton,
	createTextSkeleton,
	findJsonPrimitiveLocations,
	type DocxTextReplacement,
	type HtmlAttributeReplacement,
	type HtmlTextReplacement,
	type JsonValueReplacement,
	type XlsxTextReplacement,
	type PptxTextReplacement,
	type TextRangeReplacement,
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

export async function validatePptxFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { parts } = await readSafeZipPackage(file, context);
		const presentationXml = parts["ppt/presentation.xml"];
		if (typeof presentationXml !== "string")
			return {
				valid: false,
				reason: "The PPTX package has no ppt/presentation.xml.",
			};
		const presentation = safeParseXml(presentationXml, context);
		if (presentation.documentElement.localName !== "presentation")
			return {
				valid: false,
				reason: "ppt/presentation.xml has no presentation root element.",
			};
		const slideIds = Array.from(presentation.getElementsByTagName("*")).filter(
			(element) => element.localName === "sldId",
		).length;
		const slides = getPresentationSlides(parts);
		if (slides.length !== slideIds)
			return {
				valid: false,
				reason:
					"One or more presentation slide relationships are missing or invalid.",
			};
		for (const slide of slides) {
			const xml = parts[slide.path];
			if (typeof xml !== "string")
				return {
					valid: false,
					reason: `The slide part ${slide.path} is missing.`,
				};
			if (safeParseXml(xml, context).documentElement.localName !== "sld")
				return {
					valid: false,
					reason: `${slide.path} has no slide root element.`,
				};
		}
		for (const [path, content] of Object.entries(parts)) {
			if (typeof content !== "string") continue;
			const expected =
				path === "[Content_Types].xml"
					? "Types"
					: /(?:^|\/)\_rels\/[^/]+\.rels$/i.test(path)
						? "Relationships"
						: undefined;
			if (
				expected &&
				safeParseXml(content, context).documentElement.localName !== expected
			)
				return {
					valid: false,
					reason: `${path} has an invalid package root element.`,
				};
		}
		return { valid: true };
	} catch (error) {
		return invalidResult(error, "The file is not a readable PPTX package.");
	}
}

export async function importPptxFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("pptx", options);
	const archive = await readSafeZipPackage(file, context);
	const content = archive.parts;
	if (typeof content["ppt/presentation.xml"] !== "string")
		throw new Error("The PPTX package has no ppt/presentation.xml.");
	const slideCatalog = getPresentationSlides(content);
	const parsed = segmentPresentationPackage(content, undefined, {
		slides: parsePositiveRanges(filterOptions.slides, slideCatalog.length),
		includeNotes: filterOptions.includeNotes === true,
		includeMastersLayouts: filterOptions.includeMastersLayouts === true,
		includeChartText: filterOptions.includeChartText === true,
		includeSmartArtText: filterOptions.includeSmartArtText === true,
		includeAltText: filterOptions.includeAltText === true,
	});
	const segments = parsed.segments.map(
		(segment) => `${segment.text}${segment.separator}`,
	);
	const meta = parsed.segments.map((segment) => segment.meta);
	const replacements: PptxTextReplacement[] = meta.map((entry, unitIndex) =>
		entry.kind === "text"
			? {
					kind: "pptx-text",
					unitIndex,
					part: entry.part,
					storage: "text",
					separator: entry.separator,
					fragments: entry.fragments.map((fragment) => ({ ...fragment })),
				}
			: {
					kind: "pptx-text",
					unitIndex,
					part: entry.part,
					storage: "attribute",
					elementIndex: entry.elementIndex,
					attribute: entry.attribute,
				},
	);
	const document = createNeutralDocument({
		format: "pptx",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, index) => ({
			part: entry.part,
			...(entry.kind === "text"
				? { paragraph: entry.fragments[0]?.paragraphIndex }
				: { path: [entry.elementIndex, entry.attribute] }),
			segmentIndex: index,
			metadata: { storage: entry.kind },
		})),
	});
	if (filterOptions.includeComments === true) {
		const comments = getPresentationComments(content, parsed.slides);
		document.metadata = {
			...document.metadata,
			pptxComments: comments.map((comment) => ({ ...comment })),
		};
		for (const comment of comments) {
			const unit = document.units.find(
				(entry) => entry.sourceLocation?.part === comment.slidePath,
			);
			if (unit)
				unit.notes.push({
					category: "pptx-slide-comment",
					text: comment.authorId
						? `[Author ${comment.authorId}] ${comment.text}`
						: comment.text,
				});
		}
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(
			file,
			"pptx",
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
	const mode = filterOptions.segmentationMode as PlainTextSegmentationMode;
	const parsedSegments = segmentPlainText(text, mode);
	const segments = parsedSegments.map((segment) => segment.text);
	const replacements = parsedSegments.map(
		(segment, unitIndex) =>
			({
				kind: "text-range",
				unitIndex,
				start: segment.start,
				end: segment.end,
				separator: segment.separator,
			}) satisfies TextRangeReplacement,
	);
	const document = createNeutralDocument({
		format: "text",
		sourceSegments: segments,
		sourceLocations: parsedSegments.map((segment, index) => ({
			part: file.name,
			line: segment.line,
			segmentIndex: index,
		})),
	});
	document.metadata = {
		encoding: read.encoding,
		hasBom: read.hasBom,
		newlineStyles: [...new Set(text.match(/\r\n|\n|\r/g) ?? [])],
	};
	for (const [index, segment] of parsedSegments.entries()) {
		const unit = document.units[index];
		if (!unit) continue;
		unit.source.direction = segment.direction;
		unit.contexts.push({ type: "text-direction", value: segment.direction });
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(file, "text", text, replacements, {
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

type XlsxImportMode = "all-text" | "key-value" | "multilingual-columns";

interface XlsxUnitAnnotation {
	contexts: UnitContext[];
	notes: UnitNote[];
	metadata: Record<string, unknown>;
}

interface XlsxModeImport {
	segments: string[];
	targetSegments: string[];
	sourceLocations: SourceLocation[];
	replacements: XlsxTextReplacement[];
	document: NeutralDocument;
}

function parseSingleXlsxColumn(
	value: FormatOptionValues[string] | undefined,
	label: string,
	optional = false,
): number | null {
	if (optional && !String(value ?? "").trim()) return null;
	const columns = parseColumns(value);
	if (!columns || columns.size !== 1)
		throw new Error(`${label} must contain exactly one Excel column letter.`);
	return [...columns][0];
}

function columnLetters(column: number): string {
	let value = column;
	let letters = "";
	while (value > 0) {
		value--;
		letters = String.fromCharCode(65 + (value % 26)) + letters;
		value = Math.floor(value / 26);
	}
	return letters;
}

function xlsxCellKey(sheetPath: string, cellReference: string): string {
	return `${sheetPath}\u0000${cellReference.toUpperCase()}`;
}

function commentsForCells(
	comments: ReadonlyMap<string, WorkbookCellComment[]>,
	cells: ReadonlyArray<Pick<WorkbookCellValue, "sheetPath" | "cellReference">>,
): UnitNote[] {
	const seen = new Set<string>();
	const notes: UnitNote[] = [];
	for (const cell of cells) {
		for (const comment of comments.get(
			xlsxCellKey(cell.sheetPath, cell.cellReference),
		) ?? []) {
			const text = comment.author
				? `${comment.author}: ${comment.text}`
				: comment.text;
			const key = `${comment.cellReference}\u0000${text}`;
			if (seen.has(key)) continue;
			seen.add(key);
			notes.push({
				category: "xlsx-cell-comment",
				text,
				appliesTo: "unit",
			});
		}
	}
	return notes;
}

function attachXlsxAnnotations(
	document: NeutralDocument,
	annotations: readonly XlsxUnitAnnotation[],
): NeutralDocument {
	return {
		...document,
		units: document.units.map((unit, index) => ({
			...unit,
			contexts: annotations[index]?.contexts ?? unit.contexts,
			notes: annotations[index]?.notes ?? unit.notes,
			metadata: {
				...unit.metadata,
				...(annotations[index]?.metadata ?? {}),
			},
		})),
	};
}

function importXlsxTableMode(
	content: Record<string, string | Blob>,
	filterOptions: FormatOptionValues,
	mode: Exclude<XlsxImportMode, "all-text">,
): XlsxModeImport {
	const keyColumn = parseSingleXlsxColumn(
		filterOptions.keyColumn,
		"Key/context column",
		mode === "multilingual-columns",
	);
	const sourceColumn = parseSingleXlsxColumn(
		filterOptions.sourceColumn,
		"Source/value column",
	)!;
	const targetColumn =
		mode === "multilingual-columns"
			? parseSingleXlsxColumn(filterOptions.targetColumn, "Target column")!
			: sourceColumn;
	if (sourceColumn === targetColumn && mode === "multilingual-columns")
		throw new Error("Source and target columns must be different.");
	if (keyColumn === sourceColumn || keyColumn === targetColumn)
		throw new Error(
			"Key/context, source, and target columns must be different.",
		);
	const headerRows = Math.max(
		0,
		Math.trunc(Number(filterOptions.headerRows) || 0),
	);
	const workbookFilter = {
		worksheetPaths: parseList(filterOptions.worksheetPaths),
		rows: parsePositiveRanges(filterOptions.rows),
		includeHiddenSheets: filterOptions.includeHiddenSheets === true,
	};
	const cells = getWorkbookCellValues(content, workbookFilter);
	const byCell = new Map(
		cells.map((cell) => [
			xlsxCellKey(cell.sheetPath, cell.cellReference),
			cell,
		]),
	);
	const comments = new Map<string, WorkbookCellComment[]>();
	if (filterOptions.includeCellComments === true) {
		for (const comment of getWorkbookCellComments(content, workbookFilter)) {
			const key = xlsxCellKey(comment.sheetPath, comment.cellReference);
			comments.set(key, [...(comments.get(key) ?? []), comment]);
		}
	}
	const sheetOrder = new Map<string, number>();
	for (const cell of cells)
		if (!sheetOrder.has(cell.sheetPath))
			sheetOrder.set(cell.sheetPath, sheetOrder.size);
	const sourceCells = cells
		.filter(
			(cell) =>
				cell.column === sourceColumn &&
				cell.row > headerRows &&
				!cell.isFormula &&
				cell.text.length > 0 &&
				(cell.storage !== "shared-string" ||
					filterOptions.includeSharedStrings === true) &&
				(cell.storage !== "cell-value" ||
					filterOptions.includeCellValues === true),
		)
		.sort(
			(first, second) =>
				(sheetOrder.get(first.sheetPath) ?? 0) -
					(sheetOrder.get(second.sheetPath) ?? 0) || first.row - second.row,
		);
	const segments: string[] = [];
	const targetSegments: string[] = [];
	const sourceLocations: SourceLocation[] = [];
	const replacements: XlsxTextReplacement[] = [];
	const annotations: XlsxUnitAnnotation[] = [];
	const unitIds: string[] = [];

	for (const sourceCell of sourceCells) {
		const keyCell =
			keyColumn === null
				? undefined
				: byCell.get(
						xlsxCellKey(
							sourceCell.sheetPath,
							`${columnLetters(keyColumn)}${sourceCell.row}`,
						),
					);
		if (mode === "key-value" && (!keyCell || !keyCell.text)) continue;
		const targetReference = `${columnLetters(targetColumn)}${sourceCell.row}`;
		const targetCell = byCell.get(
			xlsxCellKey(sourceCell.sheetPath, targetReference),
		);
		if (targetCell?.isFormula) continue;
		const targetText =
			mode === "multilingual-columns" ? (targetCell?.text ?? "") : "";
		const unitIndex = segments.length;
		segments.push(sourceCell.text);
		targetSegments.push(targetText);
		unitIds.push(`xlsx:${sourceCell.sheetPath}:${sourceCell.row}`);
		sourceLocations.push({
			part: sourceCell.sheetPath,
			sheet: sourceCell.sheetName,
			cell: sourceCell.cellReference,
			row: sourceCell.row,
			column: sourceCell.column,
			segmentIndex: unitIndex,
			metadata: {
				xlsxMode: mode,
				...(keyCell
					? { key: keyCell.text, keyCell: keyCell.cellReference }
					: {}),
				targetCell: targetReference,
			},
		});
		replacements.push({
			kind: "xlsx-text",
			unitIndex,
			part: sourceCell.sheetPath,
			storage: targetCell?.storage ?? "inline-string",
			localIndex: unitIndex,
			cellReference: targetReference,
			originalText:
				mode === "key-value" ? sourceCell.text : (targetCell?.text ?? ""),
		});
		const relatedCells = [sourceCell, ...(keyCell ? [keyCell] : [])];
		if (targetCell) relatedCells.push(targetCell);
		annotations.push({
			contexts: [
				{ type: "xlsx-sheet", value: sourceCell.sheetName },
				{ type: "xlsx-cell", value: sourceCell.cellReference },
				{ type: "xlsx-row", value: String(sourceCell.row) },
				...(keyCell
					? [{ type: "xlsx-key", value: keyCell.text } satisfies UnitContext]
					: []),
			],
			notes: commentsForCells(comments, relatedCells),
			metadata: {
				xlsxMode: mode,
				targetCell: targetReference,
				...(keyCell ? { key: keyCell.text } : {}),
			},
		});
	}
	const document = attachXlsxAnnotations(
		createNeutralDocument({
			format: "xlsx",
			sourceSegments: segments,
			targetSegments,
			sourceLocations,
			unitIds,
		}),
		annotations,
	);
	return {
		segments,
		targetSegments,
		sourceLocations,
		replacements,
		document,
	};
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
	const importMode = filterOptions.importMode as XlsxImportMode;
	if (importMode !== "all-text") {
		const table = importXlsxTableMode(content, filterOptions, importMode);
		return {
			kind: "segments",
			segments: table.segments,
			targetSegments: table.targetSegments,
			document: table.document,
			skeleton: await createPackageSkeleton(
				file,
				"xlsx",
				content,
				table.replacements,
				archive.source,
			),
			filterOptions,
			typeRef: content,
		};
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
	const annotations: XlsxUnitAnnotation[] = [];
	const comments = new Map<string, WorkbookCellComment[]>();
	if (filterOptions.includeCellComments === true) {
		for (const comment of getWorkbookCellComments(content, {
			worksheetPaths: parseList(filterOptions.worksheetPaths),
			rows: parsePositiveRanges(filterOptions.rows),
			includeHiddenSheets: filterOptions.includeHiddenSheets === true,
		})) {
			const key = xlsxCellKey(comment.sheetPath, comment.cellReference);
			comments.set(key, [...(comments.get(key) ?? []), comment]);
		}
	}
	for (const [index] of workbook.shared.segments.entries()) {
		const sharedSegment = workbook.shared.segments[index];
		const references = workbook.sheets.flatMap((sheet) =>
			sheet.sharedStringCells.filter(
				(reference) => reference.itemIndex === sharedSegment.itemIndex,
			),
		);
		const primary = references[0];
		sourceLocations.push({
			part: primary?.sheetPath ?? "xl/sharedStrings.xml",
			...(primary
				? {
						sheet: primary.sheetName,
						cell: primary.cellReference,
					}
				: {}),
			segmentIndex: sourceLocations.length,
			metadata: {
				sharedStringSegment: index,
				sharedStringItem: sharedSegment.itemIndex,
				cellReferences: references.map(
					(reference) => `${reference.sheetName}!${reference.cellReference}`,
				),
			},
		});
		annotations.push({
			contexts: references.map((reference) => ({
				type: "xlsx-cell",
				value: `${reference.sheetName}!${reference.cellReference}`,
			})),
			notes: commentsForCells(comments, references),
			metadata: {
				xlsxStorage: "shared-string",
				sharedStringItem: sharedSegment.itemIndex,
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
				sheet: sheet.sheetName,
				cell: segment.cellReference,
				...(segment.row !== null ? { row: segment.row } : {}),
				...(segment.column !== null ? { column: segment.column } : {}),
				segmentIndex: sourceLocations.length,
				metadata: { fragmentCount: segment.fragments.length },
			});
			annotations.push({
				contexts: [
					{ type: "xlsx-sheet", value: sheet.sheetName },
					{ type: "xlsx-cell", value: segment.cellReference },
				],
				notes: commentsForCells(comments, [segment]),
				metadata: { xlsxStorage: "inline-string" },
			});
			replacements.push({
				kind: "xlsx-text",
				unitIndex: replacements.length,
				part: sheet.sheetPath,
				storage: "inline-string",
				localIndex,
			});
		}
		for (const [localIndex, segment] of sheet.valueSegments.entries()) {
			sourceLocations.push({
				part: sheet.sheetPath,
				sheet: sheet.sheetName,
				cell: segment.cellReference,
				...(segment.row !== null ? { row: segment.row } : {}),
				...(segment.column !== null ? { column: segment.column } : {}),
				segmentIndex: sourceLocations.length,
			});
			annotations.push({
				contexts: [
					{ type: "xlsx-sheet", value: sheet.sheetName },
					{ type: "xlsx-cell", value: segment.cellReference },
				],
				notes: commentsForCells(comments, [segment]),
				metadata: { xlsxStorage: "cell-value" },
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
		document: attachXlsxAnnotations(
			createNeutralDocument({
				format: "xlsx",
				sourceSegments: allSegments,
				sourceLocations,
			}),
			annotations,
		),
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
		if (!text.trim())
			return { valid: false, reason: "The HTML file is empty." };
		if (
			/\.xhtml$/i.test(file.name) ||
			/application\/xhtml\+xml/i.test(file.type)
		) {
			const document = safeParseXml(
				text.replace(/<!doctype\s+html\s*>/i, ""),
				context,
			);
			if (document.documentElement.localName.toLowerCase() !== "html")
				return {
					valid: false,
					reason: "The XHTML document has no html root element.",
				};
		}
		return { valid: true };
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
		excludedElements: parseList(filterOptions.excludedElements),
		respectTranslateMetadata: filterOptions.respectTranslateMetadata === true,
	});
	const replacements = meta.map((entry, unitIndex) =>
		entry.kind === "attribute"
			? ({
					kind: "html-attribute",
					unitIndex,
					path: [...entry.path],
					attribute: entry.attribute,
					separator: entry.separator,
					start: entry.start,
					end: entry.end,
					sourceText: entry.sourceText,
					prefix: entry.prefix,
					suffix: entry.suffix,
					quote: entry.quote,
				} satisfies HtmlAttributeReplacement)
			: ({
					kind: "html-text",
					unitIndex,
					path: [...entry.path],
					separator: entry.separator,
					start: entry.start,
					end: entry.end,
					sourceText: entry.sourceText,
					prefix: entry.prefix,
					suffix: entry.suffix,
				} satisfies HtmlTextReplacement),
	);
	return {
		kind: "segments",
		segments: allSegments,
		document: (() => {
			const document = createNeutralDocument({
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
			});
			for (const [index, entry] of meta.entries()) {
				const unit = document.units[index];
				if (!unit) continue;
				if (entry.language) {
					unit.source.language = entry.language;
					unit.contexts.push({ type: "html-language", value: entry.language });
				}
				if (entry.direction) {
					unit.source.direction = entry.direction;
					unit.contexts.push({
						type: "html-direction",
						value: entry.direction,
					});
				}
				if (entry.note)
					unit.notes.push({
						category: "its-localization-note",
						text: entry.note,
					});
			}
			return document;
		})(),
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
