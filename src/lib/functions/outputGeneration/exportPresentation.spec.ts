import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../test/fixtures";
import { constrainedExportPresentation } from "./exportPresentation";

describe("constrained export presentation", () => {
	it.each([
		["pdf", "Translated PDF", "flattened PDF"],
		["image-ocr", "Bilingual HTML OCR review", "HTML review"],
		["media-transcription", "Translated WebVTT transcript", "WebVTT"],
	] as const)(
		"describes the actual %s delivery instead of claiming an original-format round trip",
		(type, label, detail) => {
			const project = makeUserData({ type });
			const presentation = constrainedExportPresentation(
				project.translationData,
			);
			expect(presentation).toMatchObject({ label });
			expect(presentation?.description).toContain(detail);
			expect(presentation?.description).not.toMatch(/original source format/i);
		},
	);

	it("leaves native round-trip formats to their adapter presentation", () => {
		const project = makeUserData({ type: "text" });
		expect(constrainedExportPresentation(project.translationData)).toBeNull();
	});
});
