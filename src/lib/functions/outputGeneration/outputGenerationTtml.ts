import { parseTtmlDocument } from "$lib/formats/ttml";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TtmlValueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

function positiveLimit(value: unknown): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: Number.POSITIVE_INFINITY;
}

function visibleLength(value: string): number {
	return Array.from(value.replace(/\r\n|\n|\r/g, "")).length;
}

function validateTtmlTargets(
	project: UserData,
	replacements: readonly TtmlValueReplacement[],
): void {
	const options = project.translationData.filterOptions ?? {};
	const maxCharacters = positiveLimit(options.maxCharactersPerLine);
	const maxLines = positiveLimit(options.maxLinesPerCue);
	const maxReadingSpeed = positiveLimit(options.maxReadingSpeed);
	const maxExpansion = positiveLimit(options.maxExpansionPercent);
	const byCue = new Map<number, TtmlValueReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.cueIndex < 0) continue;
		const group = byCue.get(replacement.cueIndex) ?? [];
		group.push(replacement);
		byCue.set(replacement.cueIndex, group);
	}
	const issues: string[] = [];
	for (const [cueIndex, group] of byCue) {
		const targets = group.map(
			(replacement) =>
				project.translationData.seg2[replacement.unitIndex] ?? "",
		);
		const lines = targets.join(" ").split(/\r\n|\n|\r/);
		if (lines.length > maxLines)
			issues.push(
				`TTML cue ${cueIndex + 1} has ${lines.length} lines; maximum is ${maxLines}.`,
			);
		const longest = Math.max(
			0,
			...lines.map((line) => Array.from(line).length),
		);
		if (longest > maxCharacters)
			issues.push(
				`TTML cue ${cueIndex + 1} has a ${longest}-character line; maximum is ${maxCharacters}.`,
			);
		const targetLength = visibleLength(targets.join(" "));
		const sourceLength = visibleLength(
			group.map((entry) => entry.originalValue).join(" "),
		);
		const duration = (group[0].endMs - group[0].startMs) / 1_000;
		const speed =
			duration > 0 ? targetLength / duration : Number.POSITIVE_INFINITY;
		if (speed > maxReadingSpeed)
			issues.push(
				`TTML cue ${cueIndex + 1} reads at ${speed.toFixed(1)} characters/second; maximum is ${maxReadingSpeed}.`,
			);
		const expansion =
			sourceLength > 0
				? ((targetLength - sourceLength) / sourceLength) * 100
				: 0;
		if (expansion > maxExpansion)
			issues.push(
				`TTML cue ${cueIndex + 1} expands by ${expansion.toFixed(1)}%; maximum is ${maxExpansion}%.`,
			);
	}
	if (issues.length)
		throw new Error(
			`TTML export blocked by ${issues.length} timing/readability issue${issues.length === 1 ? "" : "s"}. ${issues.slice(0, 3).join(" ")}`,
		);
}

function escapeXml(
	value: string,
	location: TtmlValueReplacement["location"],
): string {
	if (location === "cdata") return value.replaceAll("]]>", "]]]]><![CDATA[>");
	const escaped = value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return location === "attribute"
		? escaped.replaceAll('"', "&quot;").replaceAll("'", "&apos;")
		: escaped;
}

export function buildTtmlTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "ttml");
	if (content === undefined)
		throw new Error(
			"TTML export requires its original positional XML skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is TtmlValueReplacement =>
			replacement.kind === "ttml-value",
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
			`TTML export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	validateTtmlTargets(project, replacements);
	const groups = new Map<string, TtmlValueReplacement[]>();
	for (const replacement of replacements) {
		const key = `${replacement.start}:${replacement.end}`;
		const group = groups.get(key) ?? [];
		group.push(replacement);
		groups.set(key, group);
	}
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const group of groups.values()) {
		const ordered = group.sort(
			(first, second) => first.unitIndex - second.unitIndex,
		);
		let translated = "";
		for (const replacement of ordered) {
			const separator = replacement.separator ?? "";
			let value = data.seg2[replacement.unitIndex] ?? "";
			if (separator && value.endsWith(separator))
				value = value.slice(0, -separator.length);
			translated += `${value}${separator}`;
		}
		const first = ordered[0];
		if (translated === first.originalValue) continue;
		edits.push({
			start: first.start,
			end: first.end,
			value: escapeXml(translated, first.location),
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	const parsed = parseTtmlDocument(output);
	if (
		data.filterOptions?.overlapPolicy === "error" &&
		parsed.warnings.some((warning) => warning.includes("overlaps"))
	)
		throw new Error("TTML export blocked because cue timings overlap.");
	return output;
}

export function buildTtmlTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildTtmlTranslation(project);
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `application/ttml+xml;charset=${encoding}` },
	);
}

export async function generateTtmlTranslation(
	project: UserData,
): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"captions.ttml";
	const sourceExtension = project.translationData.skeleton?.source.name
		?.toLowerCase()
		.split(".")
		.at(-1);
	const extension = sourceExtension === "dfxp" ? "dfxp" : "ttml";
	const name = new RegExp(`\\.${extension}$`, "i").test(requested)
		? requested
		: `${requested}.${extension}`;
	const url = URL.createObjectURL(buildTtmlTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
