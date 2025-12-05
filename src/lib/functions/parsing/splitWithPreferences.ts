import { getActiveTokens } from "./parsingPreferences";

export interface SplitPiece {
	text: string;
	start: number;
	end: number;
	separator: string;
}

const DEFAULT_BOUNDARY = /([.?!。！？])\s*(?=[A-ZÀ-ÖØ-Þ]|$)/g;
const DEFAULT_DELIMS = [".", "?", "!", "。", "！", "？"];

// Splits text using custom tokens if active; otherwise defaults to sentence-ish boundaries.
export function splitTextWithPreferences(text: string): SplitPiece[] {
	const tokens = getActiveTokens();
	if (!tokens || tokens.length === 0) {
		return splitOnBoundary(text, DEFAULT_BOUNDARY);
	}

	// Combine default delimiters with custom tokens so punctuation is still preserved
	const merged = Array.from(new Set([...DEFAULT_DELIMS, ...tokens]));
	const escaped = merged.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	const boundary = new RegExp(`(${escaped.join("|")})`, "g");
	return splitOnBoundary(text, boundary);
}

function splitOnBoundary(text: string, boundary: RegExp): SplitPiece[] {
	const pieces: SplitPiece[] = [];
	let cursor = 0;
	let match: RegExpExecArray | null;

	while ((match = boundary.exec(text)) !== null) {
		const sepStart = match.index;
		const sepEnd = match.index + match[0].length;
		const end = consumeTrailingWhitespace(text, sepEnd);
		pushSegment(text, cursor, sepStart, end, pieces);
		cursor = end;
	}

	if (cursor < text.length) {
		pushSegment(text, cursor, text.length, text.length, pieces);
	}

	return pieces.length > 0
		? pieces
		: [
				{
					text,
					start: 0,
					end: text.length,
					separator: "",
				},
			];
}

function consumeTrailingWhitespace(text: string, index: number): number {
	let i = index;
	while (i < text.length && /\s/.test(text[i])) {
		i++;
	}
	return i;
}

function pushSegment(
	text: string,
	rawStart: number,
	sepStart: number,
	sepEnd: number,
	pieces: SplitPiece[],
) {
	const raw = text.slice(rawStart, sepStart);
	const leading = (raw.match(/^\s*/) || [""])[0].length;
	const trailing = (raw.match(/\s*$/) || [""])[0].length;
	const start = rawStart + leading;
	const trimmedEnd = sepStart - trailing;
	const cleaned = text.slice(start, trimmedEnd);
	if (!cleaned) return;
	const separator = text.slice(trimmedEnd, sepEnd);
	pieces.push({ text: cleaned, start, end: sepEnd, separator });
}
