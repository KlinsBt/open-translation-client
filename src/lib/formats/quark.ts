import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type {
	PackageXmlSegmentMeta,
	TypeRef,
	UserData,
} from "$lib/types/types";
import { assertProjectExportQuality } from "./qualityAssurance";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import {
	createTextSkeleton,
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TextRangeReplacement,
} from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";

export const QUARK_EXTENSIONS = ["xtg", "tag"] as const;
export const QUARK_MIME_TYPES = [
	"application/vnd.quark.quarkxpress",
	"application/x-quarkxpress",
	"text/plain",
] as const;

interface QuarkTextToken {
	start: number;
	end: number;
	value: string;
	line: number;
}

export interface QuarkDocument {
	version: string;
	encodingCode: number;
	tokens: QuarkTextToken[];
	tags: number;
}

function invalidQuark(message: string): SafeInputError {
	return new SafeInputError("QUARK_INVALID", message);
}

const LITERAL_TAGS = new Map([
	["<\\@>", "@"],
	["<\\<>", "<"],
	["<\\>>", ">"],
	["<\\\\>", "\\"],
]);

function tagEnd(content: string, start: number): number {
	let quote = "";
	for (let cursor = start + 1; cursor < content.length; cursor++) {
		const character = content[cursor];
		if (quote) {
			if (character === quote && content[cursor - 1] !== "\\") quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === ">") return cursor + 1;
	}
	throw invalidQuark(
		`XPress Tags command at character ${start + 1} is not terminated.`,
	);
}

function pushVisibleTokens(
	content: string,
	start: number,
	end: number,
	line: number,
	tokens: QuarkTextToken[],
): number {
	let cursor = start;
	let tags = 0;
	while (cursor < end) {
		if (content[cursor] === "<") {
			const commandEnd = tagEnd(content, cursor);
			if (commandEnd > end)
				throw invalidQuark(`XPress Tags command crosses line ${line}.`);
			const raw = content.slice(cursor, commandEnd);
			const literal = LITERAL_TAGS.get(raw);
			if (literal !== undefined)
				tokens.push({ start: cursor, end: commandEnd, value: literal, line });
			cursor = commandEnd;
			tags++;
			continue;
		}
		let textEnd = content.indexOf("<", cursor);
		if (textEnd < 0 || textEnd > end) textEnd = end;
		const value = content.slice(cursor, textEnd);
		if (value.trim()) tokens.push({ start: cursor, end: textEnd, value, line });
		cursor = textEnd;
	}
	return tags;
}

export function parseQuarkDocument(content: string): QuarkDocument {
	if (content.includes("\0"))
		throw invalidQuark("XPress Tags contains a NUL byte.");
	const header = content.match(/^\ufeff?<v(\d+(?:\.\d+)?)><e(\d+)>/);
	if (!header)
		throw invalidQuark(
			"XPress Tags must begin with adjacent version and encoding commands such as <v21.00><e9>.",
		);
	const encodingCode = Number(header[2]);
	if (!Number.isInteger(encodingCode) || encodingCode < 0 || encodingCode > 9)
		throw invalidQuark(`Unsupported XPress Tags encoding code e${header[2]}.`);
	const tokens: QuarkTextToken[] = [];
	let tags = 2;
	let offset = header[0].length;
	let line = 1;
	while (offset < content.length) {
		let lineEnd = content.indexOf("\n", offset);
		if (lineEnd < 0) lineEnd = content.length;
		const rawLine = content.slice(offset, lineEnd).replace(/\r$/, "");
		const effectiveEnd = offset + rawLine.length;
		if (!/^\s*@[^=\r\n]{1,200}=/.test(rawLine)) {
			const storyPrefix = rawLine.match(/^\s*@[^:\r\n]{1,200}:/)?.[0];
			const visibleStart = offset + (storyPrefix?.length ?? 0);
			tags += pushVisibleTokens(
				content,
				visibleStart,
				effectiveEnd,
				line,
				tokens,
			);
		}
		offset = lineEnd < content.length ? lineEnd + 1 : content.length;
		line++;
	}
	return { version: header[1], encodingCode, tokens, tags };
}

export function encodeQuarkText(value: string): string {
	return value.replace(/[\\@<>]/g, (character) => {
		if (character === "\\") return "<\\\\>";
		return `<\\${character}>`;
	});
}

