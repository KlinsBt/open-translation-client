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
import { reportProductionError } from "$lib/functions/productionDiagnostics";
import { encodeTextBytes } from "./outputGenerationText";
import {
	detectServerHtmlProfile,
	htmlMimeType,
	htmlSourceExtension,
	type ServerHtmlExtension,
	type ServerHtmlProfile,
	type ServerHtmlTypeRef,
} from "$lib/formats/serverHtml";

async function generateHtmlFileDownload(
	blob: Blob,
	name: string,
	extension: ServerHtmlExtension,
) {
	const url: string = URL.createObjectURL(blob);
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name.replace(/\.(?:x?html?|htm|shtml|jsp|asp|aspx|ascx|inc|hhc|hhk|php)$/i, "")}.${extension}`;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	URL.revokeObjectURL(url);
}

export function getHtmlOutputFormat(
	sourceName: string,
	sourceMimeType = "",
	sourceExtension?: ServerHtmlExtension,
): {
	extension: ServerHtmlExtension;
	mimeType: string;
} {
	if (sourceExtension) {
		const profile =
			sourceExtension === "php" ? "php-template" : sourceExtension;
		return { extension: sourceExtension, mimeType: htmlMimeType(profile) };
	}
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

function resolveHtmlProfile(translation: UserData): ServerHtmlTypeRef {
	const data = translation.translationData;
	const source = data.skeleton?.source;
	if (typeof data.typeRef === "object" && data.typeRef !== null) {
		const profile = data.typeRef.profile;
		const sourceExtension = data.typeRef.sourceExtension;
		if (typeof profile === "string" && typeof sourceExtension === "string")
			return {
				profile: profile as ServerHtmlProfile,
				sourceExtension: sourceExtension as ServerHtmlExtension,
				mimeType:
					typeof data.typeRef.mimeType === "string"
						? data.typeRef.mimeType
						: (source?.mimeType ?? ""),
			};
	}
	const original =
		getTextSkeletonContent(data.skeleton, "html") ??
		(typeof data.typeRef === "string" ? data.typeRef : "");
	return (
		detectServerHtmlProfile(
			source?.name ?? "source.html",
			source?.mimeType ?? "",
			original,
		) ?? {
			profile: htmlSourceExtension(
				source?.name ?? "source.html",
			) as ServerHtmlProfile,
			sourceExtension: htmlSourceExtension(source?.name ?? "source.html"),
			mimeType: source?.mimeType ?? "text/html",
		}
	);
}

export async function createHtmlFromModifiedText(translation: UserData) {
	assertProjectExportQuality(translation);
	const source = translation.translationData.skeleton?.source;
	const profile = resolveHtmlProfile(translation);
	const { extension } = getHtmlOutputFormat(
		source?.name ?? "",
		source?.mimeType,
		profile.sourceExtension,
	);
	await generateHtmlFileDownload(
		buildHtmlTranslationBlob(translation),
		translation.translationData.name,
		extension,
	);
}

export function buildHtmlTranslationBlob(translation: UserData): Blob {
	assertProjectExportQuality(translation);
	const data = translation.translationData;
	const profile = resolveHtmlProfile(translation);
	const mimeType = htmlMimeType(profile.profile);
	if (
		skeletonHasIdentityTargets(data.seg1, data.seg2) &&
		data.skeleton?.source.originalFile
	)
		return data.skeleton.source.originalFile;
	const content = buildHtmlTranslation(translation);
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(content, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `${mimeType};charset=${encoding}` },
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
	const profile = resolveHtmlProfile(translation).profile;
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
					profile,
				},
			);
			if (allSegments.length === translation.translationData.seg2.length) {
				meta = regenMeta;
			}
		} catch (e) {
			reportProductionError("HTML metadata regeneration failed", e);
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
			profile,
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
