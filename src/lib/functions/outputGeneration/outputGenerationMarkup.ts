import {
	parseLightweightMarkup,
	type LightweightMarkupProfile,
} from "$lib/formats/lightweightMarkup";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type MarkupTextReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function buildLightweightMarkupTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "markup");
	if (content === undefined)
		throw new Error(
			"Markdown/AsciiDoc export requires its original positional text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is MarkupTextReplacement =>
			replacement.kind === "markup-text",
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
			`Markup export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	let output = content;
	for (const replacement of [...replacements].sort(
		(a, b) => b.start - a.start,
	)) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (/\r|\n/.test(translated))
			throw new Error(
				`Markup export cannot insert a line break into protected source line ${replacement.line}.`,
			);
		if (translated === replacement.originalValue) continue;
		output = `${output.slice(0, replacement.start)}${translated}${output.slice(replacement.end)}`;
	}
	parseLightweightMarkup(
		output,
		(replacements[0]?.profile ??
			data.filterOptions?.profile ??
			"markdown") as LightweightMarkupProfile,
		Boolean(data.filterOptions?.includeHtmlText ?? true),
	);
	return output;
}

export function buildLightweightMarkupTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildLightweightMarkupTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "markup");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `text/plain;charset=${encoding}` },
	);
}

export async function generateLightweightMarkupTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "document.md";
	const requested = project.translationData.name || sourceName;
	const sourceExtension = sourceName.toLowerCase().split(".").at(-1);
	const extension = ["md", "markdown", "adoc", "asciidoc"].includes(
		sourceExtension ?? "",
	)
		? sourceExtension!
		: "md";
	const name = new RegExp(`\\.${extension}$`, "i").test(requested)
		? requested
		: `${requested}.${extension}`;
	const url = URL.createObjectURL(
		buildLightweightMarkupTranslationBlob(project),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
