import type { FormatId } from "./formatIds";

/**
 * Lightweight public metadata. Registry parity is enforced by
 * supportCatalog.spec.ts so public routes do not bundle every parser/exporter.
 */
export const FORMAT_SUPPORT_LABELS = {
	text: "TXT",
	csv: "CSV/TSV",
	json: "JSON families",
	yaml: "YAML 1.2",
	po: "GNU gettext PO/POT",
	android: "Android resources",
	apple: "Apple localization",
	properties: "Java/Mozilla properties",
	resx: ".NET RESX",
	"qt-ts": "Qt Linguist TS",
	ini: "INI/desktop/lang",
	"auxiliary-resources": "Windows INF/REG + FreeMind MM",
	"outlook-msg": "Outlook MSG → safe EML",
	php: "PHP localization arrays",
	markup: "Markdown/AsciiDoc",
	subtitles: "SRT/WebVTT/SBV/ASS/SSA/Spruce STL subtitles",
	odf: "OpenDocument documents, templates, masters + formulas",
	epub: "EPUB 2/3",
	svg: "SVG",
	dita: "DITA/DITAMAP/BOOKMAP",
	docbook: "DocBook 4/5",
	idml: "Adobe IDML/ICML/INX",
	latex: "TeX/LaTeX",
	ttml: "TTML/DFXP",
	mif: "Adobe FrameMaker MIF / MIF2",
	"windows-rc": "Windows RC",
	qml: "Qt QML source",
	pdf: "PDF → translated PDF",
	"image-ocr": "PNG/JPEG/TIFF/BMP/DIB/GIF local OCR → bilingual HTML",
	"media-transcription": "Audio/video local transcription → WebVTT",
	rtf: "RTF",
	"legacy-bilingual": "TTX / ITD / TXML / Workbench bilingual",
	"legacy-office": "Legacy Office + XLSB",
	"cat-package": "CAT handoff and return packages",
	"zip-project": "Manifest-driven ZIP projects",
	visio: "Microsoft Visio drawings, stencils and templates",
	quark: "QuarkXPress Tags",
	psd: "Photoshop PSD text layers → SVG",
	"specialist-xml":
		"ITS, MULIX, Author-it, MadCap, TYPO3, SpreadsheetML + safe SGML",
	xml: "XML + ITS 2.0",
	docx: "DOCX",
	xlsx: "XLSX",
	pptx: "PPTX",
	html: "HTML, server pages and HTML Help",
} as const satisfies Record<FormatId, string>;

export interface SupportFormatGroup {
	title: string;
	formats: string[];
}

export const SUPPORT_GROUP_IDS: ReadonlyArray<{
	title: string;
	ids: readonly FormatId[];
}> = [
	{
		title: "Office, web and text",
		ids: [
			"docx",
			"xlsx",
			"pptx",
			"legacy-office",
			"rtf",
			"odf",
			"html",
			"text",
			"csv",
			"pdf",
		],
	},
	{
		title: "Software localization",
		ids: [
			"json",
			"yaml",
			"po",
			"android",
			"apple",
			"properties",
			"resx",
			"qt-ts",
			"qml",
			"ini",
			"php",
			"windows-rc",
			"auxiliary-resources",
			"outlook-msg",
		],
	},
	{
		title: "Publishing and technical authoring",
		ids: [
			"markup",
			"epub",
			"svg",
			"dita",
			"docbook",
			"idml",
			"latex",
			"ttml",
			"mif",
			"visio",
			"quark",
			"psd",
			"specialist-xml",
			"xml",
		],
	},
	{
		title: "Bilingual exchange and packages",
		ids: ["legacy-bilingual", "cat-package", "zip-project"],
	},
	{
		title: "Subtitles and local media",
		ids: ["subtitles", "image-ocr", "media-transcription"],
	},
];

export const SUPPORTED_FORMAT_LABELS = Object.values(FORMAT_SUPPORT_LABELS);

export const SUPPORT_FORMAT_GROUPS: readonly SupportFormatGroup[] =
	SUPPORT_GROUP_IDS.map((group) => ({
		title: group.title,
		formats: [
			...group.ids.map((id) => FORMAT_SUPPORT_LABELS[id]),
			...(group.title === "Bilingual exchange and packages"
				? [
						"XLIFF 1.2 / 2.0 / 2.1, SDLXLIFF, memoQ XLIFF, Phrase MXLIFF, WorldServer WsXLIFF, WPML and XLIFF:doc",
						"TMX 1.4b translation memories and TBX terminology",
					]
				: []),
		],
	}));

export const FORMAT_WORKFLOW_COUNT = SUPPORTED_FORMAT_LABELS.length;