export async function validateQuarkFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const read = await readSafeTextFile(file, context);
		const parsed = parseQuarkDocument(read.text);
		if (parsed.encodingCode === 8 && !read.encoding.startsWith("utf-16"))
			throw invalidQuark(
				"XPress Tags e8 declares UTF-16, but the bytes are not UTF-16.",
			);
		if (parsed.encodingCode === 9 && read.encoding !== "utf-8")
			throw invalidQuark(
				"XPress Tags e9 declares UTF-8, but the bytes are not UTF-8.",
			);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not safe, structurally valid XPress Tags text.",
				};
	}
}

export async function importQuarkFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("quark", options);
	const read = await readSafeTextFile(file, context);
	const parsed = parseQuarkDocument(read.text);
	const validation = await validateQuarkFile(file, context);
	if (!validation.valid)
		throw invalidQuark(validation.reason ?? "Invalid XPress Tags file.");
	const segments: string[] = [];
	const replacements: TextRangeReplacement[] = [];
	const meta: PackageXmlSegmentMeta[] = [];
	for (const token of parsed.tokens) {
		const pieces =
			filterOptions.segmentationMode === "sentences"
				? segmentPlainText(token.value, "sentences")
				: filterOptions.segmentationMode === "preferences"
					? splitTextWithPreferences(token.value)
					: [{ text: token.value, separator: "" }];
		const effective = pieces.filter((piece) => piece.text.trim());
		for (const piece of effective.length
			? effective
			: [{ text: token.value, separator: "" }]) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			replacements.push({
				kind: "text-range",
				unitIndex,
				start: token.start,
				end: token.end,
				separator: piece.separator ?? "",
			});
			meta.push({
				profile: "xpress-tags-text",
				part: file.name,
				path: [`line[${token.line}]`, `text[${unitIndex + 1}]`],
				location: "text",
				start: token.start,
				end: token.end,
				originalValue: token.value,
				separator: piece.separator ?? "",
			});
		}
	}
	if (!segments.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"The XPress Tags file contains no visible text outside protected commands and style definitions.",
		);
	const document = createNeutralDocument({
		format: "quark",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: entry.part,
			path: entry.path,
			line: parsed.tokens[segmentIndex]?.line,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: `QuarkXPress Tags ${parsed.version}`,
		encodingCode: parsed.encodingCode,
		commands: parsed.tags,
		security:
			"Formatting commands, style definitions, object references, and unknown tags remain inert protected source ranges.",
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"quark",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: {
			profile: "xpress-tags",
			version: parsed.version,
			encodingCode: parsed.encodingCode,
		} as unknown as TypeRef,
		segmentsMeta: meta,
	};
}

export function buildQuarkTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "quark");
	if (content === undefined)
		throw new Error(
			"XPress Tags export requires its original tagged-text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is TextRangeReplacement =>
			replacement.kind === "text-range",
	);
	if (
		replacements.length !== data.seg2.length ||
		new Set(replacements.map((entry) => entry.unitIndex)).size !==
			replacements.length
	)
		throw new Error(
			"XPress Tags mappings no longer align with the project segments.",
		);
	const groups = new Map<string, TextRangeReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.start < 0 || replacement.end > content.length)
			throw new Error("An XPress Tags mapping points outside its source file.");
		const key = `${replacement.start}:${replacement.end}`;
		groups.set(key, [...(groups.get(key) ?? []), replacement]);
	}
	let output = content;
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const group of groups.values()) {
		const ordered = group.sort((a, b) => a.unitIndex - b.unitIndex);
		const translated = ordered
			.map((entry) => data.seg2[entry.unitIndex] ?? "")
			.join("");
		const original = ordered
			.map((entry) => data.seg1[entry.unitIndex] ?? "")
			.join("");
		if (translated === original) continue;
		edits.push({
			start: ordered[0].start,
			end: ordered[0].end,
			value: encodeQuarkText(translated),
		});
	}
	for (const edit of edits.sort((a, b) => b.start - a.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseQuarkDocument(output);
	return output;
}

export function buildQuarkTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const output = buildQuarkTranslation(project);
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `application/vnd.quark.quarkxpress;charset=${encoding}` },
	);
}

export async function generateQuarkTranslation(
	project: UserData,
): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"story.xtg";
	const name = /\.(?:xtg|tag)$/i.test(requested)
		? requested
		: `${requested}.xtg`;
	const url = URL.createObjectURL(buildQuarkTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
