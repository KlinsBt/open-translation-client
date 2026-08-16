import {
	contentToPlainText,
	createTextContent,
	type ContentFragment,
	type SegmentContent,
} from "./documentModel";
import { SafeInputError, safeParseXml } from "./safeInput";
import type {
	TmData,
	TmTerm,
	TmVariant,
	TmxDocumentMetadata,
	TmxProperty,
	TmxTextMetadata,
	TmxUnitMetadata,
	TmxUserDefinedEncoding,
	TmxVariantMetadata,
} from "$lib/types/types";

export const TMX_VERSION = "1.4" as const;

const REQUIRED_HEADER_ATTRIBUTES = [
	"creationtool",
	"creationtoolversion",
	"segtype",
	"o-tmf",
	"adminlang",
	"srclang",
	"datatype",
] as const;

const SEGMENT_TYPES = new Set(["block", "paragraph", "sentence", "phrase"]);
const INLINE_ELEMENTS = new Set(["bpt", "ept", "it", "ph", "hi", "ut"]);
const HEADER_ATTRIBUTES = new Set([
	...REQUIRED_HEADER_ATTRIBUTES,
	"o-encoding",
	"creationdate",
	"creationid",
	"changedate",
	"changeid",
]);
const UNIT_ATTRIBUTES = new Set([
	"tuid",
	"o-encoding",
	"datatype",
	"usagecount",
	"lastusagedate",
	"creationtool",
	"creationtoolversion",
	"creationdate",
	"creationid",
	"changedate",
	"segtype",
	"changeid",
	"o-tmf",
	"srclang",
]);
const VARIANT_ATTRIBUTES = new Set([
	"xml:lang",
	"lang",
	"o-encoding",
	"datatype",
	"usagecount",
	"lastusagedate",
	"creationtool",
	"creationtoolversion",
	"creationdate",
	"creationid",
	"changedate",
	"o-tmf",
	"changeid",
]);

export interface ParsedTmxHeader {
	metadata: TmxDocumentMetadata;
	id?: number;
	name: string;
}

export interface ParsedTmxUnit {
	index: number;
	attributes: Record<string, string>;
	notes: TmxTextMetadata[];
	properties: TmxProperty[];
	variants: TmVariant[];
	level: 1 | 2;
}

export interface TmxValidationResult {
	valid: boolean;
	issues: string[];
}

export type TmxMergePolicy =
	| "keep-all"
	| "keep-first"
	| "keep-last"
	| "merge-targets";

export interface TmxMergeOptions {
	policy?: TmxMergePolicy;
	name?: string;
}

export function parseTmxHeader(
	root: Element,
	header: Element,
	doctype?: string,
): ParsedTmxHeader {
	if (localName(root) !== "tmx" || root.getAttribute("version") !== TMX_VERSION)
		throw malformed("Only TMX 1.4/1.4b documents are supported.");
	if (localName(header) !== "header")
		throw malformed("The TMX header is missing.");
	const headerAttributes = attributesOf(header);
	assertAllowedAttributes(headerAttributes, HEADER_ATTRIBUTES, "TMX header");
	for (const attribute of REQUIRED_HEADER_ATTRIBUTES)
		if (!headerAttributes[attribute])
			throw malformed(`The TMX header is missing ${attribute}.`);
	if (!SEGMENT_TYPES.has(headerAttributes.segtype))
		throw malformed(`Unsupported TMX segtype “${headerAttributes.segtype}”.`);
	validateSourceLanguage(headerAttributes.srclang, "header");

	const notes: TmxTextMetadata[] = [];
	const properties: TmxProperty[] = [];
	const userDefinedEncodings: TmxUserDefinedEncoding[] = [];
	for (const child of directElementChildren(header)) {
		switch (localName(child)) {
			case "note":
				notes.push(parseTextMetadata(child));
				break;
			case "prop":
				properties.push(parseProperty(child));
				break;
			case "ude":
				userDefinedEncodings.push(parseUserDefinedEncoding(child));
				break;
			default:
				throw malformed(
					`Unsupported element <${localName(child)}> in TMX header.`,
				);
		}
	}
	const idText = properties.find((property) => property.type === "id")?.text;
	const numericId = idText === undefined ? undefined : Number(idText);
	return {
		metadata: {
			version: TMX_VERSION,
			level: 1,
			headerAttributes,
			notes,
			properties,
			userDefinedEncodings,
			...(doctype ? { doctype } : {}),
		},
		...(numericId !== undefined &&
		Number.isSafeInteger(numericId) &&
		numericId >= 0
			? { id: numericId }
			: {}),
		name:
			properties.find((property) => property.type === "name")?.text.trim() ||
			"New TM",
	};
}

