import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { TypeRef, XmlSegmentMeta } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type XmlValueReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import {
	parseXmlSyntax,
	type XmlElementLocation,
	type XmlSyntaxDocument,
	type XmlValueLocation,
} from "./xmlFamily";

const DOCBOOK_NAMESPACE = "http://docbook.org/ns/docbook";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const ROOTS = new Set([
	"set",
	"book",
	"part",
	"article",
	"chapter",
	"appendix",
	"preface",
	"reference",
	"refentry",
	"section",
]);
const CODE_ELEMENTS = new Set([
	"programlisting",
	"programlistingco",
	"screen",
	"screenco",
	"synopsis",
	"literallayout",
	"code",
	"computeroutput",
	"userinput",
	"systemitem",
	"filename",
	"command",
]);
const METADATA_ELEMENTS = new Set([
	"info",
	"bookinfo",
	"articleinfo",
	"chapterinfo",
	"sectioninfo",
	"refentryinfo",
	"author",
	"authorgroup",
	"editor",
	"publisher",
	"publishername",
	"copyright",
	"legalnotice",
	"revhistory",
	"releaseinfo",
	"abstract",
	"keywordset",
]);
const DOCBOOK_ENTITIES: Readonly<Record<string, number>> = {
	nbsp: 160,
	copy: 169,
	reg: 174,
	trade: 8482,
	ndash: 8211,
	mdash: 8212,
	hellip: 8230,
	laquo: 171,
	raquo: 187,
	lsquo: 8216,
	rsquo: 8217,
	ldquo: 8220,
	rdquo: 8221,
	bull: 8226,
	middot: 183,
};

interface DocBookModel {
	version: "4" | "5";
	syntax: XmlSyntaxDocument;
	ids: Set<string>;
}

function invalidDocBook(message: string): SafeInputError {
	return new SafeInputError("DOCBOOK_INVALID", message);
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(entry) => entry.qName === name || entry.localName === name,
	)?.value;
}

function maskNamedEntities(content: string): string {
	return content.replace(/&([A-Za-z][\w.-]*);/g, (entity, name: string) => {
		if (["amp", "lt", "gt", "quot", "apos"].includes(name)) return entity;
		const codePoint = DOCBOOK_ENTITIES[name];
		if (codePoint === undefined)
			throw new SafeInputError(
				"XML_UNSAFE_DECLARATION",
				`DocBook entity “&${name};” is not in the safe built-in entity profile.`,
			);
		const digits = String(codePoint).padStart(entity.length - 3, "0");
		return `&#${digits};`;
	});
}

export function maskKnownDocBookDeclarations(content: string): string {
	if (/<!ENTITY\b/i.test(content) || /<!DOCTYPE[\s\S]*?\[/i.test(content))
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"DocBook internal subsets and entity declarations are disabled for safety.",
		);
	const declarations = [...content.matchAll(/<!DOCTYPE[\s\S]*?>/gi)];
	let masked = content;
	if (declarations.length > 1)
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"DocBook documents may contain at most one fixed doctype.",
		);
	if (declarations.length) {
		const declaration = declarations[0][0];
		const parsed = declaration.match(
			/^<!DOCTYPE\s+([\w:.-]+)(?:\s+PUBLIC\s+"([^"]+)"\s+"([^"]+)"|\s+SYSTEM\s+"([^"]+)")\s*>$/i,
		);
		const publicId = parsed?.[2] ?? "";
		const systemId = parsed?.[3] ?? parsed?.[4] ?? "";
		const root = parsed?.[1].split(":").at(-1)?.toLowerCase();
		if (
			!parsed ||
			!root ||
			!ROOTS.has(root) ||
			!/(?:docbookx|docbook|book|article)\.dtd(?:$|[?#])/i.test(systemId) ||
			(publicId
				? !/^-\/\/OASIS\/\/DTD DocBook (?:XML )?V4\.[0-9]+\/\/EN$/i.test(
						publicId,
					)
				: false)
		)
			throw new SafeInputError(
				"XML_UNSAFE_DECLARATION",
				"Only fixed OASIS DocBook 4 doctypes with known DTD system names are accepted.",
			);
		masked = `${content.slice(0, declarations[0].index)}${" ".repeat(declaration.length)}${content.slice(declarations[0].index! + declaration.length)}`;
	}
	return maskNamedEntities(masked);
}

