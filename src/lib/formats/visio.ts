import JSZip from "jszip";
import { createNeutralDocument } from "./documentModel";
import { getFileExtension } from "./detect";
import { normalizeImportOptions } from "./options";
import { assertProjectExportQuality } from "./qualityAssurance";
import {
	readSafeFileBytes,
	readSafeTextFile,
	readSafeZipPackage,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
	type SafeZipPackage,
} from "./safeInput";
import {
	createPackageSkeleton,
	createTextSkeleton,
	getPackageSkeleton,
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type PackageXmlValueReplacement,
	type XmlValueReplacement,
} from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import {
	parseXmlSyntax,
	type XmlElementLocation,
	type XmlSyntaxDocument,
} from "./xmlFamily";
import type { TypeRef, UserData } from "$lib/types/types";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";

export const VISIO_EXTENSIONS = [
	"vsd",
	"vdx",
	"vsx",
	"vtx",
	"vdw",
	"vsr",
	"vss",
	"vsdx",
	"vsdm",
	"vssx",
	"vssm",
	"vstx",
	"vstm",
] as const;

export type VisioExtension = (typeof VISIO_EXTENSIONS)[number];
type VisioProfile = "opc" | "xml" | "binary" | "report";

export const VISIO_MIME_TYPES = [
	"application/vnd.visio",
	"application/vnd.ms-visio.drawing",
	"application/vnd.ms-visio.drawing.macroenabled.12",
	"application/vnd.ms-visio.stencil",
	"application/vnd.ms-visio.stencil.macroenabled.12",
	"application/vnd.ms-visio.template",
	"application/vnd.ms-visio.template.macroenabled.12",
	"application/xml",
	"text/xml",
] as const;

const OPC_EXTENSIONS = new Set<VisioExtension>([
	"vsdx",
	"vsdm",
	"vssx",
	"vssm",
	"vstx",
	"vstm",
]);
const XML_EXTENSIONS = new Set<VisioExtension>(["vdx", "vsx", "vtx"]);
const BINARY_EXTENSIONS = new Set<VisioExtension>(["vsd", "vss", "vdw", "vsr"]);
const VISIO_XML_NAMESPACES = new Set([
	"urn:schemas-microsoft-com:office:visio",
	"http://schemas.microsoft.com/office/visio/2011/1/core",
	"http://schemas.microsoft.com/office/visio/2012/main",
]);
const METADATA_ELEMENTS = new Set([
	"title",
	"subject",
	"description",
	"keywords",
	"category",
	"desc",
]);
const SHAPE_DATA_CELLS = new Set(["label", "prompt", "value", "name"]);

interface VisioXmlPart {
	part: string;
	content: string;
	syntax: XmlSyntaxDocument;
}

interface VisioSource {
	profile: VisioProfile;
	extension: VisioExtension;
	parts: Record<string, string | Blob>;
	xmlParts: VisioXmlPart[];
	archive?: SafeZipPackage;
	textSource?: Awaited<ReturnType<typeof readSafeTextFile>>;
	binaryBytes?: Uint8Array;
	binarySegments?: Array<{ stream: string; text: string }>;
}

type VisioReplacement = PackageXmlValueReplacement | XmlValueReplacement;

function invalidVisio(message: string): SafeInputError {
	return new SafeInputError("VISIO_INVALID", message);
}

function opcExtensionFromContentTypes(contentTypes: string): VisioExtension {
	const content = contentTypes.toLowerCase();
	for (const [needle, extension] of [
		["drawing.macroenabled.main+xml", "vsdm"],
		["drawing.main+xml", "vsdx"],
		["stencil.macroenabled.main+xml", "vssm"],
		["stencil.main+xml", "vssx"],
		["template.macroenabled.main+xml", "vstm"],
		["template.main+xml", "vstx"],
	] as const)
		if (content.includes(needle)) return extension;
	throw invalidVisio(
		"The OPC package does not declare a supported Visio drawing, stencil, or template main content type.",
	);
}