export function parseTmxUnit(element: Element, index: number): ParsedTmxUnit {
	if (localName(element) !== "tu")
		throw malformed(`TMX record ${index + 1} is not a translation unit.`);
	const attributes = attributesOf(element);
	assertAllowedAttributes(attributes, UNIT_ATTRIBUTES, `TMX unit ${index + 1}`);
	if (attributes.tuid && /\s/.test(attributes.tuid))
		throw malformed(`TMX tuid “${attributes.tuid}” contains whitespace.`);
	if (attributes.segtype && !SEGMENT_TYPES.has(attributes.segtype))
		throw malformed(`Unsupported TMX segtype “${attributes.segtype}”.`);
	if (attributes.srclang) validateSourceLanguage(attributes.srclang, "unit");
	const notes: TmxTextMetadata[] = [];
	const properties: TmxProperty[] = [];
	const variants: TmVariant[] = [];
	let sawVariant = false;
	let level: 1 | 2 = 1;
	for (const child of directElementChildren(element)) {
		const name = localName(child);
		if (name === "tuv") {
			sawVariant = true;
			const parsed = parseVariant(child, index, variants.length);
			variants.push(parsed.variant);
			if (parsed.level === 2) level = 2;
			continue;
		}
		if (sawVariant)
			throw malformed(`TMX unit ${index + 1} has metadata after its variants.`);
		if (name === "note") notes.push(parseTextMetadata(child));
		else if (name === "prop") properties.push(parseProperty(child));
		else
			throw malformed(
				`Unsupported element <${name}> in TMX unit ${index + 1}.`,
			);
	}
	if (variants.length < 2)
		throw malformed(
			`TMX unit ${index + 1} needs at least two language variants.`,
		);
	return { index, attributes, notes, properties, variants, level };
}

export function assembleTmxData(
	header: ParsedTmxHeader,
	units: readonly ParsedTmxUnit[],
): TmData {
	if (units.length === 0)
		throw malformed("The TMX file has no translation units.");
	let level: 1 | 2 = 1;
	const terms = units.map((unit) => {
		if (unit.level === 2) level = 2;
		const sourceLanguage =
			unit.attributes.srclang ?? header.metadata.headerAttributes.srclang;
		const sourceIndex =
			sourceLanguage.toLowerCase() === "*all*"
				? 0
				: unit.variants.findIndex(
						(variant) =>
							variant.lang.toLowerCase() === sourceLanguage.toLowerCase(),
					);
		if (sourceIndex < 0)
			throw malformed(
				`TMX unit ${unit.index + 1} has no ${sourceLanguage} source variant.`,
			);
		const source = unit.variants[sourceIndex];
		const targets = unit.variants.filter((_, index) => index !== sourceIndex);
		return {
			tuid: unit.attributes.tuid || `unit-${unit.index + 1}`,
			source,
			target: targets,
			tmx: {
				attributes: unit.attributes,
				notes: unit.notes,
				properties: unit.properties,
				variantOrder: unit.variants.map((variant) => variant.lang),
			} satisfies TmxUnitMetadata,
		} satisfies TmTerm;
	});
	return {
		...(header.id === undefined ? {} : { id: header.id }),
		name: header.name,
		terms,
		tmx: { ...header.metadata, level },
	};
}

