import type { UserData } from "$lib/types/types";

async function generateTextFileDownload(textData: string, name: string) {
	const blob: Blob = new Blob([textData], {
		type: "text/plain;charset=utf-8",
	});

	// Create a URL for the Blob
	const url: string = URL.createObjectURL(blob);

	// Create a temporary <a> element to trigger the download
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name}.txt`;

	// Append the element, trigger the download, and remove the element
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	// Revoke the URL to release memory
	URL.revokeObjectURL(url);
}

export async function generateTextTranslation(
	translation: UserData,
	// singleLineFormat: boolean, // if true, text is formatted as a single line
) {
	const name: string = translation.translationData.name || "translation";
	await generateTextFileDownload(
		buildTextTranslation(translation.translationData.seg2),
		name,
	);
}

export function buildTextTranslation(segments: string[]): string {
	return segments.join(" ");
}
