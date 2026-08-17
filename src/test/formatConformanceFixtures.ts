import JSZip from "jszip";
import type { FormatConformanceFixture } from "./formatConformance";
import {
	CONFORMANCE_UNICODE_SOURCE,
	CONFORMANCE_UNICODE_TARGET,
} from "./formatConformance";

const encoder = new TextEncoder();

function textFile(content: string, name: string, type: string): File {
	return new File([content], name, { type });
}

async function zipFile(
	entries: Record<string, string | Uint8Array>,
	name: string,
	type: string,
): Promise<File> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	return new File([await zip.generateAsync({ type: "uint8array" })], name, {
		type,
	});
}

function invalidUtf8(name: string, type: string): File {
	return new File([new Uint8Array([0xc3, 0x28])], name, { type });
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (character) => {
		return {
			"<": "&lt;",
			">": "&gt;",
			"&": "&amp;",
			"'": "&apos;",
			'"': "&quot;",
		}[character]!;
	});
}

function srtTime(totalSeconds: number): string {
	const hours = String(Math.floor(totalSeconds / 3_600)).padStart(2, "0");
	const minutes = String(Math.floor((totalSeconds % 3_600) / 60)).padStart(
		2,
		"0",
	);
	const seconds = String(totalSeconds % 60).padStart(2, "0");
	return `${hours}:${minutes}:${seconds},000`;
}

const textFixture: FormatConformanceFixture = {
	id: "text",
	fileName: "unicode.txt",
	mimeType: "text/plain",
	importOptions: { segmentationMode: "document" },
	createValidFile: async () =>
		textFile(CONFORMANCE_UNICODE_SOURCE, "unicode.txt", "text/plain"),
	createMalformedFile: async () => invalidUtf8("broken.txt", "text/plain"),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			segmentationMode: "document",
			outputEncoding: "source",
			byteOrderMark: "preserve",
			unicodeNormalization: "preserve",
		},
		skeleton: { kind: "text", replacementKinds: ["text-range"] },
		units: [{ id: "unit-1", part: "unicode.txt", path: null }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			Array.from({ length: units }, (_, index) => `Message ${index}`).join(
				"\n",
			),
			"performance.txt",
			"text/plain",
		),
	performanceOptions: { segmentationMode: "lines" },
};

const csvFixture: FormatConformanceFixture = {
	id: "csv",
	fileName: "unicode.csv",
	mimeType: "text/csv",
	importOptions: {
		importMode: "source-column",
		sourceColumn: "Source",
		keyColumn: "Key",
		contextColumn: "Context",
	},
	createValidFile: async () =>
		textFile(
			`Key,Source,Context,Locked\r\nwelcome,${JSON.stringify(CONFORMANCE_UNICODE_SOURCE)},UI,keep\r\n`,
			"unicode.csv",
			"text/csv",
		),
	createMalformedFile: async () =>
		textFile('Key,Source\r\nwelcome,"unterminated', "broken.csv", "text/csv"),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			delimiter: "auto",
			quoteCharacter: "double",
			escapeMode: "double",
			hasHeader: true,
			importMode: "source-column",
			keyColumn: "Key",
			sourceColumn: "Source",
			targetColumn: "C",
			contextColumn: "Context",
			skipEmptyFields: true,
			outputEncoding: "source",
			byteOrderMark: "preserve",
		},
		skeleton: { kind: "text", replacementKinds: ["csv-field"] },
		units: [{ id: "unit-1", part: "unicode.csv", path: [1, 1] }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`Key,Source\r\n${Array.from(
				{ length: units },
				(_, index) => `${index},Message ${index}`,
			).join("\r\n")}`,
			"performance.csv",
			"text/csv",
		),
	performanceOptions: {
		importMode: "source-column",
		sourceColumn: "Source",
	},
};