export function parseTmxDocument(document: Document): TmData {
	const root = document.documentElement;
	assertAllowedAttributes(attributesOf(root), new Set(["version"]), "TMX root");
	const rootChildren = directElementChildren(root);
	if (
		rootChildren.length !== 2 ||
		localName(rootChildren[0]) !== "header" ||
		localName(rootChildren[1]) !== "body"
	)
		throw malformed("The TMX document needs one header followed by one body.");
	const [headerElement, body] = rootChildren;
	assertAllowedAttributes(attributesOf(body), new Set(), "TMX body");
	if (directElementChildren(body).some((child) => localName(child) !== "tu"))
		throw malformed("The TMX body may contain only translation units.");
	const doctype = document.doctype
		? `<!DOCTYPE ${document.doctype.name}${
				document.doctype.systemId
					? ` SYSTEM \"${document.doctype.systemId}\"`
					: ""
			}>`
		: undefined;
	const header = parseTmxHeader(root, headerElement, doctype);
	const units = directChildren(body, "tu").map(parseTmxUnit);
	return assembleTmxData(header, units);
}

export function validateTmxDocument(document: Document): TmxValidationResult {
	try {
		parseTmxDocument(document);
		return { valid: true, issues: [] };
	} catch (error) {
		return {
			valid: false,
			issues: [
				error instanceof Error ? error.message : "Invalid TMX document.",
			],
		};
	}
}

export function buildTmx14(sourceLanguage: string, input: TmData): string {
	if (input.terms.length === 0)
		throw new Error("A TMX file needs at least one translation unit.");
	const metadata = input.tmx;
	const fallbackSource =
		normalizeLanguage(sourceLanguage) || input.terms[0].source.lang || "*all*";
	const sourceLanguages = new Set(
		input.terms.map((term) => term.source.lang.toLowerCase()),
	);
	const defaultSource =
		sourceLanguages.size > 1
			? "*all*"
			: input.terms[0].source.lang || fallbackSource;
	const headerAttributes: Record<string, string> = {
		creationtool: "Open Translation Client",
		creationtoolversion: "1.0",
		segtype: "sentence",
		"o-tmf": "OpenTLCTM",
		adminlang: "en-US",
		srclang: defaultSource,
		datatype: "plaintext",
		...metadata?.headerAttributes,
	};
	for (const attribute of REQUIRED_HEADER_ATTRIBUTES)
		if (!headerAttributes[attribute])
			throw new Error(`TMX header attribute ${attribute} cannot be empty.`);
	assertAllowedAttributes(headerAttributes, HEADER_ATTRIBUTES, "TMX header");
	if (!SEGMENT_TYPES.has(headerAttributes.segtype))
		throw new Error(`Unsupported TMX segtype “${headerAttributes.segtype}”.`);
	validateSourceLanguage(headerAttributes.srclang, "header");

	const properties = documentProperties(input);
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<tmx version="${TMX_VERSION}">`,
		`  <header${serializeAttributes(headerAttributes)}>`,
	];
	for (const note of metadata?.notes ?? [])
		lines.push(`    ${serializeTextElement("note", note)}`);
	for (const property of properties)
		lines.push(`    ${serializeProperty(property)}`);
	for (const encoding of metadata?.userDefinedEncodings ?? [])
		lines.push(...serializeUserDefinedEncoding(encoding, "    "));
	lines.push("  </header>", "  <body>");

	for (const [index, term] of input.terms.entries())
		lines.push(...serializeTerm(term, index, headerAttributes.srclang));
	lines.push("  </body>", "</tmx>", "");
	return lines.join("\n");
}

export function mergeTmxData(
	first: TmData,
	second: TmData,
	options: TmxMergeOptions = {},
): TmData {
	const policy = options.policy ?? "merge-targets";
	const allTerms = [...first.terms, ...second.terms].map(cloneTerm);
	let terms: TmTerm[];
	if (policy === "keep-all") terms = allTerms;
	else {
		const bySource = new Map<string, number>();
		terms = [];
		for (const term of allTerms) {
			const key = sourceKey(term.source);
			const existingIndex = bySource.get(key);
			if (existingIndex === undefined) {
				bySource.set(key, terms.length);
				terms.push(term);
				continue;
			}
			if (policy === "keep-last") terms[existingIndex] = term;
			else if (policy === "merge-targets")
				terms[existingIndex] = mergeTermTargets(terms[existingIndex], term);
		}
	}
	return {
		name: options.name ?? "Merged TMX",
		terms,
		...(first.tmx ? { tmx: structuredClone(first.tmx) } : {}),
	};
}

