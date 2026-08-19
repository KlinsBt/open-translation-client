import type { HtmlSegmentMeta } from "$lib/types/types";
import { safeParseXml } from "$lib/formats/safeInput";
import {
	splitTextWithPreferences,
	type SplitPiece,
} from "./splitWithPreferences";
import { getActiveTokens } from "./parsingPreferences";
import {
	inspectOpaqueTemplateRanges,
	isHtmlHelpTranslatableAttribute,
	isServerCodeElement,
	type OpaqueTemplateRange,
	type ServerHtmlProfile,
} from "$lib/formats/serverHtml";

export interface HtmlTextSegment {
	text: string;
	separator: string;
}

export interface HtmlAttributeSegment {
	attribute: string;
	text: string;
	separator: string;
}

export interface HtmlSegmentation {
	doc: Document;
	textSegments: HtmlTextSegment[];
	attributeSegments: HtmlAttributeSegment[];
	allSegments: string[];
	meta: HtmlMeta[];
}

export interface HtmlFilterOptions {
	includeTextNodes?: boolean;
	translatableAttributes?: readonly string[];
	excludedElements?: readonly string[];
	respectTranslateMetadata?: boolean;
	profile?: ServerHtmlProfile;
}

export type HtmlMeta = HtmlSegmentMeta;

interface ParsedAttribute {
	name: string;
	value: string;
	start: number;
	end: number;
	quote: '"' | "'" | "unquoted";
}

interface ParsedTag {
	kind: "start" | "end" | "other";
	name?: string;
	attributes: ParsedAttribute[];
	end: number;
	selfClosing: boolean;
}

interface ElementState {
	tag: string;
	translate: boolean;
	excluded: boolean;
	language?: string;
	direction?: "ltr" | "rtl" | "auto";
	note?: string;
}

interface ItsTranslateRule {
	tag: string;
	attribute?: "class" | "id";
	value?: string;
	translate: boolean;
}

const HARD_PROTECTED_ELEMENTS = new Set(["script", "style"]);
const VOID_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);
const RAW_TEXT_ELEMENTS = new Set([
	"script",
	"style",
	"textarea",
	"title",
	"xmp",
	"iframe",
	"noembed",
	"noframes",
	"plaintext",
]);

