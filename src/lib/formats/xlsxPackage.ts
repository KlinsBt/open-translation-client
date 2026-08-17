export type XlsxFamilyExtension = "xlsx" | "xlsm" | "xltx" | "xltm";

export const XLSX_FAMILY_EXTENSIONS: readonly XlsxFamilyExtension[] = [
	"xlsx",
	"xlsm",
	"xltx",
	"xltm",
];

export const XLSX_FAMILY_MIME_TYPES: Readonly<
	Record<XlsxFamilyExtension, string>
> = {
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
	xltx: "application/vnd.openxmlformats-officedocument.spreadsheetml.template",
	xltm: "application/vnd.ms-excel.template.macroenabled.12",
};

export function detectXlsxFamilyExtension(
	parts: Record<string, string | Blob>,
	sourceName = "",
): XlsxFamilyExtension {
	const contentTypes =
		typeof parts["[Content_Types].xml"] === "string"
			? parts["[Content_Types].xml"]
			: "";
	const sourceExtension = sourceName
		.match(/\.(xlsx|xlsm|xltx|xltm)$/i)?.[1]
		?.toLowerCase() as XlsxFamilyExtension | undefined;
	const hasMacro =
		parts["xl/vbaProject.bin"] !== undefined ||
		/macroEnabled(?:Template)?\.main\+xml/i.test(contentTypes) ||
		sourceExtension === "xlsm" ||
		sourceExtension === "xltm";
	const isTemplate =
		/(?:spreadsheetml\.template|ms-excel\.template\.macroEnabled(?:Template)?)\.main\+xml/i.test(
			contentTypes,
		) ||
		sourceExtension === "xltx" ||
		sourceExtension === "xltm";
	if (hasMacro) return isTemplate ? "xltm" : "xlsm";
	return isTemplate ? "xltx" : "xlsx";
}

export function xlsxFamilyOutputName(
	projectName: string,
	parts: Record<string, string | Blob>,
	sourceName = "",
): string {
	const extension = detectXlsxFamilyExtension(parts, sourceName);
	const base = projectName.replace(/\.(?:xlsx|xlsm|xltx|xltm)$/i, "");
	return `${base}.${extension}`;
}
