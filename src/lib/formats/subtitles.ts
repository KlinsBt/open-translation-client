import type { SubtitleSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type SubtitleCueReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export type SubtitleProfile = "srt" | "vtt" | "sbv" | "ass" | "ssa" | "stl";

export interface SubtitleCue {
	profile: SubtitleProfile;
	cueIndex: number;
	cueId?: string;
	startMs: number;
	endMs: number;
	settings?: string;
	style?: string;
	actor?: string;
	layer?: string;
	effect?: string;
	frameRate?: number;
	timebase?: "milliseconds" | "centiseconds" | "frames";
	line: number;
	start: number;
	end: number;
	text: string;
}

export interface ParsedSubtitles {
	profile: SubtitleProfile;
	cues: SubtitleCue[];
	warnings: string[];
	noteBlocks: number;
	frameRate?: number;
	headers?: number;
	protectedCues?: number;
}

export interface SubtitleParseOptions {
	frameRate?: number;
}

interface LineRecord {
	start: number;
	visibleEnd: number;
	end: number;
	text: string;
	line: number;
}

const SUBTITLE_PROFILES = ["srt", "vtt", "sbv", "ass", "ssa", "stl"] as const;
const ASS_SIGNATURE = /^\s*ScriptType\s*:\s*v4\.00\+\+?\s*$/im;
const SSA_SIGNATURE = /^\s*ScriptType\s*:\s*v4\.00\s*$/im;
const STL_CUE_SIGNATURE =
	/^\d{2}:\d{2}:\d{2}:\d{2}\s*,\s*\d{2}:\d{2}:\d{2}:\d{2}\s*,/;

function invalidSubtitle(message: string, line: number): SafeInputError {
	return new SafeInputError("SUBTITLE_INVALID", `${message} (line ${line}).`, {
		line,
	});
}

function linesOf(content: string): LineRecord[] {
	const records: LineRecord[] = [];
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
			visibleEnd,
			end,
			text: content.slice(cursor, visibleEnd),
			line,
		});
		cursor = end;
		line++;
	}
	return records;
}

function substantiveStlLine(content: string): string | undefined {
	return linesOf(content)
		.map((record) => record.text.replace(/^\ufeff/, ""))
		.find((line) => {
			const trimmed = line.trim();
			return trimmed && !trimmed.startsWith("$") && !trimmed.startsWith("//");
		});
}

export function detectSubtitleProfileFromContent(
	content: string,
	name = "",
	requested = "auto",
): SubtitleProfile {
	if (content.includes("\0"))
		throw invalidSubtitle(
			"Binary EBU STL is not Spruce STL; import a text-based Spruce STL file",
			1,
		);
	const first = content.replace(/^\ufeff/, "");
	let detected: SubtitleProfile | undefined;
	if (/^WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(first)) detected = "vtt";
	else if (
		/^\s*\[Script Info\]\s*$/im.test(first) &&
		ASS_SIGNATURE.test(first) &&
		/^\s*\[Events\]\s*$/im.test(first)
	)
		detected = "ass";
	else if (
		/^\s*\[Script Info\]\s*$/im.test(first) &&
		SSA_SIGNATURE.test(first) &&
		/^\s*\[Events\]\s*$/im.test(first)
	)
		detected = "ssa";
	else if (STL_CUE_SIGNATURE.test(substantiveStlLine(first) ?? ""))
		detected = "stl";
	else if (
		/(?:^|\r?\n)(?:[^\r\n]+\r?\n)?\d{2,}:[0-5]\d:[0-5]\d,\d{3}\s+-->\s+\d{2,}:[0-5]\d:[0-5]\d,\d{3}(?:\s|$)/.test(
			first,
		)
	)
		detected = "srt";
	else if (
		/(?:^|\r?\n)\d+:[0-5]\d:[0-5]\d\.\d{3},\d+:[0-5]\d:[0-5]\d\.\d{3}\s*$/m.test(
			first,
		)
	)
		detected = "sbv";

	if (!detected) {
		const extension = name.toLowerCase().split(".").at(-1);
		const claim = SUBTITLE_PROFILES.includes(extension as SubtitleProfile)
			? ` The .${extension} extension is not sufficient without a matching content signature.`
			: "";
		throw invalidSubtitle(
			`No supported subtitle content signature was found.${claim}`,
			1,
		);
	}
	if (
		requested !== "auto" &&
		SUBTITLE_PROFILES.includes(requested as SubtitleProfile) &&
		requested !== detected
	)
		throw invalidSubtitle(
			`The requested ${requested.toUpperCase()} profile does not match the detected ${detected.toUpperCase()} content`,
			1,
		);
	return detected;
}

