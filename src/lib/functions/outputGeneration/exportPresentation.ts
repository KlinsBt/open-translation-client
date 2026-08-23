import type { UserData } from "$lib/types/types";
import { catReturnExtensionFor } from "$lib/formats/catPackage";

export interface ExportPresentation {
	label: string;
	description: string;
}

function stringTypeRef(
	data: UserData["translationData"],
	key: string,
): string | undefined {
	return typeof data.typeRef === "object" &&
		typeof (data.typeRef as Record<string, unknown>)[key] === "string"
		? String((data.typeRef as Record<string, unknown>)[key])
		: undefined;
}

function legacyTargetsAreIdentity(data: UserData["translationData"]): boolean {
	if (!Array.isArray(data.segmentsMeta)) return false;
	return data.segmentsMeta.every((raw, index) => {
		if (!raw || typeof raw !== "object") return false;
		const entry = raw as Record<string, unknown>;
		return (
			entry.originalSource === data.seg1[index] &&
			entry.originalTarget === data.seg2[index]
		);
	});
}

/** Returns copy for workflows whose primary artifact differs from a native file. */
export function formatChangingExportPresentation(
	data: UserData["translationData"],
): ExportPresentation | null {
	const constrained = constrainedExportPresentation(data);
	if (constrained) return constrained;
	if (data.type === "cat-package") {
		const extension = (
			stringTypeRef(data, "returnExtension") || catReturnExtensionFor(data.name)
		).toUpperCase();
		return {
			label: `${extension} return package`,
			description: `Create the translated CAT return package as .${extension.toLowerCase()}, preserving the retained package structure and opaque resources.`,
		};
	}
	if (
		data.type === "legacy-bilingual" &&
		stringTypeRef(data, "profile") === "workbench-ole" &&
		!legacyTargetsAreIdentity(data)
	) {
		return {
			label: "RTF conversion",
			description:
				"Create a safe bilingual RTF containing the translated Workbench units; the retained binary DOC remains unchanged in the project.",
		};
	}
	return null;
}

/** Labels constrained delivery formats by what is actually downloaded. */
export function constrainedExportPresentation(
	data: UserData["translationData"],
): ExportPresentation | null {
	switch (data.type) {
		case "pdf":
			return {
				label: "Translated PDF",
				description:
					"Create a new flattened PDF from locally rendered source pages, mapped target text, and a searchable target-language text layer.",
			};
		case "image-ocr":
			return {
				label: "Bilingual HTML OCR review",
				description:
					"Create an HTML review with the retained image, OCR source text, translated text, positions, and confidence details.",
			};
		case "media-transcription":
			return {
				label: "Translated WebVTT transcript",
				description:
					"Create a WebVTT subtitle transcript using the locally detected cue timestamps and translated text.",
			};
		default:
			return null;
	}
}
