export const FORMAT_IDS = [
	"text",
	"csv",
	"json",
	"yaml",
	"po",
	"android",
	"xml",
	"docx",
	"xlsx",
	"pptx",
	"html",
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];