function parseDocBook(content: string): DocBookModel {
	const syntax = parseXmlSyntax(maskKnownDocBookDeclarations(content));
	const root = syntax.elements[0];
	if (!root || !ROOTS.has(root.localName.toLowerCase()))
		throw invalidDocBook(
			"The document root is not a supported DocBook publication element.",
		);
	const namespace = root.namespaceUri;
	const declared = attribute(root, "version") ?? "";
	const version: "4" | "5" =
		namespace === DOCBOOK_NAMESPACE || declared.startsWith("5") ? "5" : "4";
	if (version === "5" && namespace !== DOCBOOK_NAMESPACE)
		throw invalidDocBook(
			"DocBook 5 requires the http://docbook.org/ns/docbook namespace.",
		);
	if (version === "4" && namespace)
		throw invalidDocBook(
			"DocBook 4 roots must not use an unexpected default namespace.",
		);
	if (declared && !declared.startsWith(version))
		throw invalidDocBook(
			`DocBook version “${declared}” conflicts with its namespace profile.`,
		);
	const schemaLocation = root.attributes.find(
		(entry) => entry.localName === "schemaLocation",
	)?.value;
	if (
		schemaLocation &&
		version === "5" &&
		!schemaLocation.includes(DOCBOOK_NAMESPACE)
	)
		throw invalidDocBook(
			"The declared DocBook 5 schema location does not cover the DocBook namespace.",
		);
	const ids = new Set<string>();
	for (const element of syntax.elements) {
		const id = attribute(element, "id");
		if (id) {
			if (ids.has(id)) throw invalidDocBook(`Duplicate DocBook ID “${id}”.`);
			ids.add(id);
		}
	}
	for (const element of syntax.elements)
		for (const name of ["linkend", "endterm", "startref"] as const) {
			const target = attribute(element, name);
			if (target && !ids.has(target))
				throw invalidDocBook(
					`DocBook ${name} references missing ID “${target}”.`,
				);
		}
	for (const element of syntax.elements)
		for (const entry of element.attributes) {
			if (entry.namespaceUri !== XLINK_NAMESPACE || entry.localName !== "href")
				continue;
			const fragment = entry.value.startsWith("#")
				? entry.value.slice(1)
				: undefined;
			if (fragment && !ids.has(fragment))
				throw invalidDocBook(
					`DocBook xlink:href references missing ID “${fragment}”.`,
				);
		}
	return { version, syntax, ids };
}

function ancestors(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation[] {
	const output = [element];
	let current = element;
	while (current.parentId !== undefined) {
		current = syntax.elements[current.parentId];
		output.push(current);
	}
	return output;
}

function translateDisabled(chain: readonly XmlElementLocation[]): boolean {
	return chain.some(
		(element) =>
			attribute(element, "translate")?.toLowerCase() === "no" ||
			!element.effectiveTranslate,
	);
}

export async function validateDocBookFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseDocBook(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not safe, valid DocBook XML." };
	}
}

export async function importDocBookFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("docbook", options);
	const read = await readSafeTextFile(file, context);
	const model = parseDocBook(read.text);
	const selectedAttributes = new Set(
		parseList(filterOptions.attributeSelectors).map((value) =>
			value.toLowerCase(),
		),
	);
	const candidates: XmlValueLocation[] = [];
	for (const value of model.syntax.values) {
		const element = model.syntax.elements[value.elementId];
		const chain = ancestors(element, model.syntax);
		const names = new Set(chain.map((entry) => entry.localName.toLowerCase()));
		if (filterOptions.respectTranslateMetadata && translateDisabled(chain))
			continue;
		if (
			!filterOptions.includeCode &&
			[...names].some((name) => CODE_ELEMENTS.has(name))
		)
			continue;
		if (
			!filterOptions.includeMetadata &&
			[...names].some((name) => METADATA_ELEMENTS.has(name))
		)
			continue;
		if (!filterOptions.includeIndexTerms && names.has("indexterm")) continue;
		candidates.push(value);
	}
	for (const element of model.syntax.elements) {
		const chain = ancestors(element, model.syntax);
		if (filterOptions.respectTranslateMetadata && translateDisabled(chain))
			continue;
		for (const entry of element.attributes)
			if (
				selectedAttributes.has(entry.localName.toLowerCase()) &&
				entry.namespaceUri !== XLINK_NAMESPACE &&
				entry.value.trim()
			)
				candidates.push({
					location: "attribute",
					elementId: element.id,
					path: [...element.path, `@${entry.qName}`],
					attribute: entry.qName,
					start: entry.start,
					end: entry.end,
					value: entry.value,
				});
	}
	const segments: string[] = [];
	const meta: XmlSegmentMeta[] = [];
	const replacements: XmlValueReplacement[] = [];
	const elements: XmlElementLocation[] = [];
	for (const candidate of candidates.sort(
		(first, second) => first.start - second.start,
	)) {
		const pieces =
			filterOptions.segmentationMode === "sentences"
				? segmentPlainText(candidate.value, "sentences")
				: filterOptions.segmentationMode === "preferences"
					? splitTextWithPreferences(candidate.value)
					: [{ text: candidate.value, separator: "" }];
		const effective = pieces.filter((piece) => piece.text.trim());
		for (const piece of effective.length
			? effective
			: [{ text: candidate.value, separator: "" }]) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			const common = {
				path: candidate.path,
				...(candidate.attribute ? { attribute: candidate.attribute } : {}),
				start: candidate.start,
				end: candidate.end,
				originalValue: candidate.value,
				separator: piece.separator ?? "",
			};
			meta.push({ kind: candidate.location, ...common });
			replacements.push({
				kind: "xml-value",
				location: candidate.location,
				unitIndex,
				...common,
			});
			elements.push(model.syntax.elements[candidate.elementId]);
		}
	}
	const document = createNeutralDocument({
		format: "docbook",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: file.name,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: `DocBook ${model.version}`,
		ids: model.ids.size,
		encoding: read.encoding,
		security:
			"Fixed DocBook 4 doctypes and a bounded named-entity profile are masked without external resolution.",
	};
	for (const [index, element] of elements.entries()) {
		for (const [type, value] of [
			["docbook-id", attribute(element, "id")],
			["docbook-role", attribute(element, "role")],
			["docbook-condition", attribute(element, "condition")],
			["docbook-language", attribute(element, "lang")],
		] as const)
			if (value) document.units[index].contexts.push({ type, value });
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"docbook",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: `docbook${model.version}` } as TypeRef,
		segmentsMeta: meta,
	};
}
