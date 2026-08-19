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
	segmentPlainTextAtBreaks,
	type PlainTextSegmentationMode,
} from "$lib/functions/parsing/parsingText";
import { getActiveSrxProfile } from "$lib/functions/parsing/parsingPreferences";
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
import type { CsvSegmentMeta, TypeRef } from "$lib/types/types";
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
	type DocxTextReplacement,
	type HtmlAttributeReplacement,
	type HtmlTextReplacement,
	type JsonValueReplacement,
	type XlsxTextReplacement,
	type PptxTextReplacement,
	type TextRangeReplacement,
	type CsvFieldReplacement,
} from "./skeleton";
import {
	normalizeImportOptions,
	parseColumns,
	parseList,
	parsePositiveRanges,
} from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	readSafeZipPackage,
	safeParseXml,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { readStreamingTextFile } from "./streaming";
import { findSrxBreakPositions, SrxValidationError } from "./srx20";
import {
	CsvParseError,
	isCsvFormulaInjection,
	parseCsv,
	resolveCsvColumn,
	resolveCsvDialect,
} from "./csv";
import { parseJsonSyntax, type JsonSyntaxDocument } from "./jsonSyntax";
import { extractJsonProfile, resolveJsonProfile } from "./jsonProfiles";

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
		const slides = getPresentationSlides(parts);
		if (!slides.length)
			return {
				valid: false,
				reason:
					"The package has neither a valid presentation slide list nor a standalone slide relationship.",
			};
		if (typeof presentationXml === "string") {
			if (/\.sldx$/i.test(file.name))
				return {
					valid: false,
					reason:
						"The .sldx extension is reserved for a standalone slide package, but this package contains a presentation deck.",
				};
			const presentation = safeParseXml(presentationXml, context);
			if (presentation.documentElement.localName !== "presentation")
				return {
					valid: false,
					reason: "ppt/presentation.xml has no presentation root element.",
				};
			const slideIds = Array.from(
				presentation.getElementsByTagName("*"),
			).filter((element) => element.localName === "sldId").length;
			if (slides.length !== slideIds)
				return {
					valid: false,
					reason:
						"One or more presentation slide relationships are missing or invalid.",
				};
		} else if (!/\.sldx$/i.test(file.name))
			return {
				valid: false,
				reason:
					"A standalone slide package must use the .sldx extension after its package relationship is verified.",
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
	const slideCatalog = getPresentationSlides(content);
	if (!slideCatalog.length)
		throw new Error(
			"The package has neither a valid presentation slide list nor a standalone slide relationship.",
		);
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
		parseLosslessJson(text);
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
	const read = await readSafeTextFile(file, context);
	const content = read.text;
	const syntax = parseLosslessJson(content);
	const profile = resolveJsonProfile(
		syntax,
		file.name,
		String(filterOptions.profile),
	);
	const extracted = extractJsonProfile(syntax, profile, filterOptions);
	const segments: string[] = [];
	const targetSegments: string[] = [];
	const meta: Array<{
		path: string[];
		address?: number[];
		start?: number;
		end?: number;
		originalValue?: string;
		valueType?: JsonValueReplacement["valueType"];
		profile?: typeof profile;
		key?: string;
		context?: string;
		separator?: string;
	}> = [];
	const replacements: JsonValueReplacement[] = [];
	const unitDetails: Array<(typeof extracted)[number]> = [];
	for (const extraction of extracted) {
		const text = extraction.sourceText;
		const segmentationMode =
			profile === "locjson" ? "value" : String(filterOptions.segmentationMode);
		const pieces =
			segmentationMode === "value"
				? [{ text, separator: "" }]
				: segmentationMode === "sentences"
					? segmentPlainText(text, "sentences")
					: splitTextWithPreferences(text);
		const visiblePieces = pieces.filter(
			(piece) => piece.text.trim().length > 0,
		);
		const effectivePieces =
			visiblePieces.length > 0 ? visiblePieces : [{ text, separator: "" }];
		for (const piece of effectivePieces) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			targetSegments.push(
				effectivePieces.length === 1 ? extraction.targetText : "",
			);
			const destination = extraction.destinationNodes[0];
			const originalValue = extraction.destinationNodes
				.map((node) =>
					node.valueType === "string" ? String(node.value) : node.raw,
				)
				.join("");
			meta.push({
				path: [...destination.path],
				address: [...destination.address],
				start: destination.start,
				end: destination.end,
				originalValue,
				valueType: destination.valueType,
				profile,
				...(extraction.key ? { key: extraction.key } : {}),
				...(extraction.context ? { context: extraction.context } : {}),
				separator: piece.separator ?? "",
			});
			replacements.push({
				kind: "json-value",
				unitIndex,
				path: [...destination.path],
				address: [...destination.address],
				start: destination.start,
				end: destination.end,
				valueType: destination.valueType,
				originalValue,
				profile,
				separator: piece.separator ?? "",
				...(extraction.destinationNodes.length > 1
					? {
							fragments: extraction.destinationNodes.map((node) => ({
								start: node.start,
								end: node.end,
								originalValue: String(node.value),
							})),
						}
					: {}),
			});
			unitDetails.push(extraction);
		}
	}
	const duplicateKeys = syntax.duplicateKeys.map((duplicate) => ({
		path: [...duplicate.path],
		occurrences: duplicate.occurrences,
	}));
	const document = createNeutralDocument({
		format: "json",
		sourceSegments: segments,
		targetSegments,
		sourceLocations: unitDetails.map((entry, index) => ({
			part: file.name,
			path: [...entry.sourceNodes[0].path],
			segmentIndex: index,
			metadata: {
				address: [...entry.sourceNodes[0].address],
				destinationPath: [...entry.destinationNodes[0].path],
			},
		})),
	});
	document.metadata = {
		profile,
		duplicateKeys,
		encoding: read.encoding,
		hasBom: read.hasBom,
		...(profile === "arb"
			? {
					locale:
						syntax.primitives.find(
							(node) =>
								node.valueType === "string" &&
								node.path.length === 1 &&
								node.path[0] === "@@locale",
						)?.value ?? null,
				}
			: {}),
	};
	for (const [index, details] of unitDetails.entries()) {
		const unit = document.units[index];
		if (!unit) continue;
		unit.contexts.push(...details.contexts.map((entry) => ({ ...entry })));
		if (details.key)
			unit.contexts.push({ type: "json-key", value: details.key });
		if (details.context)
			unit.contexts.push({ type: "json-context", value: details.context });
		unit.notes.push(...details.notes.map((note) => ({ ...note })));
		const duplicate = syntax.duplicateKeys.find((entry) =>
			entry.path.every(
				(part, pathIndex) => details.sourceNodes[0].path[pathIndex] === part,
			),
		);
		if (duplicate)
			unit.notes.push({
				category: "json-duplicate-key",
				appliesTo: "source",
				priority: 1,
				text: `The JSON key “${duplicate.key}” occurs ${duplicate.occurrences} times in this object. All occurrences are preserved, but consumers may choose different values.`,
			});
	}
	return {
		kind: "segments",
		segments,
		targetSegments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"json",
			content,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile, duplicateKeys } as unknown as TypeRef,
		segmentsMeta: meta,
	};
}

