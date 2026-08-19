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

export interface MifStringToken {
	tag: string;
	path: string[];
	start: number;
	end: number;
	raw: string;
	value: string;
}

export interface MifDocument {
	version: string;
	strings: MifStringToken[];
	tags: number;
}

function invalidMif(message: string): SafeInputError {
	return new SafeInputError("MIF_INVALID", message);
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

export function decodeMifString(value: string): string {
	let output = "";
	for (let cursor = 0; cursor < value.length; cursor++) {
		if (value[cursor] !== "\\") {
			output += value[cursor];
			continue;
		}
		const next = value[cursor + 1];
		if (next === "\\") {
			output += "\\";
			cursor++;
		} else if (next === "x") {
			const match = value.slice(cursor).match(/^\\x([0-9A-Fa-f]{2})\s/);
			if (!match)
				throw invalidMif("MIF hexadecimal string escape is malformed.");
			output += String.fromCharCode(Number.parseInt(match[1], 16));
			cursor += match[0].length - 1;
		} else {
			const escapes: Record<string, string> = {
				t: "\t",
				r: "\r",
				n: "\n",
				q: "'",
				Q: "`",
			};
			output += escapes[next] ?? next ?? "";
			cursor++;
		}
	}
	return output;
}

export function parseMifDocument(content: string): MifDocument {
	if (content.includes("\0")) throw invalidMif("MIF contains a NUL byte.");
	const signature = content.match(/^\ufeff?\s*<MIFFile\s+([^\s>]+)/);
	if (!signature)
		throw invalidMif("MIF must begin with a MIFFile version declaration.");
	const stack: Array<{ tag: string; occurrence: number }> = [];
	const childCounts: Array<Map<string, number>> = [new Map()];
	const strings: MifStringToken[] = [];
	let tags = 0;
	for (
		let cursor = content.startsWith("\ufeff") ? 1 : 0;
		cursor < content.length;

	) {
		const character = content[cursor];
		if (
			character === "#" &&
			(cursor === 0 || /[\r\n]/.test(content[cursor - 1]))
		) {
			const newline = content.indexOf("\n", cursor + 1);
			cursor = newline < 0 ? content.length : newline + 1;
			continue;
		}
		if (character === "<") {
			const match = content.slice(cursor + 1).match(/^\s*([A-Za-z][\w.-]*)/);
			if (!match)
				throw invalidMif(`MIF tag at character ${cursor + 1} has no name.`);
			const tag = match[1];
			const counts = childCounts.at(-1)!;
			const occurrence = (counts.get(tag) ?? 0) + 1;
			counts.set(tag, occurrence);
			stack.push({ tag, occurrence });
			childCounts.push(new Map());
			tags++;
			cursor += 1 + match[0].length;
			continue;
		}
		if (character === ">") {
			if (!stack.length)
				throw invalidMif(
					`MIF has an unmatched closing bracket at character ${cursor + 1}.`,
				);
			stack.pop();
			childCounts.pop();
			cursor++;
			continue;
		}
		if (character === "`") {
			let end = cursor + 1;
			while (
				end < content.length &&
				(content[end] !== "'" || escaped(content, end))
			)
				end++;
			if (end >= content.length)
				throw invalidMif(
					`MIF string at character ${cursor + 1} is not terminated.`,
				);
			if (!stack.length)
				throw invalidMif(
					`MIF string at character ${cursor + 1} is outside a tag.`,
				);
			const raw = content.slice(cursor + 1, end);
			strings.push({
				tag: stack.at(-1)!.tag,
				path: stack.map((entry) => `${entry.tag}[${entry.occurrence}]`),
				start: cursor + 1,
				end,
				raw,
				value: decodeMifString(raw),
			});
			cursor = end + 1;
			continue;
		}
		cursor++;
	}
	if (stack.length)
		throw invalidMif(`MIF tag “${stack.at(-1)!.tag}” is not closed.`);
	return { version: signature[1], strings, tags };
}

export async function validateMifFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseMifDocument(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not safe, structurally valid MIF.",
				};
	}
}

export async function importMifFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("mif", options);
	const read = await readSafeTextFile(file, context);
	const parsed = parseMifDocument(read.text);
	const selected = new Set(parseList(filterOptions.translatableTags));
	if (filterOptions.includeMarkers) selected.add("MarkerText");
	if (filterOptions.includeVariables) selected.add("VariableDef");
	const tokens = parsed.strings.filter((token) => selected.has(token.tag));
	const segments: string[] = [];
	const replacements: TextRangeReplacement[] = [];
	const meta: PackageXmlSegmentMeta[] = [];
	for (const token of tokens) {
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
				profile: "mif-string",
				part: file.name,
				path: [...token.path, "#string"],
				location: "text",
				start: token.start,
				end: token.end,
				originalValue: token.value,
				separator: piece.separator ?? "",
			});
		}
	}
	const document = createNeutralDocument({
		format: "mif",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: entry.part,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: `${/\.mi2$/i.test(file.name) ? "MIF2 filter / MIF" : "MIF"} ${parsed.version}`,
		tags: parsed.tags,
		strings: parsed.strings.length,
		encoding: read.encoding,
		security:
			"Catalogs, conditions, cross-reference syntax, graphics, and unselected tagged strings remain inert source ranges.",
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"mif",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: {
			profile: /\.mi2$/i.test(file.name) ? "mif2-filter-alias" : "mif",
			version: parsed.version,
		} as TypeRef,
		segmentsMeta: meta,
	};
}
