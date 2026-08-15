export interface SplitPiece {
	text: string;
	start: number;
	end: number;
	separator: string;
}

const DEFAULT_BOUNDARY = /([.?!。！？])\s*(?=[A-ZÀ-ÖØ-Þ]|$)/g;
const DEFAULT_DELIMS = [".", "?", "!", "。", "！", "？"];

// Splits text using provided tokens if given; otherwise uses active tokens; otherwise defaults.
export function splitTextWithPreferences(
	text: string,
	tokens?: string[],
	getActiveTokens?: () => string[],
): SplitPiece[] {
	const activeTokens =
		(tokens && tokens.length > 0
			? tokens
			: getActiveTokens
				? getActiveTokens()
				: []) ?? [];
	if (!activeTokens || activeTokens.length === 0) {
		return splitOnBoundary(text, DEFAULT_BOUNDARY);
	}

	// Prefer longer tokens so a custom token such as ". " is not shadowed by ".".
	const merged = Array.from(
		new Set(
			[...DEFAULT_DELIMS, ...activeTokens].filter((token) => token.length > 0),
		),
	).sort((a, b) => b.length - a.length);
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