const jsonFixture: FormatConformanceFixture = {
	id: "json",
	fileName: "unicode.json",
	mimeType: "application/json",
	createValidFile: async () =>
		textFile(
			`{\n  "message": ${JSON.stringify(CONFORMANCE_UNICODE_SOURCE)},\n  "locked": { "skip": true }\n}\n`,
			"unicode.json",
			"application/json",
		),
	createMalformedFile: async () =>
		textFile('{"message":', "broken.json", "application/json"),
	expectMalformedImportFailure: true,
	importOptions: {
		pathSelectors: "message",
		includeNonStringValues: false,
	},
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			profile: "auto",
			pathSelectors: "message",
			includeNonStringValues: false,
			segmentationMode: "value",
			keyField: "",
			contextField: "",
		},
		skeleton: { kind: "text", replacementKinds: ["json-value"] },
		units: [{ id: "unit-1", part: "unicode.json", path: ["message"] }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			JSON.stringify(
				Object.fromEntries(
					Array.from({ length: units }, (_, index) => [
						`message_${index}`,
						`Message ${index}`,
					]),
				),
			),
			"performance.json",
			"application/json",
		),
	performanceOptions: { pathSelectors: "", includeNonStringValues: false },
};

const yamlFixture: FormatConformanceFixture = {
	id: "yaml",
	fileName: "unicode.yaml",
	mimeType: "application/yaml",
	createValidFile: async () =>
		textFile(
			`# translator context\nmessage: ${JSON.stringify(CONFORMANCE_UNICODE_SOURCE)}\nlocked: &same keep\nalias: *same\n`,
			"unicode.yaml",
			"application/yaml",
		),
	createMalformedFile: async () =>
		textFile('message: "unterminated\n', "broken.yaml", "application/yaml"),
	expectMalformedImportFailure: true,
	importOptions: { pathSelectors: "message" },
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			pathSelectors: "message",
			includeNonStringScalars: false,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["yaml-scalar"] },
		units: [{ id: "unit-1", part: "unicode.yaml", path: ["0", "message"] }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			Array.from(
				{ length: units },
				(_, index) => `message_${index}: Message ${index}`,
			).join("\n"),
			"performance.yaml",
			"application/yaml",
		),
};

const poHeader = `msgid ""
msgstr ""
"Project-Id-Version: conformance\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n != 1;\\n"

`;

const poFixture: FormatConformanceFixture = {
	id: "po",
	fileName: "unicode.po",
	mimeType: "text/x-gettext-translation",
	createValidFile: async () =>
		textFile(
			`${poHeader}#. UI message\n#: src/main.c:1\n#, c-format\nmsgid ${JSON.stringify(CONFORMANCE_UNICODE_SOURCE)}\nmsgstr ""\n`,
			"unicode.po",
			"text/x-gettext-translation",
		),
	createMalformedFile: async () =>
		textFile(
			'msgid "Broken"\nmsgstr "unterminated\n',
			"broken.po",
			"text/x-gettext-translation",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeFuzzy: true,
			includeObsolete: false,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["po-string"] },
		units: [{ id: "unit-1", part: "unicode.po", path: ["1", "msgstr"] }],
	},
	identityTargetSegments: [""],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	expectTranslatedTargetSegments: true,
	createPerformanceFile: async (units) =>
		textFile(
			`${poHeader}${Array.from(
				{ length: units },
				(_, index) => `msgid "Message ${index}"\nmsgstr ""\n`,
			).join("\n")}`,
			"performance.po",
			"text/x-gettext-translation",
		),
};

