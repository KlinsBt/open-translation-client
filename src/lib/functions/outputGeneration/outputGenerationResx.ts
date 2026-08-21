import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import { parseResx } from "$lib/formats/resxFamily";
import {
	getTextSkeletonContent,
	type ResxValueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function buildResxTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "resx");
	if (content === undefined)
		throw new Error(
			"RESX export requires its original positional XML skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is ResxValueReplacement =>
			replacement.kind === "resx-value",
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
			`RESX export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	let output = content;
	for (const replacement of [...replacements].sort(
		(first, second) => second.start - first.start,
	)) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		const encoded =
			replacement.location === "cdata"
				? translated.replaceAll("]]>", "]]]]><![CDATA[>")
				: translated
						.replaceAll("&", "&amp;")
						.replaceAll("<", "&lt;")
						.replaceAll(">", "&gt;");
		output = `${output.slice(0, replacement.start)}${encoded}${output.slice(replacement.end)}`;
	}
	parseResx(output);
	return output;
}

export function buildResxTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildResxTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "resx");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(output, encoding, hasBom)], {
		type: `application/xml;charset=${encoding}`,
	});
}

export async function generateResxTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "Resources.resx";
	const requested = project.translationData.name || sourceName;
	const name = /\.resx$/i.test(requested) ? requested : `${requested}.resx`;
	const url = URL.createObjectURL(buildResxTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
