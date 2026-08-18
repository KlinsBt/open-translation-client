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

type RcTokenKind = "word" | "string" | "symbol";

export interface RcToken {
	kind: RcTokenKind;
	value: string;
	raw: string;
	start: number;
	end: number;
	line: number;
}

export interface WindowsRcDocument {
	tokens: RcToken[];
	strings: RcToken[];
	resources: number;
}

const BLOCK_RESOURCES = new Set([
	"ACCELERATORS",
	"DIALOG",
	"DIALOGEX",
	"MENU",
	"MENUEX",
	"STRINGTABLE",
	"VERSIONINFO",
]);

const RESOURCE_TYPES = new Set([
	...BLOCK_RESOURCES,
	"BITMAP",
	"CURSOR",
	"HTML",
	"ICON",
	"RCDATA",
	"WAVE",
]);

function invalidRc(message: string): SafeInputError {
	return new SafeInputError("WINDOWS_RC_INVALID", message);
}

function isWordStart(character: string): boolean {
	return /[A-Za-z_]/.test(character);
}

function isWordPart(character: string): boolean {
	return /[A-Za-z0-9_.$-]/.test(character);
}

export function decodeRcString(raw: string): string {
	let output = "";
	for (let cursor = 0; cursor < raw.length; cursor++) {
		if (raw[cursor] === '"' && raw[cursor + 1] === '"') {
			output += '"';
			cursor++;
			continue;
		}
		if (raw[cursor] !== "\\") {
			output += raw[cursor];
			continue;
		}
		const rest = raw.slice(cursor + 1);
		const hex = rest.match(/^x([0-9A-Fa-f]+)/);
		const unicode = rest.match(/^u([0-9A-Fa-f]{4})/);
		const longUnicode = rest.match(/^U([0-9A-Fa-f]{8})/);
		const octal = rest.match(/^([0-7]{1,3})/);
		if (longUnicode) {
			const codePoint = Number.parseInt(longUnicode[1], 16);
			if (codePoint > 0x10ffff)
				throw invalidRc("Windows RC string has an invalid Unicode escape.");
			output += String.fromCodePoint(codePoint);
			cursor += longUnicode[0].length;
		} else if (unicode) {
			output += String.fromCharCode(Number.parseInt(unicode[1], 16));
			cursor += unicode[0].length;
		} else if (hex) {
			output += String.fromCodePoint(Number.parseInt(hex[1], 16));
			cursor += hex[0].length;
		} else if (octal) {
			output += String.fromCharCode(Number.parseInt(octal[1], 8));
			cursor += octal[0].length;
		} else {
			const escapes: Record<string, string> = {
				a: "\x07",
				b: "\b",
				f: "\f",
				n: "\n",
				r: "\r",
				t: "\t",
				v: "\v",
				"\\": "\\",
				'"': '"',
			};
			const escaped = rest[0];
			if (!escaped)
				throw invalidRc("Windows RC string ends with an escape prefix.");
			output += escapes[escaped] ?? escaped;
			cursor++;
		}
	}
	return output;
}

