import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import { parseQtTs } from "$lib/formats/qtTsFamily";
import {
	getTextSkeletonContent,
	type QtTsValueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function buildQtTsTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "qt-ts");
	if (content === undefined)
		throw new Error(
			"Qt TS export requires its original positional XML skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is QtTsValueReplacement =>
			replacement.kind === "qt-ts-value",
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
			`Qt TS export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const replacement of replacements) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		edits.push({
			start: replacement.start,
			end: replacement.end,
			value: escapeXmlText(translated),
		});
	}
	const stateGroups = new Map<string, QtTsValueReplacement[]>();
	for (const replacement of replacements.filter(
		(replacement) =>
			replacement.state === "unfinished" &&
			replacement.stateAttributeStart !== undefined &&
			replacement.stateAttributeEnd !== undefined,
	)) {
		const key = `${replacement.stateAttributeStart}:${replacement.stateAttributeEnd}`;
		const group = stateGroups.get(key) ?? [];
		group.push(replacement);
		stateGroups.set(key, group);
	}
	for (const group of stateGroups.values()) {
		if (
			group.some(
				(replacement) => !(data.seg2[replacement.unitIndex] ?? "").trim(),
			) ||
			group.every(
				(replacement) =>
					(data.seg2[replacement.unitIndex] ?? "") ===
					replacement.originalValue,
			)
		)
			continue;
		edits.push({
			start: group[0].stateAttributeStart!,
			end: group[0].stateAttributeEnd!,
			value: "",
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseQtTs(output);
	return output;
}

function escapeXmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function buildQtTsTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildQtTsTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "qt-ts");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(output, encoding, hasBom)], {
		type: `application/xml;charset=${encoding}`,
	});
}

export async function generateQtTsTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "catalog.ts";
	const requested = project.translationData.name || sourceName;
	const name = /\.ts$/i.test(requested) ? requested : `${requested}.ts`;
	const url = URL.createObjectURL(buildQtTsTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
