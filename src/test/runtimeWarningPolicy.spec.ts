import { describe, expect, it } from "vitest";
import {
	isIsolatedPdfJsWorkerWarning,
	isolatePdfJsWorkerImport,
} from "./runtimeWarningPolicy";

describe("test runtime warning policy", () => {
	it("isolates only the known PDF.js variable worker import", () => {
		expect(
			isIsolatedPdfJsWorkerWarning(
				"pdfjs-dist/legacy/build/pdf.mjs calls import(this.workerSrc). The above dynamic import cannot be analyzed by Vite.",
			),
		).toBe(true);
		expect(
			isIsolatedPdfJsWorkerWarning(
				"application.ts imports a variable. The above dynamic import cannot be analyzed by Vite.",
			),
		).toBe(false);
	});

	it("marks only PDF.js's runtime worker URL for Vite isolation", () => {
		expect(
			isolatePdfJsWorkerImport(
				"const worker = import(this.workerSrc);",
				"/deps/pdfjs-dist_legacy_build_pdf__mjs.js",
			),
		).toBe("const worker = import(/* @vite-ignore */ this.workerSrc);");
		expect(
			isolatePdfJsWorkerImport(
				"const module = import(this.workerSrc);",
				"/src/application.ts",
			),
		).toBeUndefined();
	});
});
