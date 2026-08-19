import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { TypeRef, XmlSegmentMeta } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	safeParseXml,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type XmlValueReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

const ITS_NAMESPACE = "http://www.w3.org/2005/11/its";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const SPREADSHEETML_2003_NAMESPACE =
	"urn:schemas-microsoft-com:office:spreadsheet";

export interface XmlAttributeLocation {
	qName: string;
	localName: string;
	namespaceUri?: string;
	value: string;
	start: number;
	end: number;
	quote: '"' | "'";
}

export interface XmlElementLocation {
	id: number;
	qName: string;
	localName: string;
	namespaceUri?: string;
	parentId?: number;
	path: string[];
	selectorPath: string[];
	attributes: XmlAttributeLocation[];
	namespaces: Record<string, string>;
	startTagStart: number;
	startTagEnd: number;
	endTagStart?: number;
	endTagEnd?: number;
	selfClosing: boolean;
	localTranslate?: boolean;
	globalTranslate?: boolean;
	effectiveTranslate: boolean;
}

export interface XmlValueLocation {
	location: "text" | "cdata" | "attribute";
	elementId: number;
	path: string[];
	attribute?: string;
	start: number;
	end: number;
	value: string;
}

export interface XmlSyntaxDocument {
	elements: XmlElementLocation[];
	values: XmlValueLocation[];
	warnings: string[];
}

export function parseXmlSyntax(
	content: string,
	context?: SafeInputContext,
): XmlSyntaxDocument {
	// happy-dom's XML parser (used by the unit-test environment) treats the
	// first character inside every CDATA section as markup. Mask complete CDATA
	// sections only for this independent well-formedness check; the positional
	// scanner below validates their delimiters and retains their exact payload.
	safeParseXml(content.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ""), context);
	const elements: XmlElementLocation[] = [];
	const values: XmlValueLocation[] = [];
	const stack: XmlElementLocation[] = [];
	const childCounts = new Map<number | undefined, Map<string, number>>();
	let cursor = content.startsWith("\ufeff") ? 1 : 0;
	while (cursor < content.length) {
		if (content[cursor] !== "<") {
			const end = content.indexOf("<", cursor);
			const valueEnd = end < 0 ? content.length : end;
			addXmlTextValue(content, cursor, valueEnd, stack.at(-1), values, false);
			cursor = valueEnd;
			continue;
		}
		if (content.startsWith("<!--", cursor)) {
			const end = content.indexOf("-->", cursor + 4);
			if (end < 0) throw xmlMalformed("XML comment is not terminated", cursor);
			cursor = end + 3;
			continue;
		}
		if (content.startsWith("<![CDATA[", cursor)) {
			const end = content.indexOf("]]>", cursor + 9);
			if (end < 0)
				throw xmlMalformed("CDATA section is not terminated", cursor);
			addXmlTextValue(content, cursor + 9, end, stack.at(-1), values, true);
			cursor = end + 3;
			continue;
		}
		if (content.startsWith("<?", cursor)) {
			const end = content.indexOf("?>", cursor + 2);
			if (end < 0)
				throw xmlMalformed("Processing instruction is not terminated", cursor);
			cursor = end + 2;
			continue;
		}
		if (content.startsWith("</", cursor)) {
			const end = findXmlTagEnd(content, cursor);
			const element = stack.pop();
			if (element) {
				element.endTagStart = cursor;
				element.endTagEnd = end;
			}
			cursor = end + 1;
			continue;
		}
		if (content.startsWith("<!", cursor)) {
			throw new SafeInputError(
				"XML_UNSAFE_DECLARATION",
				"XML declarations other than comments and CDATA are not accepted for safe localization.",
			);
		}

		const end = findXmlTagEnd(content, cursor);
		const raw = content.slice(cursor + 1, end);
		const selfClosing = /\/\s*$/.test(raw);
		const name = raw.match(/^\s*([^\s/>]+)/)?.[1];
		if (!name) throw xmlMalformed("Start tag has no element name", cursor);
		const parent = stack.at(-1);
		const counts = childCounts.get(parent?.id) ?? new Map<string, number>();
		const occurrence = (counts.get(name) ?? 0) + 1;
		counts.set(name, occurrence);
		childCounts.set(parent?.id, counts);
		const attributes = parseXmlAttributes(content, cursor + 1, end, name);
		const namespaces = { ...(parent?.namespaces ?? {}) };
		for (const attribute of attributes) {
			if (attribute.qName === "xmlns") namespaces[""] = attribute.value;
			else if (attribute.qName.startsWith("xmlns:"))
				namespaces[attribute.qName.slice(6)] = attribute.value;
		}
		for (const attribute of attributes) {
			const prefix = attribute.qName.includes(":")
				? attribute.qName.split(":", 1)[0]
				: "";
			if (prefix && prefix !== "xmlns")
				attribute.namespaceUri =
					prefix === "xml" ? XML_NAMESPACE : namespaces[prefix];
		}
		const prefix = name.includes(":") ? name.split(":", 1)[0] : "";
		const element: XmlElementLocation = {
			id: elements.length,
			qName: name,
			localName: localName(name),
			...(prefix || namespaces[""]
				? { namespaceUri: prefix ? namespaces[prefix] : namespaces[""] }
				: {}),
			...(parent ? { parentId: parent.id } : {}),
			path: [...(parent?.path ?? []), `${name}[${occurrence}]`],
			selectorPath: [...(parent?.selectorPath ?? []), name],
			attributes,
			namespaces,
			startTagStart: cursor,
			startTagEnd: end,
			selfClosing,
			localTranslate: itsBoolean(attributes, "translate"),
			effectiveTranslate: true,
		};
		elements.push(element);
		if (!selfClosing) stack.push(element);
		cursor = end + 1;
	}
	applyItsTranslateRules(elements);
	for (const element of elements) {
		const parent =
			element.parentId === undefined ? undefined : elements[element.parentId];
		element.effectiveTranslate =
			element.localTranslate ??
			element.globalTranslate ??
			parent?.effectiveTranslate ??
			true;
	}
	return { elements, values, warnings: [] };
}