export function detectSubtitleProfile(
	name: string,
	requested = "auto",
	content?: string,
): SubtitleProfile {
	if (content !== undefined)
		return detectSubtitleProfileFromContent(content, name, requested);
	if (SUBTITLE_PROFILES.includes(requested as SubtitleProfile))
		return requested as SubtitleProfile;
	const extension = name.toLowerCase().split(".").at(-1);
	return SUBTITLE_PROFILES.includes(extension as SubtitleProfile)
		? (extension as SubtitleProfile)
		: "srt";
}

export async function detectSubtitleFileProfile(
	file: File,
	context?: SafeInputContext,
): Promise<SubtitleProfile> {
	const { text } = await readSafeTextFile(file, context);
	return detectSubtitleProfileFromContent(text, file.name);
}

function timestampMs(
	hours: string | undefined,
	minutes: string,
	seconds: string,
	milliseconds: string,
): number {
	return (
		Number(hours ?? 0) * 3_600_000 +
		Number(minutes) * 60_000 +
		Number(seconds) * 1_000 +
		Number(milliseconds)
	);
}

function parseTiming(
	line: string,
	profile: "srt" | "vtt" | "sbv",
): { startMs: number; endMs: number; settings?: string } | undefined {
	if (profile === "sbv") {
		const match = line.match(
			/^(\d+):([0-5]\d):([0-5]\d)\.(\d{3}),(\d+):([0-5]\d):([0-5]\d)\.(\d{3})\s*$/,
		);
		if (!match) return undefined;
		return {
			startMs: timestampMs(match[1], match[2], match[3], match[4]),
			endMs: timestampMs(match[5], match[6], match[7], match[8]),
		};
	}
	if (profile === "srt") {
		const match = line.match(
			/^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})(?:\s+(.+?))?\s*$/,
		);
		if (!match) return undefined;
		return {
			startMs: timestampMs(match[1], match[2], match[3], match[4]),
			endMs: timestampMs(match[5], match[6], match[7], match[8]),
			...(match[9] ? { settings: match[9] } : {}),
		};
	}
	const match = line.match(
		/^(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})\s+-->\s+(?:(\d{2,}):)?([0-5]\d):([0-5]\d)\.(\d{3})(?:\s+(.+?))?\s*$/,
	);
	if (!match) return undefined;
	return {
		startMs: timestampMs(match[1], match[2], match[3], match[4]),
		endMs: timestampMs(match[5], match[6], match[7], match[8]),
		...(match[9] ? { settings: match[9] } : {}),
	};
}

function blocksFrom(records: LineRecord[], startIndex: number): LineRecord[][] {
	const blocks: LineRecord[][] = [];
	let current: LineRecord[] = [];
	for (let index = startIndex; index < records.length; index++) {
		const record = records[index];
		if (!record.text.trim()) {
			if (current.length) blocks.push(current);
			current = [];
		} else current.push(record);
	}
	if (current.length) blocks.push(current);
	return blocks;
}

