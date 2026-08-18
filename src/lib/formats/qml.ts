import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { PackageXmlSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type TextRangeReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export type QmlQuote = '"' | "'" | "`";
type QmlTokenKind = "word" | "number" | "string" | "regex" | "symbol";

export interface QmlToken {
	kind: QmlTokenKind;
	value: string;
	raw: string;
	start: number;
	end: number;
	line: number;
	quote?: QmlQuote;
	interpolated?: boolean;
}

export interface QmlDocument {
	tokens: QmlToken[];
	strings: QmlToken[];
	translationCalls: number;
}

interface TranslationCall {
	functionName: string;
	token: QmlToken;
	context?: string;
	disambiguation?: string;
}

function invalidQml(message: string): SafeInputError {
	return new SafeInputError("QML_INVALID", message);
}

function decodeUnicodeEscape(raw: string, length: number): string {
	const digits = raw.slice(0, length);
	if (!new RegExp(`^[0-9A-Fa-f]{${length}}$`).test(digits))
		throw invalidQml("QML string has a malformed Unicode escape.");
	return String.fromCodePoint(Number.parseInt(digits, 16));
}

export function decodeQmlString(raw: string): string {
	let output = "";
	for (let cursor = 0; cursor < raw.length; cursor++) {
		if (raw[cursor] !== "\\") {
			output += raw[cursor];
			continue;
		}
		const next = raw[cursor + 1];
		if (next === "\n") {
			cursor++;
			continue;
		}
		if (next === "\r" && raw[cursor + 2] === "\n") {
			cursor += 2;
			continue;
		}
		if (next === "x") {
			output += decodeUnicodeEscape(raw.slice(cursor + 2), 2);
			cursor += 3;
			continue;
		}
		if (next === "u") {
			if (raw[cursor + 2] === "{") {
				const close = raw.indexOf("}", cursor + 3);
				if (close < 0) throw invalidQml("QML Unicode escape is not closed.");
				const digits = raw.slice(cursor + 3, close);
				if (!/^[0-9A-Fa-f]{1,6}$/.test(digits))
					throw invalidQml("QML string has a malformed Unicode escape.");
				const codePoint = Number.parseInt(digits, 16);
				if (codePoint > 0x10ffff)
					throw invalidQml("QML string has an invalid Unicode code point.");
				output += String.fromCodePoint(codePoint);
				cursor = close;
			} else {
				output += decodeUnicodeEscape(raw.slice(cursor + 2), 4);
				cursor += 5;
			}
			continue;
		}
		const escapes: Record<string, string> = {
			b: "\b",
			f: "\f",
			n: "\n",
			r: "\r",
			t: "\t",
			v: "\v",
			"0": "\0",
			"\\": "\\",
			'"': '"',
			"'": "'",
			"`": "`",
			$: "$",
		};
		if (!next) throw invalidQml("QML string ends with an escape prefix.");
		output += escapes[next] ?? next;
		cursor++;
	}
	return output;
}

function canStartRegex(previous: QmlToken | undefined): boolean {
	if (!previous) return true;
	if (previous.kind === "word")
		return [
			"case",
			"delete",
			"in",
			"instanceof",
			"new",
			"of",
			"return",
			"throw",
			"typeof",
			"void",
			"yield",
		].includes(previous.value);
	return (
		previous.kind === "symbol" &&
		["(", "[", "{", ",", ":", ";", "=", "!", "?", "&", "|"].includes(
			previous.value,
		)
	);
}

function scanRegex(content: string, start: number): number | undefined {
	let cursor = start + 1;
	let characterClass = false;
	while (cursor < content.length) {
		const character = content[cursor];
		if (character === "\n" || character === "\r") return undefined;
		if (character === "\\") {
			cursor += 2;
			continue;
		}
		if (character === "[") characterClass = true;
		else if (character === "]") characterClass = false;
		else if (character === "/" && !characterClass) {
			cursor++;
			while (/[A-Za-z]/.test(content[cursor] ?? "")) cursor++;
			return cursor;
		}
		cursor++;
	}
	return undefined;
}

export function tokenizeQml(content: string): QmlToken[] {
	if (content.includes("\0")) throw invalidQml("QML contains a NUL byte.");
	const tokens: QmlToken[] = [];
	let cursor = content.startsWith("\ufeff") ? 1 : 0;
	let line = 1;
	while (cursor < content.length) {
		const character = content[cursor];
		if (character === "\n") {
			line++;
			cursor++;
			continue;
		}
		if (/\s/.test(character)) {
			cursor++;
			continue;
		}
		if (content.startsWith("//", cursor)) {
			const newline = content.indexOf("\n", cursor + 2);
			cursor = newline < 0 ? content.length : newline;
			continue;
		}
		if (content.startsWith("/*", cursor)) {
			const end = content.indexOf("*/", cursor + 2);
			if (end < 0)
				throw invalidQml(`Block comment on line ${line} is not terminated.`);
			const comment = content.slice(cursor, end + 2);
			line += comment.match(/\n/g)?.length ?? 0;
			cursor = end + 2;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			const quote = character as QmlQuote;
			let end = cursor + 1;
			let interpolated = false;
			while (end < content.length) {
				if (content[end] === "\\") {
					if (content[end + 1] === "\n") line++;
					else if (content[end + 1] === "\r" && content[end + 2] === "\n")
						line++;
					end += content[end + 1] === "\r" ? 3 : 2;
					continue;
				}
				if (quote !== "`" && /[\r\n]/.test(content[end]))
					throw invalidQml(`String on line ${line} is not terminated.`);
				if (quote === "`" && content.startsWith("${", end)) interpolated = true;
				if (content[end] === "\n") line++;
				if (content[end] === quote) break;
				end++;
			}
			if (end >= content.length)
				throw invalidQml(`String on line ${line} is not terminated.`);
			const raw = content.slice(cursor + 1, end);
			tokens.push({
				kind: "string",
				value: decodeQmlString(raw),
				raw,
				start: cursor + 1,
				end,
				line,
				quote,
				...(interpolated ? { interpolated: true } : {}),
			});
			cursor = end + 1;
			continue;
		}
		if (character === "/" && canStartRegex(tokens.at(-1))) {
			const end = scanRegex(content, cursor);
			if (end !== undefined) {
				tokens.push({
					kind: "regex",
					value: content.slice(cursor, end),
					raw: content.slice(cursor, end),
					start: cursor,
					end,
					line,
				});
				cursor = end;
				continue;
			}
		}
		if (/[A-Za-z_$]/.test(character)) {
			let end = cursor + 1;
			while (/[A-Za-z0-9_$]/.test(content[end] ?? "")) end++;
			const raw = content.slice(cursor, end);
			tokens.push({
				kind: "word",
				value: raw,
				raw,
				start: cursor,
				end,
				line,
			});
			cursor = end;
			continue;
		}
		if (/\d/.test(character)) {
			let end = cursor + 1;
			while (/[\w.]/.test(content[end] ?? "")) end++;
			const raw = content.slice(cursor, end);
			tokens.push({
				kind: "number",
				value: raw,
				raw,
				start: cursor,
				end,
				line,
			});
			cursor = end;
			continue;
		}
		tokens.push({
			kind: "symbol",
			value: character,
			raw: character,
			start: cursor,
			end: cursor + 1,
			line,
		});
		cursor++;
	}
	return tokens;
}

function validateBrackets(tokens: readonly QmlToken[]): void {
	const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
	const stack: QmlToken[] = [];
	for (const token of tokens) {
		if (token.kind !== "symbol") continue;
		if (["(", "[", "{"].includes(token.value)) stack.push(token);
		else if (token.value in pairs) {
			if (stack.at(-1)?.value !== pairs[token.value])
				throw invalidQml(
					`QML has a mismatched ${token.value} on line ${token.line}.`,
				);
			stack.pop();
		}
	}
	if (stack.length)
		throw invalidQml(
			`QML ${stack.at(-1)!.value} on line ${stack.at(-1)!.line} is not closed.`,
		);
}

function directString(argument: readonly QmlToken[]): QmlToken | undefined {
	return argument.length === 1 &&
		argument[0].kind === "string" &&
		!argument[0].interpolated
		? argument[0]
		: undefined;
}

function callArguments(
	tokens: readonly QmlToken[],
	openIndex: number,
): { args: QmlToken[][]; closeIndex: number } | undefined {
	const args: QmlToken[][] = [[]];
	let round = 1;
	let square = 0;
	let curly = 0;
	for (let index = openIndex + 1; index < tokens.length; index++) {
		const token = tokens[index];
		if (token.kind === "symbol") {
			if (token.value === "(") round++;
			else if (token.value === ")") {
				round--;
				if (round === 0) return { args, closeIndex: index };
			} else if (token.value === "[") square++;
			else if (token.value === "]") square--;
			else if (token.value === "{") curly++;
			else if (token.value === "}") curly--;
			else if (
				token.value === "," &&
				round === 1 &&
				square === 0 &&
				curly === 0
			) {
				args.push([]);
				continue;
			}
		}
		args.at(-1)!.push(token);
	}
	return undefined;
}

function parseFunctionSelectors(value: unknown): Map<string, number> {
	const selectors = new Map<string, number>();
	for (const item of parseList(String(value ?? ""))) {
		const match = item.match(/^([A-Za-z_$][\w$]*):([1-9]\d*)$/);
		if (match) selectors.set(match[1], Number(match[2]) - 1);
	}
	return selectors;
}

function findTranslationCalls(
	tokens: readonly QmlToken[],
	selectors: ReadonlyMap<string, number>,
): TranslationCall[] {
	const calls: TranslationCall[] = [];
	const seen = new Set<number>();
	for (let index = 0; index < tokens.length - 1; index++) {
		const functionToken = tokens[index];
		if (
			functionToken.kind !== "word" ||
			!selectors.has(functionToken.value) ||
			tokens[index + 1].value !== "("
		)
			continue;
		const call = callArguments(tokens, index + 1);
		if (!call) continue;
		const sourceArgument = selectors.get(functionToken.value)!;
		const token = directString(call.args[sourceArgument] ?? []);
		if (!token || seen.has(token.start)) continue;
		seen.add(token.start);
		const firstArgument = directString(call.args[0] ?? []);
		const secondArgument = directString(call.args[1] ?? []);
		calls.push({
			functionName: functionToken.value,
			token,
			...(functionToken.value === "qsTranslate" ||
			functionToken.value === "QT_TRANSLATE_NOOP"
				? { context: firstArgument?.value }
				: {}),
			...(functionToken.value === "qsTr" && secondArgument
				? { disambiguation: secondArgument.value }
				: {}),
		});
	}
	return calls;
}

function translatorNotes(content: string, start: number): string[] {
	const lines = content.slice(0, start).split(/\r?\n/);
	const notes: string[] = [];
	for (let index = lines.length - 2; index >= 0; index--) {
		const match = lines[index].match(/^\s*\/\/[:~]\s*(.+?)\s*$/);
		if (!match) break;
		notes.unshift(match[1]);
	}
	return notes;
}

export function parseQmlDocument(
	content: string,
	functionSelectors = "qsTr:1,qsTranslate:2,QT_TR_NOOP:1,QT_TRANSLATE_NOOP:2",
): QmlDocument {
	const tokens = tokenizeQml(content);
	validateBrackets(tokens);
	const hasImport = tokens.some(
		(token) => token.kind === "word" && token.value === "import",
	);
	const hasObject = tokens.some(
		(token, index) =>
			token.kind === "word" &&
			/^[A-Z]/.test(token.value) &&
			tokens[index + 1]?.value === "{",
	);
	if (!hasImport && !hasObject)
		throw invalidQml("No QML import or root object declaration was found.");
	const calls = findTranslationCalls(
		tokens,
		parseFunctionSelectors(functionSelectors),
	);
	return {
		tokens,
		strings: tokens.filter((token) => token.kind === "string"),
		translationCalls: calls.length,
	};
}

export async function validateQmlFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseQmlDocument(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not safe, structurally valid QML.",
				};
	}
}

