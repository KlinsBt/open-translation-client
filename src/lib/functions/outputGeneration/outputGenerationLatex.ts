import { scanLatexProse } from "$lib/formats/latex";
import { normalizeImportOptions } from "$lib/formats/options";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TextRangeReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

function escapeLatexProse(value: string): string {
	return value.replace(/[\\{}$%&#_^~]/g, (character) => {
		return {
			"\\": "\\textbackslash{}",
			"{": "\\{",
			"}": "\\}",
			$: "\\$",
			"%": "\\%",
			"&": "\\&",
			"#": "\\#",
			_: "\\_",
			"^": "\\textasciicircum{}",
			"~": "\\textasciitilde{}",
		}[character]!;
	});
}

export function buildLatexTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "latex");
	if (content === undefined)
		throw new Error("TeX/LaTeX export requires its original prose skeleton.");
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
			`TeX/LaTeX export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const groups = new Map<string, TextRangeReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.end > content.length)
			throw new Error(
				"A TeX/LaTeX mapping points outside its original source.",
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
		const original = content.slice(first.start, first.end);
		if (translated === original) continue;
		edits.push({
			start: first.start,
			end: first.end,
			value: escapeLatexProse(translated),
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	scanLatexProse(output, normalizeImportOptions("latex", data.filterOptions));
	return output;
}

export function buildLatexTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildLatexTranslation(project);
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `application/x-tex;charset=${encoding}` },
	);
}

export async function generateLatexTranslation(
	project: UserData,
): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"document.tex";
	const name = /\.tex$/i.test(requested) ? requested : `${requested}.tex`;
	const url = URL.createObjectURL(buildLatexTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