function parseVariant(
	element: Element,
	unitIndex: number,
	variantIndex: number,
): { variant: TmVariant; level: 1 | 2 } {
	const attributes = attributesOf(element);
	assertAllowedAttributes(
		attributes,
		VARIANT_ATTRIBUTES,
		`TMX unit ${unitIndex + 1} variant ${variantIndex + 1}`,
	);
	const language = xmlLanguage(element) || attributes.lang;
	if (!language)
		throw malformed(
			`TMX unit ${unitIndex + 1} variant ${variantIndex + 1} has no xml:lang.`,
		);
	const notes: TmxTextMetadata[] = [];
	const properties: TmxProperty[] = [];
	let segment: Element | undefined;
	for (const child of directElementChildren(element)) {
		const name = localName(child);
		if (name === "note" && !segment) notes.push(parseTextMetadata(child));
		else if (name === "prop" && !segment) properties.push(parseProperty(child));
		else if (name === "seg" && !segment) segment = child;
		else
			throw malformed(
				`TMX unit ${unitIndex + 1} variant ${language} has invalid child order.`,
			);
	}
	if (!segment)
		throw malformed(
			`TMX unit ${unitIndex + 1} variant ${language} has no segment.`,
		);
	const parsedContent = parseSegmentContent(segment, language, unitIndex);
	return {
		variant: {
			lang: language,
			segment: editableText(parsedContent.content),
			...(parsedContent.level === 2 ? { content: parsedContent.content } : {}),
			tmx: {
				attributes,
				notes,
				properties,
			} satisfies TmxVariantMetadata,
		},
		level: parsedContent.level,
	};
}

function parseSegmentContent(
	segment: Element,
	language: string,
	unitIndex: number,
): { content: SegmentContent; level: 1 | 2 } {
	assertAllowedAttributes(
		attributesOf(segment),
		new Set(),
		`TMX unit ${unitIndex + 1} segment`,
	);
	const fragments: ContentFragment[] = [];
	const pairStack: string[] = [];
	const seenPairs = new Set<string>();
	let sequence = 0;
	let level: 1 | 2 = 1;
	const walk = (parent: Element) => {
		for (const node of Array.from(parent.childNodes)) {
			if (node.nodeType === 3 || node.nodeType === 4) {
				fragments.push({ kind: "text", text: node.nodeValue ?? "" });
				continue;
			}
			if (node.nodeType !== 1) continue;
			const element = node as Element;
			const name = localName(element);
			if (!INLINE_ELEMENTS.has(name))
				throw malformed(
					`TMX unit ${unitIndex + 1} contains unsupported inline <${name}>.`,
				);
			level = 2;
			validateInlineElement(element, unitIndex);
			sequence++;
			if (name === "hi") {
				const pairId = `tmx-hi-${sequence}`;
				fragments.push(
					codeFragment(sequence, "start", openingTag(element), pairId),
				);
				walk(element);
				fragments.push(codeFragment(++sequence, "end", "</hi>", pairId));
				continue;
			}
			if (name === "bpt") {
				const id = element.getAttribute("i");
				if (!id || seenPairs.has(id))
					throw malformed(
						`TMX unit ${unitIndex + 1} has a missing or duplicate bpt i value.`,
					);
				seenPairs.add(id);
				pairStack.push(id);
				fragments.push(
					codeFragment(sequence, "start", serializeNode(element), `tmx-${id}`),
				);
				continue;
			}
			if (name === "ept") {
				const id = element.getAttribute("i");
				if (!id || pairStack.pop() !== id)
					throw malformed(
						`TMX unit ${unitIndex + 1} has unbalanced bpt/ept inline codes.`,
					);
				fragments.push(
					codeFragment(sequence, "end", serializeNode(element), `tmx-${id}`),
				);
				continue;
			}
			if (
				name === "it" &&
				!/^(?:begin|end)$/.test(element.getAttribute("pos") ?? "")
			)
				throw malformed(
					`TMX unit ${unitIndex + 1} has an it code without a valid pos.`,
				);
			const serialized =
				name === "ut"
					? `<ph${serializeAttributes(attributesOf(element))}>${serializeChildren(element)}</ph>`
					: serializeNode(element);
			fragments.push(codeFragment(sequence, "standalone", serialized));
		}
	};
	walk(segment);
	if (pairStack.length > 0)
		throw malformed(
			`TMX unit ${unitIndex + 1} has unbalanced bpt/ept inline codes.`,
		);
	return {
		content: { fragments, language, preserveWhitespace: true },
		level,
	};
}

