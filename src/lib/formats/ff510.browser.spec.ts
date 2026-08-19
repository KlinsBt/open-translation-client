import { describe, expect, it } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { buildOcrBilingualReview } from "$lib/functions/outputGeneration/outputGenerationLocalMedia";
import { makeUserData } from "../../test/fixtures";
import { bmp, dib, gif } from "../../test/ocrImageFixtures";
import { importOcrImageFile } from "./localOcr";

const recognizedPage = {
	text: "Browser OCR مرحباً",
	confidence: 96,
	blocks: [
		{
			paragraphs: [
				{
					text: "Browser OCR مرحباً",
					confidence: 96,
					bbox: { x0: 0, y0: 0, x1: 1, y1: 1 },
					is_ltr: false,
					lines: [],
				},
			],
		},
	],
};

describe("FF-510 browser image decoding and persistence", () => {
	it.each([
		["bmp", bmp(), "image/bmp"],
		["dib", dib(), "image/bmp"],
		["gif", gif(), "image/gif"],
	] as const)(
		"decodes %s locally to PNG before OCR",
		async (extension, bytes, type) => {
			const seen: File[] = [];
			const imported = await importOcrImageFile(
				new File([bytes], `browser.${extension}`, { type }),
				undefined,
				undefined,
				{
					recognize: async (file) => {
						seen.push(file);
						return recognizedPage;
					},
				},
			);
			if (imported.kind !== "segments")
				throw new Error("Expected OCR segments");
			expect(seen[0].type).toBe("image/png");
			expect(seen[0].name).toBe("browser.normalized.png");
			expect(imported.segments).toEqual(["Browser OCR مرحباً"]);
		},
	);

	it("persists validated image metadata and original bytes through IndexedDB", async () => {
		const name = `ff510-${Date.now()}.bmp`;
		const sourceBytes = bmp();
		const imported = await importOcrImageFile(
			new File([sourceBytes], name, { type: "image/bmp" }),
			undefined,
			undefined,
			{ recognize: async () => recognizedPage },
		);
		if (imported.kind !== "segments") throw new Error("Expected OCR segments");
		const project = makeUserData({
			type: "image-ocr",
			name,
			seg1: imported.segments,
			seg2: ["متصفح OCR"],
			checked: [true],
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored?.translationData.typeRef).toMatchObject({
			imageProfile: "bmp",
			imageWidth: "2",
			imageHeight: "2",
		});
		const original = restored?.translationData.skeleton?.source.originalFile;
		expect(original).toBeInstanceOf(Blob);
		expect(new Uint8Array(await original!.arrayBuffer())).toEqual(sourceBytes);
		const review = buildOcrBilingualReview(restored!);
		const document = new DOMParser().parseFromString(review, "text/html");
		expect(document.body.textContent).toContain("متصفح OCR");
	});
});