function addXmlTextValue(
	content: string,
	start: number,
	end: number,
	element: XmlElementLocation | undefined,
	values: XmlValueLocation[],
	cdata: boolean,
): void {
	if (!element || end <= start) return;
	const raw = content.slice(start, end);
	const leading = raw.match(/^\s*/)?.[0].length ?? 0;
	const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
	const coreStart = start + leading;
	const coreEnd = Math.max(coreStart, end - trailing);
	if (coreEnd <= coreStart) return;
	const core = content.slice(coreStart, coreEnd);
	values.push({
		location: cdata ? "cdata" : "text",
		elementId: element.id,
		path: [...element.path, cdata ? "#cdata" : "#text"],
		start: coreStart,
		end: coreEnd,
		value: cdata ? core : decodeXmlText(core),
	});
}

function findXmlTagEnd(content: string, start: number): number {
	let quote: '"' | "'" | undefined;
	for (let index = start + 1; index < content.length; index++) {
		const character = content[index];
		if (quote) {
			if (character === quote) quote = undefined;
		} else if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index;
	}
	throw xmlMalformed("XML tag is not terminated", start);
}

function parseXmlAttributes(
	content: string,
	start: number,
	end: number,
	elementName: string,
): XmlAttributeLocation[] {
	const attributes: XmlAttributeLocation[] = [];
	let cursor =
		start + content.slice(start, end).indexOf(elementName) + elementName.length;
	while (cursor < end) {
		while (/\s/.test(content[cursor] ?? "")) cursor++;
		if (content[cursor] === "/" || cursor >= end) break;
		const name = content.slice(cursor, end).match(/^([^\s=/>]+)/)?.[1];
		if (!name) throw xmlMalformed("Malformed XML attribute name", cursor);
		cursor += name.length;
		while (/\s/.test(content[cursor] ?? "")) cursor++;
		if (content[cursor++] !== "=")
			throw xmlMalformed(
				`XML attribute “${name}” has no equals sign`,
				cursor - 1,
			);
		while (/\s/.test(content[cursor] ?? "")) cursor++;
		const quote = content[cursor] as '"' | "'";
		if (quote !== '"' && quote !== "'")
			throw xmlMalformed(`XML attribute “${name}” is not quoted`, cursor);
		const valueStart = ++cursor;
		const valueEnd = content.indexOf(quote, valueStart);
		if (valueEnd < 0 || valueEnd > end)
			throw xmlMalformed(
				`XML attribute “${name}” is not terminated`,
				valueStart,
			);
		const rawValue = content.slice(valueStart, valueEnd);
		attributes.push({
			qName: name,
			localName: localName(name),
			value: decodeXmlText(rawValue),
			start: valueStart,
			end: valueEnd,
			quote,
		});
		cursor = valueEnd + 1;
	}
	return attributes;
}

