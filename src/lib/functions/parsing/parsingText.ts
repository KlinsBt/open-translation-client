import { splitTextWithPreferences } from "./splitWithPreferences";
import { getActiveTokens } from "./parsingPreferences";

export type PlainTextSegmentationMode =
	| "preferences"
	| "sentences"
	| "srx"
	| "paragraphs"
	| "lines"
	| "document";

export interface PlainTextSegment {
	text: string;
	start: number;
	end: number;
	separator: string;
	line: number;
	direction: "ltr" | "rtl" | "auto";
}

const LINE_BREAK = /\r\n|\n|\r/g;
const PARAGRAPH_BREAK =
	/(?:\r\n|\r(?!\n)|(?<!\r)\n)[\t\f\v ]*(?:\r\n|\r(?!\n)|(?<!\r)\n)(?:(?:[\t\f\v ]*)(?:\r\n|\r(?!\n)|(?<!\r)\n))*/g;
const RTL_CHARACTER = /[\p{Script=Arabic}\p{Script=Hebrew}]/u;
const STRONG_LTR_CHARACTER = /\p{Letter}/u;

export function detectPlainTextDirection(text: string): "ltr" | "rtl" | "auto" {
	for (const character of text) {
		if (RTL_CHARACTER.test(character)) return "rtl";
		if (STRONG_LTR_CHARACTER.test(character)) return "ltr";
	}
	return "auto";
}

function lineAt(content: string, offset: number): number {
	LINE_BREAK.lastIndex = 0;
	let line = 1;
	let match: RegExpExecArray | null;
	while ((match = LINE_BREAK.exec(content)) && match.index < offset) line++;
	return line;
}

function addPlainTextSegment(
	content: string,
	segments: PlainTextSegment[],
	rawStart: number,
	rawEnd: number,
	separator = "",
	trimOuterWhitespace = false,
) {
	let start = rawStart;
	let end = rawEnd;
	if (trimOuterWhitespace) {
		while (start < end && /\s/.test(content[start])) start++;
		while (end > start && /\s/.test(content[end - 1])) end--;
	}
	const text = content.slice(start, end);
	if (!text.trim()) return;
	segments.push({
		text,
		start,
		end,
		separator,
		line: lineAt(content, start),
		direction: detectPlainTextDirection(text),
	});
}

/**
 * Segments TXT without modifying the source string. Returned offsets point to
 * the exact editable ranges; BOMs, line endings, empty lines, and surrounding
 * whitespace remain outside those ranges in the skeleton.
 */
export function segmentPlainText(
	content: string,
	mode: PlainTextSegmentationMode,
	tokens?: string[],
): PlainTextSegment[] {
	const segments: PlainTextSegment[] = [];
	const contentStart = content.startsWith("\ufeff") ? 1 : 0;

	if (mode === "document") {
		addPlainTextSegment(content, segments, contentStart, content.length);
		return segments;
	}

	if (mode === "lines") {
		LINE_BREAK.lastIndex = 0;
		let cursor = contentStart;
		let match: RegExpExecArray | null;
		while ((match = LINE_BREAK.exec(content))) {
			if (match.index < contentStart) continue;
			addPlainTextSegment(content, segments, cursor, match.index, match[0]);
			cursor = match.index + match[0].length;
		}
		addPlainTextSegment(content, segments, cursor, content.length);
		return segments;
	}

	if (mode === "paragraphs") {
		PARAGRAPH_BREAK.lastIndex = 0;
		let cursor = contentStart;
		let match: RegExpExecArray | null;
		while ((match = PARAGRAPH_BREAK.exec(content))) {
			if (match.index < contentStart) continue;
			addPlainTextSegment(
				content,
				segments,
				cursor,
				match.index,
				match[0],
				true,
			);
			cursor = match.index + match[0].length;
		}
		addPlainTextSegment(content, segments, cursor, content.length, "", true);
		return segments;
	}

	const body = content.slice(contentStart);
	for (const piece of splitTextWithPreferences(
		body,
		tokens ?? getActiveTokens(),
	)) {
		const trailingWhitespace = piece.separator.match(/\s+$/)?.[0] ?? "";
		const visibleSeparator = trailingWhitespace
			? piece.separator.slice(0, -trailingWhitespace.length)
			: piece.separator;
		const text = `${piece.text}${visibleSeparator}`;
		if (!text.trim()) continue;
		const start = contentStart + piece.start;
		const end = start + text.length;
		segments.push({
			text,
			start,
			end,
			separator: trailingWhitespace,
			line: lineAt(content, start),
			direction: detectPlainTextDirection(text),
		});
	}
	return segments;
}

export function segmentPlainTextAtBreaks(
	content: string,
	breakPositions: readonly number[],
): PlainTextSegment[] {
	const segments: PlainTextSegment[] = [];
	const contentStart = content.startsWith("\ufeff") ? 1 : 0;
	let cursor = contentStart;
	const boundaries = [...new Set(breakPositions)]
		.filter(
			(position) =>
				Number.isInteger(position) &&
				position > contentStart &&
				position < content.length,
		)
		.sort((first, second) => first - second);
	for (const boundary of boundaries) {
		addPlainTextSegment(content, segments, cursor, boundary, "", true);
		cursor = boundary;
	}
	addPlainTextSegment(content, segments, cursor, content.length, "", true);
	return segments;
}

