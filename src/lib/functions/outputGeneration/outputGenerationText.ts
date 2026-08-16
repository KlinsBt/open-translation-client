import type { UserData } from "$lib/types/types";
import {
	applyTextSkeleton,
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TextRangeReplacement,
} from "$lib/formats/skeleton";

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
		buildTextTranslationFromProject(translation),
		name,
	);
}

export function buildTextTranslationFromProject(translation: UserData): string {
	const data = translation.translationData;
	const content = getTextSkeletonContent(data.skeleton, "text");
	if (content !== undefined) {
		if (skeletonHasIdentityTargets(data.seg1, data.seg2)) return content;
		const replacements = data.skeleton!.replacements.filter(
			(replacement): replacement is TextRangeReplacement =>
				replacement.kind === "text-range",
		);
		if (replacements.length === data.seg2.length) {
			return applyTextSkeleton(content, replacements, data.seg2);
		}
	}
	return buildTextTranslation(data.seg2);
}

export function buildTextTranslation(segments: string[]): string {
	return segments.join(" ");
}
