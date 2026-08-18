import type { FormatId } from "./formatIds";
import type { SupportedTextEncoding } from "./safeInput";
import { decodeTextBytes, readSafeFileBytes } from "./safeInput";
import { parseJsonSyntax, type JsonPrimitiveNode } from "./jsonSyntax";

export const DOCUMENT_SKELETON_VERSION = 1 as const;

export interface SkeletonSource {
	name: string;
	mimeType: string;
	encoding?: SupportedTextEncoding;
	hasBom?: boolean;
	originalFile?: Blob;
}

export interface TextSkeletonPayload {
	kind: "text";
	content: string;
}

export interface PackageSkeletonPayload {
	kind: "package";
	parts: Record<string, string | Blob>;
}

export type SkeletonPayload = TextSkeletonPayload | PackageSkeletonPayload;

interface ReplacementBase {
	unitIndex: number;
	separator?: string;
}

export interface TextRangeReplacement extends ReplacementBase {
	kind: "text-range";
	start: number;
	end: number;
}

export interface CsvFieldReplacement extends ReplacementBase {
	kind: "csv-field";
	row: number;
	column: number;
	start: number;
	end: number;
	originalValue: string;
	delimiter: string;
	quote: '"' | "'" | null;
	escapeMode: "double" | "backslash";
	quoted: boolean;
}

export interface JsonValueReplacement extends ReplacementBase {
	kind: "json-value";
	path: string[];
	address?: number[];
	start: number;
	end: number;
	valueType: "string" | "number" | "boolean" | "null";
	originalValue?: string;
	profile?: "generic" | "arb" | "i18next" | "chrome" | "locjson";
	fragments?: Array<{
		start: number;
		end: number;
		originalValue: string;
	}>;
}

export interface YamlScalarReplacement extends ReplacementBase {
	kind: "yaml-scalar";
	documentIndex: number;
	path: string[];
	start: number;
	end: number;
	originalValue: string;
	valueType: "string" | "number" | "boolean" | "null";
	style:
		| "PLAIN"
		| "QUOTE_SINGLE"
		| "QUOTE_DOUBLE"
		| "BLOCK_LITERAL"
		| "BLOCK_FOLDED";
}

export interface PoStringReplacement extends ReplacementBase {
	kind: "po-string";
	entryIndex: number;
	pluralIndex?: number;
	originalValue: string;
	fragments: Array<{
		start: number;
		end: number;
		originalValue: string;
	}>;
}

export interface XmlValueReplacement extends ReplacementBase {
	kind: "xml-value";
	location: "text" | "cdata" | "attribute";
	path: string[];
	attribute?: string;
	start: number;
	end: number;
	originalValue: string;
}

export interface AndroidValueReplacement extends ReplacementBase {
	kind: "android-value";
	resourceType: "string" | "string-array" | "plurals";
	name: string;
	index?: number;
	quantity?: string;
	start: number;
	end: number;
	originalValue: string;
	formatted: boolean;
}

export interface AppleValueReplacement extends ReplacementBase {
	kind: "apple-value";
	profile: "strings" | "stringsdict" | "xcstrings";
	key: string;
	path: string[];
	start: number;
	end: number;
	originalValue: string;
	quote?: '"';
	targetLanguage?: string;
	insertionGroup?: string;
	insertionStart?: number;
	sourceObjectStart?: number;
	sourceObjectEnd?: number;
	relativePath?: string[];
	insertLocalizationsProperty?: boolean;
}

export interface PropertiesValueReplacement extends ReplacementBase {
	kind: "properties-value";
	key: string;
	line: number;
	originalValue: string;
	fragments: Array<{ start: number; end: number; originalValue: string }>;
}

export interface ResxValueReplacement extends ReplacementBase {
	kind: "resx-value";
	name: string;
	start: number;
	end: number;
	originalValue: string;
	location: "text" | "cdata";
	type?: string;
}

export interface QtTsValueReplacement extends ReplacementBase {
	kind: "qt-ts-value";
	context: string;
	messageId?: string;
	form?: number;
	variant?: number;
	start: number;
	end: number;
	originalValue: string;
	state?: string;
	stateAttributeStart?: number;
	stateAttributeEnd?: number;
}

