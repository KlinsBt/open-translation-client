import type { UserData } from "$lib/types/types";
import {
	getTextSkeletonContent,
	type PoStringReplacement,
} from "$lib/formats/skeleton";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import { parsePoCatalog } from "$lib/formats/poFamily";
import { encodeTextBytes } from "./outputGenerationText";

export function buildPoTranslation(project: UserData): string {
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "po");
	if (content === undefined)
		throw new Error(
			"Gettext export requires its original lossless PO skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is PoStringReplacement =>
			replacement.kind === "po-string",
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
			`Gettext export cannot continue because its ${replacements.length} msgstr mappings do not align uniquely with ${data.seg2.length} target segments.`,
		);

	const groups = new Map<string, PoStringReplacement[]>();
	for (const replacement of replacements) {
		const key = replacement.fragments
			.map((fragment) => `${fragment.start}:${fragment.end}`)
			.join("|");
		const group = groups.get(key) ?? [];
		group.push(replacement);
		groups.set(key, group);
	}
	const edits: Array<{ start: number; end: number; encoded: string }> = [];
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
		const pieces = splitPoTranslation(
			translated,
			first.fragments.map((fragment) => fragment.originalValue),
		);
		for (const [index, fragment] of first.fragments.entries())
			edits.push({
				start: fragment.start,
				end: fragment.end,
				encoded: quotePoString(pieces[index] ?? ""),
			});
	}

	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.encoded}${output.slice(edit.end)}`;
	parsePoCatalog(output, data.skeleton?.source.encoding ?? "utf-8");
	return output;
}

function splitPoTranslation(
	value: string,
	originalPieces: readonly string[],
): string[] {
	if (originalPieces.length <= 1) return [value];
	const characters = Array.from(value);
	const lengths = originalPieces.map((piece) => Array.from(piece).length);
	const total = lengths.reduce((sum, length) => sum + length, 0);
	if (total === 0)
		return originalPieces.map((_, index) =>
			index === originalPieces.length - 1 ? value : "",
		);
	const result: string[] = [];
	let sourceConsumed = 0;
	let targetCursor = 0;
	for (let index = 0; index < originalPieces.length - 1; index++) {
		sourceConsumed += lengths[index];
		const boundary = Math.round((characters.length * sourceConsumed) / total);
		result.push(characters.slice(targetCursor, boundary).join(""));
		targetCursor = boundary;
	}
	result.push(characters.slice(targetCursor).join(""));
	return result;
}

export function quotePoString(value: string): string {
	return `"${value
		.replaceAll("\\", "\\\\")
		.replaceAll('"', '\\"')
		.replaceAll("\t", "\\t")
		.replaceAll("\r", "\\r")
		.replaceAll("\n", "\\n")}"`;
}

export function buildPoTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const content = buildPoTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "po");
	if (source === content && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(content, encoding, hasBom)], {
		type: `text/x-gettext-translation;charset=${encoding}`,
	});
}

export async function generatePoTranslation(project: UserData): Promise<void> {
	assertProjectExportQuality(project);
	const sourceName =
		project.translationData.skeleton?.source.name ?? "messages.po";
	const requested = project.translationData.name || sourceName;
	const name = /\.po$/i.test(requested)
		? requested
		: `${requested.replace(/\.pot$/i, "")}.po`;
	const url = URL.createObjectURL(buildPoTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