function codeFragment(
	sequence: number,
	codeType: "standalone" | "start" | "end",
	originalData: string,
	pairId?: string,
): ContentFragment {
	return {
		kind: "code",
		id: `tmx-code-${sequence}`,
		codeType,
		...(pairId ? { pairId } : {}),
		originalData,
		canCopy: true,
		canDelete: false,
		canReorder: false,
	};
}

function serializeTerm(
	term: TmTerm,
	index: number,
	headerSourceLanguage: string,
): string[] {
	if (!term.source.lang)
		throw new Error(`TMX unit ${index + 1} has no source language.`);
	if (term.target.length === 0)
		throw new Error(`TMX unit ${index + 1} needs at least one target variant.`);
	const variants = [term.source, ...term.target];
	for (const variant of variants) {
		if (!variant.lang)
			throw new Error(`TMX unit ${index + 1} has an empty language.`);
	}
	const attributes: Record<string, string> = {
		...term.tmx?.attributes,
		tuid: term.tuid || term.tmx?.attributes.tuid || `unit-${index + 1}`,
	};
	assertAllowedAttributes(attributes, UNIT_ATTRIBUTES, `TMX unit ${index + 1}`);
	const effectiveSource =
		attributes.srclang?.toLowerCase() === "*all*"
			? "*all*"
			: (attributes.srclang ?? headerSourceLanguage);
	if (
		effectiveSource.toLowerCase() !== "*all*" &&
		effectiveSource.toLowerCase() !== term.source.lang.toLowerCase()
	)
		attributes.srclang = term.source.lang;
	const lines = [`    <tu${serializeAttributes(attributes)}>`];
	for (const note of term.tmx?.notes ?? [])
		lines.push(`      ${serializeTextElement("note", note)}`);
	for (const property of term.tmx?.properties ?? [])
		lines.push(`      ${serializeProperty(property)}`);
	const ordered = orderVariants(variants, term.tmx?.variantOrder ?? []);
	for (const variant of ordered) lines.push(...serializeVariant(variant));
	lines.push("    </tu>");
	return lines;
}

function serializeVariant(variant: TmVariant): string[] {
	const attributes: Record<string, string> = {
		...variant.tmx?.attributes,
		"xml:lang": variant.lang,
	};
	assertAllowedAttributes(
		attributes,
		VARIANT_ATTRIBUTES,
		`TMX variant ${variant.lang}`,
	);
	const lines = [`      <tuv${serializeAttributes(attributes)}>`];
	for (const note of variant.tmx?.notes ?? [])
		lines.push(`        ${serializeTextElement("note", note)}`);
	for (const property of variant.tmx?.properties ?? [])
		lines.push(`        ${serializeProperty(property)}`);
	const content = variant.content
		? overlayPlainText(variant.content, variant.segment)
		: createTextContent(variant.segment, variant.lang, true);
	lines.push(`        <seg>${serializeContent(content)}</seg>`, "      </tuv>");
	return lines;
}

function orderVariants(
	variants: readonly TmVariant[],
	requestedOrder: readonly string[],
): TmVariant[] {
	const pending = [...variants];
	const ordered: TmVariant[] = [];
	for (const language of requestedOrder) {
		const index = pending.findIndex(
			(variant) => variant.lang.toLowerCase() === language.toLowerCase(),
		);
		if (index >= 0) ordered.push(...pending.splice(index, 1));
	}
	return [...ordered, ...pending];
}

