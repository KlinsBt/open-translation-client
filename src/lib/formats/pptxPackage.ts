export type PptxFamilyExtension =
	| "pptx"
	| "pptm"
	| "potx"
	| "potm"
	| "ppsx"
	| "ppsm";

export const PPTX_FAMILY_EXTENSIONS: readonly PptxFamilyExtension[] = [
	"pptx",
	"pptm",
	"potx",
	"potm",
	"ppsx",
	"ppsm",
];

export const PPTX_FAMILY_MIME_TYPES: Readonly<
	Record<PptxFamilyExtension, string>
> = {
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	pptm: "application/vnd.ms-powerpoint.presentation.macroenabled.12",
	potx: "application/vnd.openxmlformats-officedocument.presentationml.template",
	potm: "application/vnd.ms-powerpoint.template.macroenabled.12",
	ppsx: "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
	ppsm: "application/vnd.ms-powerpoint.slideshow.macroenabled.12",
};

export function detectPptxFamilyExtension(
	parts: Record<string, string | Blob>,
	sourceName = "",
): PptxFamilyExtension {
	const contentTypes =
		typeof parts["[Content_Types].xml"] === "string"
			? parts["[Content_Types].xml"]
			: "";
	const sourceExtension = sourceName
		.match(/\.(pptx|pptm|potx|potm|ppsx|ppsm)$/i)?.[1]
		?.toLowerCase() as PptxFamilyExtension | undefined;
	const hasMacro =
		parts["ppt/vbaProject.bin"] !== undefined ||
		/macroEnabled(?:Template|SlideShow)?\.main\+xml/i.test(contentTypes) ||
		sourceExtension === "pptm" ||
		sourceExtension === "potm" ||
		sourceExtension === "ppsm";
	const isTemplate =
		/presentationml\.template\.main\+xml|powerpoint\.template\.macroEnabled/i.test(
			contentTypes,
		) ||
		sourceExtension === "potx" ||
		sourceExtension === "potm";
	const isSlideShow =
		/presentationml\.slideshow\.main\+xml|powerpoint\.slideshow\.macroEnabled/i.test(
			contentTypes,
		) ||
		sourceExtension === "ppsx" ||
		sourceExtension === "ppsm";
	if (isTemplate) return hasMacro ? "potm" : "potx";
	if (isSlideShow) return hasMacro ? "ppsm" : "ppsx";
	return hasMacro ? "pptm" : "pptx";
}

export function pptxFamilyOutputName(
	projectName: string,
	parts: Record<string, string | Blob>,
	sourceName = "",
): string {
	const extension = detectPptxFamilyExtension(parts, sourceName);
	const base = projectName.replace(/\.(?:pptx|pptm|potx|potm|ppsx|ppsm)$/i, "");
	return `${base}.${extension}`;
}
