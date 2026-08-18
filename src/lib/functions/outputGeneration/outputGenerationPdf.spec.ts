import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { buildJpegPdf } from "./outputGenerationPdf";

const ONE_PIXEL_JPEG = Uint8Array.from(
	Buffer.from(
		"/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABCf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=",
		"base64",
	),
);

describe("translated PDF output", () => {
	it("builds a real multi-page PDF that can be reopened", async () => {
		const blob = buildJpegPdf([
			{
				bytes: ONE_PIXEL_JPEG,
				width: 1,
				height: 1,
				pdfWidth: 612,
				pdfHeight: 792,
			},
			{
				bytes: ONE_PIXEL_JPEG,
				width: 1,
				height: 1,
				pdfWidth: 792,
				pdfHeight: 612,
			},
		]);
		expect(blob.type).toBe("application/pdf");
		const bytes = new Uint8Array(await blob.arrayBuffer());
		expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe("%PDF-1.4");
		const loadingTask = getDocument({ data: bytes });
		const document = await loadingTask.promise;
		expect(document.numPages).toBe(2);
		const firstPage = await document.getPage(1);
		const secondPage = await document.getPage(2);
		expect(firstPage.getViewport({ scale: 1 })).toMatchObject({
			width: 612,
			height: 792,
		});
		expect(secondPage.getViewport({ scale: 1 })).toMatchObject({
			width: 792,
			height: 612,
		});
		await loadingTask.destroy();
	});
});
