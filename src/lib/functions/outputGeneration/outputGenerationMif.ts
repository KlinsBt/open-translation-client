import { parseMifDocument } from "$lib/formats/mif";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TextRangeReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function encodeMifString(value: string): string {
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("`", "\\x60 ")
		.replaceAll("'", "\\x27 ")
		.replaceAll("\t", "\\t")
		.replaceAll("\r", "\\r")
		.replaceAll("\n", "\\n");
}

export function buildMifTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "mif");
	if (content === undefined)
		throw new Error("MIF export requires its original tagged-text skeleton.");
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is TextRangeReplacement =>
			replacement.kind === "text-range",
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
			`MIF export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const groups = new Map<string, TextRangeReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.end > content.length)
			throw new Error(
				"A MIF string mapping points outside its original source.",
			);
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
		const originalToken = parseMifDocument(
			`<MIFFile 7.00>\n<String \`${content.slice(first.start, first.end)}'>`,
		).strings.at(-1)?.value;
		if (translated === originalToken) continue;
		edits.push({
			start: first.start,
			end: first.end,
			value: encodeMifString(translated),
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseMifDocument(output);
	return output;
}

export function buildMifTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildMifTranslation(project);
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `application/vnd.mif;charset=${encoding}` },
	);
}

export async function generateMifTranslation(project: UserData): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"document.mif";
	const name = /\.(?:mif|mi2)$/i.test(requested)
		? requested
		: `${requested}.mif`;
	const url = URL.createObjectURL(buildMifTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