function parseLosslessJson(content: string): JsonSyntaxDocument {
	try {
		return parseJsonSyntax(content);
	} catch (error) {
		throw new SafeInputError(
			"JSON_MALFORMED",
			error instanceof Error
				? error.message
				: "The file does not contain valid JSON.",
		);
	}
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
	const activeSrx = mode === "srx" ? getActiveSrxProfile() : undefined;
	if (mode === "srx" && !activeSrx)
		throw new SrxValidationError(
			"Select an active SRX profile in Parsing preferences before importing TXT with SRX segmentation.",
		);
	const contentStart = text.startsWith("\ufeff") ? 1 : 0;
	const parsedSegments = activeSrx
		? segmentPlainTextAtBreaks(
				text,
				findSrxBreakPositions(
					text.slice(contentStart),
					activeSrx.document,
					activeSrx.languageCode,
				).map((position) => position + contentStart),
			)
		: segmentPlainText(text, mode);
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
		...(activeSrx
			? {
					segmentation: "srx-2.0",
					srxLanguageCode: activeSrx.languageCode,
					srxDocument: activeSrx.document,
				}
			: {}),
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

export async function validateCsvFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const options = normalizeImportOptions("csv");
		const read = await readSafeTextFile(file, context);
		const table = parseCsv(
			read.text,
			resolveCsvDialect(read.text, file.name, options),
		);
		if (table.rows.length === 0)
			return { valid: false, reason: "The CSV/TSV file is empty." };
		return { valid: true };
	} catch (error) {
		return invalidResult(
			error,
			error instanceof CsvParseError
				? error.message
				: "The file is not valid CSV or TSV text.",
		);
	}
}

