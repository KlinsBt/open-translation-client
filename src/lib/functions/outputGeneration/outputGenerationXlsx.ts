import type { UserData } from "$lib/types/types";
import { applyTranslationsToWorkbook } from "$lib/functions/parsing/parsingXlsx";
import JSZip from "jszip";
import { getDefaultTokens } from "$lib/functions/parsing/parsingPreferences";
import {
	getPackageSkeleton,
	skeletonHasIdentityTargets,
	type XlsxTextReplacement,
} from "$lib/formats/skeleton";

export async function createXlsxFromModifiedXmlText(translation: UserData) {
	const updatedXlsx = await buildXlsxTranslationPackage(translation);

	const link = document.createElement("a");
	const url = URL.createObjectURL(updatedXlsx);
	link.href = url;
	link.download = `${translation.translationData.name}.xlsx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export async function buildXlsxTranslationPackage(
	translation: UserData,
): Promise<Blob> {
	const data = translation.translationData;
	const skeleton = getPackageSkeleton(data.skeleton, "xlsx");
	if (
		skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	) {
		return skeleton.source.originalFile;
	}
	let xmlContentMap: Record<string, string | Blob> = {
		...(skeleton?.payload.parts ??
			(data.typeRef as Record<string, string | Blob>)),
	};
	const tokens = data.parsingTokens || getDefaultTokens();
	const skeletonReplacements = skeleton?.replacements.filter(
		(replacement): replacement is XlsxTextReplacement =>
			replacement.kind === "xlsx-text",
	);
	const translatedSegments =
		skeletonReplacements?.length === data.seg2.length
			? [...skeletonReplacements]
					.sort((first, second) => {
						if (
							first.storage === "shared-string" &&
							second.storage !== "shared-string"
						)
							return -1;
						if (
							second.storage === "shared-string" &&
							first.storage !== "shared-string"
						)
							return 1;
						if (first.part !== second.part)
							return first.part.localeCompare(second.part);
						if (first.storage !== second.storage)
							return first.storage === "inline-string" ? -1 : 1;
						return first.localIndex - second.localIndex;
					})
					.map((replacement) => data.seg2[replacement.unitIndex])
			: data.seg2;

	// Apply translations to shared strings and inline strings across all sheets
	xmlContentMap = applyTranslationsToWorkbook(
		xmlContentMap,
		translatedSegments,
		tokens,
	);

	const zip = skeleton?.source.originalFile
		? await JSZip.loadAsync(await skeleton.source.originalFile.arrayBuffer())
		: new JSZip();
	if (!skeleton?.source.originalFile) {
		for (const [filePath, content] of Object.entries(xmlContentMap)) {
			zip.file(filePath, content);
		}
	} else {
		for (const [filePath, content] of Object.entries(xmlContentMap)) {
			if (content !== skeleton.payload.parts[filePath]) {
				zip.file(filePath, content);
			}
		}
	}
	return zip.generateAsync({ type: "blob" });
}