function applyItsTranslateRules(elements: XmlElementLocation[]): void {
	for (const rule of elements.filter(
		(element) =>
			element.namespaceUri === ITS_NAMESPACE &&
			element.localName === "translateRule",
	)) {
		const selector = attributeValue(rule, "selector");
		const translate = attributeValue(rule, "translate");
		if (!selector || (translate !== "yes" && translate !== "no")) continue;
		if (!isSupportedElementSelector(selector))
			throw new SafeInputError(
				"XML_UNSUPPORTED_ITS",
				`ITS translateRule selector “${selector}” is outside the supported safe XPath subset.`,
			);
		for (const element of elements)
			if (matchesElementSelector(element, selector))
				element.globalTranslate = translate === "yes";
	}
}

function isSupportedElementSelector(selector: string): boolean {
	return (
		selector === "//*" ||
		/^\/\/?[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?(?:\/[A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)*$/.test(
			selector,
		)
	);
}

export function matchesElementSelector(
	element: XmlElementLocation,
	selector: string,
): boolean {
	if (selector === "//*" || selector === "*") return true;
	if (selector.startsWith("//")) {
		const name = selector.slice(2);
		return element.qName === name || element.localName === name;
	}
	const parts = selector.replace(/^\//, "").split("/").filter(Boolean);
	return (
		parts.length === element.selectorPath.length &&
		parts.every(
			(part, index) =>
				part === element.selectorPath[index] ||
				part === localName(element.selectorPath[index]),
		)
	);
}

function matchesAttributeSelector(
	element: XmlElementLocation,
	attribute: XmlAttributeLocation,
	selector: string,
): boolean {
	if (selector === "//@*" || selector === "@*") return true;
	if (selector.startsWith("//@")) {
		const name = selector.slice(3);
		return attribute.qName === name || attribute.localName === name;
	}
	const match = selector.match(/^(.*)\/@([^/]+)$/);
	if (match)
		return (
			matchesElementSelector(element, match[1] || "//*") &&
			(attribute.qName === match[2] || attribute.localName === match[2])
		);
	const name = selector.replace(/^@/, "");
	return attribute.qName === name || attribute.localName === name;
}

function itsBoolean(
	attributes: readonly XmlAttributeLocation[],
	name: string,
): boolean | undefined {
	const value = attributes.find(
		(attribute) =>
			attribute.namespaceUri === ITS_NAMESPACE && attribute.localName === name,
	)?.value;
	return value === "yes" ? true : value === "no" ? false : undefined;
}

function itsValue(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(attribute) =>
			attribute.namespaceUri === ITS_NAMESPACE && attribute.localName === name,
	)?.value;
}

function attributeValue(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(attribute) => attribute.qName === name || attribute.localName === name,
	)?.value;
}

function localName(qName: string): string {
	return qName.includes(":") ? qName.slice(qName.indexOf(":") + 1) : qName;
}

export function decodeXmlText(value: string): string {
	return value.replace(
		/&(#x[0-9A-Fa-f]+|#\d+|amp|lt|gt|quot|apos);/g,
		(_, entity: string) => {
			if (entity === "amp") return "&";
			if (entity === "lt") return "<";
			if (entity === "gt") return ">";
			if (entity === "quot") return '"';
			if (entity === "apos") return "'";
			return String.fromCodePoint(
				entity.startsWith("#x")
					? Number.parseInt(entity.slice(2), 16)
					: Number.parseInt(entity.slice(1), 10),
			);
		},
	);
}

function xmlMalformed(message: string, offset: number): SafeInputError {
	return new SafeInputError(
		"XML_MALFORMED",
		`${message} (character ${offset + 1}).`,
	);
}

export async function validateXmlFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseXmlSyntax(text, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file does not contain safe, well-formed XML.",
				};
	}
}

