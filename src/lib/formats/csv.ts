import type { FormatOptionValues } from "./types";

export type CsvEscapeMode = "double" | "backslash";

export interface CsvDialect {
	delimiter: string;
	quote: '"' | "'" | null;
	escapeMode: CsvEscapeMode;
}

export interface CsvField {
	value: string;
	start: number;
	end: number;
	quoted: boolean;
	row: number;
	column: number;
}

export interface CsvRow {
	fields: CsvField[];
	row: number;
	start: number;
	end: number;
	lineEnding: "\r\n" | "\n" | "\r" | "";
}

export interface CsvTable {
	rows: CsvRow[];
	dialect: CsvDialect;
}

export class CsvParseError extends Error {
	readonly name = "CsvParseError";

	constructor(
		message: string,
		readonly offset: number,
	) {
		super(`${message} (character ${offset + 1}).`);
	}
}

const DELIMITERS: Record<string, string> = {
	comma: ",",
	tab: "\t",
	semicolon: ";",
	pipe: "|",
};

export function resolveCsvDialect(
	text: string,
	fileName: string,
	options: Readonly<FormatOptionValues>,
): CsvDialect {
	const requestedDelimiter = String(options.delimiter ?? "auto");
	const delimiter =
		DELIMITERS[requestedDelimiter] ??
		(requestedDelimiter === "auto"
			? fileName.toLowerCase().endsWith(".tsv")
				? "\t"
				: detectDelimiter(text)
			: requestedDelimiter);
	if (delimiter.length !== 1 || /[\r\n"']/.test(delimiter))
		throw new CsvParseError("The delimiter must be one safe character", 0);
	const quoteOption = String(options.quoteCharacter ?? "double");
	const quote =
		quoteOption === "none" ? null : quoteOption === "single" ? "'" : '"';
	const escapeMode =
		options.escapeMode === "backslash" ? "backslash" : "double";
	return { delimiter, quote, escapeMode };
}

export function parseCsv(text: string, dialect: CsvDialect): CsvTable {
	const rows: CsvRow[] = [];
	let cursor = text.startsWith("\ufeff") ? 1 : 0;
	if (cursor === text.length) return { rows, dialect };

	while (cursor < text.length) {
		const row = rows.length;
		const rowStart = cursor;
		const fields: CsvField[] = [];
		let lineEnding: CsvRow["lineEnding"] = "";

		while (true) {
			const column = fields.length;
			const start = cursor;
			let value = "";
			let quoted = false;

			if (dialect.quote && text[cursor] === dialect.quote) {
				quoted = true;
				cursor++;
				let closed = false;
				while (cursor < text.length) {
					const character = text[cursor];
					if (
						dialect.escapeMode === "backslash" &&
						character === "\\" &&
						(text[cursor + 1] === dialect.quote || text[cursor + 1] === "\\")
					) {
						value += text[cursor + 1];
						cursor += 2;
						continue;
					}
					if (character === dialect.quote) {
						if (
							dialect.escapeMode === "double" &&
							text[cursor + 1] === dialect.quote
						) {
							value += dialect.quote;
							cursor += 2;
							continue;
						}
						cursor++;
						closed = true;
						break;
					}
					value += character;
					cursor++;
				}
				if (!closed)
					throw new CsvParseError("A quoted field is not terminated", start);
				if (
					cursor < text.length &&
					text[cursor] !== dialect.delimiter &&
					text[cursor] !== "\r" &&
					text[cursor] !== "\n"
				)
					throw new CsvParseError(
						"Unexpected text follows a closing quote",
						cursor,
					);
			} else {
				while (
					cursor < text.length &&
					text[cursor] !== dialect.delimiter &&
					text[cursor] !== "\r" &&
					text[cursor] !== "\n"
				) {
					if (dialect.quote && text[cursor] === dialect.quote)
						throw new CsvParseError(
							"A quote appears inside an unquoted field",
							cursor,
						);
					value += text[cursor++];
				}
			}

			fields.push({ value, start, end: cursor, quoted, row, column });
			if (text[cursor] === dialect.delimiter) {
				cursor++;
				if (cursor === text.length) {
					fields.push({
						value: "",
						start: cursor,
						end: cursor,
						quoted: false,
						row,
						column: fields.length,
					});
					break;
				}
				continue;
			}
			if (text[cursor] === "\r") {
				lineEnding = text[cursor + 1] === "\n" ? "\r\n" : "\r";
				cursor += lineEnding.length;
			} else if (text[cursor] === "\n") {
				lineEnding = "\n";
				cursor++;
			}
			break;
		}

		rows.push({
			fields,
			row,
			start: rowStart,
			end: cursor - lineEnding.length,
			lineEnding,
		});
	}
	return { rows, dialect };
}

function detectDelimiter(text: string): string {
	const candidates = [",", "\t", ";", "|"];
	const rowWidths = new Map(candidates.map((delimiter) => [delimiter, [1]]));
	let inQuotes = false;
	let row = 0;
	for (
		let index = text.startsWith("\ufeff") ? 1 : 0;
		index < text.length && row < 25;
		index++
	) {
		const character = text[index];
		if (character === '"') {
			if (inQuotes && text[index + 1] === '"') index++;
			else inQuotes = !inQuotes;
			continue;
		}
		if (inQuotes) continue;
		if (candidates.includes(character)) rowWidths.get(character)![row]++;
		if (character === "\r" || character === "\n") {
			if (character === "\r" && text[index + 1] === "\n") index++;
			row++;
			if (row < 25) for (const widths of rowWidths.values()) widths.push(1);
		}
	}
	let best = { delimiter: ",", score: -1 };
	for (const delimiter of candidates) {
		const frequency = new Map<number, number>();
		for (const width of rowWidths.get(delimiter) ?? [])
			frequency.set(width, (frequency.get(width) ?? 0) + 1);
		const [width, occurrences] = [...frequency.entries()].sort(
			(first, second) => second[1] - first[1] || second[0] - first[0],
		)[0];
		const score = width > 1 ? occurrences * 100 + width : 0;
		if (score > best.score) best = { delimiter, score };
	}
	return best.delimiter;
}

export function resolveCsvColumn(
	selector: string,
	header: readonly CsvField[] | undefined,
	requiredLabel: string,
): number | undefined {
	const value = selector.trim();
	if (!value) return undefined;
	const headerIndex = header?.findIndex(
		(field) =>
			field.value.trim().toLocaleLowerCase() === value.toLocaleLowerCase(),
	);
	if (headerIndex !== undefined && headerIndex >= 0) return headerIndex;
	if (/^[A-Za-z]+$/.test(value)) {
		let index = 0;
		for (const character of value.toUpperCase())
			index = index * 26 + character.charCodeAt(0) - 64;
		return index - 1;
	}
	if (/^[1-9]\d*$/.test(value)) return Number(value) - 1;
	throw new Error(
		`The ${requiredLabel} column “${selector}” is not a header name, column letter, or 1-based column number.`,
	);
}

export function isCsvFormulaInjection(value: string): boolean {
	return /^[=+\-@\t\r\n＝＋－＠]/u.test(value);
}

/** Prefixes untrusted spreadsheet formula markers with an apostrophe so CSV
 * consumers treat the cell as literal text. This is intentionally used for
 * newly generated conversion CSVs; native CSV round trips preserve source data
 * and surface a warning instead of silently changing it. */
export function neutralizeCsvFormula(value: string): string {
	return isCsvFormulaInjection(value) ? `'${value}` : value;
}

export function encodeCsvField(
	value: string,
	replacement: {
		delimiter: string;
		quote: '"' | "'" | null;
		escapeMode: CsvEscapeMode;
		quoted: boolean;
	},
): string {
	const { delimiter, quote, escapeMode, quoted } = replacement;
	const needsQuote =
		value.includes(delimiter) ||
		/[\r\n]/.test(value) ||
		Boolean(quote && value.includes(quote));
	if (!quote) {
		if (needsQuote)
			throw new Error(
				"A translated CSV/TSV field contains a delimiter, quote, or line break, but quoting is disabled.",
			);
		return value;
	}
	if (!quoted && !needsQuote) return value;
	const escaped =
		escapeMode === "backslash"
			? value.replaceAll("\\", "\\\\").replaceAll(quote, `\\${quote}`)
			: value.replaceAll(quote, `${quote}${quote}`);
	return `${quote}${escaped}${quote}`;
}