export function tokenizeWindowsRc(content: string): RcToken[] {
	if (content.includes("\0"))
		throw invalidRc("Windows RC contains a NUL byte.");
	const tokens: RcToken[] = [];
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
				throw invalidRc(`Block comment on line ${line} is not terminated.`);
			const comment = content.slice(cursor, end + 2);
			line += comment.match(/\n/g)?.length ?? 0;
			cursor = end + 2;
			continue;
		}
		const prefix = content.slice(cursor).match(/^(?:u8|[LuU])?"/);
		if (prefix) {
			const quote = cursor + prefix[0].length - 1;
			let end = quote + 1;
			while (end < content.length) {
				if (content[end] === "\n" || content[end] === "\r")
					throw invalidRc(`String on line ${line} crosses a physical line.`);
				if (content[end] === "\\") {
					end += 2;
					continue;
				}
				if (content[end] === '"') {
					if (content[end + 1] === '"') {
						end += 2;
						continue;
					}
					break;
				}
				end++;
			}
			if (end >= content.length)
				throw invalidRc(`String on line ${line} is not terminated.`);
			const raw = content.slice(quote + 1, end);
			tokens.push({
				kind: "string",
				value: decodeRcString(raw),
				raw,
				start: quote + 1,
				end,
				line,
			});
			cursor = end + 1;
			continue;
		}
		if (isWordStart(character) || /\d/.test(character)) {
			let end = cursor + 1;
			while (end < content.length && isWordPart(content[end])) end++;
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

function linesOf(tokens: readonly RcToken[]): RcToken[][] {
	const lines = new Map<number, RcToken[]>();
	for (const token of tokens) {
		const values = lines.get(token.line) ?? [];
		values.push(token);
		lines.set(token.line, values);
	}
	return [...lines.values()];
}

function upper(token: RcToken | undefined): string {
	return token?.kind === "word" ? token.value.toUpperCase() : "";
}

export function parseWindowsRcDocument(content: string): WindowsRcDocument {
	const tokens = tokenizeWindowsRc(content);
	const stack: string[] = [];
	let pendingContext: string | undefined;
	let resources = 0;
	for (const lineTokens of linesOf(tokens)) {
		const words = lineTokens.filter((token) => token.kind === "word");
		const declaration = words
			.map((token) => token.value.toUpperCase())
			.find((value) => RESOURCE_TYPES.has(value));
		if (declaration) resources++;
		for (const token of lineTokens) {
			const value = token.value.toUpperCase();
			if (value === "END" || token.value === "}") {
				if (!stack.length)
					throw invalidRc(`Resource block on line ${token.line} has no BEGIN.`);
				stack.pop();
				pendingContext = undefined;
			} else if (value === "BEGIN" || token.value === "{") {
				stack.push(pendingContext ?? declaration ?? stack.at(-1) ?? "RESOURCE");
				pendingContext = undefined;
			}
		}
		if (
			declaration &&
			BLOCK_RESOURCES.has(declaration) &&
			!lineTokens.some(
				(token) => token.value.toUpperCase() === "BEGIN" || token.value === "{",
			)
		)
			pendingContext = declaration;
	}
	if (stack.length)
		throw invalidRc(`Windows RC ${stack.at(-1)} block is not terminated.`);
	if (!resources) throw invalidRc("No Windows resource declaration was found.");
	return {
		tokens,
		strings: tokens.filter((token) => token.kind === "string"),
		resources,
	};
}

interface SelectedRcString {
	token: RcToken;
	directive: string;
}

function selectRcStrings(
	document: WindowsRcDocument,
	directives: ReadonlySet<string>,
	includeVersionInfo: boolean,
	includePreprocessor: boolean,
): SelectedRcString[] {
	const selected: SelectedRcString[] = [];
	const stack: string[] = [];
	let pendingContext: string | undefined;
	for (const lineTokens of linesOf(document.tokens)) {
		const words = lineTokens.filter((token) => token.kind === "word");
		const declaration = words
			.map((token) => token.value.toUpperCase())
			.find((value) => RESOURCE_TYPES.has(value));
		const context = pendingContext ?? stack.at(-1) ?? declaration;
		const firstWord = words[0];
		const directive = upper(firstWord);
		const strings = lineTokens.filter((token) => token.kind === "string");
		const preprocessorDefine =
			lineTokens[0]?.value === "#" && upper(lineTokens[1]) === "DEFINE";
		if (includePreprocessor && preprocessorDefine && strings[0]) {
			selected.push({ token: strings[0], directive: "#define" });
		} else if (context === "STRINGTABLE" && strings[0]) {
			selected.push({ token: strings[0], directive: "STRINGTABLE" });
		} else if (directives.has(directive) && strings[0]) {
			selected.push({ token: strings[0], directive });
		} else if (
			includeVersionInfo &&
			context === "VERSIONINFO" &&
			directive === "VALUE" &&
			strings[1]
		) {
			selected.push({ token: strings[1], directive: "VALUE" });
		}
		for (const token of lineTokens) {
			const value = token.value.toUpperCase();
			if (value === "END" || token.value === "}") stack.pop();
			else if (value === "BEGIN" || token.value === "{") {
				stack.push(pendingContext ?? declaration ?? stack.at(-1) ?? "RESOURCE");
				pendingContext = undefined;
			}
		}
		if (
			declaration &&
			BLOCK_RESOURCES.has(declaration) &&
			!lineTokens.some(
				(token) => token.value.toUpperCase() === "BEGIN" || token.value === "{",
			)
		)
			pendingContext = declaration;
	}
	return selected;
}

export async function validateWindowsRcFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseWindowsRcDocument(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not safe, structurally valid Windows RC.",
				};
	}
}

export async function importWindowsRcFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("windows-rc", options);
	const read = await readSafeTextFile(file, context);
	const parsed = parseWindowsRcDocument(read.text);
	const directives = new Set(
		parseList(filterOptions.translatableDirectives).map((value) =>
			value.toUpperCase(),
		),
	);
	const selected = selectRcStrings(
		parsed,
		directives,
		Boolean(filterOptions.includeVersionInfo),
		Boolean(filterOptions.includePreprocessor),
	);
	const segments: string[] = [];
	const replacements: TextRangeReplacement[] = [];
	const meta: PackageXmlSegmentMeta[] = [];
	for (const { token, directive } of selected) {
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
				profile: "windows-rc-string",
				part: file.name,
				path: [`line[${token.line}]`, directive],
				location: "text",
				start: token.start,
				end: token.end,
				originalValue: token.value,
				separator: piece.separator ?? "",
			});
		}
	}
	const document = createNeutralDocument({
		format: "windows-rc",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: entry.part,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: "Windows resource script",
		resources: parsed.resources,
		strings: parsed.strings.length,
		encoding: read.encoding,
		security:
			"Resource identifiers, numeric operands, accelerators, file references, comments, and preprocessor syntax remain inert source ranges.",
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"windows-rc",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "windows-rc", version: "rc" } as TypeRef,
		segmentsMeta: meta,
	};
}
