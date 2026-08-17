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

export type SubtitleProfile = "srt" | "vtt" | "sbv";

export interface SubtitleCue {
	profile: SubtitleProfile;
	cueIndex: number;
	cueId?: string;
	startMs: number;
	endMs: number;
	settings?: string;
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
}

interface LineRecord {
	start: number;
	visibleEnd: number;
	end: number;
	text: string;
	line: number;
}

export function detectSubtitleProfile(
	name: string,
	requested = "auto",
): SubtitleProfile {
	if (["srt", "vtt", "sbv"].includes(requested))
		return requested as SubtitleProfile;
	const extension = name.toLowerCase().split(".").at(-1);
	if (extension === "vtt") return "vtt";
	if (extension === "sbv") return "sbv";
	return "srt";
}

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
	profile: SubtitleProfile,
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
	profile: SubtitleProfile,
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
		line: textRecords[0].line,
		start,
		end,
		text: content.slice(start, end),
	};
}

export function parseSubtitles(
	content: string,
	profile: SubtitleProfile,
): ParsedSubtitles {
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
	return { profile, cues, warnings, noteBlocks };
}

export async function validateSubtitleFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseSubtitles(text, detectSubtitleProfile(file.name));
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
	const profile = detectSubtitleProfile(
		file.name,
		String(filterOptions.profile),
	);
	const read = await readSafeTextFile(file, context);
	const parsed = parseSubtitles(read.text, profile);
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
		line: cue.line,
		start: cue.start,
		end: cue.end,
		originalValue: cue.text,
	}));
	const replacements: SubtitleCueReplacement[] = meta.map(
		(entry, unitIndex) => ({ kind: "subtitle-cue", unitIndex, ...entry }),
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
		filterOptions: { ...filterOptions, profile },
		typeRef: { profile: `${profile}-cues` } as TypeRef,
		segmentsMeta: meta,
	};
}
