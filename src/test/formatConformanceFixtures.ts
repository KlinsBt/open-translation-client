import JSZip from "jszip";
import type { FormatConformanceFixture } from "./formatConformance";
import {
	CONFORMANCE_UNICODE_SOURCE,
	CONFORMANCE_UNICODE_TARGET,
} from "./formatConformance";
import { createSyntheticPdf } from "./pdfFixtures";

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

async function odfPackageFile(
	content: string,
	name = "document.odt",
): Promise<File> {
	const mimeType = "application/vnd.oasis.opendocument.text";
	const zip = new JSZip();
	zip.file("mimetype", mimeType, { compression: "STORE" });
	zip.file("content.xml", content);
	zip.file(
		"META-INF/manifest.xml",
		`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimeType}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
	);
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		name,
		{ type: mimeType },
	);
}

async function epubPackageFile(content: string): Promise<File> {
	const zip = new JSZip();
	zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
	zip.file(
		"META-INF/container.xml",
		'<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
	);
	zip.file(
		"EPUB/package.opf",
		'<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="id"><metadata><dc:identifier id="id">urn:test</dc:identifier><dc:language>en</dc:language><dc:title>Protected metadata</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="chapter"/></spine></package>',
	);
	zip.file("EPUB/chapter.xhtml", content);
	zip.file(
		"EPUB/nav.xhtml",
		'<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><nav><a href="chapter.xhtml">Protected nav</a></nav></body></html>',
	);
	zip.file("EPUB/style.css", "body{color:black}");
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		"book.epub",
		{ type: "application/epub+zip" },
	);
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

const odfFixture: FormatConformanceFixture = {
	id: "odf",
	fileName: "document.odt",
	mimeType: "application/vnd.oasis.opendocument.text",
	createValidFile: async () =>
		odfPackageFile(
			`<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:text><text:p>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</text:p></office:text></office:body></office:document-content>`,
		),
	createMalformedFile: async () =>
		odfPackageFile("<office:document-content>broken"),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			trackedChanges: "final",
			includeNotes: true,
			includeComments: false,
			includeHeadersFooters: true,
			includeAccessibilityText: true,
		},
		skeleton: { kind: "package", replacementKinds: ["package-xml-value"] },
		units: [
			{
				id: "content.xml:office:document-content[1]/office:body[1]/office:text[1]/text:p[1]/#text:0",
				part: "content.xml",
				path: [
					"office:document-content[1]",
					"office:body[1]",
					"office:text[1]",
					"text:p[1]",
					"#text",
				],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		odfPackageFile(
			`<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:text>${Array.from(
				{ length: units },
				(_, index) => `<text:p>Message ${index}</text:p>`,
			).join("")}</office:text></office:body></office:document-content>`,
		),
	expectedPackageChanges: ["content.xml"],
};

const epubFixture: FormatConformanceFixture = {
	id: "epub",
	fileName: "book.epub",
	mimeType: "application/epub+zip",
	importOptions: {
		includeMetadata: false,
		includeNavigation: false,
		includeSvgText: false,
	},
	createValidFile: async () =>
		epubPackageFile(
			`<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Protected</title></head><body><p>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</p></body></html>`,
		),
	createMalformedFile: async () =>
		epubPackageFile(
			'<!DOCTYPE html [<!ENTITY x SYSTEM "file:///etc/passwd">]><html xmlns="http://www.w3.org/1999/xhtml"><body><p>&x;</p></body></html>',
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			contentScope: "spine",
			includeNavigation: false,
			includeMetadata: false,
			includeSvgText: false,
			includeAccessibilityText: true,
		},
		skeleton: { kind: "package", replacementKinds: ["package-xml-value"] },
		units: [
			{
				id: "EPUB/chapter.xhtml:html[1]/body[1]/p[1]/#text:0",
				part: "EPUB/chapter.xhtml",
				path: ["html[1]", "body[1]", "p[1]", "#text"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		epubPackageFile(
			`<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body>${Array.from(
				{ length: units },
				(_, index) => `<p>Message ${index}</p>`,
			).join("")}</body></html>`,
		),
	performanceOptions: {
		includeMetadata: false,
		includeNavigation: false,
		includeSvgText: false,
	},
	expectedPackageChanges: ["EPUB/chapter.xhtml"],
};

const svgFixture: FormatConformanceFixture = {
	id: "svg",
	fileName: "diagram.svg",
	mimeType: "image/svg+xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 80"><path id="frame" d="M0 0h320v80H0z"/><text id="welcome" x="12" y="42">${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</text><script>preserve()</script></svg>\n`,
			"diagram.svg",
			"image/svg+xml",
		),
	createMalformedFile: async () =>
		textFile(
			'<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><text>&x;</text></svg>',
			"broken.svg",
			"image/svg+xml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			elementSelectors: "text,tspan,textPath,title,desc",
			attributeSelectors: "aria-label,aria-description,title",
			includeHiddenText: false,
			includeMetadata: false,
			respectTranslateMetadata: true,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["xml-value"] },
		units: [
			{
				id: "unit-1",
				part: "diagram.svg",
				path: ["svg[1]", "text[1]", "#text"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<svg xmlns="http://www.w3.org/2000/svg">${Array.from(
				{ length: units },
				(_, index) => `<text x="0" y="${index}">Message ${index}</text>`,
			).join("")}</svg>`,
			"performance.svg",
			"image/svg+xml",
		),
};

const ditaFixture: FormatConformanceFixture = {
	id: "dita",
	fileName: "topic.dita",
	mimeType: "application/dita+xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="UTF-8"?>\n<topic id="welcome"><title>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</title><body><p translate="no">Protected</p></body></topic>\n`,
			"topic.dita",
			"application/dita+xml",
		),
	createMalformedFile: async () =>
		textFile(
			'<!DOCTYPE topic [<!ENTITY x SYSTEM "file:///etc/passwd">]><topic id="bad"><title>&x;</title></topic>',
			"broken.dita",
			"application/dita+xml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			contentScope: "map",
			includeNavigation: true,
			includeMetadata: false,
			includeCode: false,
			attributeSelectors: "alt,title,navtitle",
			respectTranslateMetadata: true,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["xml-value"] },
		units: [
			{
				id: "topic.dita:topic[1]/title[1]/#text:0",
				part: "topic.dita",
				path: ["topic[1]", "title[1]", "#text"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<topic id="performance"><body>${Array.from(
				{ length: units },
				(_, index) => `<p id="p${index}">Message ${index}</p>`,
			).join("")}</body></topic>`,
			"performance.dita",
			"application/dita+xml",
		),
};

const docBookFixture: FormatConformanceFixture = {
	id: "docbook",
	fileName: "manual.dbk",
	mimeType: "application/docbook+xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="UTF-8"?>\n<article xmlns="http://docbook.org/ns/docbook" version="5.2" xml:id="manual"><title>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</title><para translate="no">Protected</para></article>\n`,
			"manual.dbk",
			"application/docbook+xml",
		),
	createMalformedFile: async () =>
		textFile(
			'<!DOCTYPE book [<!ENTITY x SYSTEM "file:///etc/passwd">]><book><title>&x;</title></book>',
			"broken.dbk",
			"application/docbook+xml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeMetadata: true,
			includeCode: false,
			includeIndexTerms: false,
			attributeSelectors: "alt,title",
			respectTranslateMetadata: true,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["xml-value"] },
		units: [
			{
				id: "unit-1",
				part: "manual.dbk",
				path: ["article[1]", "title[1]", "#text"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<article xmlns="http://docbook.org/ns/docbook" version="5.2" xml:id="performance">${Array.from(
				{ length: units },
				(_, index) => `<para xml:id="p${index}">Message ${index}</para>`,
			).join("")}</article>`,
			"performance.dbk",
			"application/docbook+xml",
		),
};

const idmlFixture: FormatConformanceFixture = {
	id: "idml",
	fileName: "story.icml",
	mimeType: "application/vnd.adobe.incopy-icml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="UTF-8"?>\n<Document DOMVersion="18.0"><Story Self="welcome"><ParagraphStyleRange AppliedParagraphStyle="ParagraphStyle/Body"><CharacterStyleRange><Content>${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</Content></CharacterStyleRange></ParagraphStyleRange></Story></Document>\n`,
			"story.icml",
			"application/vnd.adobe.incopy-icml",
		),
	createMalformedFile: async () =>
		textFile(
			'<!DOCTYPE Document [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document><Story><Content>&x;</Content></Story></Document>',
			"broken.icml",
			"application/vnd.adobe.incopy-icml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			includeNotes: true,
			includeHiddenText: false,
			includeAccessibilityText: true,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["xml-value"] },
		units: [
			{
				id: "story.icml:Document[1]/Story[1]/ParagraphStyleRange[1]/CharacterStyleRange[1]/Content[1]/#text:0",
				part: "story.icml",
				path: [
					"Document[1]",
					"Story[1]",
					"ParagraphStyleRange[1]",
					"CharacterStyleRange[1]",
					"Content[1]",
					"#text",
				],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<Document><Story Self="performance">${Array.from(
				{ length: units },
				(_, index) =>
					`<ParagraphStyleRange><Content>Message ${index}</Content></ParagraphStyleRange>`,
			).join("")}</Story></Document>`,
			"performance.icml",
			"application/vnd.adobe.incopy-icml",
		),
};

const latexFixture: FormatConformanceFixture = {
	id: "latex",
	fileName: "manual.tex",
	mimeType: "application/x-tex",
	createValidFile: async () =>
		textFile(
			`\\documentclass{article}\n\\begin{document}\n${CONFORMANCE_UNICODE_SOURCE}\n\\end{document}\n`,
			"manual.tex",
			"application/x-tex",
		),
	createMalformedFile: async () =>
		textFile(
			"\\begin{document}Broken { text",
			"broken.tex",
			"application/x-tex",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			translatableCommands:
				"chapter:1,section:1,subsection:1,subsubsection:1,title:1,author:1,caption:1,footnote:1,textbf:1,textit:1,emph:1,textrm:1,textsf:1,texttt:1,href:2,hyperref:2",
			protectedEnvironments:
				"verbatim,Verbatim,lstlisting,minted,equation,equation*,align,align*,gather,gather*,multline,multline*,displaymath,math",
			includeComments: false,
			includeMetadata: true,
			segmentationMode: "preferences",
		},
		skeleton: { kind: "text", replacementKinds: ["text-range"] },
		units: [
			{
				id: "unit-1",
				part: "manual.tex",
				path: ["latex", "range[1]"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`\\begin{document}\n${Array.from(
				{ length: units },
				(_, index) => `Message ${index}.`,
			).join("\n\n")}\n\\end{document}\n`,
			"performance.tex",
			"application/x-tex",
		),
	performanceOptions: { segmentationMode: "sentences" },
};

const ttmlFixture: FormatConformanceFixture = {
	id: "ttml",
	fileName: "captions.ttml",
	mimeType: "application/ttml+xml",
	createValidFile: async () =>
		textFile(
			`<?xml version="1.0" encoding="UTF-8"?>\n<tt xmlns="http://www.w3.org/ns/ttml" xml:lang="en"><body><div><p xml:id="welcome" begin="0s" end="10s">${escapeXml(CONFORMANCE_UNICODE_SOURCE)}</p></div></body></tt>\n`,
			"captions.ttml",
			"application/ttml+xml",
		),
	createMalformedFile: async () =>
		textFile(
			'<!DOCTYPE tt [<!ENTITY x SYSTEM "file:///etc/passwd">]><tt xmlns="http://www.w3.org/ns/ttml"><body><p begin="0s" end="1s">&x;</p></body></tt>',
			"broken.ttml",
			"application/ttml+xml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			profile: "ttml1",
			includeMetadata: false,
			overlapPolicy: "warn",
			maxCharactersPerLine: 42,
			maxLinesPerCue: 2,
			maxReadingSpeed: 20,
			maxExpansionPercent: 50,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["ttml-value"] },
		units: [
			{
				id: "cue-1-1",
				part: "captions.ttml",
				path: ["tt[1]", "body[1]", "div[1]", "p[1]", "#text"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<tt xmlns="http://www.w3.org/ns/ttml"><body><div>${Array.from(
				{ length: units },
				(_, index) => `<p begin="${index * 5}s" dur="5s">Message ${index}</p>`,
			).join("")}</div></body></tt>`,
			"performance.ttml",
			"application/ttml+xml",
		),
};

const mifFixture: FormatConformanceFixture = {
	id: "mif",
	fileName: "manual.mif",
	mimeType: "application/vnd.mif",
	createValidFile: async () =>
		textFile(
			`<MIFFile 2020>\n<Para <ParaLine <String \`${CONFORMANCE_UNICODE_SOURCE}'> > >\n`,
			"manual.mif",
			"application/vnd.mif",
		),
	createMalformedFile: async () =>
		textFile(
			"<MIFFile 2020>\n<Para <String `broken'>",
			"broken.mif",
			"application/vnd.mif",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			translatableTags: "String,ElementText,XRefSrcText",
			includeMarkers: false,
			includeVariables: false,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["text-range"] },
		units: [
			{
				id: "unit-1",
				part: "manual.mif",
				path: ["Para[1]", "ParaLine[1]", "String[1]", "#string"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`<MIFFile 2020>\n${Array.from(
				{ length: units },
				(_, index) => `<Para <ParaLine <String \`Message ${index}'> > >`,
			).join("\n")}`,
			"performance.mif",
			"application/vnd.mif",
		),
};

const windowsRcFixture: FormatConformanceFixture = {
	id: "windows-rc",
	fileName: "resources.rc",
	mimeType: "text/x-windows-rc",
	createValidFile: async () =>
		textFile(
			`STRINGTABLE\nBEGIN\n IDS_UNICODE "${CONFORMANCE_UNICODE_SOURCE}"\nEND\n`,
			"resources.rc",
			"text/x-windows-rc",
		),
	createMalformedFile: async () =>
		textFile(
			'STRINGTABLE\nBEGIN\n IDS_BROKEN "unterminated',
			"broken.rc",
			"text/x-windows-rc",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			translatableDirectives:
				"CAPTION,LTEXT,CTEXT,RTEXT,GROUPBOX,PUSHBUTTON,DEFPUSHBUTTON,CHECKBOX,AUTOCHECKBOX,RADIOBUTTON,AUTORADIOBUTTON,CONTROL,MENUITEM,POPUP",
			includeVersionInfo: true,
			includePreprocessor: false,
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["text-range"] },
		units: [
			{
				id: "unit-1",
				part: "resources.rc",
				path: ["line[3]", "STRINGTABLE"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`STRINGTABLE\nBEGIN\n${Array.from(
				{ length: units },
				(_, index) => ` IDS_${index} "Message ${index}"`,
			).join("\n")}\nEND\n`,
			"performance.rc",
			"text/x-windows-rc",
		),
};

const qmlFixture: FormatConformanceFixture = {
	id: "qml",
	fileName: "Main.qml",
	mimeType: "text/x-qml",
	createValidFile: async () =>
		textFile(
			`import QtQml\nQtObject {\n property string message: qsTr("${CONFORMANCE_UNICODE_SOURCE}")\n}\n`,
			"Main.qml",
			"text/x-qml",
		),
	createMalformedFile: async () =>
		textFile(
			'import QtQml\nQtObject { property string message: qsTr("broken) }',
			"Broken.qml",
			"text/x-qml",
		),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: [CONFORMANCE_UNICODE_SOURCE],
		filterOptions: {
			functionSelectors:
				"qsTr:1,qsTranslate:2,QT_TR_NOOP:1,QT_TRANSLATE_NOOP:2",
			segmentationMode: "value",
		},
		skeleton: { kind: "text", replacementKinds: ["text-range"] },
		units: [
			{
				id: "unit-1",
				part: "Main.qml",
				path: ["qsTr", "line[3]"],
			},
		],
	},
	identityTargetSegments: [CONFORMANCE_UNICODE_SOURCE],
	translatedSegments: [CONFORMANCE_UNICODE_TARGET],
	createPerformanceFile: async (units) =>
		textFile(
			`import QtQml\nQtObject {\n${Array.from(
				{ length: units },
				(_, index) =>
					` property string message${index}: qsTr("Message ${index}")`,
			).join("\n")}\n}\n`,
			"Performance.qml",
			"text/x-qml",
		),
};

const pdfFixture: FormatConformanceFixture = {
	id: "pdf",
	fileName: "source.pdf",
	mimeType: "application/pdf",
	createValidFile: async () =>
		createSyntheticPdf([{ lines: ["Café e\u0301 — 𐍈.", "مرحبا", "👩🏽💻"] }]),
	createMalformedFile: async () =>
		new File(["%PDF-1.7\nmalformed"], "broken.pdf", {
			type: "application/pdf",
		}),
	expectMalformedImportFailure: true,
	extractionSnapshot: {
		segments: ["Café e\u0301 — 𐍈.", "مرحبا", "👩🏽💻"],
		filterOptions: {
			pages: "all",
			grouping: "lines",
			ocrPolicy: "skip",
		},
		skeleton: { kind: "package", replacementKinds: [] },
		units: [
			{ id: "unit-1", part: "page-1", path: null },
			{ id: "unit-2", part: "page-1", path: null },
			{ id: "unit-3", part: "page-1", path: null },
		],
	},
	translatedSegments: [
		"Übersetzter Text.",
		"Arabische Übersetzung",
		"Emoji-Übersetzung",
	],
	unicodeExpectations: ["Café e\u0301 — 𐍈.", "مرحبا", "👩🏽💻"],
	derivedOutput: {
		mimeType: "text/html;charset=utf-8",
		downloadSuffix: ".bilingual.html",
		translatedMarkers: [
			"Übersetzter Text.",
			"Arabische Übersetzung",
			"Emoji-Übersetzung",
		],
	},
	createPerformanceFile: async (units) =>
		createSyntheticPdf(
			Array.from({ length: Math.ceil(units / 25) }, (_, page) => ({
				lines: Array.from(
					{ length: Math.min(25, units - page * 25) },
					(_, index) => `Message ${page * 25 + index}`,
				),
			})),
			"performance.pdf",
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
	odfFixture,
	epubFixture,
	svgFixture,
	ditaFixture,
	docBookFixture,
	idmlFixture,
	latexFixture,
	ttmlFixture,
	mifFixture,
	windowsRcFixture,
	qmlFixture,
	pdfFixture,
	xmlFixture,
	docxFixture,
	xlsxFixture,
	pptxFixture,
	htmlFixture,
] as const satisfies readonly FormatConformanceFixture[];