function overlayPlainText(
	content: SegmentContent,
	text: string,
): SegmentContent {
	const plain = contentToPlainText(content);
	if (plain === text || (plain === undefined && editableText(content) === text))
		return content;
	if (plain !== undefined)
		return createTextContent(
			text,
			content.language,
			content.preserveWhitespace,
		);
	const indexes = content.fragments.flatMap((fragment, index) =>
		fragment.kind === "text" ? [index] : [],
	);
	if (indexes.length === 0) return content;
	const oldLength = indexes.reduce((total, index) => {
		const fragment = content.fragments[index];
		return total + (fragment.kind === "text" ? fragment.text.length : 0);
	}, 0);
	let oldOffset = 0;
	let newOffset = 0;
	const fragments = content.fragments.map((fragment) => ({ ...fragment }));
	for (const [position, index] of indexes.entries()) {
		const fragment = content.fragments[index];
		if (fragment.kind !== "text") continue;
		oldOffset += fragment.text.length;
		const end =
			position === indexes.length - 1
				? text.length
				: oldLength === 0
					? newOffset
					: Math.round((oldOffset / oldLength) * text.length);
		fragments[index] = { kind: "text", text: text.slice(newOffset, end) };
		newOffset = end;
	}
	return { ...content, fragments };
}

function serializeContent(content: SegmentContent): string {
	return content.fragments
		.map((fragment) => {
			if (fragment.kind === "text") return escapeXml(fragment.text);
			if (fragment.originalData)
				return sanitizeInlineMarkup(fragment.originalData, fragment.codeType);
			return `<ph x="${escapeXml(fragment.id)}">${escapeXml(fragment.displayText ?? "")}</ph>`;
		})
		.join("");
}

function sanitizeInlineMarkup(
	markup: string,
	codeType: "standalone" | "start" | "end",
): string {
	if (/^<\/hi\s*>$/i.test(markup)) return "</hi>";
	if (codeType === "start" && /^<hi(?:\s[^<>]*)?>$/i.test(markup)) {
		const document = safeParseXml(`<root>${markup}</hi></root>`);
		const element = directElementChildren(document.documentElement)[0];
		validateInlineElement(element, 0);
		return openingTag(element);
	}
	const document = safeParseXml(`<root>${markup}</root>`);
	const children = directElementChildren(document.documentElement);
	if (
		children.length !== 1 ||
		INLINE_ELEMENTS.has(localName(children[0])) === false
	)
		throw new Error(
			"Stored TMX inline markup is not a supported single element.",
		);
	validateInlineElement(children[0], 0);
	return serializeNode(children[0]);
}

function editableText(content: SegmentContent): string {
	return content.fragments
		.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
		.join("");
}

function parseTextMetadata(element: Element): TmxTextMetadata {
	if (directElementChildren(element).length > 0)
		throw malformed(`TMX <${localName(element)}> content must be plain text.`);
	assertAllowedAttributes(
		attributesOf(element),
		new Set([
			"xml:lang",
			"lang",
			"o-encoding",
			...(localName(element) === "prop" ? ["type"] : []),
		]),
		`TMX <${localName(element)}>`,
	);
	return {
		text: element.textContent ?? "",
		...(xmlLanguage(element) ? { language: xmlLanguage(element) } : {}),
		...(element.getAttribute("o-encoding")
			? { originalEncoding: element.getAttribute("o-encoding")! }
			: {}),
	};
}

function parseProperty(element: Element): TmxProperty {
	const type = element.getAttribute("type");
	if (!type) throw malformed("A TMX property is missing its type.");
	return { type, ...parseTextMetadata(element) };
}

function parseUserDefinedEncoding(element: Element): TmxUserDefinedEncoding {
	assertAllowedAttributes(
		attributesOf(element),
		new Set(["name", "base"]),
		"TMX ude",
	);
	const name = element.getAttribute("name");
	if (!name)
		throw malformed("A TMX user-defined encoding is missing its name.");
	const children = directElementChildren(element);
	if (children.some((child) => localName(child) !== "map"))
		throw malformed(
			`TMX user-defined encoding “${name}” may contain only maps.`,
		);
	const maps = children.map((map) => {
		const attributes = attributesOf(map);
		assertAllowedAttributes(
			attributes,
			new Set(["unicode", "code", "ent", "subst"]),
			`TMX user-defined encoding “${name}” map`,
		);
		if (!attributes.unicode)
			throw malformed(
				`TMX user-defined encoding “${name}” has a map without unicode.`,
			);
		if (!attributes.code && !attributes.ent && !attributes.subst)
			throw malformed(`TMX user-defined encoding “${name}” has an empty map.`);
		if (attributes.code && !element.getAttribute("base"))
			throw malformed(
				`TMX user-defined encoding “${name}” needs base for code maps.`,
			);
		return attributes;
	});
	if (maps.length === 0)
		throw malformed(`TMX user-defined encoding “${name}” contains no maps.`);
	return {
		name,
		...(element.getAttribute("base")
			? { base: element.getAttribute("base")! }
			: {}),
		maps,
	};
}

