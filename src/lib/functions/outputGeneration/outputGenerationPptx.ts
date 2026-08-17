import type { PptxSegmentMeta, UserData } from "$lib/types/types";
import { applyTranslationsToPresentationPart } from "$lib/functions/parsing/parsingPptx";
import JSZip from "jszip";
import {
	getPackageSkeleton,
	skeletonHasIdentityTargets,
	type PptxTextReplacement,
} from "$lib/formats/skeleton";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	PPTX_FAMILY_MIME_TYPES,
	detectPptxFamilyExtension,
	pptxFamilyOutputName,
} from "$lib/formats/pptxPackage";

function isPptxMeta(value: unknown): value is PptxSegmentMeta {
	if (
		!value ||
		typeof value !== "object" ||
		!("kind" in value) ||
		!("part" in value)
	)
		return false;
	const entry = value as PptxSegmentMeta;
	return (
		(entry.kind === "text" && Array.isArray(entry.fragments)) ||
		(entry.kind === "attribute" && Number.isInteger(entry.elementIndex))
	);
}

function metaFromReplacement(
	replacement: PptxTextReplacement,
): PptxSegmentMeta {
	return replacement.storage === "text"
		? {
				kind: "text",
				part: replacement.part,
				separator: replacement.separator,
				fragments: replacement.fragments.map((fragment) => ({ ...fragment })),
			}
		: {
				kind: "attribute",
				part: replacement.part,
				elementIndex: replacement.elementIndex,
				attribute: replacement.attribute,
			};
}

export async function createPptxFromModifiedXmlText(translation: UserData) {
	assertProjectExportQuality(translation);
	const output = await buildPptxTranslationPackage(translation);
	const skeleton = getPackageSkeleton(
		translation.translationData.skeleton,
		"pptx",
	);
	const parts =
		skeleton?.payload.parts ??
		(translation.translationData.typeRef as Record<string, string | Blob>);
	const link = document.createElement("a");
	const url = URL.createObjectURL(output);
	link.href = url;
	link.download = pptxFamilyOutputName(
		translation.translationData.name,
		parts,
		skeleton?.source.name,
	);
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

export async function buildPptxTranslationPackage(
	translation: UserData,
): Promise<Blob> {
	const data = translation.translationData;
	const skeleton = getPackageSkeleton(data.skeleton, "pptx");
	if (
		skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return skeleton.source.originalFile;
	const parts: Record<string, string | Blob> = {
		...(skeleton?.payload.parts ??
			(data.typeRef as Record<string, string | Blob>)),
	};
	const projectMeta =
		data.segmentsMeta?.length === data.seg2.length &&
		data.segmentsMeta.every(isPptxMeta)
			? (data.segmentsMeta as PptxSegmentMeta[])
			: undefined;
	const skeletonMeta = skeleton?.replacements
		.filter(
			(replacement): replacement is PptxTextReplacement =>
				replacement.kind === "pptx-text",
		)
		.sort((a, b) => a.unitIndex - b.unitIndex)
		.map(metaFromReplacement);
	const meta =
		projectMeta ??
		(skeletonMeta?.length === data.seg2.length ? skeletonMeta : undefined);
	if (!meta)
		throw new Error(
			"PPTX export requires aligned slide text replacement metadata.",
		);
	const byPart = new Map<
		string,
		{ sources: string[]; translations: string[]; meta: PptxSegmentMeta[] }
	>();
	for (const [index, entry] of meta.entries()) {
		const group = byPart.get(entry.part) ?? {
			sources: [],
			translations: [],
			meta: [],
		};
		group.sources.push(data.seg1[index] ?? "");
		group.translations.push(data.seg2[index] ?? "");
		group.meta.push(entry);
		byPart.set(entry.part, group);
	}
	for (const [part, group] of byPart) {
		if (
			group.sources.every(
				(source, index) => source === group.translations[index],
			)
		)
			continue;
		const xml = parts[part];
		if (typeof xml !== "string") continue;
		parts[part] = applyTranslationsToPresentationPart(
			xml,
			group.translations,
			group.meta,
		);
	}
	const zip = skeleton?.source.originalFile
		? await JSZip.loadAsync(await skeleton.source.originalFile.arrayBuffer())
		: new JSZip();
	if (!skeleton?.source.originalFile)
		for (const [path, content] of Object.entries(parts))
			zip.file(path, content);
	else
		for (const [path, content] of Object.entries(parts))
			if (content !== skeleton.payload.parts[path]) zip.file(path, content);
	const extension = detectPptxFamilyExtension(parts, skeleton?.source.name);
	return zip.generateAsync({
		type: "blob",
		mimeType: PPTX_FAMILY_MIME_TYPES[extension],
	});
}