function attribute(
	element: XmlElementLocation | undefined,
	name: string,
): string | undefined {
	return element?.attributes.find(
		(entry) => entry.localName.toLowerCase() === name.toLowerCase(),
	)?.value;
}

function parentOf(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation | undefined {
	return element.parentId === undefined
		? undefined
		: syntax.elements[element.parentId];
}

function ancestorsOf(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation[] {
	const result: XmlElementLocation[] = [];
	let current: XmlElementLocation | undefined = element;
	while (current) {
		result.push(current);
		current = parentOf(current, syntax);
	}
	return result;
}

function parseVisioXml(
	part: string,
	content: string,
	rootNames?: readonly string[],
): VisioXmlPart {
	const syntax = parseXmlSyntax(content);
	const root = syntax.elements[0];
	if (!root) throw invalidVisio(`${part} has no XML document element.`);
	if (rootNames && !rootNames.includes(root.localName))
		throw invalidVisio(
			`${part} has ${root.localName} as its root instead of ${rootNames.join(" or ")}.`,
		);
	if (
		root.localName !== "ReportDefinition" &&
		root.localName !== "VisioReportDefinition" &&
		!part.startsWith("docProps/") &&
		(!root.namespaceUri || !VISIO_XML_NAMESPACES.has(root.namespaceUri))
	)
		throw invalidVisio(
			`${part} does not declare a recognized Microsoft Visio XML namespace.`,
		);
	return { part, content, syntax };
}

function expectedMainContentType(extension: VisioExtension): string {
	const family = extension.startsWith("vss")
		? "stencil"
		: extension.startsWith("vst")
			? "template"
			: "drawing";
	const macro = extension.endsWith("m") ? ".macroEnabled" : "";
	return `application/vnd.ms-visio.${family}${macro}.main+xml`.toLowerCase();
}

function validateOpcContainer(
	archive: SafeZipPackage,
	extension: VisioExtension,
): VisioXmlPart[] {
	const contentTypes = archive.parts["[Content_Types].xml"];
	const rootRelationships = archive.parts["_rels/.rels"];
	const document = archive.parts["visio/document.xml"];
	if (
		typeof contentTypes !== "string" ||
		typeof rootRelationships !== "string" ||
		typeof document !== "string"
	)
		throw invalidVisio(
			"A Visio OPC package requires [Content_Types].xml, _rels/.rels, and visio/document.xml.",
		);
	parseXmlSyntax(contentTypes);
	parseXmlSyntax(rootRelationships);
	const expected = expectedMainContentType(extension);
	if (!contentTypes.toLowerCase().includes(expected))
		throw invalidVisio(
			`The package main content type does not match the .${extension} Visio family (${expected}).`,
		);
	if (
		!/<(?:[\w.-]+:)?Relationship\b(?=[^>]*\bType=["'][^"']*\/relationships\/document["'])(?=[^>]*\bTarget=["']\/?visio\/document\.xml["'])/i.test(
			rootRelationships,
		)
	)
		throw invalidVisio(
			"The package root does not relate to visio/document.xml as a Visio document.",
		);
	const parts: VisioXmlPart[] = [
		parseVisioXml("visio/document.xml", document, ["VisioDocument"]),
	];
	for (const [part, value] of Object.entries(archive.parts)) {
		if (
			part === "visio/document.xml" ||
			typeof value !== "string" ||
			!isLocalizablePackagePart(part)
		)
			continue;
		parts.push(parseVisioXml(part, value));
	}
	return parts.sort((first, second) => partOrder(first.part, second.part));
}

function isLocalizablePackagePart(part: string): boolean {
	return (
		/^visio\/(?:pages\/pages|pages\/page\d+|masters\/masters|masters\/master\d+)\.xml$/i.test(
			part,
		) ||
		part === "docProps/core.xml" ||
		part === "docProps/custom.xml"
	);
}

function partRank(part: string): number {
	if (part === "docProps/core.xml") return 0;
	if (part === "docProps/custom.xml") return 1;
	if (part === "visio/document.xml") return 5;
	if (part === "visio/pages/pages.xml") return 10;
	const page = part.match(/^visio\/pages\/page(\d+)\.xml$/i);
	if (page) return 20 + Number(page[1]);
	if (part === "visio/masters/masters.xml") return 10_000;
	const master = part.match(/^visio\/masters\/master(\d+)\.xml$/i);
	if (master) return 10_010 + Number(master[1]);
	return 20_000;
}

function partOrder(first: string, second: string): number {
	return partRank(first) - partRank(second) || first.localeCompare(second);
}

async function readOpcSource(
	file: File,
	requestedExtension: VisioExtension | undefined,
	context?: SafeInputContext,
): Promise<VisioSource> {
	const archive = await readSafeZipPackage(file, context);
	const contentTypes = archive.parts["[Content_Types].xml"];
	if (typeof contentTypes !== "string")
		throw invalidVisio("The OPC package has no readable [Content_Types].xml.");
	const extension = opcExtensionFromContentTypes(contentTypes);
	if (requestedExtension && requestedExtension !== extension)
		throw invalidVisio(
			`The .${requestedExtension} extension conflicts with the ${extension.toUpperCase()} package content type.`,
		);
	return {
		profile: "opc",
		extension,
		parts: archive.parts,
		xmlParts: validateOpcContainer(archive, extension),
		archive,
	};
}

async function readXmlSource(
	file: File,
	extension: VisioExtension,
	context?: SafeInputContext,
): Promise<VisioSource> {
	const textSource = await readSafeTextFile(file, context);
	const content = textSource.text.startsWith("\ufeff")
		? textSource.text.slice(1)
		: textSource.text;
	const report = extension === "vsr";
	const part = parseVisioXml(
		file.name,
		content,
		report ? ["ReportDefinition", "VisioReportDefinition"] : ["VisioDocument"],
	);
	return {
		profile: report ? "report" : "xml",
		extension,
		parts: { [file.name]: content },
		xmlParts: [part],
		textSource,
	};
}

function hasOleSignature(bytes: Uint8Array): boolean {
	return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
		(value, index) => bytes[index] === value,
	);
}

function bytesOf(value: unknown): Uint8Array {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return new Uint8Array();
}

function isHumanText(value: string): boolean {
	const text = value.replace(/\s+/g, " ").trim();
	return (
		text.length >= 3 &&
		text.length <= 20_000 &&
		/[\p{L}\p{N}]/u.test(text) &&
		!/^(?:=|https?:|file:|[A-Z][A-Za-z]+\.[A-Za-z]+\()/i.test(text) &&
		!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)
	);
}

function extractUtf16Strings(bytes: Uint8Array): string[] {
	const output: string[] = [];
	for (const parity of [0]) {
		let start = parity;
		for (let cursor = parity; cursor + 1 <= bytes.length; cursor += 2) {
			const code = bytes[cursor] | ((bytes[cursor + 1] ?? 0) << 8);
			const printable =
				code === 9 ||
				code === 10 ||
				code === 13 ||
				(code >= 0x20 && code !== 0xffff);
			if (printable && code !== 0) continue;
			if (cursor > start) {
				const value = new TextDecoder("utf-16le").decode(
					bytes.subarray(start, cursor),
				);
				if (isHumanText(value)) output.push(value.replace(/\s+/g, " ").trim());
			}
			start = cursor + 2;
		}
	}
	return output;
}

async function inspectBinaryVisio(bytes: Uint8Array): Promise<{
	streams: string[];
	segments: Array<{ stream: string; text: string }>;
}> {
	if (!hasOleSignature(bytes))
		throw invalidVisio("The legacy Visio file has no OLE compound signature.");
	const XLSX = await import("xlsx");
	let cfb: { FullPaths: string[]; FileIndex: Array<{ content?: unknown }> };
	try {
		cfb = XLSX.CFB.read(bytes, { type: "array" });
	} catch {
		throw invalidVisio("The legacy Visio OLE container is malformed.");
	}
	const streams = cfb.FullPaths.map((path) => path.split("/").at(-1) ?? path);
	const hasVisioDocument = streams.some(
		(name) => name.toLowerCase() === "visiodocument",
	);
	const hasWebDrawing = streams.some((name) =>
		/(?:drawing|pages|shapes|visio|vdw)/i.test(name),
	);
	if (!hasVisioDocument && !hasWebDrawing)
		throw invalidVisio(
			"The OLE container has no VisioDocument or Visio web-drawing streams.",
		);
	const segments: Array<{ stream: string; text: string }> = [];
	const seen = new Set<string>();
	for (const [index, path] of cfb.FullPaths.entries()) {
		const stream = path.split("/").at(-1) ?? path;
		if (
			!/^VisioDocument$/i.test(stream) &&
			!/^VisioServerData$/i.test(stream) &&
			!/(?:Page|Shape|Drawing).*(?:xml|data)?$/i.test(stream)
		)
			continue;
		for (const text of extractUtf16Strings(
			bytesOf(cfb.FileIndex[index]?.content),
		)) {
			if (seen.has(text)) continue;
			seen.add(text);
			segments.push({ stream, text });
		}
	}
	if (!segments.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"The legacy Visio container is valid, but no defensibly identifiable local text was found. Convert a copy to VDX or VSDX for full extraction.",
		);
	return { streams, segments };
}

async function readBinarySource(
	file: File,
	extension: VisioExtension,
	context?: SafeInputContext,
): Promise<VisioSource> {
	const bytes = await readSafeFileBytes(file, context);
	throwIfAborted(context?.signal);
	const inspected = await inspectBinaryVisio(bytes);
	return {
		profile: "binary",
		extension,
		parts: {},
		xmlParts: [],
		binaryBytes: bytes,
		binarySegments: inspected.segments,
	};
}

async function readVisioSource(
	file: File,
	context?: SafeInputContext,
): Promise<VisioSource> {
	const fileExtension = getFileExtension(file.name);
	const extension = VISIO_EXTENSIONS.includes(fileExtension as VisioExtension)
		? (fileExtension as VisioExtension)
		: undefined;
	const prefix = new Uint8Array(
		await file.slice(0, Math.min(file.size, 16)).arrayBuffer(),
	);
	throwIfAborted(context?.signal);
	if (
		prefix[0] === 0x50 &&
		prefix[1] === 0x4b &&
		(prefix[2] === 0x03 || prefix[2] === 0x05 || prefix[2] === 0x07)
	) {
		if (extension && !OPC_EXTENSIONS.has(extension))
			throw invalidVisio(
				`A Visio OPC package cannot use the legacy .${extension} family extension.`,
			);
		return readOpcSource(file, extension, context);
	}
	if (hasOleSignature(prefix)) {
		if (!extension || !BINARY_EXTENSIONS.has(extension))
			throw invalidVisio(
				"An OLE Visio container requires a registered legacy Visio family extension.",
			);
		return readBinarySource(file, extension, context);
	}
	if (extension && (XML_EXTENSIONS.has(extension) || extension === "vsr"))
		return readXmlSource(file, extension, context);
	throw invalidVisio(
		`The content signature does not match a registered Visio family${extension ? ` for .${extension}` : ""}.`,
	);
}

function optionEnabled(
	options: Readonly<FormatOptionValues>,
	id: string,
): boolean {
	return options[id] !== false;
}

function selectXmlReplacements(
	part: VisioXmlPart,
	profile: VisioProfile,
	options: Readonly<FormatOptionValues>,
): Omit<VisioReplacement, "unitIndex" | "kind">[] {
	const output: Omit<VisioReplacement, "unitIndex" | "kind">[] = [];
	for (const value of part.syntax.values) {
		const element = part.syntax.elements[value.elementId];
		const chain = ancestorsOf(element, part.syntax);
		const local = element.localName.toLowerCase();
		const isShapeText =
			local === "text" || chain.some((entry) => entry.localName === "Text");
		const isField = chain.some(
			(entry) => entry.localName.toLowerCase() === "fld",
		);
		const isMetadata =
			optionEnabled(options, "includeMetadata") && METADATA_ELEMENTS.has(local);
		const isReportText =
			profile === "report" &&
			["title", "description", "columnheader", "label"].includes(local);
		if ((!isShapeText || isField) && !isMetadata && !isReportText) continue;
		output.push({
			profile,
			part: part.part,
			path: value.path,
			location: value.location,
			start: value.start,
			end: value.end,
			originalValue: value.value,
		} as Omit<VisioReplacement, "unitIndex" | "kind">);
	}
	for (const element of part.syntax.elements) {
		const name = element.localName.toLowerCase();
		const chain = ancestorsOf(element, part.syntax);
		const section = chain.find((entry) => entry.localName === "Section");
		const sectionName = attribute(section, "N")?.toLowerCase();
		for (const entry of element.attributes) {
			let selected = false;
			if (
				entry.localName === "Name" &&
				name === "page" &&
				optionEnabled(options, "includePageNames")
			)
				selected = true;
			if (
				["Name", "Prompt"].includes(entry.localName) &&
				["master", "mastershortcut"].includes(name) &&
				optionEnabled(options, "includeMasterNames")
			)
				selected = true;
			if (
				entry.localName === "V" &&
				name === "cell" &&
				optionEnabled(options, "includeShapeData") &&
				["property", "layer"].includes(sectionName ?? "") &&
				SHAPE_DATA_CELLS.has(attribute(element, "N")?.toLowerCase() ?? "") &&
				!attribute(element, "F") &&
				isHumanText(entry.value)
			)
				selected = true;
			if (!selected) continue;
			output.push({
				profile,
				part: part.part,
				path: [...element.path, `@${entry.qName}`],
				location: "attribute",
				attribute: entry.qName,
				start: entry.start,
				end: entry.end,
				originalValue: entry.value,
			} as Omit<VisioReplacement, "unitIndex" | "kind">);
		}
	}
	return output.sort((first, second) => first.start - second.start);
}

export async function validateVisioFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await readVisioSource(file, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason:
						"The file is not a safe, structurally valid Microsoft Visio document.",
				};
	}
}

