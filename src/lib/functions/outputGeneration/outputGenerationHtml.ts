import type { UserData } from "$lib/types/types";
import {
	applyTranslationsToHtml,
	segmentHtmlContent,
} from "$lib/functions/parsing/parsingHtml";

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
	let originalHtmlContent = translation.translationData.typeRef as string;
	console.log("html: ", originalHtmlContent);
	const tokens = translation.translationData.parsingTokens;
	let meta = translation.translationData.segmentsMeta;

	// If meta is missing or misaligned, regenerate from the stored HTML using the saved tokens
	if (!meta || meta.length !== translation.translationData.seg2.length) {
		try {
			const { meta: regenMeta, allSegments } = segmentHtmlContent(
				originalHtmlContent,
				tokens,
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
	await generateHtmlFileDownload(
		updatedHtmlContent,
		translation.translationData.name,
	);
}

function replaceTextStrings(
	htmlContent: string,
	textArray: string[],
	tokens?: string[],
	meta?: any[],
): string {
	return applyTranslationsToHtml(htmlContent, textArray, tokens, meta);
}
