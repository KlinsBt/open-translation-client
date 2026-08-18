// @vitest-environment happy-dom

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { createSyntheticPdf } from "../../test/pdfFixtures";
import {
	buildPdfBilingualReview,
	buildPdfBilingualReviewBlob,
} from "$lib/functions/outputGeneration/outputGenerationPdfReview";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { extractPdf, importPdfFile, validatePdfFile } from "./pdf";
import type { FormatOptionValues } from "./types";

const PDFINFO_AVAILABLE =
	spawnSync("pdfinfo", ["-v"], { encoding: "utf8" }).status === 0;

async function importProject(
	file: File,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const result = await importPdfFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected PDF segments");
	return {
		result,
		project: makeUserData({
			type: "pdf",
			name: file.name,
			seg1: result.segments,
			seg2: targets ?? [...result.segments],
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("PDF source-only workflow", () => {
	it("extracts born-digital Unicode text with page and bounding-box context", async () => {
		const file = createSyntheticPdf([
			{ lines: ["Café — e\u0301", "مرحبا", "👩🏽💻", "Second line"] },
			{ lines: ["Page two"] },
		]);
		const { result } = await importProject(file);
		expect(result.segments).toEqual([
			"Café — e\u0301",
			"مرحبا",
			"👩🏽💻",
			"Second line",
			"Page two",
		]);
		expect(result.segmentsMeta).toMatchObject([
			{ profile: "pdf-source-only", page: 1, extraction: "born-digital" },
			{ profile: "pdf-source-only", page: 1, extraction: "born-digital" },
			{ profile: "pdf-source-only", page: 1, extraction: "born-digital" },
			{ profile: "pdf-source-only", page: 1, extraction: "born-digital" },
			{ profile: "pdf-source-only", page: 2, extraction: "born-digital" },
		]);
		expect(result.document.units[0].sourceLocation).toMatchObject({
			part: "page-1",
			page: 1,
			metadata: { extraction: "born-digital" },
		});
		expect(
			(result.document.units[0].sourceLocation?.metadata?.bbox as number[])
				.length,
		).toBe(4);
		expect(result.document.metadata).toMatchObject({
			sourceOnly: true,
			lossy: true,
			textPages: [1, 2],
			ocrRequiredPages: [],
			exportPolicy: "derived-bilingual-html",
		});
	});

	it("distinguishes image-only OCR pages and applies the selected policy", async () => {
		const file = createSyntheticPdf([
			{ lines: ["Born-digital"] },
			{ imageOnly: true },
		]);
		const skipped = await importPdfFile(file, { ocrPolicy: "skip" });
		expect(skipped.document.metadata).toMatchObject({
			textPages: [1],
			ocrRequiredPages: [2],
		});
		await expect(
			importPdfFile(file, { ocrPolicy: "error" }),
		).rejects.toMatchObject({ code: "PDF_OCR_REQUIRED" });
		await expect(
			importPdfFile(createSyntheticPdf([{ imageOnly: true }])),
		).rejects.toMatchObject({ code: "PDF_OCR_REQUIRED" });
	});

	it("supports page ranges and positioned-item grouping", async () => {
		const file = createSyntheticPdf([
			{ lines: ["Page one"] },
			{ lines: ["Page two", "Another line"] },
		]);
		const extraction = await extractPdf(file, {
			pages: "2",
			grouping: "items",
		});
		expect(extraction.selectedPages).toEqual([2]);
		expect(extraction.lines.map((line) => line.text)).toEqual([
			"Page",
			"two",
			"Another",
			"line",
		]);
		await expect(extractPdf(file, { pages: "99" })).rejects.toMatchObject({
			code: "PDF_INVALID",
		});
	});

	it("exports a safe accessible bilingual HTML review rather than a replacement PDF", async () => {
		const { project } = await importProject(
			createSyntheticPdf([{ lines: ['Source & "unsafe"'] }], "manual.pdf"),
		);
		project.translationData.seg2 = ["Ziel & Übersetzung"];
		const html = buildPdfBilingualReview(project);
		expect(html).toContain("Derived review artifact");
		expect(html).toContain("Source &amp; &quot;unsafe&quot;");
		expect(html).toContain("Ziel &amp; Übersetzung");
		expect(html).toContain('data-page="1"');
		expect(html).toContain("Content-Security-Policy");
		expect(
			new DOMParser()
				.parseFromString(html, "text/html")
				.querySelectorAll("tbody tr"),
		).toHaveLength(1);
		const blob = buildPdfBilingualReviewBlob(project);
		expect(blob.type).toBe("text/html;charset=utf-8");
		expect(new Uint8Array(await blob.arrayBuffer()).slice(0, 5)).not.toEqual(
			new TextEncoder().encode("%PDF-"),
		);
	});

	it("rejects malformed/spoofed input and honors cancellation", async () => {
		await expect(
			validatePdfFile(new File(["not a pdf"], "fake.pdf")),
		).resolves.toMatchObject({ valid: false, errorCode: "PDF_INVALID" });
		await expect(
			validatePdfFile(new File(["%PDF-1.7\nbroken"], "broken.pdf")),
		).resolves.toMatchObject({ valid: false, errorCode: "PDF_INVALID" });
		const controller = new AbortController();
		controller.abort();
		await expect(
			extractPdf(createSyntheticPdf([{ lines: ["Text"] }]), undefined, {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("blocks split/join and stale page mappings", async () => {
		const { project } = await importProject(
			createSyntheticPdf([{ lines: ["Protected page unit"] }]),
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		project.translationData.segmentsMeta = [];
		expect(() => buildPdfBilingualReview(project)).toThrow(
			/missing or out of sync/,
		);
	});

	it.runIf(PDFINFO_AVAILABLE)(
		"passes an independent PDF parser before local extraction",
		async () => {
			const file = createSyntheticPdf([{ lines: ["Independent parser"] }]);
			const directory = mkdtempSync(join(tmpdir(), "opentlc-pdf-"));
			try {
				const path = join(directory, "source.pdf");
				writeFileSync(path, new Uint8Array(await file.arrayBuffer()));
				const inspected = spawnSync("pdfinfo", [path], { encoding: "utf8" });
				expect(inspected.status).toBe(0);
				expect(inspected.stdout).toContain("Pages:           1");
				await expect(validatePdfFile(file)).resolves.toMatchObject({
					valid: true,
				});
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);

	it("fails closed when generated page-count limits are exceeded", async () => {
		const pages = Array.from({ length: 2_001 }, () => ({ lines: ["x"] }));
		await expect(extractPdf(createSyntheticPdf(pages))).rejects.toEqual(
			expect.objectContaining({
				name: "SafeInputError",
				code: "PDF_LIMIT_EXCEEDED",
			}),
		);
	}, 15_000);
});
