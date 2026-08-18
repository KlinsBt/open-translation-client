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
	FormatOptionValue,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

const PROTECTED_COMMAND_ARGUMENTS: Readonly<Record<string, number>> = {
	documentclass: 1,
	usepackage: 1,
	label: 1,
	ref: 1,
	pageref: 1,
	autoref: 1,
	eqref: 1,
	cite: 1,
	citep: 1,
	citet: 1,
	url: 1,
	href: 2,
	hyperref: 2,
	include: 1,
	input: 1,
	includegraphics: 1,
	bibliography: 1,
	bibliographystyle: 1,
	addbibresource: 1,
	newcommand: 2,
	renewcommand: 2,
	providecommand: 2,
	def: 1,
	setlength: 2,
	setcounter: 2,
};
const METADATA_COMMANDS = new Set(["title", "author", "date", "thanks"]);
const TEX_SYNTAX = new Set(["{", "}", "[", "]", "&", "#", "_", "^", "~"]);

interface GroupLocation {
	start: number;
	contentStart: number;
	contentEnd: number;
	end: number;
}

export interface LatexProseRange {
	start: number;
	end: number;
	value: string;
}

interface LatexScan {
	ranges: LatexProseRange[];
	environments: string[];
	commands: Set<string>;
}

function invalidLatex(message: string): SafeInputError {
	return new SafeInputError("LATEX_INVALID", message);
}

function escaped(content: string, index: number): boolean {
	let slashes = 0;
	for (
		let cursor = index - 1;
		cursor >= 0 && content[cursor] === "\\";
		cursor--
	)
		slashes++;
	return slashes % 2 === 1;
}

function readCommand(
	content: string,
	start: number,
): { name: string; end: number } {
	if (content[start] !== "\\")
		throw invalidLatex("Internal TeX command scan error.");
	let cursor = start + 1;
	if (/[A-Za-z@]/.test(content[cursor] ?? ""))
		while (/[A-Za-z@]/.test(content[cursor] ?? "")) cursor++;
	else if (cursor < content.length) cursor++;
	return { name: content.slice(start + 1, cursor), end: cursor };
}

function skipWhitespace(content: string, start: number): number {
	let cursor = start;
	while (/\s/.test(content[cursor] ?? "")) cursor++;
	return cursor;
}

function readGroup(
	content: string,
	start: number,
	open: "{" | "[",
	close: "}" | "]",
): GroupLocation | undefined {
	if (content[start] !== open) return undefined;
	let depth = 1;
	for (let cursor = start + 1; cursor < content.length; cursor++) {
		if (content[cursor] === "%" && !escaped(content, cursor)) {
			const newline = content.indexOf("\n", cursor + 1);
			cursor = newline < 0 ? content.length : newline;
			continue;
		}
		if (content[cursor] === "\\") {
			cursor = readCommand(content, cursor).end - 1;
			continue;
		}
		if (content[cursor] === open) depth++;
		else if (content[cursor] === close && --depth === 0)
			return {
				start,
				contentStart: start + 1,
				contentEnd: cursor,
				end: cursor + 1,
			};
	}
	throw invalidLatex(`Unterminated TeX ${open}${close} group.`);
}

function mark(mask: Uint8Array, start: number, end: number): void {
	mask.fill(1, Math.max(0, start), Math.min(mask.length, end));
}

function translatableMacroArguments(
	value: FormatOptionValue | undefined,
): Map<string, Set<number>> {
	const output = new Map<string, Set<number>>();
	for (const rule of parseList(value)) {
		const match = rule.match(/^([A-Za-z@]+):(\d+(?:\+\d+)*)$/);
		if (!match)
			throw invalidLatex(
				`Macro rule “${rule}” must use name:argument-index syntax (for example caption:1 or href:2).`,
			);
		const indexes = output.get(match[1]) ?? new Set<number>();
		for (const index of match[2].split("+").map(Number)) {
			if (index < 1 || index > 9)
				throw invalidLatex(
					`Macro rule “${rule}” has an unsupported argument index.`,
				);
			indexes.add(index);
		}
		output.set(match[1], indexes);
	}
	return output;
}

