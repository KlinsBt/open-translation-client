export const PDFJS_DYNAMIC_IMPORT_WARNING =
	"The above dynamic import cannot be analyzed by Vite.";

/**
 * PDF.js loads its worker through a runtime-configurable URL. Vite cannot
 * statically analyze that third-party expression, even though Open TLC sets a
 * local worker module and never accepts an imported URL for it.
 */
export function isIsolatedPdfJsWorkerWarning(message: string): boolean {
	return (
		message.includes("pdfjs-dist") &&
		(message.includes("legacy/build/pdf") ||
			message.includes("legacy_build_pdf")) &&
		message.includes("this.workerSrc") &&
		message.includes(PDFJS_DYNAMIC_IMPORT_WARNING)
	);
}

export function isolatePdfJsWorkerImport(
	code: string,
	moduleId: string,
): string | undefined {
	if (
		!moduleId.includes("pdfjs-dist") ||
		(!moduleId.includes("legacy/build/pdf") &&
			!moduleId.includes("legacy_build_pdf")) ||
		!code.includes("import(this.workerSrc")
	)
		return undefined;
	return code.replaceAll(
		"import(this.workerSrc",
		"import(/* @vite-ignore */ this.workerSrc",
	);
}