export async function importQmlFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("qml", options);
	const read = await readSafeTextFile(file, context);
	const tokens = tokenizeQml(read.text);
	validateBrackets(tokens);
	parseQmlDocument(read.text, String(filterOptions.functionSelectors));
	const calls = findTranslationCalls(
		tokens,
		parseFunctionSelectors(filterOptions.functionSelectors),
	);
	const segments: string[] = [];
	const replacements: TextRangeReplacement[] = [];
	const meta: PackageXmlSegmentMeta[] = [];
	const unitInfo: Array<{
		context?: string;
		disambiguation?: string;
		notes: string[];
	}> = [];
	for (const call of calls) {
		const pieces =
			filterOptions.segmentationMode === "sentences"
				? segmentPlainText(call.token.value, "sentences")
				: filterOptions.segmentationMode === "preferences"
					? splitTextWithPreferences(call.token.value)
					: [{ text: call.token.value, separator: "" }];
		const effective = pieces.filter((piece) => piece.text.trim());
		for (const piece of effective.length
			? effective
			: [{ text: call.token.value, separator: "" }]) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			replacements.push({
				kind: "text-range",
				unitIndex,
				start: call.token.start,
				end: call.token.end,
				separator: piece.separator ?? "",
			});
			meta.push({
				profile: "qml-translation-call",
				part: file.name,
				path: [call.functionName, `line[${call.token.line}]`],
				location: "text",
				start: call.token.start,
				end: call.token.end,
				originalValue: call.token.value,
				separator: piece.separator ?? "",
			});
			unitInfo.push({
				...(call.context ? { context: call.context } : {}),
				...(call.disambiguation ? { disambiguation: call.disambiguation } : {}),
				notes: translatorNotes(read.text, call.token.start),
			});
		}
	}
	const document = createNeutralDocument({
		format: "qml",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: entry.part,
			path: entry.path,
			line: Number(entry.path[1]?.match(/\d+/)?.[0]),
			segmentIndex,
		})),
	});
	for (const [index, info] of unitInfo.entries()) {
		if (info.context)
			document.units[index].contexts.push({
				type: "qml-context",
				value: info.context,
			});
		if (info.disambiguation)
			document.units[index].contexts.push({
				type: "qml-disambiguation",
				value: info.disambiguation,
			});
		for (const note of info.notes)
			document.units[index].notes.push({
				category: "translator",
				text: note,
				appliesTo: "unit",
			});
	}
	document.metadata = {
		profile: "Qt QML source",
		translationCalls: calls.length,
		strings: tokens.filter((token) => token.kind === "string").length,
		encoding: read.encoding,
		security:
			"Only direct non-interpolated literal arguments selected for Qt translation APIs are editable; bindings, IDs, bare strings, regexes, imports, and comments remain inert.",
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"qml",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "qml", version: "qt" } as TypeRef,
		segmentsMeta: meta,
	};
}
