import type { FormatId } from "./formatIds";
import { decodeTextBytes, readSafeFileBytes } from "./safeInput";

export const DOCUMENT_SKELETON_VERSION = 1 as const;

export interface SkeletonSource {
	name: string;
	mimeType: string;
	encoding?: "utf-8" | "utf-16le" | "utf-16be";
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

export interface JsonValueReplacement extends ReplacementBase {
	kind: "json-value";
	path: string[];
	start: number;
	end: number;
	valueType: "string" | "number" | "boolean" | "null";
}

export interface HtmlTextReplacement extends ReplacementBase {
	kind: "html-text";
	path: number[];
}

export interface HtmlAttributeReplacement extends ReplacementBase {
	kind: "html-attribute";
	path: number[];
	attribute: string;
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
	| JsonValueReplacement
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

export interface JsonPrimitiveLocation {
	path: string[];
	start: number;
	end: number;
	value: string | number | boolean | null;
	valueType: JsonValueReplacement["valueType"];
}

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

export async function createTextSkeleton(
	file: File,
	format: "text" | "json" | "html",
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
	format: "docx" | "xlsx" | "pptx",
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

class JsonLocationParser {
	private cursor = 0;
	readonly locations: JsonPrimitiveLocation[] = [];

	constructor(private readonly text: string) {}

	parse(): JsonPrimitiveLocation[] {
		this.skipWhitespace();
		this.parseValue([]);
		this.skipWhitespace();
		if (this.cursor !== this.text.length)
			throw new Error("Unexpected JSON content.");
		return this.locations;
	}

	private skipWhitespace() {
		while (/\s/.test(this.text[this.cursor] ?? "")) this.cursor++;
	}

	private parseStringToken(): { start: number; end: number; value: string } {
		const start = this.cursor;
		if (this.text[this.cursor] !== '"')
			throw new Error("Expected JSON string.");
		this.cursor++;
		let escaped = false;
		while (this.cursor < this.text.length) {
			const character = this.text[this.cursor++];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === '"') {
				const end = this.cursor;
				return {
					start,
					end,
					value: JSON.parse(this.text.slice(start, end)),
				};
			}
		}
		throw new Error("Unterminated JSON string.");
	}

	private parseValue(path: string[]) {
		this.skipWhitespace();
		const character = this.text[this.cursor];
		if (character === "{") return this.parseObject(path);
		if (character === "[") return this.parseArray(path);
		if (character === '"') {
			const token = this.parseStringToken();
			this.locations.push({ ...token, path, valueType: "string" });
			return;
		}

		const start = this.cursor;
		while (
			this.cursor < this.text.length &&
			![",", "]", "}"].includes(this.text[this.cursor]) &&
			!/\s/.test(this.text[this.cursor])
		) {
			this.cursor++;
		}
		const end = this.cursor;
		const raw = this.text.slice(start, end);
		const value = JSON.parse(raw) as number | boolean | null;
		this.locations.push({
			path,
			start,
			end,
			value,
			valueType:
				value === null
					? "null"
					: typeof value === "number"
						? "number"
						: "boolean",
		});
	}

	private parseObject(path: string[]) {
		this.cursor++;
		this.skipWhitespace();
		if (this.text[this.cursor] === "}") {
			this.cursor++;
			return;
		}
		while (this.cursor < this.text.length) {
			this.skipWhitespace();
			const key = this.parseStringToken().value;
			this.skipWhitespace();
			if (this.text[this.cursor++] !== ":") throw new Error("Expected colon.");
			this.parseValue([...path, key]);
			this.skipWhitespace();
			const delimiter = this.text[this.cursor++];
			if (delimiter === "}") return;
			if (delimiter !== ",") throw new Error("Expected object delimiter.");
		}
		throw new Error("Unterminated JSON object.");
	}

	private parseArray(path: string[]) {
		this.cursor++;
		this.skipWhitespace();
		if (this.text[this.cursor] === "]") {
			this.cursor++;
			return;
		}
		let index = 0;
		while (this.cursor < this.text.length) {
			this.parseValue([...path, String(index++)]);
			this.skipWhitespace();
			const delimiter = this.text[this.cursor++];
			if (delimiter === "]") return;
			if (delimiter !== ",") throw new Error("Expected array delimiter.");
		}
		throw new Error("Unterminated JSON array.");
	}
}

export function findJsonPrimitiveLocations(
	content: string,
): JsonPrimitiveLocation[] {
	return new JsonLocationParser(content).parse();
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
	const grouped = new Map<string, JsonValueReplacement[]>();
	for (const replacement of replacements) {
		const key = `${replacement.start}:${replacement.end}`;
		const values = grouped.get(key) ?? [];
		values.push(replacement);
		grouped.set(key, values);
	}

	let output = content;
	const groups = [...grouped.values()].sort((a, b) => b[0].start - a[0].start);
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
		const originalValue = JSON.parse(originalRaw) as
			| string
			| number
			| boolean
			| null;
		if (translated === String(originalValue)) continue;
		let encoded: string;
		switch (group[0].valueType) {
			case "number":
				encoded = Number.isFinite(Number(translated))
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
		output = `${output.slice(0, group[0].start)}${encoded}${output.slice(group[0].end)}`;
	}
	return output;
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
	format: "docx" | "xlsx" | "pptx",
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
				replacement.kind === "json-value") &&
			(replacement.start < 0 || replacement.end < replacement.start)
		) {
			issues.push("Replacement text ranges are invalid.");
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
			const candidate = entry as { path?: string[]; separator?: string };
			if (!Array.isArray(candidate.path)) return [];
			const location = locations.find(
				(value) =>
					value.path.length === candidate.path!.length &&
					value.path.every((part, index) => part === candidate.path![index]),
			);
			return location
				? [
						{
							kind: "json-value" as const,
							unitIndex,
							path: [...candidate.path],
							start: location.start,
							end: location.end,
							valueType: location.valueType,
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
	if (!skeleton || skeleton.format === "xlsx") return skeleton;
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
