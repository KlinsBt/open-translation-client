import { parseRTF } from "@jonahschulte/rtf-toolkit";
import type { RtfSegmentMeta, UserData } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	decodeTextBytes,
	readSafeFileBytes,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import {
	createTextSkeleton,
	type DocumentSkeleton,
	type RtfParagraphReplacement,
} from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import { assertProjectExportQuality } from "./qualityAssurance";

export const RTF_EXTENSIONS = ["rtf"] as const;
export const RTF_MIME_TYPES = ["application/rtf", "text/rtf"] as const;

const ALWAYS_SKIPPED_DESTINATIONS = new Set([
	"fonttbl",
	"colortbl",
	"stylesheet",
	"info",
	"pict",
	"object",
	"datastore",
	"themedata",
	"colorschememapping",
	"listtable",
	"listoverridetable",
]);

interface RtfExtractedParagraph {
	text: string;
	fragments: Array<{ start: number; end: number }>;
}

function decodeHex(value: string): string {
	return new TextDecoder("windows-1252").decode(
		new Uint8Array([Number.parseInt(value, 16)]),
	);
}

export function extractRtfParagraphs(
	content: string,
	includeHeadersFooters = true,
): RtfExtractedParagraph[] {
	const paragraphs: RtfExtractedParagraph[] = [];
	const states: Array<{ skip: boolean; uc: number }> = [{ skip: false, uc: 1 }];
	let text = "";
	let fragments: Array<{ start: number; end: number }> = [];
	let fallbackToSkip = 0;
	const flush = () => {
		const normalized = text.replace(/[\t ]+/g, " ").trim();
		while (
			fragments.length &&
			/^\s*$/.test(content.slice(fragments[0].start, fragments[0].end))
		)
			fragments.shift();
		while (
			fragments.length &&
			/^\s*$/.test(
				content.slice(fragments.at(-1)!.start, fragments.at(-1)!.end),
			)
		)
			fragments.pop();
		if (normalized && fragments.length)
			paragraphs.push({ text: normalized, fragments: [...fragments] });
		text = "";
		fragments = [];
	};

	for (let index = 0; index < content.length; ) {
		const state = states.at(-1)!;
		const character = content[index];
		if (character === "{") {
			const destination = content
				.slice(index)
				.match(/^\{\s*\\\*?\\?([a-zA-Z]+)/)?.[1]
				?.toLowerCase();
			const skipDestination =
				!!destination &&
				(ALWAYS_SKIPPED_DESTINATIONS.has(destination) ||
					(!includeHeadersFooters && /^(?:header|footer)/.test(destination)));
			states.push({ skip: state.skip || skipDestination, uc: state.uc });
			index++;
			continue;
		}
		if (character === "}") {
			if (states.length > 1) states.pop();
			index++;
			continue;
		}
		if (character !== "\\") {
			let end = index + 1;
			while (end < content.length && !"{}\\".includes(content[end])) end++;
			if (!state.skip) {
				let start = index;
				if (fallbackToSkip > 0) {
					const skipped = Math.min(fallbackToSkip, end - start);
					start += skipped;
					fallbackToSkip -= skipped;
				}
				if (start < end) {
					text += content.slice(start, end);
					fragments.push({ start, end });
				}
			}
			index = end;
			continue;
		}

		const escaped = content[index + 1];
		if (["\\", "{", "}"].includes(escaped)) {
			if (!state.skip && fallbackToSkip === 0) {
				text += escaped;
				fragments.push({ start: index, end: index + 2 });
			} else if (fallbackToSkip > 0) fallbackToSkip--;
			index += 2;
			continue;
		}
		if (
			escaped === "'" &&
			/^[0-9a-f]{2}$/i.test(content.slice(index + 2, index + 4))
		) {
			if (!state.skip && fallbackToSkip === 0) {
				text += decodeHex(content.slice(index + 2, index + 4));
				fragments.push({ start: index, end: index + 4 });
			} else if (fallbackToSkip > 0) fallbackToSkip--;
			index += 4;
			continue;
		}

		const control = content.slice(index).match(/^\\([a-zA-Z]+)(-?\d+)? ?/);
		if (control) {
			const word = control[1].toLowerCase();
			const parameter =
				control[2] === undefined ? undefined : Number(control[2]);
			const end = index + control[0].length;
			if (!state.skip) {
				if (word === "par") flush();
				else if (word === "line") text += "\n";
				else if (word === "tab") text += "\t";
				else if (word === "uc" && parameter !== undefined)
					state.uc = Math.max(0, parameter);
				else if (word === "u" && parameter !== undefined) {
					const codePoint = parameter < 0 ? parameter + 65536 : parameter;
					text += String.fromCharCode(codePoint);
					fragments.push({
						start: index,
						end: Math.min(content.length, end + state.uc),
					});
					fallbackToSkip = state.uc;
				}
			}
			index = end;
			continue;
		}
		if (!state.skip && ["~", "-", "_"].includes(escaped)) {
			text +=
				escaped === "~" ? "\u00a0" : escaped === "-" ? "\u00ad" : "\u2011";
			fragments.push({ start: index, end: index + 2 });
		}
		index += Math.min(2, content.length - index);
	}
	flush();
	return paragraphs;
}

export async function validateRtfFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const content = decodeTextBytes(
			await readSafeFileBytes(file, context),
		).text;
		if (!/^\s*\{\\rtf\d/i.test(content))
			return {
				valid: false,
				reason: "The file does not contain an RTF document header.",
			};
		parseRTF(content);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			reason:
				error instanceof Error ? error.message : "Malformed RTF document.",
		};
	}
}

