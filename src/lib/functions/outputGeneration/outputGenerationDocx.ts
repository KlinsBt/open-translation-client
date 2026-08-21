import type { DocxSegmentMeta, UserData } from "$lib/types/types";
import { applyTranslationsToDocxXml } from "$lib/functions/parsing/parsingDocx";
import { getDefaultTokens } from "$lib/functions/parsing/parsingPreferences";
import JSZip from "jszip";
import {
	getPackageSkeleton,
	skeletonHasIdentityTargets,
	type DocxTextReplacement,
} from "$lib/formats/skeleton";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	DOCX_FAMILY_MIME_TYPES,
	detectDocxFamilyExtension,
	docxFamilyOutputName,
} from "$lib/formats/docxPackage";

function isDocxSegmentMeta(value: unknown): value is DocxSegmentMeta {
	return (
		!!value &&
		typeof value === "object" &&
		"fragments" in value &&
		Array.isArray(value.fragments)
	);
}

export async function createDocxFromModifiedXmlText(translation: UserData) {
	assertProjectExportQuality(translation);
	const updatedDocx = await buildDocxTranslationPackage(translation);
	const skeleton = getPackageSkeleton(
		translation.translationData.skeleton,
		"docx",
	);
	const parts =
		skeleton?.payload.parts ??
		(translation.translationData.typeRef as Record<string, string | Blob>);
	const link = document.createElement("a");
	const url = URL.createObjectURL(updatedDocx);
	link.href = url;
	link.download = docxFamilyOutputName(
		translation.translationData.name,
		parts,
		skeleton?.source.name,
	);
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}

export async function buildDocxTranslationPackage(
	translation: UserData,
): Promise<Blob> {
	const data = translation.translationData;
	const skeleton = getPackageSkeleton(data.skeleton, "docx");
	if (
		skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return skeleton.source.originalFile;
	const parts: Record<string, string | Blob> = {
		...(skeleton?.payload.parts ??
			(data.typeRef as Record<string, string | Blob>)),
	};
	const tokens = data.parsingTokens || getDefaultTokens();
	const skeletonMeta = skeleton?.replacements
		.filter(
			(replacement): replacement is DocxTextReplacement =>
				replacement.kind === "docx-text",
		)
		.sort((first, second) => first.unitIndex - second.unitIndex)
		.map<DocxSegmentMeta>((replacement) => ({
			part: replacement.part,
			separator: replacement.separator,
			fragments: replacement.fragments.map((fragment) => ({ ...fragment })),
		}));
	const projectMeta =
		data.segmentsMeta?.length === data.seg2.length &&
		data.segmentsMeta.every(isDocxSegmentMeta)
			? data.segmentsMeta
			: undefined;
	const meta = projectMeta
		? projectMeta
		: skeletonMeta?.length === data.seg2.length
			? skeletonMeta
			: undefined;
	if (meta) {
		const byPart = new Map<
			string,
			{ translations: string[]; meta: DocxSegmentMeta[] }
		>();
		for (const [index, entry] of meta.entries()) {
			const part = entry.part ?? "word/document.xml";
			const group = byPart.get(part) ?? { translations: [], meta: [] };
			group.translations.push(data.seg2[index] ?? "");
			group.meta.push(entry);
			byPart.set(part, group);
		}
		for (const [part, group] of byPart) {
			const xml = parts[part];
			if (typeof xml !== "string") continue;
			parts[part] = applyTranslationsToDocxXml(
				xml,
				group.translations,
				tokens,
				group.meta,
			);
		}
	} else if (typeof parts["word/document.xml"] === "string") {
		parts["word/document.xml"] = applyTranslationsToDocxXml(
			parts["word/document.xml"],
			data.seg2,
			tokens,
		);
	}

	const zip = skeleton?.source.originalFile
		? await JSZip.loadAsync(await skeleton.source.originalFile.arrayBuffer())
		: new JSZip();
	if (!skeleton?.source.originalFile)
		for (const [path, content] of Object.entries(parts))
			zip.file(path, content);
	else
		for (const [path, content] of Object.entries(parts)) {
			const original = skeleton.payload.parts[path];
			if (content !== original) zip.file(path, content);
		}
	const extension = detectDocxFamilyExtension(parts, skeleton?.source.name);
	return zip.generateAsync({
		type: "blob",
		mimeType: DOCX_FAMILY_MIME_TYPES[extension],
	});
}
