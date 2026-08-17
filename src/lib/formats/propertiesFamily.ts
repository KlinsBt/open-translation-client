import type { PropertiesSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	decodeTextBytes,
	readSafeFileBytes,
	SafeInputError,
	type SafeInputContext,
	type SafeTextFile,
	type SupportedTextEncoding,
} from "./safeInput";
import {
	createTextSkeleton,
	type PropertiesValueReplacement,
} from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

interface PhysicalLine {
	number: number;
	start: number;
	end: number;
	contentEnd: number;
}

interface PropertiesEntry {
	key: string;
	value: string;
	line: number;
	fragments: Array<{ start: number; end: number; originalValue: string }>;
	comment?: string;
}

export function parseProperties(content: string): {
	entries: PropertiesEntry[];
	warnings: string[];
} {
	const lines = physicalLines(content);
	const entries: PropertiesEntry[] = [];
	const warnings: string[] = [];
	const keys = new Set<string>();
	let pendingComment: string | undefined;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const first = lines[lineIndex];
		let visibleStart = first.start;
		if (first.number === 1 && content[visibleStart] === "\ufeff")
			visibleStart++;
		while (/[ \t\f]/.test(content[visibleStart] ?? "")) visibleStart++;
		if (visibleStart >= first.contentEnd) continue;
		if (content[visibleStart] === "#" || content[visibleStart] === "!") {
			pendingComment = content.slice(visibleStart + 1, first.contentEnd).trim();
			continue;
		}
		const { keyEnd, valueStart } = findPropertySeparator(
			content,
			visibleStart,
			first.contentEnd,
		);
		const rawKey = content.slice(visibleStart, keyEnd);
		const fragments: PropertiesEntry["fragments"] = [];
		let current = first;
		let fragmentStart = valueStart;
		while (true) {
			const continued = hasOddTrailingBackslash(
				content,
				fragmentStart,
				current.contentEnd,
			);
			const fragmentEnd = continued
				? current.contentEnd - 1
				: current.contentEnd;
			fragments.push({
				start: fragmentStart,
				end: fragmentEnd,
				originalValue: content.slice(fragmentStart, fragmentEnd),
			});
			if (!continued) break;
			const next = lines[++lineIndex];
			if (!next)
				throw malformedProperties(
					"A properties continuation marker has no following line.",
				);
			current = next;
			fragmentStart = current.start;
			while (/[ \t\f]/.test(content[fragmentStart] ?? "")) fragmentStart++;
		}
		const key = decodePropertiesEscapes(rawKey);
		const value = decodePropertiesEscapes(
			fragments.map((fragment) => fragment.originalValue).join(""),
		);
		if (keys.has(key)) warnings.push(`Duplicate properties key ${key}.`);
		keys.add(key);
		entries.push({
			key,
			value,
			line: first.number,
			fragments,
			...(pendingComment ? { comment: pendingComment } : {}),
		});
		pendingComment = undefined;
	}
	return { entries, warnings };
}

function physicalLines(content: string): PhysicalLine[] {
	const lines: PhysicalLine[] = [];
	let start = 0;
	let number = 1;
	while (start < content.length) {
		const newline = content.indexOf("\n", start);
		const end = newline < 0 ? content.length : newline + 1;
		const contentEnd =
			newline < 0
				? content.length
				: newline > start && content[newline - 1] === "\r"
					? newline - 1
					: newline;
		lines.push({ number, start, end, contentEnd });
		start = end;
		number++;
	}
	return lines;
}

function findPropertySeparator(
	content: string,
	start: number,
	end: number,
): { keyEnd: number; valueStart: number } {
	let escaped = false;
	for (let index = start; index < end; index++) {
		const character = content[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\") {
			escaped = true;
			continue;
		}
		if (character === "=" || character === ":" || /[ \t\f]/.test(character)) {
			const keyEnd = index;
			while (/[ \t\f]/.test(content[index] ?? "")) index++;
			if (content[index] === "=" || content[index] === ":") index++;
			while (/[ \t\f]/.test(content[index] ?? "")) index++;
			return { keyEnd, valueStart: Math.min(index, end) };
		}
	}
	return { keyEnd: end, valueStart: end };
}