function findProtectedEnvironmentEnd(
	content: string,
	start: number,
	environment: string,
): number {
	let depth = 1;
	for (let cursor = start; cursor < content.length; cursor++) {
		if (content[cursor] === "%" && !escaped(content, cursor)) {
			const newline = content.indexOf("\n", cursor + 1);
			cursor = newline < 0 ? content.length : newline;
			continue;
		}
		if (content[cursor] !== "\\") continue;
		const command = readCommand(content, cursor);
		if (command.name !== "begin" && command.name !== "end") {
			cursor = command.end - 1;
			continue;
		}
		const groupStart = skipWhitespace(content, command.end);
		const group = readGroup(content, groupStart, "{", "}");
		if (!group) continue;
		if (content.slice(group.contentStart, group.contentEnd) === environment) {
			depth += command.name === "begin" ? 1 : -1;
			if (depth === 0) return group.end;
		}
		cursor = group.end - 1;
	}
	throw invalidLatex(
		`Protected TeX environment “${environment}” is not terminated.`,
	);
}

function validateBalancedBraces(content: string): void {
	const stack: number[] = [];
	for (let cursor = 0; cursor < content.length; cursor++) {
		if (content[cursor] === "%" && !escaped(content, cursor)) {
			const newline = content.indexOf("\n", cursor + 1);
			cursor = newline < 0 ? content.length : newline;
			continue;
		}
		if (content[cursor] === "\\") {
			cursor = readCommand(content, cursor).end - 1;
			continue;
		}
		if (content[cursor] === "{" && !escaped(content, cursor))
			stack.push(cursor);
		else if (
			content[cursor] === "}" &&
			!escaped(content, cursor) &&
			stack.pop() === undefined
		)
			throw invalidLatex("TeX contains an unmatched closing brace.");
	}
	if (stack.length)
		throw invalidLatex("TeX contains an unmatched opening brace.");
}

export function scanLatexProse(
	content: string,
	options: Readonly<FormatOptionValues>,
): LatexScan {
	if (content.includes("\0"))
		throw invalidLatex("TeX source contains a NUL byte.");
	validateBalancedBraces(content);
	const mask = new Uint8Array(content.length);
	const translatable = translatableMacroArguments(options.translatableCommands);
	const protectedEnvironments = new Set(
		parseList(options.protectedEnvironments),
	);
	const environments: string[] = [];
	const environmentStack: string[] = [];
	const commands = new Set<string>();
	for (let cursor = 0; cursor < content.length; ) {
		if (mask[cursor]) {
			cursor++;
			continue;
		}
		const character = content[cursor];
		if (character === "%" && !escaped(content, cursor)) {
			const newline = content.indexOf("\n", cursor + 1);
			const end = newline < 0 ? content.length : newline;
			if (options.includeComments) mark(mask, cursor, cursor + 1);
			else mark(mask, cursor, end);
			cursor = options.includeComments ? cursor + 1 : end;
			continue;
		}
		if (character === "$" && !escaped(content, cursor)) {
			const delimiter = content[cursor + 1] === "$" ? "$$" : "$";
			let end = content.indexOf(delimiter, cursor + delimiter.length);
			while (end >= 0 && escaped(content, end))
				end = content.indexOf(delimiter, end + delimiter.length);
			if (end < 0) throw invalidLatex("TeX math delimiter is not terminated.");
			mark(mask, cursor, end + delimiter.length);
			cursor = end + delimiter.length;
			continue;
		}
		if (character === "\\") {
			const command = readCommand(content, cursor);
			commands.add(command.name);
			if (command.name === "(" || command.name === "[") {
				const closing = command.name === "(" ? "\\)" : "\\]";
				const end = content.indexOf(closing, command.end);
				if (end < 0)
					throw invalidLatex(
						"TeX display/inline math delimiter is not terminated.",
					);
				mark(mask, cursor, end + closing.length);
				cursor = end + closing.length;
				continue;
			}
			if (command.name === "verb") {
				const delimiterIndex =
					content[command.end] === "*" ? command.end + 1 : command.end;
				const delimiter = content[delimiterIndex];
				if (!delimiter || /\s/.test(delimiter))
					throw invalidLatex("TeX \\verb requires a non-whitespace delimiter.");
				const end = content.indexOf(delimiter, delimiterIndex + 1);
				if (end < 0) throw invalidLatex("TeX \\verb is not terminated.");
				mark(mask, cursor, end + 1);
				cursor = end + 1;
				continue;
			}
			if (command.name === "begin" || command.name === "end") {
				const groupStart = skipWhitespace(content, command.end);
				const group = readGroup(content, groupStart, "{", "}");
				if (!group)
					throw invalidLatex(`TeX \\${command.name} has no environment name.`);
				const environment = content.slice(group.contentStart, group.contentEnd);
				mark(mask, cursor, group.end);
				if (command.name === "begin") {
					environments.push(environment);
					if (protectedEnvironments.has(environment)) {
						const end = findProtectedEnvironmentEnd(
							content,
							group.end,
							environment,
						);
						mark(mask, cursor, end);
						cursor = end;
						continue;
					}
					environmentStack.push(environment);
				} else if (environmentStack.pop() !== environment)
					throw invalidLatex(
						`TeX environment “${environment}” closes out of order.`,
					);
				cursor = group.end;
				continue;
			}
			mark(mask, cursor, command.end);
			let argumentCursor = skipWhitespace(content, command.end);
			while (content[argumentCursor] === "[") {
				const optional = readGroup(content, argumentCursor, "[", "]")!;
				mark(mask, optional.start, optional.end);
				argumentCursor = skipWhitespace(content, optional.end);
			}
			const metadataProtected =
				!options.includeMetadata && METADATA_COMMANDS.has(command.name);
			const selected = metadataProtected
				? undefined
				: translatable.get(command.name);
			const argumentCount = Math.max(
				PROTECTED_COMMAND_ARGUMENTS[command.name] ?? 0,
				metadataProtected ? 1 : 0,
				...(selected ? [...selected] : [0]),
			);
			if (!selected && argumentCount === 0) {
				const immediate = readGroup(content, argumentCursor, "{", "}");
				if (immediate) mark(mask, immediate.start, immediate.end);
			}
			for (
				let argumentIndex = 1;
				argumentIndex <= argumentCount;
				argumentIndex++
			) {
				const group = readGroup(content, argumentCursor, "{", "}");
				if (!group) break;
				if (selected?.has(argumentIndex)) {
					mark(mask, group.start, group.contentStart);
					mark(mask, group.contentEnd, group.end);
				} else mark(mask, group.start, group.end);
				argumentCursor = skipWhitespace(content, group.end);
			}
			cursor = command.end;
			continue;
		}
		if (TEX_SYNTAX.has(character)) mark(mask, cursor, cursor + 1);
		cursor++;
	}
	if (environmentStack.length)
		throw invalidLatex(
			`TeX environment “${environmentStack.at(-1)}” is not closed.`,
		);
	const ranges: LatexProseRange[] = [];
	for (let cursor = 0; cursor < content.length; ) {
		while (cursor < content.length && mask[cursor]) cursor++;
		const start = cursor;
		while (cursor < content.length && !mask[cursor]) cursor++;
		const end = cursor;
		if (end <= start) continue;
		const raw = content.slice(start, end);
		const leading = raw.match(/^\s*/)?.[0].length ?? 0;
		const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
		const coreStart = start + leading;
		const coreEnd = Math.max(coreStart, end - trailing);
		if (
			coreEnd > coreStart &&
			/[\p{L}\p{N}]/u.test(content.slice(coreStart, coreEnd))
		)
			ranges.push({
				start: coreStart,
				end: coreEnd,
				value: content.slice(coreStart, coreEnd),
			});
	}
	return { ranges, environments, commands };
}