export interface IniValueReplacement extends ReplacementBase {
	kind: "ini-value";
	profile: "generic" | "desktop" | "lang";
	section: string;
	key: string;
	locale?: string;
	start: number;
	end: number;
	originalValue: string;
	insertionStart?: number;
	insertionTextPrefix?: string;
	insertionTextSuffix?: string;
}

export interface PhpValueReplacement extends ReplacementBase {
	kind: "php-value";
	path: string[];
	start: number;
	end: number;
	originalValue: string;
	quote: "'" | '"';
}

export interface MarkupTextReplacement extends ReplacementBase {
	kind: "markup-text";
	profile: "markdown" | "asciidoc";
	line: number;
	span: number;
	start: number;
	end: number;
	originalValue: string;
}

export interface SubtitleCueReplacement extends ReplacementBase {
	kind: "subtitle-cue";
	profile: "srt" | "vtt" | "sbv";
	cueIndex: number;
	cueId?: string;
	startMs: number;
	endMs: number;
	settings?: string;
	line: number;
	start: number;
	end: number;
	originalValue: string;
}

export interface PackageXmlValueReplacement extends ReplacementBase {
	kind: "package-xml-value";
	profile: string;
	part: string;
	path: string[];
	location: "text" | "cdata" | "attribute";
	attribute?: string;
	start: number;
	end: number;
	originalValue: string;
}

export interface TtmlValueReplacement
	extends Omit<XmlValueReplacement, "kind"> {
	kind: "ttml-value";
	profile: string;
	cueIndex: number;
	startMs: number;
	endMs: number;
	region?: string;
	style?: string;
	language?: string;
}

export interface HtmlTextReplacement extends ReplacementBase {
	kind: "html-text";
	path: number[];
	start?: number;
	end?: number;
	sourceText?: string;
	prefix?: string;
	suffix?: string;
}

export interface HtmlAttributeReplacement extends ReplacementBase {
	kind: "html-attribute";
	path: number[];
	attribute: string;
	start?: number;
	end?: number;
	sourceText?: string;
	prefix?: string;
	suffix?: string;
	quote?: '"' | "'" | "unquoted";
}

export interface DocxTextReplacement extends ReplacementBase {
	kind: "docx-text";
	part: string;
	fragments: Array<{
		paragraphIndex: number;
		textNodeIndex: number;
		start: number;
		end: number;
	}>;
}

export interface XlsxTextReplacement extends ReplacementBase {
	kind: "xlsx-text";
	part: string;
	storage: "shared-string" | "inline-string" | "cell-value";
	localIndex: number;
	cellReference?: string;
	originalText?: string;
}

export type PptxTextReplacement = ReplacementBase &
	(
		| {
				kind: "pptx-text";
				part: string;
				storage: "text";
				fragments: DocxTextReplacement["fragments"];
		  }
		| {
				kind: "pptx-text";
				part: string;
				storage: "attribute";
				elementIndex: number;
				attribute: "title" | "descr";
		  }
	);

export type SkeletonReplacement =
	| TextRangeReplacement
	| CsvFieldReplacement
	| JsonValueReplacement
	| YamlScalarReplacement
	| PoStringReplacement
	| AndroidValueReplacement
	| AppleValueReplacement
	| PropertiesValueReplacement
	| ResxValueReplacement
	| QtTsValueReplacement
	| IniValueReplacement
	| PhpValueReplacement
	| MarkupTextReplacement
	| SubtitleCueReplacement
	| PackageXmlValueReplacement
	| TtmlValueReplacement
	| XmlValueReplacement
	| HtmlTextReplacement
	| HtmlAttributeReplacement
	| DocxTextReplacement
	| XlsxTextReplacement
	| PptxTextReplacement;

export interface DocumentSkeleton {
	schemaVersion: typeof DOCUMENT_SKELETON_VERSION;
	format: FormatId;
	source: SkeletonSource;
	payload: SkeletonPayload;
	replacements: SkeletonReplacement[];
}

