import type { UserData } from "$lib/types/types";
import { applyTranslationsToHtml } from "$lib/functions/parsing/parsingHtml";

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
	const updatedHtmlContent = replaceTextStrings(
		originalHtmlContent,
		translation.translationData.seg2,
	);
	await generateHtmlFileDownload(
		updatedHtmlContent,
		translation.translationData.name,
	);
}

function replaceTextStrings(htmlContent: string, textArray: string[]): string {
	return applyTranslationsToHtml(htmlContent, textArray);
}