function serializeTextElement(name: "note", value: TmxTextMetadata): string {
	const attributes = {
		...(value.language ? { "xml:lang": value.language } : {}),
		...(value.originalEncoding ? { "o-encoding": value.originalEncoding } : {}),
	};
	return `<${name}${serializeAttributes(attributes)}>${escapeXml(value.text)}</${name}>`;
}

function documentProperties(input: TmData): TmxProperty[] {
	const properties = (input.tmx?.properties ?? []).map((property) => ({
		...property,
	}));
	const idIndex = properties.findIndex((property) => property.type === "id");
	if (input.id !== undefined) {
		const id = { type: "id", text: String(input.id) } satisfies TmxProperty;
		if (idIndex >= 0) properties[idIndex] = { ...properties[idIndex], ...id };
		else properties.unshift(id);
	}
	const name = { type: "name", text: input.name ?? "" } satisfies TmxProperty;
	const nameIndex = properties.findIndex(
		(property) => property.type === "name",
	);
	if (nameIndex >= 0)
		properties[nameIndex] = { ...properties[nameIndex], ...name };
	else properties.push(name);
	return properties;
}

function serializeProperty(property: TmxProperty): string {
	const attributes = {
		type: property.type,
		...(property.language ? { "xml:lang": property.language } : {}),
		...(property.originalEncoding
			? { "o-encoding": property.originalEncoding }
			: {}),
	};
	return `<prop${serializeAttributes(attributes)}>${escapeXml(property.text)}</prop>`;
}

function serializeUserDefinedEncoding(
	encoding: TmxUserDefinedEncoding,
	prefix: string,
): string[] {
	if (!encoding.name || encoding.maps.length === 0)
		throw new Error(
			"TMX user-defined encodings need a name and at least one map.",
		);
	if (encoding.maps.some((map) => map.code) && !encoding.base)
		throw new Error(`TMX user-defined encoding “${encoding.name}” needs base.`);
	const lines = [
		`${prefix}<ude${serializeAttributes({ name: encoding.name, ...(encoding.base ? { base: encoding.base } : {}) })}>`,
	];
	for (const map of encoding.maps) {
		assertAllowedAttributes(
			map,
			new Set(["unicode", "code", "ent", "subst"]),
			`TMX user-defined encoding “${encoding.name}” map`,
		);
		if (!map.unicode || (!map.code && !map.ent && !map.subst))
			throw new Error(
				`TMX user-defined encoding “${encoding.name}” has an invalid map.`,
			);
		lines.push(`${prefix}  <map${serializeAttributes(map)}/>`);
	}
	lines.push(`${prefix}</ude>`);
	return lines;
}

function mergeTermTargets(first: TmTerm, second: TmTerm): TmTerm {
	const targets = first.target.map(cloneVariant);
	const seen = new Set(targets.map(variantKey));
	for (const target of second.target) {
		const key = variantKey(target);
		if (!seen.has(key)) {
			seen.add(key);
			targets.push(cloneVariant(target));
		}
	}
	return { ...first, target: targets };
}

function sourceKey(variant: TmVariant): string {
	return `${variant.lang.toLowerCase()}\u0000${variantSignature(variant)}`;
}

function variantKey(variant: TmVariant): string {
	return `${variant.lang.toLowerCase()}\u0000${variantSignature(variant)}`;
}

function variantSignature(variant: TmVariant): string {
	return variant.content
		? JSON.stringify(variant.content.fragments)
		: variant.segment.normalize("NFC");
}