export type JsonPrimitiveLocation = JsonPrimitiveNode;

async function sourceFromFile(
	file: File,
	textSource: boolean,
): Promise<SkeletonSource> {
	const bytes = await readSafeFileBytes(file);
	const textMetadata = textSource ? decodeTextBytes(bytes) : undefined;
	return {
		name: file.name,
		mimeType: file.type,
		encoding: textMetadata?.encoding,
		hasBom: textMetadata?.hasBom,
		originalFile: new Blob([bytes], { type: file.type }),
	};
}

function locateTextRanges(
	content: string,
	segments: readonly string[],
): TextRangeReplacement[] {
	const replacements: TextRangeReplacement[] = [];
	let cursor = 0;
	for (const [unitIndex, segment] of segments.entries()) {
		const trailingWhitespace = segment.match(/\s+$/)?.[0] ?? "";
		const searchable = trailingWhitespace
			? segment.slice(0, -trailingWhitespace.length)
			: segment;
		const start = content.indexOf(searchable, cursor);
		if (start < 0) continue;
		const end = start + searchable.length;
		replacements.push({
			kind: "text-range",
			unitIndex,
			start,
			end,
			...(trailingWhitespace ? { separator: trailingWhitespace } : {}),
		});
		cursor = end + trailingWhitespace.length;
	}
	return replacements;
}

function locateJoinedTextRanges(
	content: string,
	segments: readonly string[],
	current: readonly TextRangeReplacement[],
): TextRangeReplacement[] {
	const original = [...current].sort(
		(first, second) => first.start - second.start,
	);
	const replacements: TextRangeReplacement[] = [];
	let originalIndex = 0;
	for (const [unitIndex, segment] of segments.entries()) {
		const first = original[originalIndex];
		if (!first) return [];
		let reconstructed = "";
		let last = first;
		while (
			originalIndex < original.length &&
			reconstructed.length < segment.length
		) {
			last = original[originalIndex++];
			reconstructed += content.slice(last.start, last.end);
		}
		if (reconstructed !== segment) return [];
		replacements.push({
			kind: "text-range",
			unitIndex,
			start: first.start,
			end: last.end,
			separator: last.separator,
		});
	}
	return originalIndex === original.length ? replacements : [];
}

export async function createTextSkeleton(
	file: File,
	format:
		| "text"
		| "csv"
		| "json"
		| "yaml"
		| "po"
		| "android"
		| "apple"
		| "properties"
		| "resx"
		| "qt-ts"
		| "ini"
		| "php"
		| "markup"
		| "subtitles"
		| "svg"
		| "dita"
		| "docbook"
		| "idml"
		| "latex"
		| "ttml"
		| "mif"
		| "windows-rc"
		| "xml"
		| "html",
	content: string,
	replacements: SkeletonReplacement[],
	source?: SkeletonSource,
): Promise<DocumentSkeleton> {
	return {
		schemaVersion: DOCUMENT_SKELETON_VERSION,
		format,
		source: source ?? (await sourceFromFile(file, true)),
		payload: { kind: "text", content },
		replacements,
	};
}

export async function createPlainTextSkeleton(
	file: File,
	content: string,
	segments: readonly string[],
	source?: SkeletonSource,
): Promise<DocumentSkeleton> {
	return createTextSkeleton(
		file,
		"text",
		content,
		locateTextRanges(content, segments),
		source,
	);
}

export async function createPackageSkeleton(
	file: File,
	format: FormatId,
	parts: Record<string, string | Blob>,
	replacements: SkeletonReplacement[],
	source?: SkeletonSource,
): Promise<DocumentSkeleton> {
	return {
		schemaVersion: DOCUMENT_SKELETON_VERSION,
		format,
		source: source ?? (await sourceFromFile(file, false)),
		payload: { kind: "package", parts },
		replacements,
	};
}

export function findJsonPrimitiveLocations(
	content: string,
): JsonPrimitiveLocation[] {
	return parseJsonSyntax(content).primitives;
}

