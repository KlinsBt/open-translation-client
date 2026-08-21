import type { UserData } from "$lib/types/types";
import {
	applyJsonSkeleton,
	getTextSkeletonContent,
	type JsonValueReplacement,
} from "$lib/formats/skeleton";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import { encodeTextBytes } from "./outputGenerationText";
// Note: do not rely on parsing preferences when reconstructing JSON output

async function generateJsonFileDownload(blob: Blob, name: string) {
	const url: string = URL.createObjectURL(blob);
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = name;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}

export async function generateJsonTranslation(translation: UserData) {
	assertProjectExportQuality(translation);
	const data = translation.translationData;
	const sourceName = data.skeleton?.source.name ?? "translation.json";
	const extension = getJsonOutputExtension(sourceName);
	const requestedName = data.name || sourceName;
	const name = /\.(?:json|arb|locjson)$/i.test(requestedName)
		? requestedName
		: `${requestedName}.${extension}`;
	await generateJsonFileDownload(buildJsonTranslationBlob(translation), name);
}

export function buildJsonTranslation(translation: UserData): string {
	const data = translation.translationData;
	const skeletonContent = getTextSkeletonContent(data.skeleton, "json");
	if (skeletonContent !== undefined) {
		const replacements = data.skeleton!.replacements.filter(
			(replacement): replacement is JsonValueReplacement =>
				replacement.kind === "json-value",
		);
		const mappingsAlign =
			replacements.length === data.seg2.length &&
			new Set(replacements.map((replacement) => replacement.unitIndex)).size ===
				replacements.length &&
			replacements.every(
				(replacement) =>
					replacement.unitIndex >= 0 &&
					replacement.unitIndex < data.seg2.length,
			);
		if (mappingsAlign) {
			return applyJsonSkeleton(skeletonContent, replacements, data.seg2);
		}
		throw new Error(
			`JSON export cannot continue because its ${replacements.length} syntax mappings do not align uniquely with ${data.seg2.length} target segments.`,
		);
	}

	const typeRef: any = translation.translationData.typeRef;
	const sourceData =
		(typeRef && typeRef.data) || translation.translationData.typeRef;
	const segMeta = resolveJsonSegmentMeta(
		translation.translationData,
		sourceData,
	);
	let newJsonObject: Object = reconstructJsonFromValues(
		sourceData as Record<string, any>,
		translation.translationData.seg2,
		segMeta,
	);
	return JSON.stringify(JSON.parse(JSON.stringify(newJsonObject)), null, 2);
}

export function buildJsonTranslationBlob(translation: UserData): Blob {
	const data = translation.translationData;
	const content = buildJsonTranslation(translation);
	const sourceContent = getTextSkeletonContent(data.skeleton, "json");
	if (sourceContent === content && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(content, encoding, hasBom)], {
		type: `application/json;charset=${encoding}`,
	});
}

export function getJsonOutputExtension(
	sourceName: string,
): "json" | "arb" | "locjson" {
	if (/\.arb$/i.test(sourceName)) return "arb";
	if (/\.locjson$/i.test(sourceName)) return "locjson";
	return "json";
}

export type JsonMetaEntry = { path: string[]; separator?: string } | number;

export function resolveJsonSegmentMeta(
	translationData: UserData["translationData"],
	sourceData: Record<string, any>,
): JsonMetaEntry[] {
	const structuralMeta = translationData.segmentsMeta;
	const hasValidStructuralMeta =
		structuralMeta?.length === translationData.seg2.length &&
		structuralMeta.every(
			(entry) =>
				"path" in entry &&
				Array.isArray(entry.path) &&
				entry.path.every((part) => typeof part === "string"),
		);
	if (hasValidStructuralMeta) return structuralMeta as JsonMetaEntry[];

	const typeRef: any = translationData.typeRef;
	return (
		(typeRef && (typeRef.segMeta || typeRef.meta)) ||
		buildFlatSegMeta(sourceData)
	);
}

export function reconstructJsonFromValues(
	jsonData: Record<string, any>,
	values: string[],
	segMeta: JsonMetaEntry[] = [],
): Record<string, any> {
	// If meta is numeric (legacy), fall back to count-based assignment
	const allNumbers =
		Array.isArray(segMeta) && segMeta.every((m) => typeof m === "number");
	if (allNumbers) {
		let valueIndex = 0;
		let metaIndex = 0;
		function traverse(obj: any): void {
			for (const key in obj) {
				if (typeof obj[key] === "object" && obj[key] !== null) {
					traverse(obj[key]);
				} else {
					const takeCount =
						(segMeta as number[]).length > metaIndex
							? (segMeta as number[])[metaIndex]
							: 1;
					const parts = values.slice(valueIndex, valueIndex + takeCount);
					obj[key] = parts.join("");
					valueIndex += takeCount;
					metaIndex++;
				}
			}
		}
		const newJson = JSON.parse(JSON.stringify(jsonData));
		traverse(newJson);
		return newJson;
	}

	// New meta: one entry per segment with a path
	const newJson = JSON.parse(JSON.stringify(jsonData));
	const seenKeys = new Set<string>();

	for (let i = 0; i < values.length; i++) {
		const entry = segMeta[i] as any;
		if (!entry || !entry.path) continue;
		const path: string[] = entry.path;
		const sep: string = entry.separator ?? "";
		let target: any = newJson;
		for (let p = 0; p < path.length - 1; p++) {
			const key = path[p];
			if (target[key] === undefined) target[key] = {};
			target = target[key];
		}
		const leaf = path[path.length - 1];
		const keyString = path.join("||");
		if (!seenKeys.has(keyString)) {
			target[leaf] = "";
			seenKeys.add(keyString);
		}
		const existing = target[leaf] || "";
		// Avoid double separator if already present
		let base = values[i];
		const trimmedExisting =
			sep && typeof existing === "string" && existing.endsWith(sep)
				? existing.slice(0, -sep.length)
				: existing;
		const trimmedBase =
			sep && base.endsWith(sep) ? base.slice(0, -sep.length) : base;
		target[leaf] = `${trimmedExisting}${trimmedBase}${sep}`;
	}

	return newJson;
}

// Fallback that assumes 1 segment per leaf value; avoids parsing preferences.
export function buildFlatSegMeta(jsonData: Record<string, any>): number[] {
	const meta: number[] = [];

	function traverse(obj: any): void {
		for (const key in obj) {
			if (typeof obj[key] === "object" && obj[key] !== null) {
				traverse(obj[key]);
			} else {
				meta.push(1);
			}
		}
	}

	traverse(jsonData);
	return meta;
}