const androidFixture: FormatConformanceFixture = {
	id: "android",
	fileName: "strings.xml",
	mimeType: "application/xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="utf-8"?>\n<resources><!-- Home title --><string name="welcome">${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</string><string name="locked" translatable="false">Keep</string></resources>\n`,
			"strings.xml",
			"application/xml",
		),
	createMalformedFile: async () =>
		textFile(
			'<resources><plurals name="count"><item quantity="one">One</item></plurals></resources>',
			"broken.xml",
			"application/xml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeNonTranslatable: false,
			includeEmpty: false,
		},
		skeleton: { kind: "text", replacementKinds: ["android-value"] },
		units: [
			{
				id: "welcome",
				part: "strings.xml",
				path: ["resources", "string", "welcome", "value"],
			},
		],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<resources>${Array.from(
				{ length: units },
				(_, index) =>
					`<string name="message_${index}">Message ${index}</string>`,
			).join("")}</resources>`,
			"performance.xml",
			"application/xml",
		),
};

const appleFixture: FormatConformanceFixture = {
	id: "apple",
	fileName: "Localizable.strings",
	mimeType: "text/plain",
	createValidFile: async () =>
		textFile(
			`/* Home title */\n"welcome" = ${JSON.stringify(CONFORMANCE_UNICODE_SOURCE)};\n`,
			"Localizable.strings",
			"text/plain",
		),
	createMalformedFile: async () =>
		textFile('"broken" = "unterminated;', "broken.strings", "text/plain"),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			profile: "auto",
			sourceLanguage: "",
			targetLanguage: "",
			includeStale: true,
		},
		skeleton: { kind: "text", replacementKinds: ["apple-value"] },
		units: [
			{
				id: "welcome:",
				part: "Localizable.strings",
				path: ["welcome"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			Array.from(
				{ length: units },
				(_, index) => `"message_${index}" = "Message ${index}";`,
			).join("\n"),
			"performance.strings",
			"text/plain",
		),
};

const propertiesFixture: FormatConformanceFixture = {
	id: "properties",
	fileName: "messages.properties",
	mimeType: "text/x-java-properties",
	createValidFile: async () =>
		textFile(
			`# Home title\nwelcome=${CONFORMANCE_UNICODE_SOURCE}\nlocked.keep=unchanged\n`,
			"messages.properties",
			"text/x-java-properties",
		),
	createMalformedFile: async () =>
		textFile("broken=\\u12G4", "broken.properties", "text/x-java-properties"),
	expectMalformedImportFailure: true,
	importOptions: { includeEmpty: false },
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE, "unchanged"],
		filterOptions: { sourceEncoding: "auto", includeEmpty: false },
		skeleton: {
			kind: "text",
			replacementKinds: ["properties-value", "properties-value"],
		},
		units: [
			{
				id: "welcome",
				part: "messages.properties",
				path: ["welcome"],
			},
			{
				id: "locked.keep",
				part: "messages.properties",
				path: ["locked.keep"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE, "unchanged"],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET, "unchanged"],
	createPerformanceFile: async (units) =>
		textFile(
			Array.from(
				{ length: units },
				(_, index) => `message_${index}=Message ${index}`,
			).join("\n"),
			"performance.properties",
			"text/x-java-properties",
		),
};

const resxFixture: FormatConformanceFixture = {
	id: "resx",
	fileName: "Resources.resx",
	mimeType: "application/xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="utf-8"?>\n<root><resheader name="resmimetype"><value>text/microsoft-resx</value></resheader><data name="welcome" xml:space="preserve"><value>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</value><comment>Home title</comment></data><data name="binary" mimetype="application/x-microsoft.net.object.binary.base64"><value>AAEC</value></data></root>\n`,
			"Resources.resx",
			"application/xml",
		),
	createMalformedFile: async () =>
		textFile(
			"<root><data><value>Missing name</value></data></root>",
			"bad.resx",
			"application/xml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeEmpty: false,
			includeExplicitSystemStrings: true,
		},
		skeleton: { kind: "text", replacementKinds: ["resx-value"] },
		units: [
			{
				id: "welcome",
				part: "Resources.resx",
				path: ["root", "data", "welcome", "value"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<root>${Array.from(
				{ length: units },
				(_, index) =>
					`<data name="message_${index}"><value>Message ${index}</value></data>`,
			).join("")}</root>`,
			"performance.resx",
			"application/xml",
		),
};

const qtTsFixture: FormatConformanceFixture = {
	id: "qt-ts",
	fileName: "catalog.ts",
	mimeType: "application/xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE TS>\n<TS version="2.1" language="de" sourcelanguage="en"><context><name>Main</name><message id="welcome"><location filename="main.cpp" line="7"/><source>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</source><extracomment>Home title</extracomment><translation type="unfinished"></translation></message></context></TS>\n`,
			"catalog.ts",
			"application/xml",
		),
	createMalformedFile: async () =>
		textFile(
			"<TS><context><message></context></TS>",
			"bad.ts",
			"application/xml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeUnfinished: true,
			includeVanished: false,
			includeObsolete: false,
		},
		skeleton: { kind: "text", replacementKinds: ["qt-ts-value"] },
		units: [
			{
				id: "welcome",
				part: "catalog.ts",
				path: ["TS", "Main", "welcome", "translation"],
			},
		],
	},
	identityTargetSegments: [""],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	expectTranslatedTargetSegments: true,
	createPerformanceFile: async (units) =>
		textFile(
			`<TS><context><name>Main</name>${Array.from(
				{ length: units },
				(_, index) =>
					`<message id="message_${index}"><source>Message ${index}</source><translation></translation></message>`,
			).join("")}</context></TS>`,
			"performance.ts",
			"application/xml",
		),
};

