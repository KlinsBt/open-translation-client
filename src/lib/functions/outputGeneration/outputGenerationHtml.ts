import type { UserData } from "$lib/types/types";
import {
	applyTranslationsToHtml,
	segmentHtmlContent,
	type HtmlMeta,
} from "$lib/functions/parsing/parsingHtml";
import {
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type HtmlAttributeReplacement,
	type HtmlTextReplacement,
} from "$lib/formats/skeleton";
import { normalizeImportOptions, parseList } from "$lib/formats/options";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";

async function generateHtmlFileDownload(
	htmlContent: string,
	name: string,
	extension: "html" | "htm" | "xhtml",
) {
	const blob: Blob = new Blob([htmlContent], {
		type: extension === "xhtml" ? "application/xhtml+xml" : "text/html",
	});

	const url: string = URL.createObjectURL(blob);
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name.replace(/\.(?:x?html?|htm)$/i, "")}.${extension}`;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	URL.revokeObjectURL(url);
}

export function getHtmlOutputFormat(
	sourceName: string,
	sourceMimeType = "",
): {
	extension: "html" | "htm" | "xhtml";
	mimeType: "text/html" | "application/xhtml+xml";
} {
	if (
		/\.xhtml$/i.test(sourceName) ||
		/application\/xhtml\+xml/i.test(sourceMimeType)
	)
		return { extension: "xhtml", mimeType: "application/xhtml+xml" };
	return {
		extension: /\.htm$/i.test(sourceName) ? "htm" : "html",
		mimeType: "text/html",
	};
}

export async function createHtmlFromModifiedText(translation: UserData) {
	assertProjectExportQuality(translation);
	const updatedHtmlContent = buildHtmlTranslation(translation);
	const source = translation.translationData.skeleton?.source;
	const { extension } = getHtmlOutputFormat(
		source?.name ?? "",
		source?.mimeType,
	);
	await generateHtmlFileDownload(
		updatedHtmlContent,
		translation.translationData.name,
		extension,
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
	let meta: HtmlMeta[] | undefined = data.skeleton?.replacements
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
						start: replacement.start,
						end: replacement.end,
						sourceText: replacement.sourceText,
						prefix: replacement.prefix,
						suffix: replacement.suffix,
						quote: replacement.quote,
					}
				: {
						kind: "text" as const,
						path: replacement.path,
						separator: replacement.separator ?? "",
						start: replacement.start,
						end: replacement.end,
						sourceText: replacement.sourceText,
						prefix: replacement.prefix,
						suffix: replacement.suffix,
					},
		);
	if (meta?.length !== data.seg2.length)
		meta = data.segmentsMeta as HtmlMeta[] | undefined;

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
					excludedElements: parseList(filterOptions.excludedElements),
					respectTranslateMetadata:
						filterOptions.respectTranslateMetadata === true,
				},
			);
			if (allSegments.length === translation.translationData.seg2.length) {
				meta = regenMeta;
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
		{
			includeTextNodes: filterOptions.includeTextNodes === true,
			translatableAttributes: parseList(filterOptions.translatableAttributes),
			excludedElements: parseList(filterOptions.excludedElements),
			respectTranslateMetadata: filterOptions.respectTranslateMetadata === true,
		},
	);
	return updatedHtmlContent;
}

function replaceTextStrings(
	htmlContent: string,
	textArray: string[],
	tokens?: string[],
	meta?: HtmlMeta[],
	filterOptions?: Parameters<typeof applyTranslationsToHtml>[4],
): string {
	return applyTranslationsToHtml(
		htmlContent,
		textArray,
		tokens,
		meta,
		filterOptions,
	);
}
