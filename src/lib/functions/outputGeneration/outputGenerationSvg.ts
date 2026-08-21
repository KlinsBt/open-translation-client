import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type XmlValueReplacement,
} from "$lib/formats/skeleton";
import { maskInertSvgContent } from "$lib/formats/svg";
import { parseXmlSyntax } from "$lib/formats/xmlFamily";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

function encodeSvgValue(
	value: string,
	location: XmlValueReplacement["location"],
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

export function buildSvgTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "svg");
	if (content === undefined)
		throw new Error(
			"SVG export requires its original positional text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is XmlValueReplacement =>
			replacement.kind === "xml-value",
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
			`SVG export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const groups = new Map<string, XmlValueReplacement[]>();
	for (const replacement of replacements) {
		const key = `${replacement.start}:${replacement.end}`;
		const group = groups.get(key) ?? [];
		group.push(replacement);
		groups.set(key, group);
	}
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const group of groups.values()) {
		const ordered = group.sort((a, b) => a.unitIndex - b.unitIndex);
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
			value: encodeSvgValue(translated, first.location),
		});
	}
	let output = content;
	for (const edit of edits.sort((a, b) => b.start - a.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseXmlSyntax(maskInertSvgContent(output));
	return output;
}

export function buildSvgTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildSvgTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "svg");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `image/svg+xml;charset=${encoding}` },
	);
}

export async function generateSvgTranslation(project: UserData): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"image.svg";
	const name = /\.svg$/i.test(requested) ? requested : `${requested}.svg`;
	const url = URL.createObjectURL(buildSvgTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