function cueFromBlock(
	content: string,
	block: LineRecord[],
	profile: "srt" | "vtt" | "sbv",
	cueIndex: number,
): SubtitleCue {
	const direct = parseTiming(block[0].text.replace(/^\ufeff/, ""), profile);
	const timingIndex = direct ? 0 : 1;
	const timing = direct ?? parseTiming(block[1]?.text ?? "", profile);
	if (!timing)
		throw invalidSubtitle(
			`Expected a valid ${profile.toUpperCase()} timing line`,
			block[0].line,
		);
	if (profile === "sbv" && timingIndex !== 0)
		throw invalidSubtitle(
			"SBV cues cannot have a separate cue ID",
			block[0].line,
		);
	if (timing.endMs <= timing.startMs)
		throw invalidSubtitle(
			"Cue end time must be later than its start time",
			block[timingIndex].line,
		);
	const textRecords = block.slice(timingIndex + 1);
	if (!textRecords.length)
		throw invalidSubtitle("Cue has no text payload", block[timingIndex].line);
	const start = textRecords[0].start;
	const end = textRecords.at(-1)!.visibleEnd;
	return {
		profile,
		cueIndex,
		...(timingIndex === 1
			? { cueId: block[0].text.replace(/^\ufeff/, "") }
			: {}),
		...timing,
		timebase: "milliseconds",
		line: textRecords[0].line,
		start,
		end,
		text: content.slice(start, end),
	};
}

function assTimeMs(value: string, line: number): number {
	const match = value.trim().match(/^(\d+):([0-5]\d):([0-5]\d)\.(\d{2})$/);
	if (!match)
		throw invalidSubtitle(`Invalid ASS/SSA timestamp "${value.trim()}"`, line);
	return timestampMs(match[1], match[2], match[3], `${match[4]}0`);
}

function splitAssFields(
	value: string,
	fieldCount: number,
): string[] | undefined {
	const fields: string[] = [];
	let cursor = 0;
	for (let index = 0; index < fieldCount - 1; index++) {
		const comma = value.indexOf(",", cursor);
		if (comma < 0) return undefined;
		fields.push(value.slice(cursor, comma));
		cursor = comma + 1;
	}
	fields.push(value.slice(cursor));
	return fields;
}

