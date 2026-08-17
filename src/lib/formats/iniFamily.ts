import type { IniSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type IniValueReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export type IniProfile = "generic" | "desktop" | "lang";

interface IniEntry {
	section: string;
	key: string;
	baseKey: string;
	locale?: string;
	value: string;
	start: number;
	end: number;
	lineEnd: number;
	lineEnding: string;
	line: number;
	comment?: string;
}

const DESKTOP_KEYS = new Set([
	"Name",
	"GenericName",
	"Comment",
	"Keywords",
	"X-GNOME-FullName",
]);

export function detectIniProfile(name: string, requested = "auto"): IniProfile {
	if (requested !== "auto") return requested as IniProfile;
	const extension = name.toLowerCase().split(".").at(-1);
	if (extension === "desktop") return "desktop";
	if (extension === "lang") return "lang";
	return "generic";
}

export function parseIni(
	content: string,
	profile: IniProfile,
): {
	entries: IniEntry[];
	warnings: string[];
} {
	const entries: IniEntry[] = [];
	const warnings: string[] = [];
	const seen = new Set<string>();
	let section = "";
	let pendingComment: string | undefined;
	let cursor = 0;
	let line = 1;
	while (cursor < content.length) {
		const newline = content.indexOf("\n", cursor);
		const lineEnd = newline < 0 ? content.length : newline + 1;
		const contentEnd =
			newline < 0
				? content.length
				: newline > cursor && content[newline - 1] === "\r"
					? newline - 1
					: newline;
		const lineEnding = content.slice(contentEnd, lineEnd);
		let visibleStart = cursor;
		if (line === 1 && content[visibleStart] === "\ufeff") visibleStart++;
		while (/[ \t]/.test(content[visibleStart] ?? "")) visibleStart++;
		if (visibleStart >= contentEnd) {
			cursor = lineEnd;
			line++;
			continue;
		}
		const first = content[visibleStart];
		if (first === ";" || first === "#") {
			pendingComment = content.slice(visibleStart + 1, contentEnd).trim();
			cursor = lineEnd;
			line++;
			continue;
		}
		if (first === "[") {
			const close = content.indexOf("]", visibleStart + 1);
			if (close < 0 || close >= contentEnd)
				throw invalidIni(`Section header on line ${line} is not terminated.`);
			if (content.slice(close + 1, contentEnd).trim())
				throw invalidIni(`Unexpected content after section on line ${line}.`);
			section = content.slice(visibleStart + 1, close);
			pendingComment = undefined;
			cursor = lineEnd;
			line++;
			continue;
		}
		const delimiter = findDelimiter(content, visibleStart, contentEnd);
		if (delimiter < 0)
			throw invalidIni(`Key/value line ${line} has no = or : delimiter.`);
		const rawKey = content.slice(visibleStart, delimiter).trimEnd();
		if (!rawKey) throw invalidIni(`Key/value line ${line} has an empty key.`);
		let valueStart = delimiter + 1;
		while (/[ \t]/.test(content[valueStart] ?? "")) valueStart++;
		const localeMatch = rawKey.match(/^(.*)\[([^\]]+)\]$/);
		const baseKey = localeMatch?.[1] ?? rawKey;
		const locale = localeMatch?.[2];
		const identity = `${section}\u0000${rawKey}`;
		if (seen.has(identity))
			warnings.push(
				`Duplicate INI key ${section ? `${section}.` : ""}${rawKey}.`,
			);
		seen.add(identity);
		entries.push({
			section,
			key: rawKey,
			baseKey,
			...(locale ? { locale } : {}),
			value: decodeIniValue(content.slice(valueStart, contentEnd), profile),
			start: valueStart,
			end: contentEnd,
			lineEnd,
			lineEnding,
			line,
			...(pendingComment ? { comment: pendingComment } : {}),
		});
		pendingComment = undefined;
		cursor = lineEnd;
		line++;
	}
	return { entries, warnings };
}

function findDelimiter(content: string, start: number, end: number): number {
	let escaped = false;
	for (let index = start; index < end; index++) {
		if (escaped) {
			escaped = false;
			continue;
		}
		if (content[index] === "\\") escaped = true;
		else if (content[index] === "=" || content[index] === ":") return index;
	}
	return -1;
}

export function decodeIniValue(value: string, profile: IniProfile): string {
	return value.replace(/\\(.)/g, (raw, escaped: string) => {
		if (escaped === "n") return "\n";
		if (escaped === "r") return "\r";
		if (escaped === "t") return "\t";
		if (escaped === "\\") return "\\";
		if (profile === "desktop" && escaped === "s") return " ";
		if (profile === "desktop" && escaped === ";") return ";";
		return raw;
	});
}