// More sophisticated filter using the array of strings as
// filter criteria to create text segments
const PARSE_CRITERIA: string[] = [".", "?", "!", ". ", "? ", "! "];
export async function createTextSegmentsByArrayFilters(fullText: string) {
	const tokens = PARSE_CRITERIA.filter((token) => token.trim().length > 0);
	const segments = splitTextWithPreferences(fullText, tokens)
		.map((piece) => `${piece.text}${piece.separator}`)
		.filter((segment) => segment.length > 0);
	return buildSegmentArrays(segments);
}

// Simple filter by "." to create text segments
export async function createTextSegmentsSimple(fullText: string) {
	const segments = splitTextWithPreferences(fullText, ["."])
		.map((piece) => `${piece.text}${piece.separator}`)
		.filter((segment) => segment.length > 0);
	return buildSegmentArrays(segments);
}

export function createTextSegmentsWithRegexGeneralTextAlgo(
	fullText: string,
): [string[], string[], boolean[]] {
	// Normalize line endings, unescape literal \n, strip wrapping quotes
	let normalized = fullText
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "")
		.replace(/\\n/g, "\n");
	normalized = normalized.replace(/^["']+|["']+$/g, "").trim();
	const tokens = getActiveTokens();

	const splitBySentences = (text: string) =>
		text
			.replace(/([.?!])\s+(?=[A-Z])/g, "$1|")
			.split("|")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);

	const segments: string[] = [];
	const paragraphs = normalized.split(/\n{2,}/);

	for (let pIndex = 0; pIndex < paragraphs.length; pIndex++) {
		const para = paragraphs[pIndex].trim();
		if (!para) continue;

		if (tokens && tokens.length > 0) {
			const pieces = splitTextWithPreferences(para, tokens).filter(
				(p) => (p.text + (p.separator ?? "")).trim().length > 0,
			);
			pieces.forEach((p, idx) => {
				let seg = `${p.text}${p.separator ?? ""}`;
				if (seg.trim().length > 0) segments.push(seg);
			});
		} else {
			const parts = splitBySentences(para);
			segments.push(...parts);
		}
	}

	// If no segments (empty input), return defaults
	if (segments.length === 0) {
		return [[], [], []];
	}

	return buildSegmentArrays(segments);
}

function buildSegmentArrays(
	segments: string[],
): [string[], string[], boolean[]] {
	const textSegments1: string[] = [];
	const textSegments2: string[] = [];
	const checked: boolean[] = [];

	for (const seg of segments) {
		textSegments1.push(seg);
		textSegments2.push("");
		checked.push(false);
	}

	if (textSegments1.length === 0) {
		return [[], [], []];
	}
	return [textSegments1, textSegments2, checked];
}

// Works well for technical content with a lot of code-like
// patterns and unusual punctuation, spacing and commas
function createTextSegmentsWithRegexTechnicalTextAlgo(fullText: string) {
	// Step 1: Replace double newlines (or more) with a strong delimiter
	let sanitizedText = fullText.replace(/\n\s*\n/g, "|||");

	// Step 2: Replace remaining newlines with a space to avoid splitting within sentences
	sanitizedText = sanitizedText.replace(/\n/g, " ");

	// Step 3: Protect technical content by adding markers around regex and code-like patterns
	sanitizedText = sanitizedText.replace(
		/(replace|split|filter|map)\(([^)]+)\)/g,
		"__MARKER__$1($2)__ENDMARKER__",
	);

	// Step 4: Split on punctuation followed by space and an uppercase letter, also consider the strong delimiter
	let segments = sanitizedText
		.replace(/([.?!])\s+(?=[A-Z])/g, "$1|||") // Split by punctuation followed by space and uppercase letter
		.split("|||") // Split using the delimiter '|||'
		.map((segment) => segment.trim()) // Trim whitespace around each segment
		.filter((segment) => segment.length > 0); // Filter out any empty segments

	// Step 5: Restore protected technical content
	segments = segments.map((segment) =>
		segment.replace(/__MARKER__(.*?)__ENDMARKER__/g, "$1"),
	);

	let textSegments1: string[] = [];
	let textSegments2: string[] = [];
	let checked: boolean[] = [];
	for (let i = 0; i < segments.length; i++) {
		textSegments1.push(segments[i]);
		textSegments2.push("");
		checked.push(false);
	}
	if (textSegments1.length === 0) {
		return [[], [], []];
	}
	return [textSegments1, textSegments2, checked];
}

// Works well for simple text content with standard punctuation
export async function createTextSegmentsWithRegexSimple(fullText: string) {
	const arrayText: string[] = fullText
		.replace(/([.?!])\s*(?=[A-Z])/g, "$1|")
		.split("|")
		.filter((segment) => segment.length > 0);
	return buildSegmentArrays(arrayText);
}
