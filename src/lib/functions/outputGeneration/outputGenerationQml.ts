import {
	decodeQmlString,
	parseQmlDocument,
	type QmlQuote,
} from "$lib/formats/qml";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TextRangeReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function encodeQmlString(value: string, quote: QmlQuote): string {
	let output = "";
	for (let index = 0; index < value.length; index++) {
		const codePoint = value.codePointAt(index)!;
		const character = String.fromCodePoint(codePoint);
		if (character === "\\") output += "\\\\";
		else if (character === quote) output += `\\${character}`;
		else if (quote === "`" && character === "$" && value[index + 1] === "{")
			output += "\\$";
		else if (character === "\n") output += quote === "`" ? "\n" : "\\n";
		else if (character === "\r") output += "\\r";
		else if (character === "\t") output += "\\t";
		else if (character === "\b") output += "\\b";
		else if (character === "\f") output += "\\f";
		else if (character === "\v") output += "\\v";
		else if (codePoint === 0 || codePoint === 0x2028 || codePoint === 0x2029)
			output += `\\u${codePoint.toString(16).padStart(4, "0")}`;
		else if (codePoint < 0x20 || codePoint === 0x7f)
			output += `\\x${codePoint.toString(16).padStart(2, "0")}`;
		else output += character;
		if (codePoint > 0xffff) index++;
	}
	return output;
}

export function buildQmlTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "qml");
	if (content === undefined)
		throw new Error("QML export requires its original source-code skeleton.");
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
			`QML export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const groups = new Map<string, TextRangeReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.start <= 0 || replacement.end >= content.length)
			throw new Error(
				"A QML string mapping points outside its original source.",
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
		const quote = content[first.start - 1] as QmlQuote;
		if (!['"', "'", "`"].includes(quote))
			throw new Error("A QML string mapping has lost its quote delimiter.");
		const original = decodeQmlString(content.slice(first.start, first.end));
		if (translated === original) continue;
		edits.push({
			start: first.start,
			end: first.end,
			value: encodeQmlString(translated, quote),
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseQmlDocument(output, String(data.filterOptions?.functionSelectors ?? ""));
	return output;
}

export function buildQmlTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildQmlTranslation(project);
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `text/x-qml;charset=${encoding}` },
	);
}

export async function generateQmlTranslation(project: UserData): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"Main.qml";
	const name = /\.qml$/i.test(requested) ? requested : `${requested}.qml`;
	const url = URL.createObjectURL(buildQmlTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
