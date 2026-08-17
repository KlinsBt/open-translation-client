import type { MarkupSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type MarkupTextReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export type LightweightMarkupProfile = "markdown" | "asciidoc";

export interface MarkupProseSpan {
	profile: LightweightMarkupProfile;
	line: number;
	span: number;
	start: number;
	end: number;
	value: string;
}

export interface ParsedLightweightMarkup {
	profile: LightweightMarkupProfile;
	spans: MarkupProseSpan[];
	warnings: string[];
}

export function detectLightweightMarkupProfile(
	name: string,
	requested = "auto",
): LightweightMarkupProfile {
	if (requested === "markdown" || requested === "asciidoc") return requested;
	const extension = name.toLowerCase().split(".").at(-1);
	return extension === "adoc" || extension === "asciidoc"
		? "asciidoc"
		: "markdown";
}

function invalidMarkup(message: string, line: number): SafeInputError {
	return new SafeInputError("MARKUP_INVALID", `${message} (line ${line}).`, {
		line,
	});
}

function lineRecords(content: string): Array<{
	start: number;
	end: number;
	visibleEnd: number;
	text: string;
	line: number;
}> {
	const records = [];
	let cursor = 0;
	let line = 1;
	while (cursor < content.length) {
		const newline = content.indexOf("\n", cursor);
		const end = newline < 0 ? content.length : newline + 1;
		const visibleEnd =
			newline < 0
				? content.length
				: newline > cursor && content[newline - 1] === "\r"
					? newline - 1
					: newline;
		records.push({
			start: cursor,
			end,
			visibleEnd,
			text: content.slice(cursor, visibleEnd),
			line,
		});
		cursor = end;
		line++;
	}
	return records;
}

function markdownPrefixLength(line: string): number {
	return (
		line.match(
			/^ {0,3}(?:#{1,6}\s+|(?:>\s*)+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)/,
		)?.[0].length ?? 0
	);
}

function asciidocPrefixLength(line: string): number {
	return (
		line.match(
			/^(?:={1,6}\s+|(?:\*+|-|\.|\d+\.)\s+|>\s+|(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION):\s+)/,
		)?.[0].length ??
		line.match(/^\.(?=[^.\s])/)?.[0].length ??
		0
	);
}

function trimRange(
	content: string,
	start: number,
	end: number,
): [number, number] {
	while (start < end && /\s/.test(content[start])) start++;
	while (end > start && /\s/.test(content[end - 1])) end--;
	return [start, end];
}

function htmlTagEnd(content: string, start: number, limit: number): number {
	let quote: string | undefined;
	for (let index = start + 1; index < limit; index++) {
		const character = content[index];
		if (quote) {
			if (character === quote && content[index - 1] !== "\\") quote = undefined;
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index + 1;
	}
	return limit;
}

function consumeUrl(content: string, start: number, limit: number): number {
	const match = content
		.slice(start, limit)
		.match(/^(?:https?:\/\/|mailto:|www\.)[^\s<>()\[\]]+/i)?.[0];
	if (!match) return start;
	return start + match.replace(/[.,;:!?]+$/, "").length;
}

function protectedEnd(
	content: string,
	index: number,
	limit: number,
	profile: LightweightMarkupProfile,
): number {
	const urlEnd = consumeUrl(content, index, limit);
	if (urlEnd > index) return urlEnd;
	if (content[index] === "\\" && index + 1 < limit) return index + 2;
	if (content[index] === "&") {
		const entity = content
			.slice(index, limit)
			.match(/^&(?:#\d+|#x[\dA-Fa-f]+|[A-Za-z][\w-]*);/);
		if (entity) return index + entity[0].length;
	}
	if (content[index] === "<") {
		if (content.startsWith("<<", index) && profile === "asciidoc") {
			const close = content.indexOf(">>", index + 2);
			return close < 0 || close >= limit ? limit : close + 2;
		}
		return htmlTagEnd(content, index, limit);
	}
	if (profile === "asciidoc" && content[index] === "{") {
		const close = content.indexOf("}", index + 1);
		return close < 0 || close >= limit ? limit : close + 1;
	}
	if (profile === "asciidoc") {
		const macro = content
			.slice(index, limit)
			.match(
				/^(?:link|xref|image|kbd|btn|menu|footnote|pass):[^\s[]*\[[^\]]*\]/,
			)?.[0];
		if (macro) return index + macro.length;
	}
	if (
		content[index] === "`" ||
		(profile === "asciidoc" && content[index] === "+")
	) {
		const marker = content[index];
		let count = 1;
		while (content[index + count] === marker) count++;
		const token = marker.repeat(count);
		const close = content.indexOf(token, index + count);
		return close < 0 || close >= limit ? limit : close + count;
	}
	if (
		profile === "markdown" &&
		content[index] === "(" &&
		index > 0 &&
		content[index - 1] === "]"
	) {
		let depth = 1;
		let quote: string | undefined;
		for (let cursor = index + 1; cursor < limit; cursor++) {
			const character = content[cursor];
			if (character === "\\") {
				cursor++;
				continue;
			}
			if (quote) {
				if (character === quote) quote = undefined;
				continue;
			}
			if (character === '"' || character === "'") quote = character;
			else if (character === "(") depth++;
			else if (character === ")" && --depth === 0) return cursor + 1;
		}
		return limit;
	}
	const syntax = profile === "markdown" ? "*_~[]!|" : "*_[]|#^";
	if (syntax.includes(content[index])) {
		let end = index + 1;
		while (end < limit && content[end] === content[index]) end++;
		return end;
	}
	return index;
}

function extractInlineSpans(
	content: string,
	start: number,
	end: number,
	line: number,
	profile: LightweightMarkupProfile,
): MarkupProseSpan[] {
	const spans: MarkupProseSpan[] = [];
	let proseStart = start;
	let index = start;
	const flush = (until: number) => {
		const [trimmedStart, trimmedEnd] = trimRange(content, proseStart, until);
		if (trimmedEnd > trimmedStart)
			spans.push({
				profile,
				line,
				span: spans.length,
				start: trimmedStart,
				end: trimmedEnd,
				value: content.slice(trimmedStart, trimmedEnd),
			});
	};
	while (index < end) {
		const protectedStop = protectedEnd(content, index, end, profile);
		if (protectedStop === index) {
			index++;
			continue;
		}
		flush(index);
		index = protectedStop;
		proseStart = index;
	}
	flush(end);
	return spans;
}

export function parseLightweightMarkup(
	content: string,
	profile: LightweightMarkupProfile,
	includeHtmlText = true,
): ParsedLightweightMarkup {
	const records = lineRecords(content);
	const spans: MarkupProseSpan[] = [];
	const warnings: string[] = [];
	let frontMatter: "---" | "+" | undefined;
	let markdownFence: { marker: string; line: number } | undefined;
	let asciidocBlock: { marker: string; line: number } | undefined;
	let rawHtml: { tag: string; line: number } | undefined;

	for (const record of records) {
		const bomOffset =
			record.line === 1 && record.text.startsWith("\ufeff") ? 1 : 0;
		const line = record.text.slice(bomOffset);
		const trimmed = line.trim();
		if (rawHtml) {
			if (
				(rawHtml.tag === "!--" && trimmed.includes("-->")) ||
				(rawHtml.tag !== "!--" &&
					new RegExp(`</${rawHtml.tag}\\s*>`, "i").test(line))
			)
				rawHtml = undefined;
			continue;
		}
		if (profile === "markdown") {
			if (record.line === 1 && (trimmed === "---" || trimmed === "+++")) {
				frontMatter = trimmed === "---" ? "---" : "+";
				continue;
			}
			if (frontMatter) {
				if (trimmed === (frontMatter === "---" ? "---" : "+++"))
					frontMatter = undefined;
				continue;
			}
			const fence = trimmed.match(/^(`{3,}|~{3,})/i)?.[1];
			if (markdownFence) {
				if (
					fence &&
					fence[0] === markdownFence.marker[0] &&
					fence.length >= markdownFence.marker.length
				)
					markdownFence = undefined;
				continue;
			}
			if (fence) {
				markdownFence = { marker: fence, line: record.line };
				continue;
			}
			if (/^(?: {4}|\t)/.test(line)) continue;
			if (/^ {0,3}\[[^\]]+\]:\s*\S+/.test(line)) continue;
			if (/^ {0,3}(?:[-*_]\s*){3,}$/.test(line)) continue;
			if (/^\s*\|?\s*:?-{3,}/.test(line) && line.includes("|")) continue;
		} else {
			if (asciidocBlock) {
				if (trimmed === asciidocBlock.marker) asciidocBlock = undefined;
				continue;
			}
			if (["----", "....", "++++", "////"].includes(trimmed)) {
				asciidocBlock = { marker: trimmed, line: record.line };
				continue;
			}
			if (
				/^\s*(?::[^:]+:|\/\/|include::|image::|ifdef::|ifndef::|endif::|\[\[|\[#|\[source[,\]])/.test(
					line,
				) ||
				trimmed === "+" ||
				trimmed === "|==="
			)
				continue;
		}
		if (!trimmed) continue;
		const rawBlock = trimmed.match(/^<(script|style|pre)(?:\s|>)/i)?.[1];
		if (trimmed.startsWith("<!--") || rawBlock) {
			const tag = trimmed.startsWith("<!--") ? "!--" : rawBlock!.toLowerCase();
			const alreadyClosed =
				tag === "!--"
					? trimmed.includes("-->")
					: new RegExp(`</${tag}\\s*>`, "i").test(line);
			if (!alreadyClosed) rawHtml = { tag, line: record.line };
			continue;
		}
		if (!includeHtmlText && /<\/?[A-Za-z][^>]*>/.test(line)) continue;
		let relativeStart =
			profile === "markdown"
				? markdownPrefixLength(line)
				: asciidocPrefixLength(line);
		let relativeEnd = line.length;
		if (profile === "markdown") {
			const hardBreak = line.slice(relativeStart).match(/(?: {2,}|\\)$/)?.[0];
			if (hardBreak) relativeEnd -= hardBreak.length;
		}
		if (relativeEnd <= relativeStart) continue;
		spans.push(
			...extractInlineSpans(
				content,
				record.start + bomOffset + relativeStart,
				record.start + bomOffset + relativeEnd,
				record.line,
				profile,
			).map((span, index) => ({ ...span, span: index })),
		);
	}
	if (frontMatter) throw invalidMarkup("Unterminated Markdown front matter", 1);
	if (markdownFence)
		throw invalidMarkup("Unterminated Markdown code fence", markdownFence.line);
	if (asciidocBlock)
		throw invalidMarkup(
			"Unterminated AsciiDoc protected block",
			asciidocBlock.line,
		);
	if (rawHtml) throw invalidMarkup("Unterminated raw HTML block", rawHtml.line);
	return { profile, spans, warnings };
}

export async function validateLightweightMarkupFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseLightweightMarkup(text, detectLightweightMarkupProfile(file.name));
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The lightweight markup file is invalid." };
	}
}

export async function importLightweightMarkupFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("markup", options);
	const profile = detectLightweightMarkupProfile(
		file.name,
		String(filterOptions.profile),
	);
	const read = await readSafeTextFile(file, context);
	const parsed = parseLightweightMarkup(
		read.text,
		profile,
		Boolean(filterOptions.includeHtmlText),
	);
	const segments = parsed.spans.map((span) => span.value);
	const meta: MarkupSegmentMeta[] = parsed.spans.map((span) => ({
		profile,
		line: span.line,
		span: span.span,
		start: span.start,
		end: span.end,
		originalValue: span.value,
	}));
	const replacements: MarkupTextReplacement[] = meta.map(
		(entry, unitIndex) => ({ kind: "markup-text", unitIndex, ...entry }),
	);
	const document = createNeutralDocument({
		format: "markup",
		sourceSegments: segments,
		unitIds: meta.map((entry) => `line-${entry.line}-span-${entry.span}`),
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: file.name,
			path: [profile, entry.line, entry.span],
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
	for (const [index, entry] of meta.entries())
		document.units[index].contexts.push({
			type: `${profile}-source-line`,
			value: String(entry.line),
		});
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"markup",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions: { ...filterOptions, profile },
		typeRef: { profile: `${profile}-source-ranges` } as TypeRef,
		segmentsMeta: meta,
	};
}
