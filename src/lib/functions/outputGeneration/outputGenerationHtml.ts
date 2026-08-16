import type { UserData } from "$lib/types/types";
import {
	applyTranslationsToHtml,
	segmentHtmlContent,
} from "$lib/functions/parsing/parsingHtml";
import {
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type HtmlAttributeReplacement,
	type HtmlTextReplacement,
} from "$lib/formats/skeleton";
import { normalizeImportOptions, parseList } from "$lib/formats/options";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";

async function generateHtmlFileDownload(htmlContent: string, name: string) {
	const blob: Blob = new Blob([htmlContent], {
		type: "text/html",
	});

	const url: string = URL.createObjectURL(blob);
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name}.html`;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	URL.revokeObjectURL(url);
}

export async function createHtmlFromModifiedText(translation: UserData) {
	assertProjectExportQuality(translation);
	const updatedHtmlContent = buildHtmlTranslation(translation);
	await generateHtmlFileDownload(
		updatedHtmlContent,
		translation.translationData.name,
	);
}

export function buildHtmlTranslation(translation: UserData): string {
	const data = translation.translationData;
	const originalHtmlContent =
		getTextSkeletonContent(data.skeleton, "html") ?? (data.typeRef as string);
	if (skeletonHasIdentityTargets(data.seg1, data.seg2)) {
		return originalHtmlContent;
	}
	const tokens = translation.translationData.parsingTokens;
	const filterOptions = normalizeImportOptions("html", data.filterOptions);
	let meta = data.skeleton?.replacements
		.filter(
			(
				replacement,
			): replacement is HtmlTextReplacement | HtmlAttributeReplacement =>
				replacement.kind === "html-text" ||
				replacement.kind === "html-attribute",
		)
		.map((replacement) =>
			replacement.kind === "html-attribute"
				? {
						kind: "attribute" as const,
						path: replacement.path,
						attribute: replacement.attribute,
						separator: replacement.separator ?? "",
					}
				: {
						kind: "text" as const,
						path: replacement.path,
						separator: replacement.separator ?? "",
					},
		);
	if (meta?.length !== data.seg2.length) meta = data.segmentsMeta as any;

	// If meta is missing or misaligned, regenerate from the stored HTML using the saved tokens
	if (!meta || meta.length !== translation.translationData.seg2.length) {
		try {
			const { meta: regenMeta, allSegments } = segmentHtmlContent(
				originalHtmlContent,
				tokens,
				{
					includeTextNodes: filterOptions.includeTextNodes === true,
					translatableAttributes: parseList(
						filterOptions.translatableAttributes,
					),
				},
			);
			if (allSegments.length === translation.translationData.seg2.length) {
				meta = regenMeta.map((htmlMeta) => ({
					...htmlMeta,
					fragments: [],
				}));
			}
		} catch (e) {
			console.error("Failed to regenerate HTML meta", e);
		}
	}

	const updatedHtmlContent = replaceTextStrings(
		originalHtmlContent,
		translation.translationData.seg2,
		tokens,
		meta,
	);
	return updatedHtmlContent;
}

function replaceTextStrings(
	htmlContent: string,
	textArray: string[],
	tokens?: string[],
	meta?: any[],
): string {
	return applyTranslationsToHtml(htmlContent, textArray, tokens, meta);
}
