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
	android: [
		{
			id: "includeNonTranslatable",
			label: "Include translatable=false resources",
			type: "boolean",
			defaultValue: false,
			description:
				"Expose locked Android resources for review while preserving their translatable flag.",
		},
		{
			id: "includeEmpty",
			label: "Include empty resources",
			type: "boolean",
			defaultValue: false,
		},
	],
	apple: [
		{
			id: "profile",
			label: "Apple localization profile",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "strings", "stringsdict", "xcstrings"],
		},
		{
			id: "sourceLanguage",
			label: "Source language",
			type: "text",
			defaultValue: "",
			placeholder: "Catalog metadata or e.g. en",
		},
		{
			id: "targetLanguage",
			label: "Target language",
			type: "text",
			defaultValue: "",
			placeholder: "Existing catalog language or BCP 47 tag",
		},
		{
			id: "includeStale",
			label: "Include stale catalog entries",
			type: "boolean",
			defaultValue: true,
		},
	],
	properties: [
		{
			id: "sourceEncoding",
			label: "Properties encoding",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "utf-8", "iso-8859-1", "windows-1252"],
			description:
				"Auto prefers valid UTF-8 and falls back to the traditional single-byte Java properties encoding.",
		},
		{
			id: "includeEmpty",
			label: "Include empty values",
			type: "boolean",
			defaultValue: false,
		},
	],
	resx: [
		{
			id: "includeEmpty",
			label: "Include empty string resources",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeExplicitSystemStrings",
			label: "Include typed System.String values",
			type: "boolean",
			defaultValue: true,
			description:
				"Other typed, serialized, binary, or mimetype resources always remain protected.",
		},
	],
	"qt-ts": [
		{
			id: "includeUnfinished",
			label: "Include unfinished translations",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeVanished",
			label: "Include vanished messages",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeObsolete",
			label: "Include obsolete messages",
			type: "boolean",
			defaultValue: false,
		},
	],
	ini: [
		{
			id: "profile",
			label: "INI resource profile",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "generic", "desktop", "lang"],
		},
		{
			id: "keySelectors",
			label: "Translatable keys",
			type: "text",
			defaultValue: "",
			placeholder: "Required for generic INI, e.g. ui.title, message_*",
			description:
				"Comma-separated key or section.key patterns; * is supported. Generic INI imports require an explicit selection.",
		},
		{
			id: "targetLocale",
			label: "Desktop target locale",
			type: "text",
			defaultValue: "",
			placeholder: "e.g. de, pt_BR",
		},
		{
			id: "includeEmpty",
			label: "Include empty values",
			type: "boolean",
			defaultValue: false,
		},
	],
	php: [
		{
			id: "pathSelectors",
			label: "Translatable array paths",
			type: "text",
			defaultValue: "",
			placeholder: "All string leaves, or e.g. auth.*, validation.required",
			description:
				"Comma-separated dot paths; * and ** wildcards are supported. Keys are always protected.",
		},
		{
			id: "includeEmpty",
			label: "Include empty strings",
			type: "boolean",
			defaultValue: false,
		},
	],
	markup: [
		{
			id: "profile",
			label: "Markup profile",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "markdown", "asciidoc"],
		},
		{
			id: "includeHtmlText",
			label: "Include text around inline HTML",
			type: "boolean",
			defaultValue: true,
			description:
				"HTML tags remain protected; text between inline tags is exposed. Raw script, style, pre, and comment blocks remain protected.",
		},
	],
	subtitles: [
		{
			id: "profile",
			label: "Subtitle profile",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "srt", "vtt", "sbv"],
		},
		{
			id: "overlapPolicy",
			label: "Overlapping cues",
			type: "select",
			defaultValue: "warn",
			choices: ["warn", "error", "allow"],
		},
		{
			id: "maxCharactersPerLine",
			label: "Maximum characters per line",
			type: "number",
			defaultValue: 42,
		},
		{
			id: "maxLinesPerCue",
			label: "Maximum lines per cue",
			type: "number",
			defaultValue: 2,
		},
		{
			id: "maxReadingSpeed",
			label: "Maximum characters per second",
			type: "number",
			defaultValue: 20,
		},
		{
			id: "maxExpansionPercent",
			label: "Maximum target expansion (%)",
			type: "number",
			defaultValue: 50,
		},
	],
	odf: [
		{
			id: "trackedChanges",
			label: "Tracked changes",
			type: "select",
			defaultValue: "final",
			choices: ["final", "original", "all"],
			description:
				"Choose final text, original text, or both insertion/deletion branches. Change metadata remains protected.",
		},
		{
			id: "includeNotes",
			label: "Include presentation notes",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeComments",
			label: "Include annotations/comments",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeHeadersFooters",
			label: "Include headers and footers",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeAccessibilityText",
			label: "Include drawing titles/descriptions",
			type: "boolean",
			defaultValue: true,
		},
	],
	epub: [
		{
			id: "contentScope",
			label: "Content documents",
			type: "select",
			defaultValue: "spine",
			choices: ["spine", "all"],
			description:
				"Translate reading-order documents, or every XHTML content document declared in the manifest.",
		},
		{
			id: "includeNavigation",
			label: "Include navigation labels",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeMetadata",
			label: "Include publication metadata",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeSvgText",
			label: "Include SVG text/title/description",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeAccessibilityText",
			label: "Include alt/title/ARIA labels",
			type: "boolean",
			defaultValue: true,
		},
	],
	svg: [
		{
			id: "elementSelectors",
			label: "Translatable SVG elements",
			type: "text",
			defaultValue: "text,tspan,textPath,title,desc",
			description:
				"Comma-separated local element names. Script, style, and geometry remain protected regardless.",
		},
		{
			id: "attributeSelectors",
			label: "Accessibility attributes",
			type: "text",
			defaultValue: "aria-label,aria-description,title",
		},
		{
			id: "includeHiddenText",
			label: "Include hidden text",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeMetadata",
			label: "Include metadata element text",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "respectTranslateMetadata",
			label: "Respect translate=no and ITS translate",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "segmentationMode",
			label: "Text segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	dita: [
		{
			id: "contentScope",
			label: "Bundle content",
			type: "select",
			defaultValue: "map",
			choices: ["map", "all"],
			description:
				"For .ditazip bundles, translate the root-map dependency graph or every DITA XML document.",
		},
		{
			id: "includeNavigation",
			label: "Include map navigation text",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeMetadata",
			label: "Include topic/book metadata",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeCode",
			label: "Include code and preformatted text",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "attributeSelectors",
			label: "Translatable attributes",
			type: "text",
			defaultValue: "alt,title,navtitle",
		},
		{
			id: "respectTranslateMetadata",
			label: "Respect translate=no and ITS translate",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "segmentationMode",
			label: "Text segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	docbook: [
		{
			id: "includeMetadata",
			label: "Include document metadata",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeCode",
			label: "Include code and literal blocks",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeIndexTerms",
			label: "Include index terms",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "attributeSelectors",
			label: "Translatable attributes",
			type: "text",
			defaultValue: "alt,title",
		},
		{
			id: "respectTranslateMetadata",
			label: "Respect translate=no and ITS translate",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "segmentationMode",
			label: "Text segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	idml: [
		{
			id: "includeNotes",
			label: "Include notes",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeHiddenText",
			label: "Include hidden/conditional text",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeAccessibilityText",
			label: "Include custom alt/actual text",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "segmentationMode",
			label: "Content segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	latex: [
		{
			id: "translatableCommands",
			label: "Translatable macro arguments",
			type: "text",
			defaultValue:
				"chapter:1,section:1,subsection:1,subsubsection:1,title:1,author:1,caption:1,footnote:1,textbf:1,textit:1,emph:1,textrm:1,textsf:1,texttt:1,href:2,hyperref:2",
			description:
				"Comma-separated macro:argument-index rules. Unknown macro arguments remain protected.",
		},
		{
			id: "protectedEnvironments",
			label: "Protected environments",
			type: "text",
			defaultValue:
				"verbatim,Verbatim,lstlisting,minted,equation,equation*,align,align*,gather,gather*,multline,multline*,displaymath,math",
		},
		{
			id: "includeComments",
			label: "Include comments",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeMetadata",
			label: "Include title/author/date metadata",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "segmentationMode",
			label: "Prose segmentation",
			type: "select",
			defaultValue: "preferences",
			choices: ["range", "preferences", "sentences"],
		},
	],
	ttml: [
		{
			id: "profile",
			label: "TTML profile",
			type: "select",
			defaultValue: "auto",
			choices: ["auto", "ttml1", "ttml2", "imsc1"],
		},
		{
			id: "includeMetadata",
			label: "Include metadata text",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "overlapPolicy",
			label: "Overlapping cues",
			type: "select",
			defaultValue: "warn",
			choices: ["allow", "warn", "error"],
		},
		{
			id: "maxCharactersPerLine",
			label: "Maximum characters per line",
			type: "number",
			defaultValue: 42,
		},
		{
			id: "maxLinesPerCue",
			label: "Maximum lines per cue",
			type: "number",
			defaultValue: 2,
		},
		{
			id: "maxReadingSpeed",
			label: "Maximum characters per second",
			type: "number",
			defaultValue: 20,
		},
		{
			id: "maxExpansionPercent",
			label: "Maximum target expansion (%)",
			type: "number",
			defaultValue: 50,
		},
		{
			id: "segmentationMode",
			label: "Text segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	mif: [
		{
			id: "translatableTags",
			label: "Translatable MIF string tags",
			type: "text",
			defaultValue: "String,ElementText,XRefSrcText",
		},
		{
			id: "includeMarkers",
			label: "Include marker text",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "includeVariables",
			label: "Include variable definitions",
			type: "boolean",
			defaultValue: false,
		},
		{
			id: "segmentationMode",
			label: "String segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	"windows-rc": [
		{
			id: "translatableDirectives",
			label: "Translatable resource directives",
			type: "text",
			defaultValue:
				"CAPTION,LTEXT,CTEXT,RTEXT,GROUPBOX,PUSHBUTTON,DEFPUSHBUTTON,CHECKBOX,AUTOCHECKBOX,RADIOBUTTON,AUTORADIOBUTTON,CONTROL,MENUITEM,POPUP",
			description:
				"STRINGTABLE values are always included; the listed dialog and menu directives expose only their text operand.",
		},
		{
			id: "includeVersionInfo",
			label: "Include VERSIONINFO values",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includePreprocessor",
			label: "Include string #define values",
			type: "boolean",
			defaultValue: false,
			description:
				"Disabled by default because string macros may be identifiers, paths, or build-time data rather than user-facing text.",
		},
		{
			id: "segmentationMode",
			label: "Resource-value segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	qml: [
		{
			id: "functionSelectors",
			label: "Qt translation functions",
			type: "text",
			defaultValue: "qsTr:1,qsTranslate:2,QT_TR_NOOP:1,QT_TRANSLATE_NOOP:2",
			description:
				"List function:argument pairs. Only a direct, non-interpolated string literal at that one-based argument is editable; qsTrId IDs remain protected.",
		},
		{
			id: "segmentationMode",
			label: "Translation-literal segmentation",
			type: "select",
			defaultValue: "value",
			choices: ["value", "preferences", "sentences"],
		},
	],
	pdf: [
		{
			id: "pages",
			label: "Pages",
			type: "text",
			defaultValue: "all",
			placeholder: "all or e.g. 1-5, 8",
		},
		{
			id: "grouping",
			label: "Text grouping",
			type: "select",
			defaultValue: "lines",
			choices: ["lines", "items"],
			description:
				"Group adjacent PDF text items into visual lines or retain individual positioned items.",
		},
		{
			id: "ocrPolicy",
			label: "Pages requiring OCR",
			type: "select",
			defaultValue: "skip",
			choices: ["skip", "error"],
			description:
				"Skip image-only pages with a recorded warning, or reject the import. Core PDF extraction never runs OCR implicitly.",
		},
	],
	"image-ocr": [
		{
			id: "ocrLanguage",
			label: "OCR language model",
			type: "text",
			defaultValue: "eng",
			placeholder: "eng, deu, fra or e.g. eng+deu",
			description:
				"Tesseract language code(s). Model files are downloaded and cached, while the selected image remains on this device.",
		},
		{
			id: "grouping",
			label: "Text grouping",
			type: "select",
			defaultValue: "paragraphs",
			choices: ["paragraphs", "lines"],
		},
	],
	"media-transcription": [
		{
			id: "model",
			label: "Local Whisper model",
			type: "select",
			defaultValue: "onnx-community/whisper-tiny",
			choices: ["onnx-community/whisper-tiny", "onnx-community/whisper-base"],
			description:
				"The model is downloaded and cached by the browser. Audio samples are processed locally and are not uploaded.",
		},
		{
			id: "language",
			label: "Spoken language",
			type: "text",
			defaultValue: "",
			placeholder: "Auto-detect, or e.g. english / german",
		},
		{
			id: "chunkSeconds",
			label: "Chunk length (seconds)",
			type: "number",
			defaultValue: 30,
		},
	],
	rtf: [
		{
			id: "includeHeadersFooters",
			label: "Headers and footers",
			type: "boolean",
			defaultValue: true,
			description: "Include visible text in header and footer groups.",
		},
	],
	"legacy-bilingual": [
		{
			id: "includeLocked",
			label: "Include locked units",
			type: "boolean",
			defaultValue: true,
			description:
				"Show workflow-locked units for context. Their targets remain protected and cannot be changed during same-family export.",
		},
	],
	"legacy-office": [
		{
			id: "includeNumbers",
			label: "Include numeric spreadsheet cells",
			type: "boolean",
			defaultValue: false,
			description:
				"Normally only text cells in legacy XLS workbooks are translated.",
		},
	],
	"cat-package": [
		{
			id: "memberPaths",
			label: "Bilingual members",
			type: "text",
			defaultValue: "",
			placeholder: "All, or comma-separated package paths/globs",
			description:
				"Leave empty to import every supported XLIFF member, or select exact paths and * / ** wildcard patterns.",
		},
		{
			id: "includeExistingTargets",
			label: "Import existing targets",
			type: "boolean",
			defaultValue: true,
			description:
				"Retain the bilingual targets and workflow state already stored in package XLIFF members.",
		},
	],
	"zip-project": [
		{
			id: "failurePolicy",
			label: "Member failures",
			type: "select",
			defaultValue: "reject-batch",
			choices: ["reject-batch", "skip-optional"],
			description:
				"Reject any failing member, or skip only members explicitly marked required:false while retaining a report.",
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
			description:
				"Include repeated text from page headers and footers in the translation project.",
		},
		{
			id: "includeNotes",
			label: "Footnotes and endnotes",
			type: "boolean",
			defaultValue: true,
			description:
				"Include footnote and endnote text in addition to the main document content.",
		},
		{
			id: "includeComments",
			label: "Comments",
			type: "boolean",
			defaultValue: true,
			description:
				"Include reviewer comments as translatable content. Turn this off when comments are internal guidance only.",
		},
		{
			id: "includeTextBoxes",
			label: "Text boxes",
			type: "boolean",
			defaultValue: true,
			description:
				"Include text placed in Word text boxes, callouts, and similar positioned containers.",
		},
		{
			id: "includeDrawingText",
			label: "Drawing text",
			type: "boolean",
			defaultValue: true,
			description:
				"Include text embedded in drawing objects and diagram shapes when Word stores it separately.",
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
			defaultValue: "placeholder,value,alt,title,text",
			placeholder: "placeholder, value, alt, title, text",
			description:
				"Comma-separated visible labels to import. Dynamic server/template values remain protected even when their attribute name is selected.",
		},
		{
			id: "excludedElements",
			label: "Protected elements",
			type: "text",
			defaultValue: "script,style,code",
			placeholder: "script, style, code",
			description:
				"Comma-separated element names whose content is never extracted. Scripts, styles, server directives, expressions, and executable blocks always remain protected.",
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