export function applyTextSkeleton(
	content: string,
	replacements: readonly TextRangeReplacement[],
	translations: readonly string[],
): string {
	let output = content;
	for (const replacement of [...replacements].sort(
		(a, b) => b.start - a.start,
	)) {
		let translated = translations[replacement.unitIndex];
		if (translated === undefined) continue;
		if (replacement.separator && translated.endsWith(replacement.separator)) {
			translated = translated.slice(0, -replacement.separator.length);
		}
		output = `${output.slice(0, replacement.start)}${translated}${output.slice(replacement.end)}`;
	}
	return output;
}

export function applyJsonSkeleton(
	content: string,
	replacements: readonly JsonValueReplacement[],
	translations: readonly string[],
): string {
	const edits: Array<{ start: number; end: number; encoded: string }> = [];
	for (const replacement of replacements) {
		if (!replacement.fragments?.length) continue;
		const translated = translations[replacement.unitIndex] ?? "";
		const original = replacement.fragments
			.map((fragment) => fragment.originalValue)
			.join("");
		if (translated === original) continue;
		const pieces = splitJsonArrayTranslation(
			translated,
			replacement.fragments.map((fragment) => fragment.originalValue),
		);
		for (const [index, fragment] of replacement.fragments.entries()) {
			edits.push({
				start: fragment.start,
				end: fragment.end,
				encoded: JSON.stringify(pieces[index] ?? ""),
			});
		}
	}

	const grouped = new Map<string, JsonValueReplacement[]>();
	for (const replacement of replacements.filter(
		(replacement) => !replacement.fragments?.length,
	)) {
		const key = `${replacement.start}:${replacement.end}`;
		const values = grouped.get(key) ?? [];
		values.push(replacement);
		grouped.set(key, values);
	}

	const groups = [...grouped.values()];
	for (const group of groups) {
		let translated = "";
		for (const replacement of group.sort((a, b) => a.unitIndex - b.unitIndex)) {
			const separator = replacement.separator ?? "";
			let piece = translations[replacement.unitIndex] ?? "";
			if (separator) {
				if (piece.endsWith(separator)) {
					piece = piece.slice(0, -separator.length);
				} else {
					const visibleSeparator = separator.trimEnd();
					if (visibleSeparator && piece.endsWith(visibleSeparator)) {
						piece = piece.slice(0, -visibleSeparator.length);
					}
				}
			}
			translated += `${piece}${separator}`;
		}
		const originalRaw = content.slice(group[0].start, group[0].end);
		const originalValue =
			group[0].originalValue ?? String(JSON.parse(originalRaw));
		if (translated === originalValue) continue;
		let encoded: string;
		switch (group[0].valueType) {
			case "number":
				encoded = isJsonNumber(translated)
					? translated
					: JSON.stringify(translated);
				break;
			case "boolean":
				encoded =
					translated === "true" || translated === "false"
						? translated
						: JSON.stringify(translated);
				break;
			case "null":
				encoded = translated === "null" ? "null" : JSON.stringify(translated);
				break;
			default:
				encoded = JSON.stringify(translated);
		}
		edits.push({ start: group[0].start, end: group[0].end, encoded });
	}

	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.encoded}${output.slice(edit.end)}`;
	return output;
}

function isJsonNumber(value: string): boolean {
	return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value);
}

function splitJsonArrayTranslation(
	translation: string,
	originalPieces: readonly string[],
): string[] {
	if (originalPieces.length <= 1) return [translation];
	const characters = Array.from(translation);
	const originalLengths = originalPieces.map(
		(piece) => Array.from(piece).length,
	);
	const originalTotal = originalLengths.reduce(
		(sum, length) => sum + length,
		0,
	);
	if (originalTotal === 0)
		return [translation, ...originalPieces.slice(1).map(() => "")];
	const pieces: string[] = [];
	let cursor = 0;
	let consumedOriginal = 0;
	for (let index = 0; index < originalPieces.length - 1; index++) {
		consumedOriginal += originalLengths[index];
		const boundary = Math.round(
			(characters.length * consumedOriginal) / originalTotal,
		);
		pieces.push(characters.slice(cursor, boundary).join(""));
		cursor = boundary;
	}
	pieces.push(characters.slice(cursor).join(""));
	return pieces;
}

export function skeletonHasIdentityTargets(
	sourceSegments: readonly string[],
	targetSegments: readonly string[],
): boolean {
	return (
		sourceSegments.length === targetSegments.length &&
		sourceSegments.every((source, index) => source === targetSegments[index])
	);
}

export function getTextSkeletonContent(
	skeleton: DocumentSkeleton | undefined,
	format: FormatId,
): string | undefined {
	return skeleton?.format === format && skeleton.payload.kind === "text"
		? skeleton.payload.content
		: undefined;
}

export function getPackageSkeleton(
	skeleton: DocumentSkeleton | undefined,
	format: FormatId,
): (DocumentSkeleton & { payload: PackageSkeletonPayload }) | undefined {
	return skeleton?.format === format && skeleton.payload.kind === "package"
		? (skeleton as DocumentSkeleton & { payload: PackageSkeletonPayload })
		: undefined;
}

export function validateDocumentSkeleton(skeleton: DocumentSkeleton): {
	valid: boolean;
	issues: string[];
} {
	const issues: string[] = [];
	if (!skeleton || typeof skeleton !== "object") {
		return { valid: false, issues: ["Skeleton is missing."] };
	}
	if (skeleton.schemaVersion !== DOCUMENT_SKELETON_VERSION) {
		issues.push("Unsupported skeleton version.");
	}
	if (!skeleton.source || typeof skeleton.source !== "object") {
		issues.push("Skeleton source metadata is missing.");
	} else {
		if (
			skeleton.source.originalFile !== undefined &&
			!(skeleton.source.originalFile instanceof Blob)
		) {
			issues.push("Original skeleton bytes are invalid.");
		}
	}
	if (!skeleton.payload || typeof skeleton.payload !== "object") {
		return {
			valid: false,
			issues: [...issues, "Skeleton payload is missing."],
		};
	}
	if (
		skeleton.payload.kind === "text" &&
		typeof skeleton.payload.content !== "string"
	) {
		issues.push("Text skeleton content is missing.");
	}
	if (
		skeleton.payload.kind === "package" &&
		(!skeleton.payload.parts || typeof skeleton.payload.parts !== "object")
	) {
		issues.push("Package skeleton parts are missing.");
	}
	if (
		skeleton.payload.kind === "package" &&
		skeleton.payload.parts &&
		Object.values(skeleton.payload.parts).some(
			(part) => typeof part !== "string" && !(part instanceof Blob),
		)
	) {
		issues.push("Package skeleton parts contain unsupported data.");
	}
	if (!Array.isArray(skeleton.replacements)) {
		return {
			valid: false,
			issues: [...issues, "Skeleton replacements are missing."],
		};
	}
	for (const replacement of skeleton.replacements) {
		if (!Number.isInteger(replacement.unitIndex) || replacement.unitIndex < 0) {
			issues.push("Replacement unit indices must be non-negative integers.");
		}
		if (
			(replacement.kind === "text-range" ||
				replacement.kind === "csv-field" ||
				replacement.kind === "json-value" ||
				replacement.kind === "yaml-scalar" ||
				replacement.kind === "android-value" ||
				replacement.kind === "apple-value") &&
			(replacement.start < 0 || replacement.end < replacement.start)
		) {
			issues.push("Replacement text ranges are invalid.");
		}
		if (
			replacement.kind === "csv-field" &&
			(typeof replacement.originalValue !== "string" ||
				typeof replacement.delimiter !== "string" ||
				replacement.delimiter.length !== 1 ||
				(replacement.quote !== null &&
					replacement.quote !== '"' &&
					replacement.quote !== "'") ||
				(replacement.escapeMode !== "double" &&
					replacement.escapeMode !== "backslash") ||
				typeof replacement.quoted !== "boolean" ||
				!Number.isInteger(replacement.row) ||
				!Number.isInteger(replacement.column) ||
				replacement.row < 0 ||
				replacement.column < 0)
		) {
			issues.push("CSV field replacement metadata is invalid.");
		}
		if (
			replacement.kind === "json-value" &&
			replacement.address !== undefined &&
			(!Array.isArray(replacement.address) ||
				replacement.address.some((part) => !Number.isInteger(part) || part < 0))
		) {
			issues.push("JSON syntax addresses are invalid.");
		}
		if (
			replacement.kind === "json-value" &&
			replacement.fragments?.some(
				(fragment) =>
					!Number.isInteger(fragment.start) ||
					!Number.isInteger(fragment.end) ||
					fragment.start < 0 ||
					fragment.end < fragment.start ||
					typeof fragment.originalValue !== "string",
			)
		) {
			issues.push("JSON string-array fragment mappings are invalid.");
		}
		if (
			replacement.kind === "yaml-scalar" &&
			(!Number.isInteger(replacement.documentIndex) ||
				replacement.documentIndex < 0 ||
				!Array.isArray(replacement.path) ||
				replacement.path.some((part) => typeof part !== "string") ||
				typeof replacement.originalValue !== "string" ||
				!["string", "number", "boolean", "null"].includes(
					replacement.valueType,
				) ||
				![
					"PLAIN",
					"QUOTE_SINGLE",
					"QUOTE_DOUBLE",
					"BLOCK_LITERAL",
					"BLOCK_FOLDED",
				].includes(replacement.style))
		) {
			issues.push("YAML scalar replacement metadata is invalid.");
		}
		if (
			replacement.kind === "po-string" &&
			(!Number.isInteger(replacement.entryIndex) ||
				replacement.entryIndex < 0 ||
				(replacement.pluralIndex !== undefined &&
					(!Number.isInteger(replacement.pluralIndex) ||
						replacement.pluralIndex < 0)) ||
				typeof replacement.originalValue !== "string" ||
				!replacement.fragments.length ||
				replacement.fragments.some(
					(fragment) =>
						fragment.start < 0 ||
						fragment.end < fragment.start ||
						typeof fragment.originalValue !== "string",
				))
		) {
			issues.push("PO string replacement metadata is invalid.");
		}
		if (
			replacement.kind === "android-value" &&
			(!["string", "string-array", "plurals"].includes(
				replacement.resourceType,
			) ||
				!replacement.name ||
				typeof replacement.originalValue !== "string" ||
				typeof replacement.formatted !== "boolean")
		) {
			issues.push("Android value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "apple-value" &&
			(!["strings", "stringsdict", "xcstrings"].includes(replacement.profile) ||
				!replacement.key ||
				!Array.isArray(replacement.path) ||
				typeof replacement.originalValue !== "string")
		) {
			issues.push("Apple value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "properties-value" &&
			(!replacement.key ||
				!Number.isInteger(replacement.line) ||
				replacement.line < 1 ||
				typeof replacement.originalValue !== "string" ||
				!replacement.fragments.length ||
				replacement.fragments.some(
					(fragment) =>
						fragment.start < 0 ||
						fragment.end < fragment.start ||
						typeof fragment.originalValue !== "string",
				))
		) {
			issues.push("Properties value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "resx-value" &&
			(!replacement.name ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string" ||
				!["text", "cdata"].includes(replacement.location))
		) {
			issues.push("RESX value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "qt-ts-value" &&
			(!replacement.context ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string")
		) {
			issues.push("Qt TS value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "ini-value" &&
			(!["generic", "desktop", "lang"].includes(replacement.profile) ||
				!replacement.key ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string")
		) {
			issues.push("INI value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "php-value" &&
			(!Array.isArray(replacement.path) ||
				replacement.path.length === 0 ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string" ||
				!["'", '\"'].includes(replacement.quote))
		) {
			issues.push("PHP value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "markup-text" &&
			(!["markdown", "asciidoc"].includes(replacement.profile) ||
				!Number.isInteger(replacement.line) ||
				replacement.line < 1 ||
				!Number.isInteger(replacement.span) ||
				replacement.span < 0 ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string")
		) {
			issues.push("Markup text replacement metadata is invalid.");
		}
		if (
			replacement.kind === "subtitle-cue" &&
			(!["srt", "vtt", "sbv"].includes(replacement.profile) ||
				!Number.isInteger(replacement.cueIndex) ||
				replacement.cueIndex < 0 ||
				replacement.startMs < 0 ||
				replacement.endMs <= replacement.startMs ||
				!Number.isInteger(replacement.line) ||
				replacement.line < 1 ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string")
		) {
			issues.push("Subtitle cue replacement metadata is invalid.");
		}
		if (
			replacement.kind === "package-xml-value" &&
			(!replacement.profile ||
				!replacement.part ||
				!Array.isArray(replacement.path) ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string" ||
				(replacement.location === "attribute" && !replacement.attribute))
		) {
			issues.push("Package XML value replacement metadata is invalid.");
		}
		if (
			replacement.kind === "xml-value" &&
			(!Array.isArray(replacement.path) ||
				replacement.path.some((part) => typeof part !== "string") ||
				replacement.start < 0 ||
				replacement.end < replacement.start ||
				typeof replacement.originalValue !== "string" ||
				(replacement.location === "attribute" && !replacement.attribute))
		) {
			issues.push("XML value replacement metadata is invalid.");
		}
	}
	return { valid: issues.length === 0, issues };
}

interface LegacySkeletonOptions {
	format: FormatId;
	name: string;
	typeRef: unknown;
	segments: readonly string[];
	segmentsMeta?: readonly unknown[];
}

export function createSkeletonFromLegacy(
	options: LegacySkeletonOptions,
): DocumentSkeleton {
	const source: SkeletonSource = {
		name: options.name,
		mimeType: "",
		encoding: "utf-8",
	};
	const meta = options.segmentsMeta ?? [];

	if (
		options.format === "docx" ||
		options.format === "xlsx" ||
		options.format === "pptx"
	) {
		const parts =
			options.typeRef && typeof options.typeRef === "object"
				? (options.typeRef as Record<string, string | Blob>)
				: {};
		const replacements: SkeletonReplacement[] = [];
		if (options.format === "docx") {
			for (const [unitIndex, entry] of meta.entries()) {
				const candidate = entry as Partial<DocxTextReplacement> & {
					fragments?: DocxTextReplacement["fragments"];
				};
				if (!Array.isArray(candidate.fragments)) continue;
				replacements.push({
					kind: "docx-text",
					unitIndex,
					part:
						typeof candidate.part === "string"
							? candidate.part
							: "word/document.xml",
					separator: candidate.separator,
					fragments: candidate.fragments.map((fragment) => ({ ...fragment })),
				});
			}
		}
		if (options.format === "pptx") {
			for (const [unitIndex, entry] of meta.entries()) {
				const candidate = entry as {
					kind?: string;
					part?: string;
					separator?: string;
					fragments?: DocxTextReplacement["fragments"];
					elementIndex?: number;
					attribute?: "title" | "descr";
				};
				if (typeof candidate.part !== "string") continue;
				if (candidate.kind === "text" && Array.isArray(candidate.fragments))
					replacements.push({
						kind: "pptx-text",
						unitIndex,
						part: candidate.part,
						storage: "text",
						separator: candidate.separator,
						fragments: candidate.fragments.map((fragment) => ({ ...fragment })),
					});
				if (
					candidate.kind === "attribute" &&
					Number.isInteger(candidate.elementIndex) &&
					(candidate.attribute === "title" || candidate.attribute === "descr")
				)
					replacements.push({
						kind: "pptx-text",
						unitIndex,
						part: candidate.part,
						storage: "attribute",
						elementIndex: candidate.elementIndex!,
						attribute: candidate.attribute,
					});
			}
		}
		return {
			schemaVersion: DOCUMENT_SKELETON_VERSION,
			format: options.format,
			source,
			payload: { kind: "package", parts },
			replacements,
		};
	}

	let content = "";
	if (typeof options.typeRef === "string") {
		content = options.typeRef;
	} else if (options.format === "json") {
		const ref = options.typeRef as { data?: unknown } | undefined;
		content = JSON.stringify(ref?.data ?? options.typeRef ?? {}, null, 2);
	} else {
		content = options.segments.join("");
	}

	let replacements: SkeletonReplacement[] = [];
	if (options.format === "text") {
		replacements = locateTextRanges(content, options.segments);
	} else if (options.format === "json") {
		const locations = findJsonPrimitiveLocations(content);
		replacements = meta.flatMap<SkeletonReplacement>((entry, unitIndex) => {
			const candidate = entry as {
				path?: string[];
				address?: number[];
				start?: number;
				end?: number;
				originalValue?: string;
				profile?: JsonValueReplacement["profile"];
				separator?: string;
			};
			if (!Array.isArray(candidate.path)) return [];
			const location = locations.find((value) =>
				candidate.start !== undefined && candidate.end !== undefined
					? value.start === candidate.start && value.end === candidate.end
					: candidate.address
						? value.address.length === candidate.address.length &&
							value.address.every(
								(part, index) => part === candidate.address![index],
							)
						: value.path.length === candidate.path!.length &&
							value.path.every(
								(part, index) => part === candidate.path![index],
							),
			);
			return location
				? [
						{
							kind: "json-value" as const,
							unitIndex,
							path: [...candidate.path],
							address: [...location.address],
							start: location.start,
							end: location.end,
							valueType: location.valueType,
							originalValue:
								candidate.originalValue ??
								(location.valueType === "string"
									? String(location.value)
									: location.raw),
							profile: candidate.profile,
							separator: candidate.separator,
						},
					]
				: [];
		});
	} else if (options.format === "html") {
		replacements = meta.flatMap<SkeletonReplacement>((entry, unitIndex) => {
			const candidate = entry as {
				kind?: string;
				path?: number[];
				attribute?: string;
				separator?: string;
				start?: number;
				end?: number;
				sourceText?: string;
				prefix?: string;
				suffix?: string;
				quote?: '"' | "'" | "unquoted";
			};
			if (!Array.isArray(candidate.path)) return [];
			if (candidate.kind === "attribute" && candidate.attribute) {
				return [
					{
						kind: "html-attribute" as const,
						unitIndex,
						path: [...candidate.path],
						attribute: candidate.attribute,
						separator: candidate.separator,
						start: candidate.start,
						end: candidate.end,
						sourceText: candidate.sourceText,
						prefix: candidate.prefix,
						suffix: candidate.suffix,
						quote: candidate.quote,
					},
				];
			}
			return candidate.kind === "text"
				? [
						{
							kind: "html-text" as const,
							unitIndex,
							path: [...candidate.path],
							separator: candidate.separator,
							start: candidate.start,
							end: candidate.end,
							sourceText: candidate.sourceText,
							prefix: candidate.prefix,
							suffix: candidate.suffix,
						},
					]
				: [];
		});
	}

	return {
		schemaVersion: DOCUMENT_SKELETON_VERSION,
		format: options.format,
		source,
		payload: { kind: "text", content },
		replacements,
	};
}

export function synchronizeSkeletonReplacements(
	skeleton: DocumentSkeleton | undefined,
	segments: readonly string[],
	segmentsMeta?: readonly unknown[],
): DocumentSkeleton | undefined {
	if (!skeleton || skeleton.format === "xlsx" || skeleton.format === "csv")
		return skeleton;
	if (skeleton.format === "text" && skeleton.payload.kind === "text") {
		let replacements = locateTextRanges(skeleton.payload.content, segments);
		if (replacements.length !== segments.length) {
			replacements = locateJoinedTextRanges(
				skeleton.payload.content,
				segments,
				skeleton.replacements.filter(
					(replacement): replacement is TextRangeReplacement =>
						replacement.kind === "text-range",
				),
			);
		}
		return { ...skeleton, replacements };
	}
	const typeRef =
		skeleton.payload.kind === "text"
			? skeleton.payload.content
			: skeleton.payload.parts;
	const rebuilt = createSkeletonFromLegacy({
		format: skeleton.format,
		name: skeleton.source.name,
		typeRef,
		segments,
		segmentsMeta,
	});
	return { ...skeleton, replacements: rebuilt.replacements };
}