function parseAss(content: string, profile: "ass" | "ssa"): ParsedSubtitles {
	const records = linesOf(content);
	if (!records.length) throw invalidSubtitle("Subtitle file is empty", 1);
	let section = "";
	let scriptType = "";
	let eventsFormat: string[] | undefined;
	let eventsFormatLine = 1;
	let headers = 0;
	let noteBlocks = 0;
	let protectedCues = 0;
	const styles = new Set<string>();
	const cues: SubtitleCue[] = [];
	for (const record of records) {
		const lineText =
			record.line === 1 ? record.text.replace(/^\ufeff/, "") : record.text;
		const trimmed = lineText.trim();
		const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
		if (sectionMatch) {
			section = sectionMatch[1].toLowerCase();
			headers++;
			continue;
		}
		if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("!")) {
			if (trimmed) noteBlocks++;
			continue;
		}
		if (section === "script info") {
			const type = trimmed.match(/^ScriptType\s*:\s*(.+)$/i);
			if (type) scriptType = type[1].trim();
			continue;
		}
		const expectedStyleSection =
			profile === "ass" ? /^v4\+{1,2} styles$/ : /^v4 styles$/;
		if (expectedStyleSection.test(section)) {
			const style = lineText.match(/^\s*Style\s*:\s*([^,]+)/i);
			if (style) styles.add(style[1].trim());
			continue;
		}
		if (section !== "events") continue;
		const format = lineText.match(/^\s*Format\s*:\s*(.+)$/i);
		if (format) {
			eventsFormat = format[1]
				.split(",")
				.map((field) => field.trim().toLowerCase());
			eventsFormatLine = record.line;
			continue;
		}
		const event = lineText.match(/^\s*(Dialogue|Comment)\s*:(.*)$/i);
		if (!event) continue;
		if (event[1].toLowerCase() === "comment") {
			noteBlocks++;
			continue;
		}
		if (!eventsFormat)
			throw invalidSubtitle(
				"ASS/SSA Events must declare a Format line before Dialogue",
				record.line,
			);
		const required = ["start", "end", "style", "text"];
		if (required.some((field) => !eventsFormat!.includes(field)))
			throw invalidSubtitle(
				"ASS/SSA Events Format must include Start, End, Style, and Text",
				eventsFormatLine,
			);
		if (eventsFormat.at(-1) !== "text")
			throw invalidSubtitle(
				"ASS/SSA Events Text must be the final Format field",
				eventsFormatLine,
			);
		const rawFields = event[2];
		const fields = splitAssFields(rawFields, eventsFormat.length);
		if (!fields)
			throw invalidSubtitle(
				"Dialogue has fewer values than its Events Format",
				record.line,
			);
		const value = (name: string) => fields[eventsFormat!.indexOf(name)] ?? "";
		const startMs = assTimeMs(value("start"), record.line);
		const endMs = assTimeMs(value("end"), record.line);
		if (endMs <= startMs)
			throw invalidSubtitle(
				"Cue end time must be later than its start time",
				record.line,
			);
		const style = value("style").trim();
		if (!style || !styles.has(style))
			throw invalidSubtitle(
				`Dialogue references undefined style "${style || "(empty)"}"`,
				record.line,
			);
		const text = fields.at(-1)!;
		if (/\{[^}]*\\p(?:bo)?[1-9]\d*[^}]*\}/i.test(text)) {
			protectedCues++;
			continue;
		}
		const textOffset = rawFields.length - text.length;
		const rawFieldsOffset = lineText.indexOf(event[2]);
		const start = record.start + rawFieldsOffset + textOffset;
		const cueIndex = cues.length;
		cues.push({
			profile,
			cueIndex,
			cueId: `${profile}-dialogue-${cueIndex + 1}`,
			startMs,
			endMs,
			style,
			actor: value("name").trim() || undefined,
			layer: (value("layer") || value("marked")).trim() || undefined,
			effect: value("effect").trim() || undefined,
			settings:
				[value("marginl"), value("marginr"), value("marginv")]
					.map((entry) => entry.trim())
					.filter(Boolean)
					.join(",") || undefined,
			timebase: "centiseconds",
			line: record.line,
			start,
			end: record.visibleEnd,
			text,
		});
	}
	const expectedScriptType = profile === "ass" ? /^v4\.00\+\+?$/i : /^v4\.00$/i;
	if (!expectedScriptType.test(scriptType))
		throw invalidSubtitle(
			`${profile.toUpperCase()} requires a matching ScriptType declaration`,
			1,
		);
	if (!styles.size)
		throw invalidSubtitle("ASS/SSA contains no declared styles", 1);
	if (!cues.length)
		throw invalidSubtitle(
			"Subtitle file contains no translatable dialogue cues",
			1,
		);
	return {
		profile,
		cues,
		warnings: cueWarnings(cues),
		noteBlocks,
		headers,
		protectedCues,
	};
}

function stlTimeMs(
	parts: readonly string[],
	frameRate: number,
	line: number,
): number {
	const [hours, minutes, seconds, frames] = parts.map(Number);
	if (minutes > 59 || seconds > 59 || frames >= frameRate)
		throw invalidSubtitle(
			`Invalid Spruce STL timecode for ${frameRate} fps`,
			line,
		);
	return Math.round(
		(hours * 3_600 + minutes * 60 + seconds + frames / frameRate) * 1_000,
	);
}

function normalizedFrameRate(value: number | undefined): number {
	const rate = value ?? 30;
	if (!Number.isInteger(rate) || rate < 1 || rate > 120)
		throw invalidSubtitle(
			"Spruce STL frame rate must be an integer from 1 to 120",
			1,
		);
	return rate;
}

