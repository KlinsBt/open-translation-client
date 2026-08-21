import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	parseProperties,
	propertiesOutputEncoding,
} from "$lib/formats/propertiesFamily";
import {
	getTextSkeletonContent,
	type PropertiesValueReplacement,
} from "$lib/formats/skeleton";
import type { SupportedTextEncoding } from "$lib/formats/safeInput";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function buildPropertiesTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "properties");
	if (content === undefined)
		throw new Error("Properties export requires its original text skeleton.");
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is PropertiesValueReplacement =>
			replacement.kind === "properties-value",
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
			`Properties export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const encoding = propertiesOutputEncoding(data.skeleton?.source.encoding);
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const replacement of replacements) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		const pieces = splitAcrossFragments(
			translated,
			replacement.fragments.map((fragment) => fragment.originalValue.length),
		);
		for (const [index, fragment] of replacement.fragments.entries())
			edits.push({
				start: fragment.start,
				end: fragment.end,
				value: encodePropertiesValue(
					pieces[index] ?? "",
					index === 0,
					encoding,
				),
			});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseProperties(output);
	return output;
}

function splitAcrossFragments(value: string, weights: number[]): string[] {
	if (weights.length <= 1) return [value];
	const characters = Array.from(value);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	if (total === 0) return [value, ...weights.slice(1).map(() => "")];
	const pieces: string[] = [];
	let cursor = 0;
	let consumed = 0;
	for (const weight of weights.slice(0, -1)) {
		consumed += weight;
		const boundary = Math.round((characters.length * consumed) / total);
		pieces.push(characters.slice(cursor, boundary).join(""));
		cursor = boundary;
	}
	pieces.push(characters.slice(cursor).join(""));
	return pieces;
}

export function encodePropertiesValue(
	value: string,
	firstFragment: boolean,
	encoding: SupportedTextEncoding,
): string {
	let output = "";
	let leading = firstFragment;
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		const character = value[index];
		if (character === " ") {
			output += leading ? "\\ " : " ";
			continue;
		}
		leading = false;
		if (character === "\\") output += "\\\\";
		else if (character === "\t") output += "\\t";
		else if (character === "\n") output += "\\n";
		else if (character === "\r") output += "\\r";
		else if (character === "\f") output += "\\f";
		else if (
			(encoding === "iso-8859-1" || encoding === "windows-1252") &&
			code > 0x7e
		)
			output += `\\u${code.toString(16).padStart(4, "0").toUpperCase()}`;
		else output += character;
	}
	return output;
}

export function buildPropertiesTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildPropertiesTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "properties");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = propertiesOutputEncoding(data.skeleton?.source.encoding);
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(output, encoding, hasBom)], {
		type: `text/plain;charset=${encoding}`,
	});
}

export async function generatePropertiesTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "messages.properties";
	const requested = project.translationData.name || sourceName;
	const name = /\.properties$/i.test(requested)
		? requested
		: `${requested}.properties`;
	const url = URL.createObjectURL(buildPropertiesTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
