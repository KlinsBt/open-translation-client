export type DocxFamilyExtension = "docx" | "docm" | "dotx" | "dotm";

export const DOCX_FAMILY_EXTENSIONS: readonly DocxFamilyExtension[] = [
	"docx",
	"docm",
	"dotx",
	"dotm",
];

export const DOCX_FAMILY_MIME_TYPES: Readonly<
	Record<DocxFamilyExtension, string>
> = {
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	docm: "application/vnd.ms-word.document.macroenabled.12",
	dotx: "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
	dotm: "application/vnd.ms-word.template.macroenabled.12",
};

export function detectDocxFamilyExtension(
	parts: Record<string, string | Blob>,
	sourceName = "",
): DocxFamilyExtension {
	const contentTypes =
		typeof parts["[Content_Types].xml"] === "string"
			? parts["[Content_Types].xml"]
			: "";
	const sourceExtension = sourceName
		.match(/\.(docx|docm|dotx|dotm)$/i)?.[1]
		?.toLowerCase() as DocxFamilyExtension | undefined;
	const hasMacro =
		parts["word/vbaProject.bin"] !== undefined ||
		/macroEnabled(?:Template)?\.main\+xml/i.test(contentTypes) ||
		sourceExtension === "docm" ||
		sourceExtension === "dotm";
	const isTemplate =
		/(?:wordprocessingml\.template|ms-word\.template\.macroEnabled(?:Template)?)\.main\+xml/i.test(
			contentTypes,
		) ||
		sourceExtension === "dotx" ||
		sourceExtension === "dotm";
	if (hasMacro) return isTemplate ? "dotm" : "docm";
	return isTemplate ? "dotx" : "docx";
}

export function docxFamilyOutputName(
	projectName: string,
	parts: Record<string, string | Blob>,
	sourceName = "",
): string {
	const extension = detectDocxFamilyExtension(parts, sourceName);
	const base = projectName.replace(/\.(?:docx|docm|dotx|dotm)$/i, "");
	return `${base}.${extension}`;
}