export async function importCsvFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("csv", options);
	const read = await readSafeTextFile(file, context);
	const content = read.text;
	const table = parseCsv(
		content,
		resolveCsvDialect(content, file.name, filterOptions),
	);
	if (table.rows.length === 0) throw new Error("The CSV/TSV file is empty.");

	const hasHeader = Boolean(filterOptions.hasHeader);
	const header = hasHeader ? table.rows[0]?.fields : undefined;
	const dataRows = table.rows.slice(hasHeader ? 1 : 0);
	const mode = String(filterOptions.importMode);
	const sourceColumn = resolveCsvColumn(
		String(filterOptions.sourceColumn),
		header,
		"source",
	);
	const targetColumn = resolveCsvColumn(
		String(filterOptions.targetColumn),
		header,
		"target",
	);
	const keyColumn = resolveCsvColumn(
		String(filterOptions.keyColumn),
		header,
		"key",
	);
	const contextColumn = resolveCsvColumn(
		String(filterOptions.contextColumn),
		header,
		"context",
	);
	if (mode !== "all-text" && sourceColumn === undefined)
		throw new Error("Source-column modes require a source column.");
	if (mode === "multilingual-columns" && targetColumn === undefined)
		throw new Error("Multilingual-column mode requires a target column.");
	if (mode === "multilingual-columns" && sourceColumn === targetColumn)
		throw new Error("Source and target columns must be different.");

	const segments: string[] = [];
	const targetSegments: string[] = [];
	const replacements: CsvFieldReplacement[] = [];
	const meta: CsvSegmentMeta[] = [];
	const locations: SourceLocation[] = [];
	const unitDetails: Array<{
		key?: string;
		context?: string;
		sourceFormula: boolean;
		targetFormula: boolean;
	}> = [];
	const skipEmpty = Boolean(filterOptions.skipEmptyFields);

	const addUnit = (
		row: (typeof table.rows)[number],
		sourceIndex: number,
		destinationIndex: number,
	) => {
		const source = row.fields[sourceIndex];
		const destination = row.fields[destinationIndex];
		if (!source || !destination) return;
		if (skipEmpty && source.value.length === 0) return;
		const unitIndex = segments.length;
		const key =
			keyColumn === undefined ? undefined : row.fields[keyColumn]?.value;
		const context =
			contextColumn === undefined
				? undefined
				: row.fields[contextColumn]?.value;
		segments.push(source.value);
		targetSegments.push(
			mode === "multilingual-columns" ? destination.value : "",
		);
		replacements.push({
			kind: "csv-field",
			unitIndex,
			row: row.row,
			column: destinationIndex,
			start: destination.start,
			end: destination.end,
			originalValue: destination.value,
			delimiter: table.dialect.delimiter,
			quote: table.dialect.quote,
			escapeMode: table.dialect.escapeMode,
			quoted: destination.quoted,
		});
		meta.push({
			row: row.row,
			column: destinationIndex,
			sourceColumn: sourceIndex,
			...(key ? { key } : {}),
			...(context ? { context } : {}),
		});
		locations.push({
			part: file.name,
			row: row.row + 1,
			column: sourceIndex + 1,
			path: [row.row, sourceIndex],
			segmentIndex: unitIndex,
			metadata: { destinationColumn: destinationIndex + 1 },
		});
		unitDetails.push({
			...(key ? { key } : {}),
			...(context ? { context } : {}),
			sourceFormula: isCsvFormulaInjection(source.value),
			targetFormula: isCsvFormulaInjection(destination.value),
		});
	};

	for (const row of dataRows) {
		if (mode === "all-text") {
			for (const field of row.fields) addUnit(row, field.column, field.column);
		} else {
			addUnit(
				row,
				sourceColumn!,
				mode === "multilingual-columns" ? targetColumn! : sourceColumn!,
			);
		}
	}

	const document = createNeutralDocument({
		format: "csv",
		sourceSegments: segments,
		targetSegments,
		sourceLocations: locations,
	});
	let formulaWarningCount = 0;
	for (const [index, details] of unitDetails.entries()) {
		const unit = document.units[index];
		if (!unit) continue;
		if (details.key)
			unit.contexts.push({ type: "csv-key", value: details.key });
		if (details.context)
			unit.contexts.push({ type: "csv-context", value: details.context });
		if (details.sourceFormula) {
			formulaWarningCount++;
			unit.notes.push({
				category: "csv-formula-injection",
				appliesTo: "source",
				priority: 1,
				text: "This field begins with a character that spreadsheet software may execute as a formula. It is preserved as data; review it before opening the export in a spreadsheet.",
			});
		}
		if (details.targetFormula && mode === "multilingual-columns") {
			formulaWarningCount++;
			unit.notes.push({
				category: "csv-formula-injection",
				appliesTo: "target",
				priority: 1,
				text: "The existing target begins with a character that spreadsheet software may execute as a formula. It is preserved as data.",
			});
		}
	}
	const widths = table.rows.map((row) => row.fields.length);
	const expectedWidth = widths[0] ?? 0;
	document.metadata = {
		delimiter: table.dialect.delimiter,
		quote: table.dialect.quote,
		escapeMode: table.dialect.escapeMode,
		hasHeader,
		rowCount: table.rows.length,
		raggedRows: widths
			.map((width, index) => (width === expectedWidth ? -1 : index + 1))
			.filter((row) => row > 0),
		formulaInjectionWarnings: formulaWarningCount,
	};

	return {
		kind: "segments",
		segments,
		targetSegments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"csv",
			content,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { dialect: table.dialect } as unknown as TypeRef,
		segmentsMeta: meta,
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
