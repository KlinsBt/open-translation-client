import { parseSubtitles, type SubtitleProfile } from "$lib/formats/subtitles";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type SubtitleCueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

function visibleSubtitleText(value: string, profile: SubtitleProfile): string {
	const profileText =
		profile === "ass" || profile === "ssa"
			? value
					.replace(/\{[^{}\r\n]*\}/g, "")
					.replace(/\\[Nn]/g, "\n")
					.replace(/\\h/g, " ")
			: profile === "stl"
				? value.replace(/\|/g, "\n").replace(/\{[^{}\r\n]*\}/g, "")
				: value;
	return profileText
		.replace(/<[^>]*>/g, "")
		.replace(/&(?:#\d+|#x[\dA-Fa-f]+|[A-Za-z][\w-]*);/g, "x");
}

function tokenSequence(value: string, pattern: RegExp): string[] {
	return [...value.matchAll(pattern)].map((match) => match[0]);
}

function validateProfileMarkup(
	source: string,
	target: string,
	profile: SubtitleProfile,
	cue: string | number,
): string | undefined {
	if (profile === "ass" || profile === "ssa") {
		if (/[\r\n]/.test(target))
			return `Cue ${cue} contains a physical line break; ASS/SSA line breaks must remain protected \\N or \\n tokens.`;
		const sourceOverrides = tokenSequence(source, /\{[^{}\r\n]*\}/g);
		const targetOverrides = tokenSequence(target, /\{[^{}\r\n]*\}/g);
		if (JSON.stringify(sourceOverrides) !== JSON.stringify(targetOverrides))
			return `Cue ${cue} changed, removed, or reordered ASS/SSA override tags.`;
		const sourceBreaks = tokenSequence(source, /\\[Nnh]/g);
		const targetBreaks = tokenSequence(target, /\\[Nnh]/g);
		if (JSON.stringify(sourceBreaks) !== JSON.stringify(targetBreaks))
			return `Cue ${cue} changed, removed, or reordered ASS/SSA line-break or hard-space tokens.`;
	}
	if (profile === "stl") {
		if (/[\r\n]/.test(target))
			return `Cue ${cue} contains a physical line break; Spruce STL lines must use protected | separators.`;
		if (
			(source.match(/\|/g)?.length ?? 0) !== (target.match(/\|/g)?.length ?? 0)
		)
			return `Cue ${cue} changed the number of Spruce STL line separators.`;
		const sourceTags = tokenSequence(source, /\{[^{}\r\n]*\}/g);
		const targetTags = tokenSequence(target, /\{[^{}\r\n]*\}/g);
		if (JSON.stringify(sourceTags) !== JSON.stringify(targetTags))
			return `Cue ${cue} changed, removed, or reordered Spruce STL style tags.`;
	}
	return undefined;
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
		const cue = replacement.cueId ?? replacement.cueIndex + 1;
		const markupIssue = validateProfileMarkup(
			replacement.originalValue,
			target,
			replacement.profile,
			cue,
		);
		if (markupIssue) issues.push(markupIssue);
		const lines =
			replacement.profile === "ass" || replacement.profile === "ssa"
				? target.split(/\\[Nn]/)
				: replacement.profile === "stl"
					? target.split("|")
					: target.split(/\r\n|\n|\r/);
		if (lines.length > maxLines)
			issues.push(
				`Cue ${cue} has ${lines.length} lines; maximum is ${maxLines}.`,
			);
		const longest = Math.max(
			0,
			...lines.map(
				(line) =>
					Array.from(visibleSubtitleText(line, replacement.profile)).length,
			),
		);
		if (longest > maxCharacters)
			issues.push(
				`Cue ${cue} has a ${longest}-character line; maximum is ${maxCharacters}.`,
			);
		const targetLength = Array.from(
			visibleSubtitleText(target, replacement.profile).replace(
				/\r\n|\n|\r/g,
				"",
			),
		).length;
		const durationSeconds = (replacement.endMs - replacement.startMs) / 1_000;
		const speed =
			durationSeconds > 0 ? targetLength / durationSeconds : Infinity;
		if (speed > maxReadingSpeed)
			issues.push(
				`Cue ${cue} reads at ${speed.toFixed(1)} characters/second; maximum is ${maxReadingSpeed}.`,
			);
		const sourceLength = Array.from(
			visibleSubtitleText(
				replacement.originalValue,
				replacement.profile,
			).replace(/\r\n|\n|\r/g, ""),
		).length;
		const expansion =
			sourceLength > 0
				? ((targetLength - sourceLength) / sourceLength) * 100
				: 0;
		if (expansion > maxExpansion)
			issues.push(
				`Cue ${cue} expands by ${expansion.toFixed(1)}%; maximum is ${maxExpansion}%.`,
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
		{
			frameRate: Number(
				replacements[0]?.frameRate ?? data.filterOptions?.spruceFrameRate ?? 30,
			),
		},
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
	const profile = String(
		data.skeleton?.replacements.find(
			(replacement) => replacement.kind === "subtitle-cue",
		)?.profile ??
			data.filterOptions?.profile ??
			"srt",
	) as SubtitleProfile;
	const mimeType =
		profile === "vtt"
			? "text/vtt"
			: profile === "srt"
				? "application/x-subrip"
				: profile === "ass"
					? "text/x-ass"
					: profile === "ssa"
						? "text/x-ssa"
						: profile === "stl"
							? "text/x-stl"
							: "text/plain";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `${mimeType};charset=${encoding}` },
	);
}

export function subtitleTranslationDownloadName(project: UserData): string {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "subtitles.srt";
	const requested = project.translationData.name || sourceName;
	const sourceExtension = sourceName.toLowerCase().split(".").at(-1);
	const profile = String(
		project.translationData.skeleton?.replacements.find(
			(replacement) => replacement.kind === "subtitle-cue",
		)?.profile ??
			project.translationData.filterOptions?.profile ??
			"srt",
	);
	const extension = ["srt", "vtt", "sbv", "ass", "ssa", "stl"].includes(
		sourceExtension ?? "",
	)
		? sourceExtension!
		: ["srt", "vtt", "sbv", "ass", "ssa", "stl"].includes(profile)
			? profile
			: "srt";
	return new RegExp(`\\.${extension}$`, "i").test(requested)
		? requested
		: `${requested}.${extension}`;
}

export async function generateSubtitleTranslation(
	project: UserData,
): Promise<void> {
	const name = subtitleTranslationDownloadName(project);
	const url = URL.createObjectURL(buildSubtitleTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
