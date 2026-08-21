import type { UserData } from "$lib/types/types";

export interface ExportPresentation {
	label: string;
	description: string;
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
