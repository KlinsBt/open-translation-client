import { decodeRcString, parseWindowsRcDocument } from "$lib/formats/windowsRc";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TextRangeReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function encodeRcString(value: string): string {
	let output = "";
	for (const character of value) {
		const codePoint = character.codePointAt(0)!;
		if (character === "\\") output += "\\\\";
		else if (character === '"') output += '\\"';
		else if (character === "\n") output += "\\n";
		else if (character === "\r") output += "\\r";
		else if (character === "\t") output += "\\t";
		else if (codePoint < 0x20 || codePoint === 0x7f)
			output += `\\x${codePoint.toString(16).padStart(2, "0")}`;
		else output += character;
	}
	return output;
}

export function buildWindowsRcTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "windows-rc");
	if (content === undefined)
		throw new Error(
			"Windows RC export requires its original resource-script skeleton.",
		);
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
			`Windows RC export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const groups = new Map<string, TextRangeReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.end > content.length)
			throw new Error(
				"A Windows RC string mapping points outside its original source.",
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
		const original = decodeRcString(content.slice(first.start, first.end));
		if (translated === original) continue;
		edits.push({
			start: first.start,
			end: first.end,
			value: encodeRcString(translated),
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseWindowsRcDocument(output);
	return output;
}

export function buildWindowsRcTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildWindowsRcTranslation(project);
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `text/x-windows-rc;charset=${encoding}` },
	);
}

export async function generateWindowsRcTranslation(
	project: UserData,
): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"resources.rc";
	const name = /\.rc$/i.test(requested) ? requested : `${requested}.rc`;
	const url = URL.createObjectURL(buildWindowsRcTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
