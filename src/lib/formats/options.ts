import type { FormatId } from "./formatIds";
import type {
	FormatImportOption,
	FormatOptionValue,
	FormatOptionValues,
} from "./types";

export const FORMAT_IMPORT_OPTIONS = {
	text: [
		{
			id: "segmentationMode",
			label: "Segmentation",
			type: "select",
			defaultValue: "preferences",
			choices: [
				"preferences",
				"sentences",
				"srx",
				"paragraphs",
				"lines",
				"document",
			],
			description:
				"Choose how source text is divided; SRX uses the active imported SRX profile.",
		},
		{
			id: "outputEncoding",
			label: "Output encoding",
			type: "select",
			defaultValue: "source",
			choices: ["source", "utf-8", "utf-16le", "utf-16be"],
			description: "Preserve the source encoding or select an export encoding.",
		},
		{
			id: "byteOrderMark",
			label: "Byte-order mark",
			type: "select",
			defaultValue: "preserve",
			choices: ["preserve", "always", "never"],
			description: "Preserve, add, or remove the TXT byte-order mark.",
		},
		{
			id: "unicodeNormalization",
			label: "Unicode normalization",
			type: "select",
			defaultValue: "preserve",
			choices: ["preserve", "nfc", "nfd", "nfkc", "nfkd"],
			description:
				"Preserve target code points or normalize translated text during export.",
		},
	],
	csv: [
		{
			id: "delimiter",
			label: "Delimiter",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "comma", "tab", "semicolon", "pipe"],
			description:
				"Detect the delimiter from the extension/content or select it explicitly.",
		},
		{
			id: "quoteCharacter",
			label: "Quote character",
			type: "select",
			defaultValue: "double",
			choices: ["double", "single", "none"],
		},
		{
			id: "escapeMode",
			label: "Quote escaping",
			type: "select",
			defaultValue: "double",
			choices: ["double", "backslash"],
			description:
				"RFC 4180 doubles quote characters; backslash mode supports common nonstandard exports.",
		},
		{
			id: "hasHeader",
			label: "First row is a header",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "importMode",
			label: "Delimited-text mode",
			type: "select",
			defaultValue: "all-text",
			choices: ["all-text", "source-column", "multilingual-columns"],
			description:
				"Import every selected text field, one source column, or paired source and target columns.",
		},
		{
			id: "keyColumn",
			label: "Key column",
			type: "text",
			defaultValue: "A",
			placeholder: "Header, A, or 1",
		},
		{
			id: "sourceColumn",
			label: "Source column",
			type: "text",
			defaultValue: "B",
			placeholder: "Header, B, or 2",
		},
		{
			id: "targetColumn",
			label: "Target column",
			type: "text",
			defaultValue: "C",
			placeholder: "Header, C, or 3",
		},
		{
			id: "contextColumn",
			label: "Context column",
			type: "text",
			defaultValue: "",
			placeholder: "Optional header, D, or 4",
		},
		{
			id: "skipEmptyFields",
			label: "Skip empty fields",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "outputEncoding",
			label: "Output encoding",
			type: "select",
			defaultValue: "source",
			choices: ["source", "utf-8", "utf-16le", "utf-16be"],
		},
		{
			id: "byteOrderMark",
			label: "Byte-order mark",
			type: "select",
			defaultValue: "preserve",
			choices: ["preserve", "always", "never"],
		},
	],
	json: [
		{
			id: "profile",
			label: "JSON profile",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "generic", "arb", "i18next", "chrome", "locjson"],
			description:
				"Auto detects ARB, LocJSON, and Chrome messages; select i18next explicitly because generic nested JSON is structurally ambiguous.",
		},
		{
			id: "pathSelectors",
			label: "JSON paths",
			type: "text",
			defaultValue: "",
			placeholder: "e.g. messages.**, products.*.title",
			description:
				"Comma-separated paths. * matches one key; ** matches any depth.",
		},
		{
			id: "includeNonStringValues",
			label: "Include numbers and booleans",
			type: "boolean",
			defaultValue: true,
			description: "Import primitive values as well as strings.",
		},
		{
			id: "segmentationMode",
			label: "Value segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
			description:
				"Keep each resource value intact by default, especially for ICU and placeholder-bearing messages.",
		},
		{
			id: "keyField",
			label: "Sibling key field",
			type: "text",
			defaultValue: "",
			placeholder: "e.g. id",
			description:
				"For generic JSON, use a sibling primitive as the unit key and exclude it from translation.",
		},
		{
			id: "contextField",
			label: "Sibling context field",
			type: "text",
			defaultValue: "",
			placeholder: "e.g. description",
			description:
				"For generic JSON, attach a sibling primitive as translator context and exclude it from translation.",
		},
	],
	yaml: [
		{
			id: "pathSelectors",
			label: "YAML paths",
			type: "text",
			defaultValue: "",
			placeholder: "e.g. messages.**, products.*.title",
			description:
				"Comma-separated value paths. * matches one key; ** matches any depth. Mapping keys and aliases are never translated.",
		},
		{
			id: "includeNonStringScalars",
			label: "Include non-string scalars",
			type: "boolean",
			defaultValue: false,
			description:
				"Also expose YAML numbers, booleans, and null values. Their original type is retained when the target remains valid for that type.",
		},
		{
			id: "segmentationMode",
			label: "Value segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
			description:
				"Keep each scalar intact by default so block styles and application placeholders remain stable.",
		},
	],
	po: [
		{
			id: "includeFuzzy",
			label: "Include fuzzy entries",
			type: "boolean",
			defaultValue: true,
			description:
				"Import fuzzy translations for review while retaining their workflow flag.",
		},
		{
			id: "includeObsolete",
			label: "Include obsolete entries",
			type: "boolean",
			defaultValue: false,
			description:
				"Expose #~ entries for archival review. They remain obsolete on export.",
		},
		{
			id: "segmentationMode",
			label: "Entry segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
			description:
				"Keep each msgstr or plural form intact by default so gettext alignment remains stable.",
		},
	],
	xml: [
		{
			id: "elementSelectors",
			label: "Translatable elements",
			type: "text",
			defaultValue: "//*",
			placeholder: "e.g. //title, /catalog/item/description",
			description:
				"Comma-separated XPath-like element paths. Supports //name, /absolute/path, qualified names, and //*.",
		},
		{
			id: "attributeSelectors",
			label: "Translatable attributes",
			type: "text",
			defaultValue: "",
			placeholder: "e.g. //@title, //image/@alt",
			description:
				"Attributes are protected unless selected explicitly or by a supported ITS rule.",
		},
		{
			id: "respectIts",
			label: "Respect ITS 2.0 metadata",
			type: "boolean",
			defaultValue: true,
			description:
				"Honor local ITS translate, withinText, preserveSpace, terminology, locale, language, ID, and localization-note metadata plus basic translateRule selectors.",
		},
		{
			id: "includeCdata",
			label: "Include CDATA text",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "segmentationMode",
			label: "Text-node segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	docx: [
		{
			id: "paragraphs",
			label: "Paragraphs",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. 1-5, 8",
			description: "Import all paragraphs or a 1-based range list.",
		},
		{
			id: "trackedChanges",
			label: "Tracked changes",
			type: "select",
			defaultValue: "current",
			choices: ["current", "original", "all"],
			description:
				"Current includes insertions; original includes deletions; all imports both without accepting or rejecting revisions.",
		},
		{
			id: "includeHeadersFooters",
			label: "Headers and footers",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeNotes",
			label: "Footnotes and endnotes",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeComments",
			label: "Comments",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeTextBoxes",
			label: "Text boxes",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeDrawingText",
			label: "Drawing text",
			type: "boolean",
			defaultValue: true,
		},
	],
	xlsx: [
		{
			id: "importMode",
			label: "Spreadsheet mode",
			type: "select",
			defaultValue: "all-text",
			choices: ["all-text", "key-value", "multilingual-columns"],
			description:
				"All-text imports selected text cells. Key-value uses a key and value column. Multilingual mode pairs source and target columns by row.",
		},
		{
			id: "worksheetPaths",
			label: "Worksheets",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. sheet1, sheet3",
			description: "Comma-separated worksheet filenames or package paths.",
		},
		{
			id: "columns",
			label: "Columns",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. A, C-F",
			description:
				"Column letters and ranges for all-text mode. Paired modes use the columns below.",
		},
		{
			id: "rows",
			label: "Rows",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. 2-100, 105",
			description: "Import all rows or a 1-based range list.",
		},
		{
			id: "includeHiddenSheets",
			label: "Include hidden sheets",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "keyColumn",
			label: "Key/context column",
			type: "text",
			defaultValue: "A",
			placeholder: "A, or blank when optional",
			description:
				"Required in key-value mode; optional context in multilingual mode.",
		},
		{
			id: "sourceColumn",
			label: "Source/value column",
			type: "text",
			defaultValue: "B",
			placeholder: "B",
		},
		{
			id: "targetColumn",
			label: "Target column",
			type: "text",
			defaultValue: "C",
			placeholder: "C",
			description: "Used by multilingual-column mode.",
		},
		{
			id: "headerRows",
			label: "Header rows",
			type: "number",
			defaultValue: 1,
			description: "Rows at the start of each selected sheet to exclude.",
		},
		{
			id: "includeCellComments",
			label: "Cell comments as notes",
			type: "boolean",
			defaultValue: true,
			description:
				"Attach legacy cell comments as non-translatable translator notes.",
		},
		{
			id: "includeSharedStrings",
			label: "Include shared strings",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeCellValues",
			label: "Include non-text values",
			type: "boolean",
			defaultValue: false,
			description:
				"Include numeric and boolean cell values. Formula cells are always protected.",
		},
	],
	pptx: [
		{
			id: "slides",
			label: "Slides",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. 1-5, 8",
			description: "Import all slides or a 1-based range list.",
		},
		{
			id: "includeNotes",
			label: "Speaker notes",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeComments",
			label: "Comments as notes",
			type: "boolean",
			defaultValue: true,
			description:
				"Attach slide comments as non-translatable translator notes.",
		},
		{
			id: "includeAltText",
			label: "Shape alt text",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeChartText",
			label: "Chart drawing text",
			type: "boolean",
			defaultValue: true,
			description:
				"Import addressable DrawingML text without changing formulas or cached values.",
		},
		{
			id: "includeSmartArtText",
			label: "SmartArt text",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeMastersLayouts",
			label: "Masters and layouts",
			type: "boolean",
			defaultValue: false,
			description:
				"Include reusable master and layout text; disabled by default to avoid duplicates.",
		},
	],
	html: [
		{
			id: "includeTextNodes",
			label: "Include visible text",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "translatableAttributes",
			label: "Translatable attributes",
			type: "text",
			defaultValue: "placeholder,value,alt,title",
			placeholder: "placeholder, value, alt, title",
			description:
				"Comma-separated HTML attribute names; leave empty for none.",
		},
		{
			id: "excludedElements",
			label: "Protected elements",
			type: "text",
			defaultValue: "script,style,code",
			placeholder: "script, style, code",
			description:
				"Comma-separated element names whose content is never extracted. Script and style always remain protected.",
		},
		{
			id: "respectTranslateMetadata",
			label: "Respect translate metadata",
			type: "boolean",
			defaultValue: true,
			description:
				"Honor inherited HTML translate and local ITS translate metadata.",
		},
	],
} as const satisfies Record<FormatId, readonly FormatImportOption[]>;

