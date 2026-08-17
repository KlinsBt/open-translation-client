import { parseSubtitles, type SubtitleProfile } from "$lib/formats/subtitles";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type SubtitleCueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

function visibleSubtitleText(value: string): string {
	return value
		.replace(/<[^>]*>/g, "")
		.replace(/&(?:#\d+|#x[\dA-Fa-f]+|[A-Za-z][\w-]*);/g, "x");
}

function positiveLimit(value: unknown): number {
	const number = Number(value);
	return Number.isFinite(number) && number > 0
		? number
		: Number.POSITIVE_INFINITY;
}

export function validateSubtitleTargets(
	project: UserData,
	replacements: readonly SubtitleCueReplacement[],
): void {
	const data = project.translationData;
	const options = data.filterOptions ?? {};
	const maxCharacters = positiveLimit(options.maxCharactersPerLine);
	const maxLines = positiveLimit(options.maxLinesPerCue);
	const maxReadingSpeed = positiveLimit(options.maxReadingSpeed);
	const maxExpansion = positiveLimit(options.maxExpansionPercent);
	const issues: string[] = [];
	for (const replacement of replacements) {
		const target = data.seg2[replacement.unitIndex] ?? "";
		const lines = target.split(/\r\n|\n|\r/);
		if (lines.length > maxLines)
			issues.push(
				`Cue ${replacement.cueId ?? replacement.cueIndex + 1} has ${lines.length} lines; maximum is ${maxLines}.`,
			);
		const longest = Math.max(
			0,
			...lines.map((line) => Array.from(visibleSubtitleText(line)).length),
		);
		if (longest > maxCharacters)
			issues.push(
				`Cue ${replacement.cueId ?? replacement.cueIndex + 1} has a ${longest}-character line; maximum is ${maxCharacters}.`,
			);
		const targetLength = Array.from(
			visibleSubtitleText(target).replace(/\r\n|\n|\r/g, ""),
		).length;
		const durationSeconds = (replacement.endMs - replacement.startMs) / 1_000;
		const speed =
			durationSeconds > 0 ? targetLength / durationSeconds : Infinity;
		if (speed > maxReadingSpeed)
			issues.push(
				`Cue ${replacement.cueId ?? replacement.cueIndex + 1} reads at ${speed.toFixed(1)} characters/second; maximum is ${maxReadingSpeed}.`,
			);
		const sourceLength = Array.from(
			visibleSubtitleText(replacement.originalValue).replace(/\r\n|\n|\r/g, ""),
		).length;
		const expansion =
			sourceLength > 0
				? ((targetLength - sourceLength) / sourceLength) * 100
				: 0;
		if (expansion > maxExpansion)
			issues.push(
				`Cue ${replacement.cueId ?? replacement.cueIndex + 1} expands by ${expansion.toFixed(1)}%; maximum is ${maxExpansion}%.`,
			);
	}
	if (issues.length)
		throw new Error(
			`Subtitle export blocked by ${issues.length} timing/readability issue${issues.length === 1 ? "" : "s"}. ${issues.slice(0, 3).join(" ")}`,
		);
}

export function buildSubtitleTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "subtitles");
	if (content === undefined)
		throw new Error(
			"Subtitle export requires its original positional text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is SubtitleCueReplacement =>
			replacement.kind === "subtitle-cue",
	);
	if (
		replacements.length !== data.seg2.length ||
		new Set(replacements.map((replacement) => replacement.unitIndex)).size !==
			replacements.length ||
		replacements.some(
			(replacement) =>
				replacement.unitIndex < 0 || replacement.unitIndex >= data.seg2.length,
		)
	)
		throw new Error(
			`Subtitle export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	validateSubtitleTargets(project, replacements);
	let output = content;
	for (const replacement of [...replacements].sort(
		(a, b) => b.start - a.start,
	)) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		output = `${output.slice(0, replacement.start)}${translated}${output.slice(replacement.end)}`;
	}
	const parsed = parseSubtitles(
		output,
		(replacements[0]?.profile ??
			data.filterOptions?.profile ??
			"srt") as SubtitleProfile,
	);
	if (
		data.filterOptions?.overlapPolicy === "error" &&
		parsed.warnings.some((warning) => warning.includes("overlaps"))
	)
		throw new Error("Subtitle export blocked because cue timings overlap.");
	return output;
}

export function buildSubtitleTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildSubtitleTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "subtitles");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `text/plain;charset=${encoding}` },
	);
}

export async function generateSubtitleTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "subtitles.srt";
	const requested = project.translationData.name || sourceName;
	const sourceExtension = sourceName.toLowerCase().split(".").at(-1);
	const extension = ["srt", "vtt", "sbv"].includes(sourceExtension ?? "")
		? sourceExtension!
		: "srt";
	const name = new RegExp(`\\.${extension}$`, "i").test(requested)
		? requested
		: `${requested}.${extension}`;
	const url = URL.createObjectURL(buildSubtitleTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