function parseStl(
	content: string,
	options: SubtitleParseOptions,
): ParsedSubtitles {
	if (content.includes("\0"))
		throw invalidSubtitle(
			"Binary EBU STL is not supported by the text-based Spruce STL profile",
			1,
		);
	const frameRate = normalizedFrameRate(options.frameRate);
	const cues: SubtitleCue[] = [];
	let headers = 0;
	let noteBlocks = 0;
	for (const record of linesOf(content)) {
		const text =
			record.line === 1 ? record.text.replace(/^\ufeff/, "") : record.text;
		const trimmed = text.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith("$")) {
			headers++;
			continue;
		}
		if (trimmed.startsWith("//")) {
			noteBlocks++;
			continue;
		}
		const match = text.match(
			/^(\d{2}):(\d{2}):(\d{2}):(\d{2})\s*,\s*(\d{2}):(\d{2}):(\d{2}):(\d{2})\s*,(.*)$/,
		);
		if (!match)
			throw invalidSubtitle(
				"Expected a Spruce STL entry with two HH:MM:SS:FF timecodes",
				record.line,
			);
		const startMs = stlTimeMs(match.slice(1, 5), frameRate, record.line);
		const endMs = stlTimeMs(match.slice(5, 9), frameRate, record.line);
		if (endMs <= startMs)
			throw invalidSubtitle(
				"Cue end time must be later than its start time",
				record.line,
			);
		const cueText = match[9];
		if (!cueText.length)
			throw invalidSubtitle("Cue has no text payload", record.line);
		const start = record.visibleEnd - cueText.length;
		const cueIndex = cues.length;
		cues.push({
			profile: "stl",
			cueIndex,
			cueId: `stl-cue-${cueIndex + 1}`,
			startMs,
			endMs,
			frameRate,
			timebase: "frames",
			line: record.line,
			start,
			end: record.visibleEnd,
			text: content.slice(start, record.visibleEnd),
		});
	}
	if (!cues.length)
		throw invalidSubtitle(
			"Subtitle file contains no translatable Spruce STL cues",
			1,
		);
	return {
		profile: "stl",
		cues,
		warnings: cueWarnings(cues),
		noteBlocks,
		headers,
		frameRate,
	};
}

function cueWarnings(cues: readonly SubtitleCue[]): string[] {
	const warnings: string[] = [];
	for (let index = 1; index < cues.length; index++) {
		const previous = cues[index - 1];
		const current = cues[index];
		if (current.startMs < previous.startMs)
			warnings.push(
				`Cue ${index + 1} starts before cue ${index}; source order was retained.`,
			);
		if (current.startMs < previous.endMs)
			warnings.push(
				`Cue ${index + 1} overlaps cue ${index} by ${previous.endMs - current.startMs} ms.`,
			);
	}
	return warnings;
}

export function parseSubtitles(
	content: string,
	profile: SubtitleProfile,
	options: SubtitleParseOptions = {},
): ParsedSubtitles {
	if (profile === "ass" || profile === "ssa") return parseAss(content, profile);
	if (profile === "stl") return parseStl(content, options);
	const records = linesOf(content);
	if (!records.length) throw invalidSubtitle("Subtitle file is empty", 1);
	let startIndex = 0;
	let noteBlocks = 0;
	if (profile === "vtt") {
		const signature = records[0].text.replace(/^\ufeff/, "");
		if (!/^WEBVTT(?:[ \t].*)?$/.test(signature))
			throw invalidSubtitle("WebVTT must begin with a WEBVTT signature", 1);
		startIndex = 1;
		while (startIndex < records.length && records[startIndex].text.trim())
			startIndex++;
	}
	const cues: SubtitleCue[] = [];
	for (const block of blocksFrom(records, startIndex)) {
		if (
			profile === "vtt" &&
			/^(?:NOTE(?:[ \t]|$)|STYLE$|REGION$)/.test(block[0].text)
		) {
			noteBlocks++;
			continue;
		}
		cues.push(cueFromBlock(content, block, profile, cues.length));
	}
	if (!cues.length)
		throw invalidSubtitle("Subtitle file contains no translatable cues", 1);
	return { profile, cues, warnings: cueWarnings(cues), noteBlocks };
}