function invalidIni(message: string, selection = false): SafeInputError {
	return new SafeInputError(
		selection ? "INI_SELECTION_REQUIRED" : "INI_MALFORMED",
		message,
	);
}

export async function validateIniFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseIni(text, detectIniProfile(file.name));
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not valid INI resource text." };
	}
}

function globMatches(value: string, pattern: string): boolean {
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replaceAll("*", ".*");
	return new RegExp(`^${escaped}$`).test(value);
}

export async function importIniFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("ini", options);
	const profile = detectIniProfile(file.name, String(filterOptions.profile));
	const selectors = parseList(filterOptions.keySelectors);
	if (profile === "generic" && !selectors.length)
		throw invalidIni(
			"Generic INI import requires at least one translatable key selector.",
			true,
		);
	const read = await readSafeTextFile(file, context);
	const parsed = parseIni(read.text, profile);
	const targetLocale = String(filterOptions.targetLocale).trim();
	const localized = new Map(
		parsed.entries
			.filter((entry) => entry.locale)
			.map((entry) => [
				`${entry.section}\u0000${entry.baseKey}\u0000${entry.locale}`,
				entry,
			]),
	);
	const sourceEntries = parsed.entries.filter((entry) => {
		if (profile === "desktop")
			return !entry.locale && DESKTOP_KEYS.has(entry.baseKey);
		if (profile === "lang") return true;
		return selectors.some(
			(selector) =>
				globMatches(entry.key, selector) ||
				globMatches(`${entry.section}.${entry.key}`, selector),
		);
	});
	const selected = sourceEntries.filter(
		(entry) => filterOptions.includeEmpty || entry.value.length > 0,
	);
	const targets: string[] = [];
	const meta: IniSegmentMeta[] = [];
	for (const entry of selected) {
		const target =
			profile === "desktop" && targetLocale
				? localized.get(
						`${entry.section}\u0000${entry.baseKey}\u0000${targetLocale}`,
					)
				: undefined;
		targets.push(target?.value ?? "");
		if (target) {
			meta.push({
				profile,
				section: entry.section,
				key: entry.baseKey,
				locale: targetLocale,
				start: target.start,
				end: target.end,
				originalValue: target.value,
			});
		} else if (profile === "desktop" && targetLocale) {
			const hasLineEnding = entry.lineEnding.length > 0;
			meta.push({
				profile,
				section: entry.section,
				key: entry.baseKey,
				locale: targetLocale,
				start: entry.lineEnd,
				end: entry.lineEnd,
				originalValue: "",
				insertionStart: entry.lineEnd,
				insertionTextPrefix: hasLineEnding
					? `${entry.baseKey}[${targetLocale}]=`
					: `\n${entry.baseKey}[${targetLocale}]=`,
				insertionTextSuffix: hasLineEnding ? entry.lineEnding : "",
			});
		} else {
			meta.push({
				profile,
				section: entry.section,
				key: entry.key,
				...(entry.locale ? { locale: entry.locale } : {}),
				start: entry.start,
				end: entry.end,
				originalValue: entry.value,
			});
		}
	}
	const segments = selected.map((entry) => entry.value);
	const replacements: IniValueReplacement[] = meta.map((entry, unitIndex) => ({
		kind: "ini-value",
		unitIndex,
		...entry,
	}));
	const document = createNeutralDocument({
		format: "ini",
		sourceSegments: segments,
		targetSegments: targets,
		unitIds: selected.map((entry) => `${entry.section}:${entry.key}`),
		sourceLocations: selected.map((entry, segmentIndex) => ({
			part: file.name,
			path: [entry.section, entry.key],
			line: entry.line,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile,
		warnings: parsed.warnings,
		encoding: read.encoding,
		hasBom: read.hasBom,
	};
	for (const [index, entry] of selected.entries()) {
		const unit = document.units[index];
		unit.contexts.push({ type: "ini-section", value: entry.section });
		unit.contexts.push({ type: "ini-key", value: entry.key });
		if (entry.locale)
			unit.contexts.push({ type: "locale", value: entry.locale });
		if (entry.comment)
			unit.notes.push({
				category: "developer-comment",
				text: entry.comment,
				appliesTo: "source",
			});
	}
	return {
		kind: "segments",
		segments,
		targetSegments: targets,
		document,
		skeleton: await createTextSkeleton(
			file,
			"ini",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions: { ...filterOptions, profile },
		typeRef: { profile: `${profile}-resource-text` } as TypeRef,
		segmentsMeta: meta,
	};
}
