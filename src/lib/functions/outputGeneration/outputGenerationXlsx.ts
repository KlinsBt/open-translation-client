import type { UserData } from "$lib/types/types";
import {
	applyTranslationsToWorkbook,
	applyTranslationsToWorkbookCells,
} from "$lib/functions/parsing/parsingXlsx";
import JSZip from "jszip";
import { getDefaultTokens } from "$lib/functions/parsing/parsingPreferences";
import {
	getPackageSkeleton,
	skeletonHasIdentityTargets,
	type XlsxTextReplacement,
} from "$lib/formats/skeleton";
import {
	normalizeImportOptions,
	parseColumns,
	parseList,
	parsePositiveRanges,
} from "$lib/formats/options";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	detectXlsxFamilyExtension,
	XLSX_FAMILY_MIME_TYPES,
	xlsxFamilyOutputName,
} from "$lib/formats/xlsxPackage";

export async function createXlsxFromModifiedXmlText(translation: UserData) {
	assertProjectExportQuality(translation);
	const updatedXlsx = await buildXlsxTranslationPackage(translation);
	const skeleton = getPackageSkeleton(
		translation.translationData.skeleton,
		"xlsx",
	);
	const parts =
		skeleton?.payload.parts ??
		(translation.translationData.typeRef as Record<string, string | Blob>);
	const link = document.createElement("a");
	const url = URL.createObjectURL(updatedXlsx);
	link.href = url;
	link.download = xlsxFamilyOutputName(
		translation.translationData.name,
		parts,
		skeleton?.source.name,
	);
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
	const filterOptions = normalizeImportOptions("xlsx", data.filterOptions);
	const skeletonReplacements = skeleton?.replacements.filter(
		(replacement): replacement is XlsxTextReplacement =>
			replacement.kind === "xlsx-text",
	);
	const importMode = String(filterOptions.importMode);
	if (importMode !== "all-text") {
		const cellReplacements = [...(skeletonReplacements ?? [])]
			.sort((first, second) => first.unitIndex - second.unitIndex)
			.filter((replacement) => typeof replacement.cellReference === "string");
		if (cellReplacements.length !== data.seg2.length)
			throw new Error(
				"XLSX column-mode cell mappings are missing or out of sync.",
			);
		const effectiveTargets = cellReplacements.map((replacement) => {
			const target = data.seg2[replacement.unitIndex] ?? "";
			return importMode === "key-value" && target.length === 0
				? (replacement.originalText ?? "")
				: target;
		});
		if (
			skeleton?.source.originalFile &&
			cellReplacements.every(
				(replacement, index) =>
					effectiveTargets[index] === (replacement.originalText ?? ""),
			)
		)
			return skeleton.source.originalFile;
		xmlContentMap = applyTranslationsToWorkbookCells(
			xmlContentMap,
			cellReplacements.map((replacement, index) => ({
				sheetPath: replacement.part,
				cellReference: replacement.cellReference!,
				text: effectiveTargets[index],
			})),
		);
	} else {
		const translatedSegments =
			skeletonReplacements?.length === data.seg2.length
				? [...skeletonReplacements]
						.sort((first, second) => first.unitIndex - second.unitIndex)
						.map((replacement) => data.seg2[replacement.unitIndex])
				: data.seg2;

		// Apply translations to shared strings and inline strings across all sheets.
		xmlContentMap = applyTranslationsToWorkbook(
			xmlContentMap,
			translatedSegments,
			tokens,
			{
				worksheetPaths: parseList(filterOptions.worksheetPaths),
				columns: parseColumns(filterOptions.columns),
				rows: parsePositiveRanges(filterOptions.rows),
				includeHiddenSheets: filterOptions.includeHiddenSheets === true,
				includeSharedStrings: filterOptions.includeSharedStrings === true,
				includeCellValues: filterOptions.includeCellValues === true,
			},
		);
	}

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
	const extension = detectXlsxFamilyExtension(
		xmlContentMap,
		skeleton?.source.name,
	);
	return zip.generateAsync({
		type: "blob",
		mimeType: XLSX_FAMILY_MIME_TYPES[extension],
	});
}