export async function validateLatexFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		scanLatexProse(text, normalizeImportOptions("latex"));
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not safe, structurally valid TeX/LaTeX.",
				};
	}
}

export async function importLatexFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("latex", options);
	const read = await readSafeTextFile(file, context);
	const scan = scanLatexProse(read.text, filterOptions);
	const segments: string[] = [];
	const replacements: TextRangeReplacement[] = [];
	const meta: PackageXmlSegmentMeta[] = [];
	for (const [rangeIndex, range] of scan.ranges.entries()) {
		const pieces =
			filterOptions.segmentationMode === "sentences"
				? segmentPlainText(range.value, "sentences")
				: filterOptions.segmentationMode === "preferences"
					? splitTextWithPreferences(range.value)
					: [{ text: range.value, separator: "" }];
		const effective = pieces.filter((piece) => piece.text.trim());
		for (const piece of effective.length
			? effective
			: [{ text: range.value, separator: "" }]) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			replacements.push({
				kind: "text-range",
				unitIndex,
				start: range.start,
				end: range.end,
				separator: piece.separator ?? "",
			});
			meta.push({
				profile: "latex-prose",
				part: file.name,
				path: ["latex", `range[${rangeIndex + 1}]`],
				location: "text",
				start: range.start,
				end: range.end,
				originalValue: range.value,
				separator: piece.separator ?? "",
			});
		}
	}
	const document = createNeutralDocument({
		format: "latex",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: entry.part,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: "TeX/LaTeX grammar-aware prose",
		commands: scan.commands.size,
		environments: [...new Set(scan.environments)],
		encoding: read.encoding,
		security:
			"Commands, unknown macro arguments, math, comments, and protected environments remain inert source ranges.",
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"latex",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "latex" } as TypeRef,
		segmentsMeta: meta,
	};
}
