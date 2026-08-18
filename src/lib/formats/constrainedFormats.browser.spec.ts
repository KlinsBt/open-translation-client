import { describe, expect, it } from "vitest";
import { buildTranslatedPdf } from "$lib/functions/outputGeneration/outputGenerationPdf";
import { makeUserData } from "../../test/fixtures";
import { createSyntheticPdf } from "../../test/pdfFixtures";
import { importPdfFile } from "./pdf";
import { detectFormatWithConfidence, getFormatAcceptValue } from "./registry";

describe("browser local and constrained format routing", () => {
	it("advertises signed legacy Office input through the local adapter", async () => {
		const ole = new Uint8Array([
			0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0,
		]);
		const detection = await detectFormatWithConfidence(
			new File([ole], "confidential.doc", {
				type: "application/msword",
			}),
		);

		expect(detection).toMatchObject({
			formatId: "legacy-office",
			supported: true,
			confidence: "high",
		});
		expect(detection?.workflow).toBeUndefined();
		expect(getFormatAcceptValue().split(",")).toContain(".doc");
	});

	it.each([
		[
			"scan.png",
			"image/png",
			new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			"ocr",
		],
		[
			"interview.wav",
			"audio/wav",
			new Uint8Array([
				0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45,
			]),
			"transcription",
		],
	])(
		"routes %s to on-device %s without a consent workflow",
		async (name, type, signature, modality) => {
			const detection = await detectFormatWithConfidence(
				new File([signature], name, { type }),
			);
			expect(detection).toMatchObject({
				formatId: modality === "ocr" ? "image-ocr" : "media-transcription",
				supported: true,
				confidence: "high",
			});
			expect(detection?.workflow).toBeUndefined();
			expect(getFormatAcceptValue().split(",")).toContain(
				`.${name.split(".").at(-1)}`,
			);
		},
	);

	it("exports translated PDF pages over the retained source layout", async () => {
		const source = createSyntheticPdf(
			[{ lines: ["Original heading", "Original body"] }, { imageOnly: true }],
			"layout-source.pdf",
		);
		const imported = await importPdfFile(source, { ocrPolicy: "skip" });
		if (imported.kind !== "segments") throw new Error("Expected PDF segments");
		const project = makeUserData({
			type: "pdf",
			name: source.name,
			sourceLang: "English (en)",
			targetLang: "German (de)",
			seg1: imported.segments,
			seg2: ["Übersetzte Überschrift", "Übersetzter Inhalt"],
			checked: imported.segments.map(() => true),
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});

		const exported = await buildTranslatedPdf(project);
		expect(exported.type).toBe("application/pdf");
		const bytes = new Uint8Array(await exported.arrayBuffer());
		expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");

		const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
		const loadingTask = pdfjs.getDocument({ data: bytes });
		const document = await loadingTask.promise;
		expect(document.numPages).toBe(2);
		expect((await document.getPage(1)).getViewport({ scale: 1 })).toMatchObject(
			{ width: 612, height: 792 },
		);
		expect((await document.getPage(2)).getViewport({ scale: 1 })).toMatchObject(
			{ width: 612, height: 792 },
		);
		await loadingTask.destroy();
	}, 20_000);
});