export async function importRtfFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const bytes = await readSafeFileBytes(file, context);
	const decoded = decodeTextBytes(bytes);
	if (!(await validateRtfFile(file, context)).valid)
		throw new SafeInputError(
			"RTF_INVALID",
			"The RTF document is malformed or unsupported.",
		);
	const normalized = normalizeImportOptions("rtf", options);
	const paragraphs = extractRtfParagraphs(
		decoded.text,
		Boolean(normalized.includeHeadersFooters),
	);
	if (!paragraphs.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"The RTF contains no translatable text.",
		);
	const segments = paragraphs.map((paragraph) => paragraph.text);
	const meta: RtfSegmentMeta[] = paragraphs.map((paragraph, index) => ({
		profile: "rtf-native",
		paragraph: index,
		fragments: paragraph.fragments,
	}));
	const replacements: RtfParagraphReplacement[] = meta.map(
		(entry, unitIndex) => ({
			kind: "rtf-paragraph",
			unitIndex,
			paragraph: entry.paragraph,
			fragments: entry.fragments,
		}),
	);
	const document = createNeutralDocument({
		format: "rtf",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			paragraph: entry.paragraph,
			segmentIndex,
		})),
	});
	document.metadata = { profile: "RTF 1.x native skeleton", roundTrip: true };
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(file, "rtf", decoded.text, replacements),
		filterOptions: normalized,
		typeRef: { profile: "rtf-native" },
		segmentsMeta: meta,
	};
}

function escapeRtf(value: string): string {
	let output = "";
	for (const character of value) {
		if (character === "\\" || character === "{" || character === "}")
			output += `\\${character}`;
		else if (character === "\n") output += "\\line ";
		else if (character === "\t") output += "\\tab ";
		else {
			const code = character.charCodeAt(0);
			output +=
				code >= 32 && code <= 126
					? character
					: `\\u${code > 32767 ? code - 65536 : code}?`;
		}
	}
	return output;
}

function rtfSkeleton(project: UserData): DocumentSkeleton {
	const skeleton = project.translationData.skeleton;
	if (
		!skeleton ||
		skeleton.format !== "rtf" ||
		skeleton.payload.kind !== "text"
	)
		throw new Error("RTF export requires its original text skeleton.");
	return skeleton;
}

export function buildRtfTranslationBlob(project: UserData): Blob {
	assertProjectExportQuality(project);
	const skeleton = rtfSkeleton(project);
	let output = skeleton.payload.kind === "text" ? skeleton.payload.content : "";
	const replacements = skeleton.replacements.filter(
		(replacement): replacement is RtfParagraphReplacement =>
			replacement.kind === "rtf-paragraph",
	);
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const replacement of replacements) {
		const translated = escapeRtf(
			project.translationData.seg2[replacement.unitIndex] ||
				project.translationData.seg1[replacement.unitIndex] ||
				"",
		);
		for (const [fragmentIndex, fragment] of replacement.fragments.entries()) {
			const original = output.slice(fragment.start, fragment.end);
			const leadingWhitespace = original.match(/^\s+/)?.[0] ?? "";
			edits.push({
				start: fragment.start,
				end: fragment.end,
				value: fragmentIndex === 0 ? `${leadingWhitespace}${translated}` : "",
			});
		}
	}
	for (const edit of edits.sort((a, b) => b.start - a.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	return new Blob([output], { type: "application/rtf" });
}

export async function generateRtfTranslation(project: UserData): Promise<void> {
	const url = URL.createObjectURL(buildRtfTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = `${(project.translationData.name || "translation").replace(/\.rtf$/i, "")}.translated.rtf`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