export async function validateSubtitleFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		const profile = detectSubtitleProfileFromContent(text, file.name);
		// Spruce STL does not carry a universal frame-rate declaration. Structural
		// validation accepts the supported ceiling; import applies the user's rate.
		parseSubtitles(text, profile, profile === "stl" ? { frameRate: 120 } : {});
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The subtitle file is invalid." };
	}
}

export async function importSubtitleFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("subtitles", options);
	const read = await readSafeTextFile(file, context);
	const profile = detectSubtitleProfileFromContent(
		read.text,
		file.name,
		String(filterOptions.profile),
	);
	const frameRate = normalizedFrameRate(Number(filterOptions.spruceFrameRate));
	const parsed = parseSubtitles(read.text, profile, { frameRate });
	const overlapWarnings = parsed.warnings.filter((warning) =>
		warning.includes("overlaps"),
	);
	if (filterOptions.overlapPolicy === "error" && overlapWarnings.length)
		throw invalidSubtitle(overlapWarnings[0], parsed.cues[1]?.line ?? 1);
	const warnings =
		filterOptions.overlapPolicy === "allow"
			? parsed.warnings.filter((warning) => !warning.includes("overlaps"))
			: parsed.warnings;
	const segments = parsed.cues.map((cue) => cue.text);
	const meta: SubtitleSegmentMeta[] = parsed.cues.map((cue) => ({
		profile,
		cueIndex: cue.cueIndex,
		...(cue.cueId ? { cueId: cue.cueId } : {}),
		startMs: cue.startMs,
		endMs: cue.endMs,
		...(cue.settings ? { settings: cue.settings } : {}),
		...(cue.style ? { style: cue.style } : {}),
		...(cue.actor ? { actor: cue.actor } : {}),
		...(cue.layer ? { layer: cue.layer } : {}),
		...(cue.effect ? { effect: cue.effect } : {}),
		...(cue.frameRate ? { frameRate: cue.frameRate } : {}),
		...(cue.timebase ? { timebase: cue.timebase } : {}),
		line: cue.line,
		start: cue.start,
		end: cue.end,
		originalValue: cue.text,
	}));
	const replacements: SubtitleCueReplacement[] = meta.map(
		(entry, unitIndex) => ({
			kind: "subtitle-cue",
			unitIndex,
			...entry,
		}),
	);
	const document = createNeutralDocument({
		format: "subtitles",
		sourceSegments: segments,
		unitIds: meta.map((cue) => cue.cueId || `cue-${cue.cueIndex + 1}`),
		sourceLocations: meta.map((cue, segmentIndex) => ({
			part: file.name,
			path: [profile, cue.cueId || cue.cueIndex + 1],
			line: cue.line,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile,
		warnings,
		noteBlocks: parsed.noteBlocks,
		headers: parsed.headers ?? 0,
		protectedCues: parsed.protectedCues ?? 0,
		...(parsed.frameRate
			? { frameRate: parsed.frameRate, timebase: "frames" }
			: {}),
		encoding: read.encoding,
		hasBom: read.hasBom,
	};
	for (const [index, cue] of meta.entries()) {
		const unit = document.units[index];
		if (cue.cueId)
			unit.contexts.push({ type: "subtitle-cue-id", value: cue.cueId });
		unit.contexts.push({
			type: "subtitle-time-range-ms",
			value: `${cue.startMs}-${cue.endMs}`,
		});
		if (cue.settings)
			unit.contexts.push({ type: "subtitle-settings", value: cue.settings });
		if (cue.style)
			unit.contexts.push({ type: "subtitle-style", value: cue.style });
		if (cue.actor)
			unit.contexts.push({ type: "subtitle-actor", value: cue.actor });
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"subtitles",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions: {
			...filterOptions,
			profile,
			...(profile === "stl" ? { spruceFrameRate: parsed.frameRate } : {}),
		},
		typeRef: {
			profile: `${profile}-cues`,
			...(parsed.frameRate
				? { frameRate: String(parsed.frameRate), timebase: "frames" }
				: {}),
		} as TypeRef,
		segmentsMeta: meta,
	};
}
