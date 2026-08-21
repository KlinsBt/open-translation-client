import { parseAndroidResources } from "$lib/formats/androidResources";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type AndroidValueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function buildAndroidResourcesTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "android");
	if (content === undefined)
		throw new Error(
			"Android resources export requires its original positional skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is AndroidValueReplacement =>
			replacement.kind === "android-value",
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
			`Android resources export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	let output = content;
	for (const replacement of [...replacements].sort(
		(first, second) => second.start - first.start,
	)) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		output = `${output.slice(0, replacement.start)}${encodeAndroidFragment(translated)}${output.slice(replacement.end)}`;
	}
	parseAndroidResources(output);
	return output;
}

export function encodeAndroidFragment(value: string): string {
	let output = "";
	let cursor = 0;
	while (cursor < value.length) {
		if (value.startsWith("<!--", cursor)) {
			const end = value.indexOf("-->", cursor + 4);
			if (end >= 0) {
				output += value.slice(cursor, end + 3);
				cursor = end + 3;
				continue;
			}
		}
		if (value[cursor] === "<") {
			const tag = value
				.slice(cursor)
				.match(/^<\/?[A-Za-z_][\w.:-]*(?:\s[^<>]*?)?\s*\/?>/);
			if (tag) {
				output += tag[0];
				cursor += tag[0].length;
				continue;
			}
		}
		const next = value.indexOf("<", cursor + 1);
		const end = next < 0 ? value.length : next;
		output += encodeAndroidText(value.slice(cursor, end));
		cursor = end;
	}
	return output;
}

function encodeAndroidText(value: string): string {
	let escaped = "";
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (character === "\\" && index + 1 < value.length) {
			escaped += `${character}${value[++index]}`;
			continue;
		}
		if (character === "'" || character === '"') escaped += `\\${character}`;
		else escaped += character;
	}
	const firstVisible = escaped.search(/\S/);
	if (
		firstVisible >= 0 &&
		(escaped[firstVisible] === "@" || escaped[firstVisible] === "?") &&
		escaped[firstVisible - 1] !== "\\"
	)
		escaped = `${escaped.slice(0, firstVisible)}\\${escaped.slice(firstVisible)}`;
	return escaped
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function buildAndroidResourcesTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildAndroidResourcesTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "android");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(output, encoding, hasBom)], {
		type: `application/xml;charset=${encoding}`,
	});
}

export async function generateAndroidResourcesTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "strings.xml";
	const requested = project.translationData.name || sourceName;
	const name = /\.xml$/i.test(requested) ? requested : `${requested}.xml`;
	const url = URL.createObjectURL(
		buildAndroidResourcesTranslationBlob(project),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
