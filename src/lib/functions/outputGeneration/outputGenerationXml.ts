import type { UserData } from "$lib/types/types";
import {
	getTextSkeletonContent,
	type XmlValueReplacement,
} from "$lib/formats/skeleton";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import { parseXmlSyntax } from "$lib/formats/xmlFamily";
import { encodeTextBytes } from "./outputGenerationText";

export function buildXmlTranslation(project: UserData): string {
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "xml");
	if (content === undefined)
		throw new Error(
			"XML export requires its original positional text skeleton.",
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
			`XML export cannot continue because its ${replacements.length} value mappings do not align uniquely with ${data.seg2.length} target segments.`,
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
		edits.push({
			start: first.start,
			end: first.end,
			value: encodeXmlValue(translated, first.location),
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseXmlSyntax(output);
	return output;
}

function encodeXmlValue(
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

export function buildXmlTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const content = buildXmlTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "xml");
	if (source === content && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(content, encoding, hasBom)], {
		type: `application/xml;charset=${encoding}`,
	});
}

export async function generateXmlTranslation(project: UserData): Promise<void> {
	assertProjectExportQuality(project);
	const sourceName =
		project.translationData.skeleton?.source.name ?? "document.xml";
	const requested = project.translationData.name || sourceName;
	const name = /\.xml$/i.test(requested) ? requested : `${requested}.xml`;
	const url = URL.createObjectURL(buildXmlTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