const iniFixture: FormatConformanceFixture = {
	id: "ini",
	fileName: "messages.ini",
	mimeType: "text/plain",
	createValidFile: async () =>
		textFile(
			`# Home title\n[ui]\nwelcome=${CONFORMANCE_UNICODE_SOURCE}\nlocked=Keep\n`,
			"messages.ini",
			"text/plain",
		),
	createMalformedFile: async () =>
		textFile("[unterminated\nkey=value", "bad.ini", "text/plain"),
	expectMalformedImportFailure: true,
	importOptions: { profile: "generic", keySelectors: "ui.welcome" },
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			profile: "generic",
			keySelectors: "ui.welcome",
			targetLocale: "",
			includeEmpty: false,
		},
		skeleton: { kind: "text", replacementKinds: ["ini-value"] },
		units: [
			{
				id: "ui:welcome",
				part: "messages.ini",
				path: ["ui", "welcome"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`[messages]\n${Array.from(
				{ length: units },
				(_, index) => `message_${index}=Message ${index}`,
			).join("\n")}`,
			"performance.ini",
			"text/plain",
		),
	performanceOptions: { profile: "generic", keySelectors: "messages.*" },
};

const phpFixture: FormatConformanceFixture = {
	id: "php",
	fileName: "messages.php",
	mimeType: "application/x-httpd-php",
	createValidFile: async () =>
		textFile(
			`<?php\nreturn [\n    // Home title\n    'welcome' => '${CONFORMANCE_UNICODE_SOURCE.replaceAll("'", "\\'")}',\n    'locked' => 'Keep',\n];\n`,
			"messages.php",
			"application/x-httpd-php",
		),
	createMalformedFile: async () =>
		textFile(
			"<?php return ['welcome' => getenv('MESSAGE')];",
			"bad.php",
			"application/x-httpd-php",
		),
	expectMalformedImportFailure: true,
	importOptions: { pathSelectors: "welcome" },
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: { pathSelectors: "welcome", includeEmpty: false },
		skeleton: { kind: "text", replacementKinds: ["php-value"] },
		units: [
			{
				id: "welcome",
				part: "messages.php",
				path: ["welcome"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<?php return [${Array.from(
				{ length: units },
				(_, index) => `'message_${index}' => 'Message ${index}'`,
			).join(",")}];`,
			"performance.php",
			"application/x-httpd-php",
		),
};

const markupFixture: FormatConformanceFixture = {
	id: "markup",
	fileName: "guide.md",
	mimeType: "text/markdown",
	createValidFile: async () =>
		textFile(
			`---\ntitle: protected\n---\n# ${CONFORMANCE_UNICODE_SOURCE}\n\n\`protected()\` [reference](https://example.com)\n`,
			"guide.md",
			"text/markdown",
		),
	createMalformedFile: async () =>
		textFile("```js\nconst unclosed = true;", "bad.md", "text/markdown"),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE, "reference"],
		filterOptions: { profile: "markdown", includeHtmlText: true },
		skeleton: {
			kind: "text",
			replacementKinds: ["markup-text", "markup-text"],
		},
		units: [
			{
				id: "line-4-span-0",
				part: "guide.md",
				path: ["markdown", 4, 0],
			},
			{
				id: "line-6-span-0",
				part: "guide.md",
				path: ["markdown", 6, 0],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE, "reference"],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET, "Referenz"],
	createPerformanceFile: async (units) =>
		textFile(
			Array.from({ length: units }, (_, index) => `Message ${index}`).join(
				"\n",
			),
			"performance.md",
			"text/markdown",
		),
};

const subtitlesFixture: FormatConformanceFixture = {
	id: "subtitles",
	fileName: "captions.srt",
	mimeType: "application/x-subrip",
	createValidFile: async () =>
		textFile(
			`welcome\n00:00:00,000 --> 00:00:05,000\n${CONFORMANCE_UNICODE_SOURCE}\n`,
			"captions.srt",
			"application/x-subrip",
		),
	createMalformedFile: async () =>
		textFile(
			"1\n00:00:05,000 --> 00:00:04,000\nBackwards",
			"bad.srt",
			"application/x-subrip",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			profile: "srt",
			overlapPolicy: "warn",
			maxCharactersPerLine: 42,
			maxLinesPerCue: 2,
			maxReadingSpeed: 20,
			maxExpansionPercent: 50,
		},
		skeleton: { kind: "text", replacementKinds: ["subtitle-cue"] },
		units: [
			{
				id: "welcome",
				part: "captions.srt",
				path: ["srt", "welcome"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			Array.from({ length: units }, (_, index) => {
				const start = index * 10;
				return `${index + 1}\n${srtTime(start)} --> ${srtTime(start + 5)}\nMessage ${index}`;
			}).join("\n\n"),
			"performance.srt",
			"application/x-subrip",
		),
};

const xmlFixture: FormatConformanceFixture = {
	id: "xml",
	fileName: "unicode.xml",
	mimeType: "application/xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="UTF-8"?>\n<catalog xmlns:its="http://www.w3.org/2005/11/its"><message id="welcome">${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</message><locked its:translate="no">Keep</locked><!--preserve--></catalog>\n`,
			"unicode.xml",
			"application/xml",
		),
	createMalformedFile: async () =>
		textFile(
			'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
			"broken.xml",
			"application/xml",
		),
	expectMalformedImportFailure: true,
	importOptions: { elementSelectors: "//message" },
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			elementSelectors: "//message",
			attributeSelectors: "",
			respectIts: true,
			includeCdata: true,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["xml-value"] },
		units: [
			{
				id: "unit-1",
				part: "unicode.xml",
				path: ["catalog[1]", "message[1]", "#text"],
			},
		],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<catalog>${Array.from(
				{ length: units },
				(_, index) => `<message>Message ${index}</message>`,
			).join("")}</catalog>`,
			"performance.xml",
			"application/xml",
		),
	performanceOptions: { elementSelectors: "//message" },
};

const htmlFixture: FormatConformanceFixture = {
	id: "html",
	fileName: "unicode.html",
	mimeType: "text/html",
	createValidFile: async () =>
		textFile(
			`<!doctype html><html><body><p data-locked="yes">${CONFORMANCE_UNICODE_SOURCE}</p></body></html>`,
			"unicode.html",
			"text/html",
		),
	createMalformedFile: async () => textFile("", "broken.html", "text/html"),
	expectMalformedImportFailure: false,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeTextNodes: true,
			translatableAttributes: "placeholder,value,alt,title",
			excludedElements: "script,style,code",
			respectTranslateMetadata: true,
		},
		skeleton: { kind: "text", replacementKinds: ["html-text"] },
		units: [{ id: "unit-1", part: "unicode.html", path: [0, 0] }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<!doctype html><html><body>${Array.from(
				{ length: units },
				(_, index) => `<p>Message ${index}</p>`,
			).join("")}</body></html>`,
			"performance.html",
			"text/html",
		),
};

const docxMime =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const docxFixture: FormatConformanceFixture = {
	id: "docx",
	fileName: "unicode.docx",
	mimeType: docxMime,
	createValidFile: async () =>
		zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"word/document.xml": `<w:document xmlns:w="w" xmlns:vendor="urn:test"><w:body><vendor:keep/><w:p><w:r><w:t>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</w:t></w:r></w:p></w:body></w:document>`,
				"custom/keep.bin": encoder.encode("untouched DOCX data"),
			},
			"unicode.docx",
			docxMime,
		),
	createMalformedFile: async () =>
		textFile("not a zip", "broken.docx", docxMime),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			paragraphs: "",
			trackedChanges: "current",
			includeHeadersFooters: true,
			includeNotes: true,
			includeComments: true,
			includeTextBoxes: true,
			includeDrawingText: true,
		},
		skeleton: { kind: "package", replacementKinds: ["docx-text"] },
		units: [{ id: "unit-1", part: "word/document.xml", path: null }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		zipFile(
			{
				"word/document.xml": `<w:document xmlns:w="w"><w:body>${Array.from(
					{ length: units },
					(_, index) => `<w:p><w:r><w:t>Message ${index}</w:t></w:r></w:p>`,
				).join("")}</w:body></w:document>`,
			},
			"performance.docx",
			docxMime,
		),
	expectedPackageChanges: ["word/document.xml"],
};