export async function importXmlFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("xml", options);
	const read = await readSafeTextFile(file, context);
	const syntax = parseXmlSyntax(read.text, context);
	const spreadsheetMl2003 = isSpreadsheetMl2003(syntax);
	const elementSelectors = parseList(filterOptions.elementSelectors);
	const attributeSelectors = parseList(filterOptions.attributeSelectors);
	const candidates: XmlValueLocation[] = [];
	for (const value of syntax.values) {
		const element = syntax.elements[value.elementId];
		if (!element || isItsInfrastructure(element)) continue;
		if (spreadsheetMl2003) {
			if (
				value.location !== "text" ||
				element.localName !== "Data" ||
				element.namespaceUri !== SPREADSHEETML_2003_NAMESPACE ||
				!isSpreadsheetStringData(element) ||
				hasSpreadsheetFormulaAncestor(element, syntax.elements)
			)
				continue;
			candidates.push(value);
			continue;
		}
		if (filterOptions.respectIts && !element.effectiveTranslate) continue;
		if (value.location === "cdata" && !filterOptions.includeCdata) continue;
		if (
			elementSelectors.some((selector) =>
				matchesElementSelector(element, selector),
			)
		)
			candidates.push(value);
	}
	for (const element of spreadsheetMl2003 ? [] : syntax.elements) {
		if (isItsInfrastructure(element)) continue;
		if (filterOptions.respectIts && !element.effectiveTranslate) continue;
		for (const attribute of element.attributes) {
			if (
				attribute.qName === "xmlns" ||
				attribute.qName.startsWith("xmlns:") ||
				attribute.namespaceUri === ITS_NAMESPACE ||
				attribute.namespaceUri === XML_NAMESPACE
			)
				continue;
			if (
				attributeSelectors.some((selector) =>
					matchesAttributeSelector(element, attribute, selector),
				)
			)
				candidates.push({
					location: "attribute",
					elementId: element.id,
					path: [...element.path, `@${attribute.qName}`],
					attribute: attribute.qName,
					start: attribute.start,
					end: attribute.end,
					value: attribute.value,
				});
		}
	}

	const segments: string[] = [];
	const meta: XmlSegmentMeta[] = [];
	const replacements: XmlValueReplacement[] = [];
	const details: XmlValueLocation[] = [];
	for (const candidate of candidates.sort(
		(first, second) => first.start - second.start,
	)) {
		const mode = String(filterOptions.segmentationMode);
		const pieces =
			mode === "value"
				? [{ text: candidate.value, separator: "" }]
				: mode === "sentences"
					? segmentPlainText(candidate.value, "sentences")
					: splitTextWithPreferences(candidate.value);
		const effective = pieces.filter((piece) => piece.text.trim().length > 0);
		for (const piece of effective.length
			? effective
			: [{ text: candidate.value, separator: "" }]) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			const common = {
				path: [...candidate.path],
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
			details.push(candidate);
		}
	}

	const document = createNeutralDocument({
		format: "xml",
		sourceSegments: segments,
		targetSegments: segments.map(() => ""),
		sourceLocations: details.map((value, index) => ({
			part: file.name,
			path: [...value.path],
			segmentIndex: index,
		})),
	});
	document.metadata = {
		encoding: read.encoding,
		hasBom: read.hasBom,
		profile: spreadsheetMl2003 ? "SpreadsheetML 2003" : "Generic XML",
		...(spreadsheetMl2003
			? {
					activeContentPolicy:
						"Formulas, scripts, external links, and embedded objects are preserved but never evaluated.",
				}
			: {}),
	};
	const localizationNotes = new Map<number, string[]>();
	for (const noteValue of syntax.values) {
		const noteElement = syntax.elements[noteValue.elementId];
		if (
			noteElement?.namespaceUri !== ITS_NAMESPACE ||
			noteElement.localName !== "locNote" ||
			noteElement.parentId === undefined
		)
			continue;
		const notes = localizationNotes.get(noteElement.parentId) ?? [];
		notes.push(noteValue.value);
		localizationNotes.set(noteElement.parentId, notes);
	}
	for (const [index, value] of details.entries()) {
		const element = syntax.elements[value.elementId];
		const unit = document.units[index];
		if (!element || !unit) continue;
		unit.contexts.push({ type: "xml-path", value: value.path.join("/") });
		for (const [type, contextValue] of [
			[
				"xml-id",
				attributeValue(element, "id") ?? attributeValue(element, "xml:id"),
			],
			["xml-language", attributeValue(element, "xml:lang")],
			["its-within-text", itsValue(element, "withinText")],
			[
				"its-preserve-space",
				itsValue(element, "preserveSpace") ??
					attributeValue(element, "xml:space"),
			],
			["its-term", itsValue(element, "term")],
			["its-locale-filter", itsValue(element, "localeFilterList")],
		] as const)
			if (contextValue) unit.contexts.push({ type, value: contextValue });
		const notes = [
			...(itsValue(element, "locNote") ? [itsValue(element, "locNote")!] : []),
			...(localizationNotes.get(element.id) ?? []),
		];
		for (const note of notes)
			unit.notes.push({
				category: "its-localization-note",
				text: note,
				appliesTo: "source",
			});
	}
	return {
		kind: "segments",
		segments,
		targetSegments: segments.map(() => ""),
		document,
		skeleton: await createTextSkeleton(
			file,
			"xml",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: {
			profile: spreadsheetMl2003 ? "spreadsheetml-2003" : "generic-xml",
		} as TypeRef,
		segmentsMeta: meta,
	};
}

