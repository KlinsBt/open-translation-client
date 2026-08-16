import type { UserData } from "$lib/types/types";
import { applyTranslationsToDocxXml } from "$lib/functions/parsing/parsingDocx";
import { getDefaultTokens } from "$lib/functions/parsing/parsingPreferences";
import JSZip from "jszip";
import {
	getPackageSkeleton,
	skeletonHasIdentityTargets,
	type DocxTextReplacement,
} from "$lib/formats/skeleton";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";

export async function createDocxFromModifiedXmlText(translation: UserData) {
	assertProjectExportQuality(translation);
	const updatedDocx = await buildDocxTranslationPackage(translation);

	const link = document.createElement("a");
	const url = URL.createObjectURL(updatedDocx);
	link.href = url;
	link.download = `${translation.translationData.name}.docx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export async function buildDocxTranslationPackage(
	translation: UserData,
): Promise<Blob> {
	const data = translation.translationData;
	const skeleton = getPackageSkeleton(data.skeleton, "docx");
	if (
		skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	) {
		return skeleton.source.originalFile;
	}
	const xmlContentMap: Record<string, string | Blob> = {
		...(skeleton?.payload.parts ??
			(data.typeRef as Record<string, string | Blob>)),
	};
	const tokens = data.parsingTokens || getDefaultTokens();
	const skeletonMeta = skeleton?.replacements
		.filter(
			(replacement): replacement is DocxTextReplacement =>
				replacement.kind === "docx-text",
		)
		.map((replacement) => ({
			separator: replacement.separator,
			fragments: replacement.fragments.map((fragment) => ({ ...fragment })),
		}));
	const meta =
		skeletonMeta?.length === data.seg2.length
			? skeletonMeta
			: data.segmentsMeta?.length === data.seg2.length
				? data.segmentsMeta
				: undefined;
	// Replace the text in document.xml with the new strings
	const updatedDocumentXml = replaceTextStrings(
		xmlContentMap["word/document.xml"],
		data.seg2,
		tokens,
		meta,
	);

	const zip = skeleton?.source.originalFile
		? await JSZip.loadAsync(await skeleton.source.originalFile.arrayBuffer())
		: new JSZip();
	if (!skeleton?.source.originalFile) {
		for (const [filePath, content] of Object.entries(xmlContentMap)) {
			zip.file(filePath, content);
		}
	}
	zip.file("word/document.xml", updatedDocumentXml);
	return zip.generateAsync({ type: "blob" });
}

// Replace text strings in the XML string with the modified ones
function replaceTextStrings(
	documentXml: any,
	textArray: string[],
	tokens: string[],
	meta?: any,
) {
	if (typeof documentXml !== "string") return documentXml;
	return applyTranslationsToDocxXml(documentXml, textArray, tokens, meta);
}