const xlsxMime =
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xlsxFixture: FormatConformanceFixture = {
	id: "xlsx",
	fileName: "unicode.xlsx",
	mimeType: xlsxMime,
	createValidFile: async () =>
		zipFile(
			{
				"[Content_Types].xml": "<Types/>",
				"xl/workbook.xml": '<workbook xmlns="urn:test"/>',
				"xl/sharedStrings.xml": `<sst xmlns="urn:test"><si><t>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</t></si></sst>`,
				"custom/keep.bin": encoder.encode("untouched XLSX data"),
			},
			"unicode.xlsx",
			xlsxMime,
		),
	createMalformedFile: async () =>
		textFile("not a zip", "broken.xlsx", xlsxMime),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			importMode: "all-text",
			worksheetPaths: "",
			columns: "",
			rows: "",
			includeHiddenSheets: true,
			keyColumn: "A",
			sourceColumn: "B",
			targetColumn: "C",
			headerRows: 1,
			includeCellComments: true,
			includeSharedStrings: true,
			includeCellValues: false,
		},
		skeleton: { kind: "package", replacementKinds: ["xlsx-text"] },
		units: [{ id: "unit-1", part: "xl/sharedStrings.xml", path: null }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		zipFile(
			{
				"xl/workbook.xml": '<workbook xmlns="urn:test"/>',
				"xl/sharedStrings.xml": `<sst xmlns="urn:test">${Array.from(
					{ length: units },
					(_, index) => `<si><t>Message ${index}</t></si>`,
				).join("")}</sst>`,
			},
			"performance.xlsx",
			xlsxMime,
		),
	expectedPackageChanges: ["xl/sharedStrings.xml"],
};