function isSpreadsheetMl2003(syntax: XmlSyntaxDocument): boolean {
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	return (
		root?.localName === "Workbook" &&
		root.namespaceUri === SPREADSHEETML_2003_NAMESPACE
	);
}

function isSpreadsheetStringData(element: XmlElementLocation): boolean {
	const type = element.attributes.find(
		(attribute) =>
			attribute.localName === "Type" &&
			(attribute.namespaceUri === SPREADSHEETML_2003_NAMESPACE ||
				attribute.qName === "Type"),
	)?.value;
	return !type || type.toLowerCase() === "string";
}

function hasSpreadsheetFormulaAncestor(
	element: XmlElementLocation,
	elements: readonly XmlElementLocation[],
): boolean {
	let current =
		element.parentId === undefined ? undefined : elements[element.parentId];
	while (current) {
		if (
			current.localName === "Cell" &&
			current.attributes.some(
				(attribute) => attribute.localName.toLowerCase() === "formula",
			)
		)
			return true;
		current =
			current.parentId === undefined ? undefined : elements[current.parentId];
	}
	return false;
}

function isItsInfrastructure(element: XmlElementLocation): boolean {
	if (element.namespaceUri !== ITS_NAMESPACE) return false;
	return ["rules", "translateRule", "locNoteRule", "locNote"].includes(
		element.localName,
	);
}
