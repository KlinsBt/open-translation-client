import { describe, expect, it, vi } from "vitest";
import { buildOcrBilingualReview } from "$lib/functions/outputGeneration/outputGenerationLocalMedia";
import {
	importOcrImageFile,
	ocrUnitsFromPage,
	validateOcrImageFile,
} from "./localOcr";
import type { UserData } from "$lib/types/types";
import { inspectOcrImage, wrapDibAsBmp } from "./ocrImageInspection";
import { detectFormatWithConfidence } from "./registry";
import {
	bmp,
	dib,
	gif,
	jpegWithExifOrientation,
	minimalTiff,
	structuredPng,
} from "../../test/ocrImageFixtures";

const png = new File([structuredPng()], "scan.png", { type: "image/png" });

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
			imageProfile: "png",
			imageWidth: 200,
			imageHeight: 100,
		});
		expect(result.skeleton.source.originalFile).toBeInstanceOf(Blob);
		expect(
			new Uint8Array(await result.skeleton.source.originalFile!.arrayBuffer()),
		).toEqual(structuredPng());
	});

	it.each([
		["renamed.bin", "image/bmp", bmp(), "bmp"],
		["drawing.dat", "image/x-bmp", dib(), "dib"],
		["alias.jfif", "image/jpeg", jpegWithExifOrientation(), "jpeg"],
		["scan.tiff", "image/tiff", minimalTiff(), "tiff"],
		["still.gif", "image/gif", gif(), "gif"],
	] as const)(
		"validates %s by content rather than filename",
		async (name, type, bytes, profile) => {
			expect(
				await validateOcrImageFile(new File([bytes], name, { type })),
			).toEqual({ valid: true });
			expect(inspectOcrImage(bytes).profile).toBe(profile);
		},
	);

	it.each(["jpe", "jif", "jfif", "jfi"])(
		"routes the .%s JPEG alias only when JPEG structure matches",
		async (extension) => {
			const detection = await detectFormatWithConfidence(
				new File([jpegWithExifOrientation()], `scan.${extension}`, {
					type: "application/octet-stream",
				}),
			);
			expect(detection).toMatchObject({
				formatId: "image-ocr",
				supported: true,
				confidence: "high",
			});
			await expect(
				detectFormatWithConfidence(new File(["not jpeg"], `scan.${extension}`)),
			).resolves.toMatchObject({
				formatId: null,
				supported: false,
				label: "Unrecognized image",
			});
		},
	);

	it("records JPEG orientation/color profiles and bitmap orientation/alpha metadata", () => {
		expect(inspectOcrImage(jpegWithExifOrientation(32, 24, 6))).toMatchObject({
			width: 32,
			height: 24,
			orientation: 6,
			hasColorProfile: true,
		});
		expect(inspectOcrImage(bmp(2, 2, true))).toMatchObject({
			topDown: true,
			orientation: 1,
		});
		expect(inspectOcrImage(structuredPng())).toMatchObject({ hasAlpha: true });
	});

	it("wraps standalone DIB payloads as BMP without changing their image data", () => {
		const source = dib();
		const wrapped = wrapDibAsBmp(source);
		expect(String.fromCharCode(...wrapped.slice(0, 2))).toBe("BM");
		expect(wrapped.slice(14)).toEqual(source);
		expect(inspectOcrImage(wrapped)).toMatchObject({
			profile: "bmp",
			width: 2,
			height: 2,
		});
	});

	it("rejects animated GIFs unless first-frame OCR is explicitly selected", async () => {
		const animated = new File([gif(2)], "motion.gif", { type: "image/gif" });
		await expect(
			importOcrImageFile(animated, undefined, undefined, {
				recognize: vi.fn(),
			}),
		).rejects.toMatchObject({ code: "OCR_ANIMATED_GIF" });
		const gifPage = structuredClone(page);
		gifPage.blocks[0].paragraphs[0].bbox = { x0: 0, y0: 0, x1: 1, y1: 1 };
		gifPage.blocks[0].paragraphs[0].lines[0].bbox = {
			x0: 0,
			y0: 0,
			x1: 1,
			y1: 1,
		};
		const recognize = vi.fn().mockResolvedValue(gifPage);
		const decode = vi.fn().mockResolvedValue(
			new File([structuredPng()], "motion.normalized.png", {
				type: "image/png",
			}),
		);
		const imported = await importOcrImageFile(
			animated,
			{ gifAnimationPolicy: "first-frame" },
			undefined,
			{ recognize },
			{ decode },
		);
		expect(decode).toHaveBeenCalledWith(
			animated,
			expect.any(Uint8Array),
			expect.objectContaining({ frameCount: 2 }),
		);
		expect(recognize.mock.calls[0][0]).toMatchObject({
			name: "motion.normalized.png",
			type: "image/png",
		});
		expect(imported.typeRef).toMatchObject({
			imageFrames: "2",
			gifFramePolicy: "first-frame",
		});
	});

	it("rejects malformed structures, decompression bombs, and out-of-bounds OCR boxes", async () => {
		const malformed = gif().slice(0, -1);
		expect(
			await validateOcrImageFile(new File([malformed], "bad.gif")),
		).toMatchObject({ valid: false, errorCode: "OCR_INVALID" });
		const bomb = bmp(2, 2);
		new DataView(bomb.buffer).setInt32(18, 20_000, true);
		expect(() => inspectOcrImage(bomb)).toThrowError(
			expect.objectContaining({ code: "OCR_LIMIT_EXCEEDED" }),
		);
		const hostileOffset = bmp();
		new DataView(hostileOffset.buffer).setUint32(
			10,
			hostileOffset.length + 100,
			true,
		);
		expect(() => inspectOcrImage(hostileOffset)).toThrowError(
			expect.objectContaining({ code: "OCR_INVALID" }),
		);
		const invalidPage = structuredClone(page);
		invalidPage.blocks[0].paragraphs[0].bbox.x1 = 300;
		expect(() =>
			ocrUnitsFromPage(invalidPage, "paragraphs", { width: 200, height: 100 }),
		).toThrowError(expect.objectContaining({ code: "OCR_INVALID_RESULT" }));
	});

	it("honors cancellation before decoding or OCR", async () => {
		const controller = new AbortController();
		controller.abort();
		const decode = vi.fn();
		await expect(
			importOcrImageFile(
				new File([bmp()], "cancel.bmp"),
				undefined,
				{ signal: controller.signal },
				{ recognize: vi.fn() },
				{ decode },
			),
		).rejects.toMatchObject({ code: "ABORTED" });
		expect(decode).not.toHaveBeenCalled();
	});

	it("rejects generated over-limit files before allocating an OCR decode", async () => {
		const oversized = new File([structuredPng()], "large.png", {
			type: "image/png",
		});
		Object.defineProperty(oversized, "size", { value: 100 * 1024 * 1024 + 1 });
		await expect(validateOcrImageFile(oversized)).resolves.toMatchObject({
			valid: false,
			errorCode: "FILE_TOO_LARGE",
		});
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
		const parsed = new DOMParser().parseFromString(html, "text/html");
		const row = parsed.getElementsByTagName("tr")[1];
		expect(row.getAttribute("data-bbox")).toBe("10,20,100,25");
		expect(row.getElementsByTagName("td")[1].textContent).toBe("Hallo Welt");
	});
});