function findTagEnd(source: string, start: number): number {
	let quote = "";
	for (let index = start + 1; index < source.length; index++) {
		const character = source[index];
		if (quote) {
			if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index + 1;
	}
	return -1;
}

function parseTag(source: string, start: number): ParsedTag | undefined {
	if (source.startsWith("<!--", start)) {
		const close = source.indexOf("-->", start + 4);
		return {
			kind: "other",
			attributes: [],
			end: close < 0 ? source.length : close + 3,
			selfClosing: true,
		};
	}
	if (source.startsWith("<![CDATA[", start)) {
		const close = source.indexOf("]]>", start + 9);
		return {
			kind: "other",
			attributes: [],
			end: close < 0 ? source.length : close + 3,
			selfClosing: true,
		};
	}
	const end = findTagEnd(source, start);
	if (end < 0) return undefined;
	let cursor = start + 1;
	if (["!", "?"].includes(source[cursor] ?? ""))
		return { kind: "other", attributes: [], end, selfClosing: true };
	let kind: ParsedTag["kind"] = "start";
	if (source[cursor] === "/") {
		kind = "end";
		cursor++;
	}
	const nameStart = cursor;
	while (/[A-Za-z0-9_.:-]/.test(source[cursor] ?? "")) cursor++;
	if (cursor === nameStart) return undefined;
	const name = source.slice(nameStart, cursor).toLowerCase();
	if (kind === "end")
		return { kind, name, attributes: [], end, selfClosing: true };
	const attributes: ParsedAttribute[] = [];
	while (cursor < end - 1) {
		while (/\s/.test(source[cursor] ?? "")) cursor++;
		if (source[cursor] === "/" || source[cursor] === ">") break;
		const attributeStart = cursor;
		while (/[^\s=/>]/.test(source[cursor] ?? "")) cursor++;
		if (cursor === attributeStart) {
			cursor++;
			continue;
		}
		const attributeName = source.slice(attributeStart, cursor).toLowerCase();
		while (/\s/.test(source[cursor] ?? "")) cursor++;
		if (source[cursor] !== "=") {
			attributes.push({
				name: attributeName,
				value: "",
				start: cursor,
				end: cursor,
				quote: "unquoted",
			});
			continue;
		}
		cursor++;
		while (/\s/.test(source[cursor] ?? "")) cursor++;
		const quoteCharacter = source[cursor];
		if (quoteCharacter === '"' || quoteCharacter === "'") {
			cursor++;
			const valueStart = cursor;
			while (cursor < end - 1 && source[cursor] !== quoteCharacter) cursor++;
			attributes.push({
				name: attributeName,
				value: source.slice(valueStart, cursor),
				start: valueStart,
				end: cursor,
				quote: quoteCharacter,
			});
			if (source[cursor] === quoteCharacter) cursor++;
		} else {
			const valueStart = cursor;
			while (/[^\s>]/.test(source[cursor] ?? "")) cursor++;
			attributes.push({
				name: attributeName,
				value: source.slice(valueStart, cursor).replace(/\/$/, ""),
				start: valueStart,
				end: source[cursor - 1] === "/" ? cursor - 1 : cursor,
				quote: "unquoted",
			});
		}
	}
	return {
		kind,
		name,
		attributes,
		end,
		selfClosing:
			/\/\s*>$/.test(source.slice(start, end)) || VOID_ELEMENTS.has(name),
	};
}

function decodeEntities(value: string): string {
	if (!value.includes("&")) return value;
	const document = new DOMParser().parseFromString(
		`<!doctype html><body><textarea>${value.replace(/<\/textarea/gi, "&lt;/textarea")}</textarea>`,
		"text/html",
	);
	return document.querySelector("textarea")?.textContent ?? value;
}

function attributeMap(
	attributes: ParsedAttribute[],
): Map<string, ParsedAttribute> {
	return new Map(attributes.map((attribute) => [attribute.name, attribute]));
}

function normalizeDirection(
	value: string | undefined,
): "ltr" | "rtl" | "auto" | undefined {
	const direction = value?.toLowerCase();
	return direction === "ltr" || direction === "rtl" || direction === "auto"
		? direction
		: undefined;
}

function autoClose(stack: ElementState[], tag: string) {
	const closes =
		tag === "p"
			? new Set(["p"])
			: tag === "li"
				? new Set(["li"])
				: tag === "dt" || tag === "dd"
					? new Set(["dt", "dd"])
					: tag === "tr"
						? new Set(["tr"])
						: tag === "td" || tag === "th"
							? new Set(["td", "th"])
							: tag === "option"
								? new Set(["option"])
								: undefined;
	if (!closes) return;
	for (let index = stack.length - 1; index >= 0; index--)
		if (closes.has(stack[index].tag)) {
			stack.splice(index);
			return;
		}
}

function popElement(stack: ElementState[], tag: string) {
	for (let index = stack.length - 1; index >= 0; index--)
		if (stack[index].tag === tag) {
			stack.splice(index);
			return;
		}
}

function normalizedTranslationFlag(
	attributes: Map<string, ParsedAttribute>,
): boolean | undefined {
	const value =
		attributes.get("translate")?.value ??
		attributes.get("its:translate")?.value ??
		attributes.get("data-its-translate")?.value;
	if (value === undefined) return undefined;
	const normalized = decodeEntities(value).trim().toLowerCase();
	if (normalized === "no") return false;
	if (normalized === "yes" || normalized === "") return true;
	return undefined;
}

function inlineItsTranslateRules(source: string): ItsTranslateRule[] {
	const rules: ItsTranslateRule[] = [];
	for (const script of source.matchAll(
		/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,
	)) {
		const type = script[1].match(
			/\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
		);
		if (
			(type?.[1] ?? type?.[2] ?? type?.[3] ?? "").toLowerCase() !==
			"application/its+xml"
		)
			continue;
		let document: Document;
		try {
			document = safeParseXml(script[2]);
		} catch {
			continue;
		}
		for (const rule of Array.from(document.getElementsByTagName("*")).filter(
			(element) => element.localName.toLowerCase() === "translaterule",
		)) {
			const translate = rule.getAttribute("translate")?.toLowerCase();
			if (translate !== "yes" && translate !== "no") continue;
			for (const selector of (rule.getAttribute("selector") ?? "").split("|")) {
				const match = selector
					.trim()
					.match(
						/^\/\/(?:[\w.-]+:)?([\w*-]+)(?:\[@(class|id)\s*=\s*["']([^"']+)["']\])?$/i,
					);
				if (!match) continue;
				rules.push({
					tag: match[1].toLowerCase(),
					...(match[2]
						? {
								attribute: match[2].toLowerCase() as "class" | "id",
								value: match[3],
							}
						: {}),
					translate: translate === "yes",
				});
			}
		}
	}
	return rules;
}

function globalTranslateFlag(
	rules: ItsTranslateRule[],
	tag: string,
	attributes: Map<string, ParsedAttribute>,
): boolean | undefined {
	let result: boolean | undefined;
	for (const rule of rules) {
		if (rule.tag !== "*" && rule.tag !== tag) continue;
		if (rule.attribute) {
			const actual = decodeEntities(
				attributes.get(rule.attribute)?.value ?? "",
			);
			if (
				rule.attribute === "class"
					? !actual.split(/\s+/).includes(rule.value ?? "")
					: actual !== rule.value
			)
				continue;
		}
		result = rule.translate;
	}
	return result;
}

function segmentPieces(decoded: string, tokens: string[]): SplitPiece[] {
	return (
		splitTextWithPreferences(decoded, tokens, getActiveTokens) as SplitPiece[]
	).filter((piece) => piece.text.trim().length > 0);
}

function escapeHtmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(
	value: string,
	quote: '"' | "'" | "unquoted",
): string {
	let escaped = value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
	if (quote === '"') return escaped.replaceAll('"', "&quot;");
	if (quote === "'") return escaped.replaceAll("'", "&#39;");
	return escaped.replace(
		/[\s"'`=>]/g,
		(character) => `&#${character.charCodeAt(0)};`,
	);
}

function overlapsOpaqueRange(
	start: number,
	end: number,
	ranges: readonly OpaqueTemplateRange[],
): boolean {
	return ranges.some((range) => range.start < end && range.end > start);
}

export function segmentHtmlContent(
	htmlContent: string,
	tokensOverride?: string[],
	filterOptions: HtmlFilterOptions = {},
): HtmlSegmentation {
	const doc = new DOMParser().parseFromString(htmlContent, "text/html");
	const textSegments: HtmlTextSegment[] = [];
	const attributeSegments: HtmlAttributeSegment[] = [];
	const allSegments: string[] = [];
	const meta: HtmlMeta[] = [];
	const tokens = tokensOverride ?? getActiveTokens();
	const selectedAttributes = new Set(
		(
			filterOptions.translatableAttributes ?? [
				"placeholder",
				"value",
				"alt",
				"title",
				"text",
			]
		).map((attribute) => attribute.toLowerCase()),
	);
	const excludedElements = new Set(
		(filterOptions.excludedElements ?? ["script", "style", "code"]).map((tag) =>
			tag.toLowerCase(),
		),
	);
	const respectTranslate = filterOptions.respectTranslateMetadata ?? true;
	const globalRules = respectTranslate
		? inlineItsTranslateRules(htmlContent)
		: [];
	const opaqueInspection = inspectOpaqueTemplateRanges(
		htmlContent,
		filterOptions.profile,
	);
	const opaqueRanges = opaqueInspection.ranges;
	const stack: ElementState[] = [];
	let textTokenIndex = 0;
	let elementIndex = 0;
	let opaqueIndex = 0;

	const addRange = (
		kind: "text" | "attribute",
		raw: string,
		start: number,
		end: number,
		state: ElementState,
		path: number[],
		attribute?: ParsedAttribute,
	) => {
		const decoded = decodeEntities(raw);
		const pieces = segmentPieces(decoded, tokens);
		if (!pieces.length) return;
		for (const [pieceIndex, piece] of pieces.entries()) {
			const sourceText = `${piece.text}${piece.separator ?? ""}`;
			const common = {
				path: [...path],
				separator: piece.separator ?? "",
				start,
				end,
				sourceText,
				...(pieceIndex === 0 ? { prefix: decoded.slice(0, piece.start) } : {}),
				...(pieceIndex === pieces.length - 1
					? { suffix: decoded.slice(piece.end) }
					: {}),
				...(state.language ? { language: state.language } : {}),
				...(state.direction ? { direction: state.direction } : {}),
				...(state.note ? { note: state.note } : {}),
			};
			if (kind === "text") {
				textSegments.push({
					text: piece.text,
					separator: piece.separator ?? "",
				});
				meta.push({ kind: "text", ...common });
			} else if (attribute) {
				attributeSegments.push({
					attribute: attribute.name,
					text: piece.text,
					separator: piece.separator ?? "",
				});
				meta.push({
					kind: "attribute",
					...common,
					attribute: attribute.name,
					quote: attribute.quote,
				});
			}
			allSegments.push(sourceText);
		}
	};

	let cursor = 0;
	while (cursor < htmlContent.length) {
		while (
			opaqueIndex < opaqueRanges.length &&
			opaqueRanges[opaqueIndex].end <= cursor
		)
			opaqueIndex++;
		const opaque = opaqueRanges[opaqueIndex];
		if (opaque?.start === cursor) {
			cursor = opaque.end;
			continue;
		}
		const parent = stack.at(-1);
		if (parent && RAW_TEXT_ELEMENTS.has(parent.tag)) {
			const closing =
				parent.tag === "plaintext"
					? -1
					: htmlContent.toLowerCase().indexOf(`</${parent.tag}`, cursor);
			if (closing === cursor) {
				// Let the normal tag parser consume the raw-text closing tag.
			} else {
				const rawEnd = closing < 0 ? htmlContent.length : closing;
				const end =
					opaque && opaque.start > cursor && opaque.start < rawEnd
						? opaque.start
						: rawEnd;
				if (
					end > cursor &&
					filterOptions.includeTextNodes !== false &&
					parent.translate &&
					!parent.excluded
				)
					addRange(
						"text",
						htmlContent.slice(cursor, end),
						cursor,
						end,
						parent,
						[0, textTokenIndex++],
					);
				cursor = end;
				if (end < rawEnd) continue;
				if (closing < 0) break;
				continue;
			}
		}

		const nextTag = htmlContent.indexOf("<", cursor);
		const nextMarkup = nextTag < 0 ? htmlContent.length : nextTag;
		const textEnd =
			opaque && opaque.start > cursor && opaque.start < nextMarkup
				? opaque.start
				: nextMarkup;
		if (textEnd > cursor) {
			const state: ElementState = parent ?? {
				tag: "#document",
				translate: true,
				excluded: false,
			};
			if (
				filterOptions.includeTextNodes !== false &&
				state.translate &&
				!state.excluded
			)
				addRange(
					"text",
					htmlContent.slice(cursor, textEnd),
					cursor,
					textEnd,
					state,
					[0, textTokenIndex++],
				);
			cursor = textEnd;
			if (cursor >= htmlContent.length) break;
			if (opaque?.start === cursor) continue;
		}

		const tag = parseTag(htmlContent, cursor);
		if (!tag) {
			const nextCandidate = htmlContent.indexOf("<", cursor + 1);
			const end = nextCandidate < 0 ? htmlContent.length : nextCandidate;
			const state: ElementState = stack.at(-1) ?? {
				tag: "#document",
				translate: true,
				excluded: false,
			};
			if (
				filterOptions.includeTextNodes !== false &&
				state.translate &&
				!state.excluded
			)
				addRange("text", htmlContent.slice(cursor, end), cursor, end, state, [
					0,
					textTokenIndex++,
				]);
			cursor = end;
			continue;
		}
		if (tag.kind === "end" && tag.name) popElement(stack, tag.name);
		if (tag.kind === "start" && tag.name) {
			autoClose(stack, tag.name);
			const inherited = stack.at(-1);
			const attributes = attributeMap(tag.attributes);
			const flag = respectTranslate
				? normalizedTranslationFlag(attributes)
				: undefined;
			const globalFlag = respectTranslate
				? globalTranslateFlag(globalRules, tag.name, attributes)
				: undefined;
			const language = decodeEntities(
				attributes.get("lang")?.value ??
					attributes.get("xml:lang")?.value ??
					inherited?.language ??
					"",
			).trim();
			const direction =
				normalizeDirection(attributes.get("dir")?.value) ??
				inherited?.direction;
			const localNote = decodeEntities(
				attributes.get("its-loc-note")?.value ??
					attributes.get("its:locnote")?.value ??
					attributes.get("data-its-loc-note")?.value ??
					inherited?.note ??
					"",
			).trim();
			const state: ElementState = {
				tag: tag.name,
				translate: flag ?? globalFlag ?? inherited?.translate ?? true,
				excluded:
					HARD_PROTECTED_ELEMENTS.has(tag.name) ||
					isServerCodeElement(filterOptions.profile, tag.name) ||
					excludedElements.has(tag.name) ||
					(inherited?.excluded ?? false),
				...(language ? { language } : {}),
				...(direction ? { direction } : {}),
				...(localNote ? { note: localNote } : {}),
			};
			if (state.translate && !state.excluded)
				for (const attribute of tag.attributes)
					if (
						selectedAttributes.has(attribute.name) &&
						attribute.end > attribute.start &&
						!overlapsOpaqueRange(
							attribute.start,
							attribute.end,
							opaqueRanges,
						) &&
						isHtmlHelpTranslatableAttribute(
							filterOptions.profile,
							tag.name,
							attributes,
							attribute.name,
						)
					)
						addRange(
							"attribute",
							attribute.value,
							attribute.start,
							attribute.end,
							state,
							[1, elementIndex],
							attribute,
						);
			elementIndex++;
			if (!tag.selfClosing) stack.push(state);
		}
		cursor = tag.end;
	}

	return { doc, textSegments, attributeSegments, allSegments, meta };
}

interface RangeGroup {
	start: number;
	end: number;
	kind: HtmlMeta["kind"];
	entries: Array<{ meta: HtmlMeta; translation: string }>;
}

function hasTargetedMetadata(meta: HtmlMeta[], sourceLength: number): boolean {
	return (
		meta.length > 0 &&
		meta.every(
			(entry) =>
				Number.isInteger(entry.start) &&
				Number.isInteger(entry.end) &&
				entry.start! >= 0 &&
				entry.end! >= entry.start! &&
				entry.end! <= sourceLength &&
				typeof entry.sourceText === "string",
		)
	);
}

function applyTargetedRanges(
	htmlContent: string,
	translatedSegments: readonly string[],
	meta: HtmlMeta[],
): string {
	const groups = new Map<string, RangeGroup>();
	for (const [index, entry] of meta.entries()) {
		const key = `${entry.kind}:${entry.start}:${entry.end}`;
		const group = groups.get(key) ?? {
			start: entry.start!,
			end: entry.end!,
			kind: entry.kind,
			entries: [],
		};
		group.entries.push({
			meta: entry,
			translation: translatedSegments[index] ?? entry.sourceText ?? "",
		});
		groups.set(key, group);
	}
	let output = htmlContent;
	for (const group of [...groups.values()].sort((a, b) => b.start - a.start)) {
		const first = group.entries[0].meta;
		const last = group.entries.at(-1)!.meta;
		const prefix = first.prefix ?? "";
		const suffix = last.suffix ?? "";
		const source = `${prefix}${group.entries
			.map((entry) => entry.meta.sourceText ?? "")
			.join("")}${suffix}`;
		const translated = `${prefix}${group.entries
			.map(({ meta: entry, translation }) => {
				const separator = entry.separator ?? "";
				const base =
					separator && translation.endsWith(separator)
						? translation.slice(0, -separator.length)
						: translation;
				return `${base}${separator}`;
			})
			.join("")}${suffix}`;
		if (translated === source) continue;
		const encoded =
			group.kind === "attribute" && first.kind === "attribute"
				? escapeHtmlAttribute(translated, first.quote ?? '"')
				: escapeHtmlText(translated);
		output = `${output.slice(0, group.start)}${encoded}${output.slice(group.end)}`;
	}
	return output;
}

function resolveLegacyPath(doc: Document, path: number[]): Node | null {
	let current: Node | null = doc.body;
	for (const index of path) {
		if (!current?.childNodes || index < 0 || index >= current.childNodes.length)
			return null;
		current = current.childNodes[index];
	}
	return current;
}

function applyLegacyDom(
	htmlContent: string,
	translatedSegments: readonly string[],
	meta: HtmlMeta[],
): string {
	const doc = new DOMParser().parseFromString(htmlContent, "text/html");
	const textPieces = new Map<Node, string[]>();
	const attributePieces = new Map<Element, Map<string, string[]>>();
	for (const [index, entry] of meta.entries()) {
		const node = resolveLegacyPath(doc, entry.path);
		if (!node) continue;
		const separator = entry.separator ?? "";
		const value = translatedSegments[index] ?? "";
		const base =
			separator && value.endsWith(separator)
				? value.slice(0, -separator.length)
				: value;
		const piece = `${base}${separator}`;
		if (entry.kind === "text" && node.nodeType === Node.TEXT_NODE)
			textPieces.set(node, [...(textPieces.get(node) ?? []), piece]);
		if (entry.kind === "attribute" && node.nodeType === Node.ELEMENT_NODE) {
			const element = node as Element;
			const values =
				attributePieces.get(element) ?? new Map<string, string[]>();
			values.set(entry.attribute, [
				...(values.get(entry.attribute) ?? []),
				piece,
			]);
			attributePieces.set(element, values);
		}
	}
	for (const [node, pieces] of textPieces) node.textContent = pieces.join("");
	for (const [element, attributes] of attributePieces)
		for (const [attribute, pieces] of attributes)
			element.setAttribute(attribute, pieces.join(""));
	return new XMLSerializer().serializeToString(doc);
}

export function applyTranslationsToHtml(
	htmlContent: string,
	translatedSegments: string[],
	tokensOverride?: string[],
	metaOverride?: HtmlMeta[],
	filterOptions: HtmlFilterOptions = {},
): string {
	let meta = metaOverride;
	if (!meta || meta.length !== translatedSegments.length)
		meta = segmentHtmlContent(htmlContent, tokensOverride, filterOptions).meta;
	if (meta.length !== translatedSegments.length) return htmlContent;
	return hasTargetedMetadata(meta, htmlContent.length)
		? applyTargetedRanges(htmlContent, translatedSegments, meta)
		: applyLegacyDom(htmlContent, translatedSegments, meta);
}