const pptxMime =
	"application/vnd.openxmlformats-officedocument.presentationml.presentation";
const pptxFixture: FormatConformanceFixture = {
	id: "pptx",
	fileName: "unicode.pptx",
	mimeType: pptxMime,
	createValidFile: async () =>
		zipFile(
			{
				"[Content_Types].xml":
					'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
				"ppt/presentation.xml":
					'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId7"/></p:sldIdLst></p:presentation>',
				"ppt/_rels/presentation.xml.rels":
					'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide9.xml"/></Relationships>',
				"ppt/slides/slide9.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
				"custom/keep.bin": encoder.encode("untouched PPTX data"),
			},
			"unicode.pptx",
			pptxMime,
		),
	createMalformedFile: async () =>
		textFile("not a zip", "broken.pptx", pptxMime),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			slides: "",
			includeNotes: true,
			includeComments: true,
			includeAltText: true,
			includeChartText: true,
			includeSmartArtText: true,
			includeMastersLayouts: false,
		},
		skeleton: { kind: "package", replacementKinds: ["pptx-text"] },
		units: [{ id: "unit-1", part: "ppt/slides/slide9.xml", path: null }],
	},
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		zipFile(
			{
				"ppt/presentation.xml":
					'<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>',
				"ppt/_rels/presentation.xml.rels":
					'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/></Relationships>',
				"ppt/slides/slide1.xml": `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${Array.from(
					{ length: units },
					(_, index) =>
						`<p:sp><p:txBody><a:p><a:r><a:t>Message ${index}</a:t></a:r></a:p></p:txBody></p:sp>`,
				).join("")}</p:spTree></p:cSld></p:sld>`,
			},
			"performance.pptx",
			pptxMime,
		),
	expectedPackageChanges: ["ppt/slides/slide9.xml"],
};

export const FORMAT_CONFORMANCE_FIXTURES = [
	textFixture,
	csvFixture,
	jsonFixture,
	yamlFixture,
	poFixture,
	androidFixture,
	appleFixture,
	propertiesFixture,
	resxFixture,
	qtTsFixture,
	iniFixture,
	phpFixture,
	markupFixture,
	subtitlesFixture,
	xmlFixture,
	docxFixture,
	xlsxFixture,
	pptxFixture,
	htmlFixture,
] as const satisfies readonly FormatConformanceFixture[];