export async function importVisioFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const normalized = normalizeImportOptions("visio", options);
	const source = await readVisioSource(file, context);
	if (source.profile === "binary") {
		const entries = source.binarySegments ?? [];
		const segments = entries.map((entry) => entry.text);
		const document = createNeutralDocument({
			format: "visio",
			sourceSegments: segments,
			unitIds: entries.map((entry, index) => `${entry.stream}:${index + 1}`),
			sourceLocations: entries.map((entry, segmentIndex) => ({
				part: entry.stream,
				segmentIndex,
			})),
		});
		document.metadata = {
			profile: "Legacy Visio protected import",
			sourceExtension: source.extension,
			exportPolicy: "identity-or-vdx-conversion",
			security:
				"Only local VisioDocument/page/shape streams are scanned. VBA, formulas, embedded objects, links, and other streams remain inert opaque bytes.",
		};
		return {
			kind: "segments",
			segments,
			document,
			skeleton: await createPackageSkeleton(file, "visio", {}, []),
			filterOptions: normalized,
			typeRef: {
				profile: "visio-binary",
				sourceExtension: source.extension,
				outputPolicy: "identity-or-vdx-conversion",
			} as TypeRef,
		};
	}
	const selected = source.xmlParts.flatMap((part) =>
		selectXmlReplacements(part, source.profile, normalized),
	);
	if (!selected.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"No translatable Visio shape, page, master, layer, shape-data, or selected metadata text was found.",
		);
	const replacements: VisioReplacement[] = selected.map((entry, unitIndex) =>
		source.profile === "opc"
			? ({
					kind: "package-xml-value",
					unitIndex,
					...entry,
				} as PackageXmlValueReplacement)
			: ({
					kind: "xml-value",
					unitIndex,
					path: entry.path,
					location: entry.location,
					...(entry.attribute ? { attribute: entry.attribute } : {}),
					start: entry.start,
					end: entry.end,
					originalValue: entry.originalValue,
				} as XmlValueReplacement),
	);
	const segments = replacements.map((entry) => entry.originalValue);
	const document = createNeutralDocument({
		format: "visio",
		sourceSegments: segments,
		unitIds: replacements.map(
			(entry, index) =>
				`${"part" in entry ? entry.part : file.name}:${entry.path.join("/")}:${index}`,
		),
		sourceLocations: replacements.map((entry, segmentIndex) => ({
			part: "part" in entry ? entry.part : file.name,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile:
			source.profile === "opc"
				? "Visio OPC package"
				: source.profile === "report"
					? "Visio report definition XML"
					: "Visio DataDiagramML XML",
		sourceExtension: source.extension,
		visualOrder:
			"Core metadata, page list, page shape z-order, master list, and master shape z-order.",
		security:
			"Formulas, geometry, relationships, VBA, external links, embedded objects, and binary resources are not evaluated or exposed.",
	};
	const skeleton =
		source.profile === "opc"
			? await createPackageSkeleton(
					file,
					"visio",
					source.parts,
					replacements,
					source.archive!.source,
				)
			: await createTextSkeleton(
					file,
					"visio",
					source.xmlParts[0].content,
					replacements,
					{
						name: file.name,
						mimeType: file.type,
						encoding: source.textSource!.encoding,
						hasBom: source.textSource!.hasBom,
						originalFile: new Blob([source.textSource!.bytes], {
							type: file.type,
						}),
					},
				);
	return {
		kind: "segments",
		segments,
		document,
		skeleton,
		filterOptions: normalized,
		typeRef: {
			profile: `visio-${source.profile}`,
			sourceExtension: source.extension,
			outputPolicy: "same-family",
		} as TypeRef,
	};
}

function escapeXml(
	value: string,
	location: VisioReplacement["location"],
): string {
	if (location === "cdata") return value.replaceAll("]]>", "]]]]><![CDATA[>");
	const escaped = value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return location === "attribute"
		? escaped.replaceAll('"', "&quot;").replaceAll("'", "&apos;")
		: escaped;
}

function applyVisioReplacements(
	content: string,
	replacements: readonly VisioReplacement[],
	targets: readonly string[],
): string {
	let output = content;
	for (const replacement of [...replacements].sort(
		(first, second) => second.start - first.start,
	)) {
		if (
			replacement.start < 0 ||
			replacement.end < replacement.start ||
			replacement.end > content.length
		)
			throw new Error("A Visio mapping points outside its original XML part.");
		const translated = targets[replacement.unitIndex];
		if (translated === undefined || translated === replacement.originalValue)
			continue;
		output = `${output.slice(0, replacement.start)}${escapeXml(
			translated,
			replacement.location,
		)}${output.slice(replacement.end)}`;
	}
	parseXmlSyntax(output);
	return output;
}

function projectProfile(project: UserData): string | undefined {
	return typeof project.translationData.typeRef === "object"
		? (project.translationData.typeRef.profile as string | undefined)
		: undefined;
}

function projectExtension(project: UserData): VisioExtension {
	const extension =
		typeof project.translationData.typeRef === "object"
			? project.translationData.typeRef.sourceExtension
			: undefined;
	if (
		typeof extension === "string" &&
		VISIO_EXTENSIONS.includes(extension as VisioExtension)
	)
		return extension as VisioExtension;
	const fromName = getFileExtension(
		project.translationData.skeleton?.source.name ??
			project.translationData.name,
	);
	return VISIO_EXTENSIONS.includes(fromName as VisioExtension)
		? (fromName as VisioExtension)
		: "vsdx";
}

function legacyVdx(translations: readonly string[]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>\n<VisioDocument xmlns="urn:schemas-microsoft-com:office:visio"><DocumentProperties><Title>Open TLC translated legacy Visio delivery</Title></DocumentProperties><Pages><Page ID="0" Name="Translated"><Shapes>${translations
		.map(
			(text, index) =>
				`<Shape ID="${index + 1}" Type="Shape"><XForm><PinX>${1 + (index % 4) * 2}</PinX><PinY>${1 + Math.floor(index / 4)}</PinY></XForm><Text>${escapeXml(text, "text")}</Text></Shape>`,
		)
		.join("")}</Shapes></Page></Pages></VisioDocument>`;
}

export async function buildVisioTranslation(project: UserData): Promise<{
	blob: Blob;
	extension: VisioExtension;
}> {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const extension = projectExtension(project);
	const identity = skeletonHasIdentityTargets(data.seg1, data.seg2);
	if (identity && data.skeleton?.source.originalFile)
		return { blob: data.skeleton.source.originalFile, extension };
	if (projectProfile(project) === "visio-binary") {
		const content = legacyVdx(
			data.seg2.map((target, index) => target || data.seg1[index] || ""),
		);
		parseVisioXml("translated.vdx", content, ["VisioDocument"]);
		return {
			blob: new Blob([content], { type: "application/xml;charset=utf-8" }),
			extension: "vdx",
		};
	}
	if (data.skeleton?.payload.kind === "package") {
		const skeleton = getPackageSkeleton(data.skeleton, "visio");
		if (!skeleton)
			throw new Error("Visio package export requires its original skeleton.");
		if (
			Object.keys(skeleton.payload.parts).some((part) =>
				part.toLowerCase().startsWith("_xmlsignatures/"),
			)
		)
			throw new Error(
				"This Visio package is digitally signed. Exporting translated XML would invalidate its signature; remove the signature in a trusted Visio-compatible application before translating it.",
			);
		const replacements = skeleton.replacements.filter(
			(entry): entry is PackageXmlValueReplacement =>
				entry.kind === "package-xml-value",
		);
		const byPart = new Map<string, PackageXmlValueReplacement[]>();
		for (const replacement of replacements) {
			const list = byPart.get(replacement.part) ?? [];
			list.push(replacement);
			byPart.set(replacement.part, list);
		}
		const original = skeleton.source.originalFile;
		if (!original)
			throw new Error(
				"Visio package export requires its retained source bytes.",
			);
		const zip = await JSZip.loadAsync(await original.arrayBuffer());
		for (const [part, entries] of byPart) {
			const content = skeleton.payload.parts[part];
			if (typeof content !== "string")
				throw new Error(`Visio XML part ${part} is missing from the skeleton.`);
			const translated = applyVisioReplacements(content, entries, data.seg2);
			if (translated !== content) zip.file(part, translated);
		}
		return {
			blob: await zip.generateAsync({
				type: "blob",
				mimeType: "application/vnd.visio",
				compression: "DEFLATE",
				compressionOptions: { level: 6 },
			}),
			extension,
		};
	}
	const content = getTextSkeletonContent(data.skeleton, "visio");
	if (content === undefined)
		throw new Error("Visio XML export requires its positional XML skeleton.");
	const replacements = data.skeleton!.replacements.filter(
		(entry): entry is XmlValueReplacement => entry.kind === "xml-value",
	);
	const output = applyVisioReplacements(content, replacements, data.seg2);
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return {
		blob: new Blob(
			[
				encodeTextBytes(
					output,
					encoding,
					data.skeleton?.source.hasBom ?? false,
				),
			],
			{ type: `application/xml;charset=${encoding}` },
		),
		extension,
	};
}

export async function buildVisioTranslationBlob(
	project: UserData,
): Promise<Blob> {
	return (await buildVisioTranslation(project)).blob;
}

export async function generateVisioTranslation(
	project: UserData,
): Promise<void> {
	const { blob, extension } = await buildVisioTranslation(project);
	const base = (project.translationData.name || "diagram").replace(
		/\.[^.]+$/,
		"",
	);
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${base}.translated.${extension}`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
