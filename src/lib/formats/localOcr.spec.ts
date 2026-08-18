import { describe, expect, it, vi } from "vitest";
import { buildOcrBilingualReview } from "$lib/functions/outputGeneration/outputGenerationLocalMedia";
import { importOcrImageFile, ocrUnitsFromPage } from "./localOcr";
import type { UserData } from "$lib/types/types";

const png = new File(
	[new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])],
	"scan.png",
	{ type: "image/png" },
);

const page = {
	text: "Hello world",
	confidence: 91,
	blocks: [
		{
			paragraphs: [
				{
					text: "Hello world",
					confidence: 91,
					bbox: { x0: 10, y0: 20, x1: 110, y1: 45 },
					is_ltr: true,
					lines: [
						{
							text: "Hello world",
							confidence: 92,
							bbox: { x0: 10, y0: 20, x1: 110, y1: 45 },
						},
					],
				},
			],
		},
	],
};

describe("local image OCR", () => {
	it("maps paragraphs and lines to bounded-confidence translation units", () => {
		expect(ocrUnitsFromPage(page)).toEqual([
			{
				text: "Hello world",
				confidence: 0.91,
				bbox: { x0: 10, y0: 20, x1: 110, y1: 45 },
				direction: "ltr",
			},
		]);
		expect(ocrUnitsFromPage(page, "lines")[0].confidence).toBe(0.92);
	});

	it("processes the image locally without a consent object and retains it in the skeleton", async () => {
		const recognize = vi.fn().mockResolvedValue(page);
		const result = await importOcrImageFile(
			png,
			{ ocrLanguage: "eng+deu", grouping: "paragraphs" },
			undefined,
			{ recognize },
		);
		expect(recognize).toHaveBeenCalledWith(
			png,
			"eng+deu",
			expect.any(Function),
		);
		expect(result.kind).toBe("segments");
		if (result.kind !== "segments") return;
		expect(result.segments).toEqual(["Hello world"]);
		expect(result.document.metadata).toMatchObject({
			processing: "on-device",
			fileUploaded: false,
		});
		expect(result.skeleton.source.originalFile).toBeInstanceOf(Blob);
	});

	it("exports an accessible bilingual review with OCR confidence", async () => {
		const imported = await importOcrImageFile(png, undefined, undefined, {
			recognize: vi.fn().mockResolvedValue(page),
		});
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const project = {
			translationData: {
				name: "scan",
				sourceLang: "English (en)",
				targetLang: "German (de)",
				creationDate: "1",
				seg1: imported.segments,
				seg2: ["Hallo Welt"],
				checked: [true],
				type: "image-ocr",
				typeRef: imported.typeRef ?? {},
				segmentsMeta: imported.segmentsMeta,
				documentModel: imported.document,
				skeleton: imported.skeleton,
				filterOptions: imported.filterOptions,
				tm: { id: null, name: null, active: false },
				tb: { id: null, name: null, active: false },
			},
		} as UserData;
		const html = buildOcrBilingualReview(project);
		expect(html).toContain("Hallo Welt");
		expect(html).toContain('data-confidence="0.910"');
		expect(html).toContain("recognition ran on-device");
	});
});