function cloneTerm(term: TmTerm): TmTerm {
	return structuredClone(term);
}

function cloneVariant(variant: TmVariant): TmVariant {
	return structuredClone(variant);
}

function normalizeLanguage(language: string): string {
	const match = language.match(/\(([^)]+)\)/);
	return (match?.[1] ?? language).trim();
}

function validateSourceLanguage(value: string, location: string): void {
	if (
		!value ||
		(value !== "*all*" && !/^[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8})*$/.test(value))
	)
		throw malformed(`The TMX ${location} has invalid srclang “${value}”.`);
}

function validateInlineElement(element: Element, unitIndex: number): void {
	const name = localName(element);
	const allowedAttributes =
		name === "bpt"
			? new Set(["i", "x", "type"])
			: name === "ept"
				? new Set(["i"])
				: name === "it"
					? new Set(["pos", "x", "type"])
					: name === "ph"
						? new Set(["x", "assoc", "type"])
						: name === "hi"
							? new Set(["x", "type"])
							: name === "ut"
								? new Set(["x"])
								: new Set(["datatype", "type"]);
	assertAllowedAttributes(
		attributesOf(element),
		allowedAttributes,
		`TMX unit ${unitIndex + 1} inline <${name}>`,
	);
	if ((name === "bpt" || name === "ept") && !element.getAttribute("i"))
		throw malformed(`TMX inline <${name}> requires an i attribute.`);
	if (
		name === "it" &&
		!/^(?:begin|end)$/.test(element.getAttribute("pos") ?? "")
	)
		throw malformed("TMX inline <it> requires pos=begin or pos=end.");
	const allowedChildren =
		name === "hi" || name === "sub"
			? new Set(["bpt", "ept", "it", "ph", "hi", "ut"])
			: new Set(["sub"]);
	for (const child of directElementChildren(element)) {
		if (!allowedChildren.has(localName(child)))
			throw malformed(
				`TMX unit ${unitIndex + 1} inline <${name}> contains invalid <${localName(child)}>.`,
			);
		validateInlineElement(child, unitIndex);
	}
}

function assertAllowedAttributes(
	attributes: Record<string, string>,
	allowed: ReadonlySet<string>,
	location: string,
): void {
	const unknown = Object.keys(attributes).find(
		(attribute) => !allowed.has(attribute),
	);
	if (unknown)
		throw malformed(`${location} has unsupported attribute “${unknown}”.`);
}

function serializeAttributes(attributes: Record<string, string>): string {
	return Object.entries(attributes)
		.filter(([, value]) => value !== "")
		.map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
		.join("");
}

function attributesOf(element: Element): Record<string, string> {
	return Object.fromEntries(
		Array.from(element.attributes).map((attribute) => [
			attribute.name,
			attribute.value,
		]),
	);
}

function directElementChildren(element: Element): Element[] {
	return Array.from(element.childNodes).filter(
		(node): node is Element => node.nodeType === 1,
	);
}

function directChildren(element: Element, name: string): Element[] {
	return directElementChildren(element).filter(
		(child) => localName(child) === name,
	);
}

function directChild(element: Element, name: string): Element | undefined {
	return directChildren(element, name)[0];
}

function localName(element: Element): string {
	return (
		element.localName ||
		element.tagName.split(":").at(-1) ||
		""
	).toLowerCase();
}

function xmlLanguage(element: Element): string | undefined {
	return (
		element.getAttribute("xml:lang") ??
		element.getAttributeNS?.("http://www.w3.org/XML/1998/namespace", "lang") ??
		undefined
	);
}

function serializeNode(element: Element): string {
	return new XMLSerializer().serializeToString(element);
}

function serializeChildren(element: Element): string {
	return Array.from(element.childNodes)
		.map((child) => new XMLSerializer().serializeToString(child))
		.join("");
}

function openingTag(element: Element): string {
	return `<${localName(element)}${serializeAttributes(attributesOf(element))}>`;
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'\"]/g, (character) => {
		switch (character) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case "'":
				return "&apos;";
			default:
				return "&quot;";
		}
	});
}

function malformed(message: string): SafeInputError {
	return new SafeInputError("XML_MALFORMED", message);
}
