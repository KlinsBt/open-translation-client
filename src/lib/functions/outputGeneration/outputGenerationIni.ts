import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import { parseIni, type IniProfile } from "$lib/formats/iniFamily";
import {
	getTextSkeletonContent,
	type IniValueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function buildIniTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "ini");
	if (content === undefined)
		throw new Error(
			"INI export requires its original positional text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is IniValueReplacement =>
			replacement.kind === "ini-value",
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
			`INI export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const replacement of replacements) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		const encoded = encodeIniValue(translated, replacement.profile);
		edits.push({
			start: replacement.start,
			end: replacement.end,
			value:
				replacement.insertionStart !== undefined
					? `${replacement.insertionTextPrefix ?? ""}${encoded}${replacement.insertionTextSuffix ?? ""}`
					: encoded,
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseIni(output, replacements[0]?.profile ?? "generic");
	return output;
}

export function encodeIniValue(value: string, profile: IniProfile): string {
	let output = value
		.replaceAll("\\", "\\\\")
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")
		.replaceAll("\t", "\\t");
	if (profile === "desktop") {
		output = output.replace(/^ +| +$/g, (spaces) =>
			"\\s".repeat(spaces.length),
		);
		if (output.endsWith(";")) output = `${output.slice(0, -1)}\\;`;
	}
	return output;
}

export function buildIniTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildIniTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "ini");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(output, encoding, hasBom)], {
		type: `text/plain;charset=${encoding}`,
	});
}

export async function generateIniTranslation(project: UserData): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "messages.ini";
	const requested = project.translationData.name || sourceName;
	const extension = sourceName.toLowerCase().split(".").at(-1);
	const suffix = ["ini", "desktop", "lang"].includes(extension ?? "")
		? extension!
		: "ini";
	const name = new RegExp(`\\.${suffix}$`, "i").test(requested)
		? requested
		: `${requested}.${suffix}`;
	const url = URL.createObjectURL(buildIniTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