export function normalizeImportOptions(
	format: FormatId,
	supplied: Readonly<FormatOptionValues> = {},
): FormatOptionValues {
	const normalized: FormatOptionValues = {};
	for (const option of FORMAT_IMPORT_OPTIONS[format]) {
		const value = supplied[option.id] ?? option.defaultValue;
		normalized[option.id] = normalizeValue(option, value);
	}
	return normalized;
}

function normalizeValue(
	option: FormatImportOption,
	value: FormatOptionValue,
): FormatOptionValue {
	if (option.type === "boolean") {
		return typeof value === "string"
			? value.toLowerCase() === "true"
			: Boolean(value);
	}
	if (option.type === "number") {
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : option.defaultValue;
	}
	const text = String(value);
	if (option.type === "select" && !option.choices?.includes(text)) {
		return option.defaultValue;
	}
	return text.trim();
}

export function parseList(value: FormatOptionValue | undefined): string[] {
	return String(value ?? "")
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function matchesJsonSelector(
	path: readonly string[],
	selectors: readonly string[],
): boolean {
	if (selectors.length === 0) return true;
	return selectors.some((selector) => {
		const parts = selector
			.replace(/^\$\.?/, "")
			.split(/[./]/)
			.filter(Boolean);
		return matchPathParts(path, parts, 0, 0);
	});
}

function matchPathParts(
	path: readonly string[],
	pattern: readonly string[],
	pathIndex: number,
	patternIndex: number,
): boolean {
	if (patternIndex === pattern.length) return pathIndex === path.length;
	if (pattern[patternIndex] === "**") {
		return (
			matchPathParts(path, pattern, pathIndex, patternIndex + 1) ||
			(pathIndex < path.length &&
				matchPathParts(path, pattern, pathIndex + 1, patternIndex))
		);
	}
	if (pathIndex >= path.length) return false;
	return (
		(pattern[patternIndex] === "*" ||
			pattern[patternIndex] === path[pathIndex]) &&
		matchPathParts(path, pattern, pathIndex + 1, patternIndex + 1)
	);
}

export function parsePositiveRanges(
	value: FormatOptionValue | undefined,
	maximum = 100_000,
): Set<number> | null {
	const entries = parseList(value);
	if (
		entries.length === 0 ||
		entries.some((entry) => entry.toLowerCase() === "all")
	)
		return null;
	const result = new Set<number>();
	for (const entry of entries) {
		const match = entry.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
		if (!match) continue;
		const start = Number(match[1]);
		const end = Number(match[2] ?? match[1]);
		for (
			let current = Math.max(1, start);
			current <= Math.min(end, maximum);
			current++
		)
			result.add(current);
	}
	return result;
}

function columnNumber(column: string): number {
	return [...column.toUpperCase()].reduce(
		(total, character) => total * 26 + character.charCodeAt(0) - 64,
		0,
	);
}

export function parseColumns(
	value: FormatOptionValue | undefined,
): Set<number> | null {
	const entries = parseList(value);
	if (
		entries.length === 0 ||
		entries.some((entry) => entry.toLowerCase() === "all")
	)
		return null;
	const result = new Set<number>();
	for (const entry of entries) {
		const match = entry.match(/^([a-z]+)(?:\s*-\s*([a-z]+))?$/i);
		if (!match) continue;
		const start = columnNumber(match[1]);
		const end = columnNumber(match[2] ?? match[1]);
		for (let current = start; current <= Math.min(end, 16_384); current++)
			result.add(current);
	}
	return result;
}

export function columnFromCellReference(reference: string): number | null {
	const match = reference.match(/^([a-z]+)/i);
	return match ? columnNumber(match[1]) : null;
}