function hasOddTrailingBackslash(
	content: string,
	start: number,
	end: number,
): boolean {
	let count = 0;
	for (let index = end - 1; index >= start && content[index] === "\\"; index--)
		count++;
	return count % 2 === 1;
}

export function decodePropertiesEscapes(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (character !== "\\") {
			output += character;
			continue;
		}
		if (++index >= value.length)
			throw malformedProperties("A properties escape is not terminated.");
		const escaped = value[index];
		if (escaped === "t") output += "\t";
		else if (escaped === "n") output += "\n";
		else if (escaped === "r") output += "\r";
		else if (escaped === "f") output += "\f";
		else if (escaped === "u") {
			const hex = value.slice(index + 1, index + 5);
			if (!/^[0-9A-Fa-f]{4}$/.test(hex))
				throw malformedProperties("A properties Unicode escape is invalid.");
			output += String.fromCharCode(Number.parseInt(hex, 16));
			index += 4;
		} else output += escaped;
	}
	return output;
}

function malformedProperties(message: string): SafeInputError {
	return new SafeInputError("PROPERTIES_MALFORMED", message);
}

async function readPropertiesText(
	file: File,
	requested: string,
	context?: SafeInputContext,
): Promise<SafeTextFile> {
	const bytes = await readSafeFileBytes(file, context);
	if (requested === "auto") {
		try {
			return decodeTextBytes(bytes);
		} catch (error) {
			if (
				!(error instanceof SafeInputError) ||
				error.code !== "TEXT_INVALID_ENCODING"
			)
				throw error;
			return decodeSingleByte(bytes, "iso-8859-1");
		}
	}
	if (requested === "iso-8859-1" || requested === "windows-1252")
		return decodeSingleByte(bytes, requested);
	const decoded = decodeTextBytes(bytes);
	if (decoded.encoding !== "utf-8") return decoded;
	return decoded;
}

function decodeSingleByte(
	bytes: Uint8Array,
	encoding: "iso-8859-1" | "windows-1252",
): SafeTextFile {
	return {
		bytes,
		text: new TextDecoder(encoding, { fatal: true }).decode(bytes),
		encoding,
		hasBom: false,
	};
}

export async function validatePropertiesFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const read = await readPropertiesText(file, "auto", context);
		parseProperties(read.text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not valid properties data." };
	}
}

export async function importPropertiesFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("properties", options);
	const read = await readPropertiesText(
		file,
		String(filterOptions.sourceEncoding),
		context,
	);
	const parsed = parseProperties(read.text);
	const entries = parsed.entries.filter(
		(entry) => filterOptions.includeEmpty || entry.value.length > 0,
	);
	const segments = entries.map((entry) => entry.value);
	const meta: PropertiesSegmentMeta[] = entries.map((entry) => ({
		key: entry.key,
		line: entry.line,
		originalValue: entry.value,
		fragments: entry.fragments,
	}));
	const replacements: PropertiesValueReplacement[] = meta.map(
		(entry, unitIndex) => ({ kind: "properties-value", unitIndex, ...entry }),
	);
	const document = createNeutralDocument({
		format: "properties",
		sourceSegments: segments,
		targetSegments: segments.map(() => ""),
		unitIds: entries.map((entry) => entry.key),
		sourceLocations: entries.map((entry, segmentIndex) => ({
			part: file.name,
			path: [entry.key],
			line: entry.line,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: "java-mozilla-properties",
		encoding: read.encoding,
		hasBom: read.hasBom,
		warnings: parsed.warnings,
	};
	for (const [index, entry] of entries.entries()) {
		document.units[index].contexts.push({
			type: "properties-key",
			value: entry.key,
		});
		if (entry.comment)
			document.units[index].notes.push({
				category: "developer-comment",
				text: entry.comment,
				appliesTo: "source",
			});
	}
	return {
		kind: "segments",
		segments,
		targetSegments: segments.map(() => ""),
		document,
		skeleton: await createTextSkeleton(
			file,
			"properties",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "java-mozilla-properties" } as TypeRef,
		segmentsMeta: meta,
	};
}

export function propertiesOutputEncoding(
	encoding: SupportedTextEncoding | undefined,
): SupportedTextEncoding {
	return encoding ?? "utf-8";
}
