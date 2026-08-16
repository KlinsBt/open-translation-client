import type { DocxSegmentMeta } from "$lib/types/types";
import { safeParseXml } from "$lib/formats/safeInput";
import {
	splitTextWithPreferences,
	type SplitPiece,
} from "./splitWithPreferences";
import { getActiveTokens, getDefaultTokens } from "./parsingPreferences";

export type DocxTrackedChangesPolicy = "current" | "original" | "all";

export interface DocxParseOptions {
	part?: string;
	trackedChanges?: DocxTrackedChangesPolicy;
	includeTextBoxes?: boolean;
	includeDrawingText?: boolean;
}

export interface DocxPackageParseOptions extends DocxParseOptions {
	includeHeadersFooters?: boolean;
	includeNotes?: boolean;
	includeComments?: boolean;
}

export interface DocxSegmentFragment {
	node: Element;
	start: number;
	end: number;
}

export interface DocxSegment {
	text: string;
	separator: string;
	fragments: DocxSegmentFragment[];
}

interface SplitSegment {
	text: string;
	start: number;
	end: number;
	separator: string;
}

interface NodeRange {
	node: Element;
	start: number;
	end: number;
}

interface TextFlow {
	nodes: Element[];
}

export interface DocxSegmentationResult {
	xmlDoc: Document;
	segments: DocxSegment[];
	meta: DocxSegmentMeta[];
}

export interface DocxPackageSegmentationResult {
	segments: DocxSegment[];
	meta: DocxSegmentMeta[];
	parts: string[];
}

const WORD_TEXT_PARTS = {
	document: "word/document.xml",
	footnotes: "word/footnotes.xml",
	endnotes: "word/endnotes.xml",
	comments: "word/comments.xml",
} as const;

function splitParagraphIntoSegments(paragraphText: string): SplitSegment[] {
	const segments: SplitSegment[] = [];
	let cursor = 0;
	while (cursor < paragraphText.length) {
		let boundary = paragraphText.length;
		for (let index = cursor; index < paragraphText.length; index++) {
			if ([".", "?", "!", "。", "！", "？"].includes(paragraphText[index])) {
				boundary = index + 1;
				break;
			}
		}
		let end = boundary;
		while (end < paragraphText.length && /\s/.test(paragraphText[end])) end++;
		const rawSegment = paragraphText.slice(cursor, end);
		const leadingWhitespace = rawSegment.match(/^\s*/)?.[0].length ?? 0;
		const trailingWhitespace = rawSegment.match(/\s*$/)?.[0].length ?? 0;
		const start = cursor + leadingWhitespace;
		const trimmedEnd = end - trailingWhitespace;
		const text = paragraphText.slice(start, trimmedEnd);
		if (text)
			segments.push({
				text,
				start,
				end,
				separator: paragraphText.slice(trimmedEnd, end),
			});
		cursor = end;
	}
	return segments;
}

function buildNodeRanges(textNodes: Element[]): NodeRange[] {
	const ranges: NodeRange[] = [];
	let offset = 0;
	for (const node of textNodes) {
		const text = node.textContent ?? "";
		ranges.push({ node, start: offset, end: offset + text.length });
		offset += text.length;
	}
	return ranges;
}

function isWordElement(element: Element, localName: string): boolean {
	if (element.localName !== localName) return false;
	return (
		element.prefix === "w" ||
		element.tagName === `w:${localName}` ||
		/wordprocessingml|ooxml\/wordprocessingml/i.test(
			element.namespaceURI ?? "",
		) ||
		["w", "urn:word", "urn:test"].includes(element.namespaceURI ?? "")
	);
}

function isDrawingElement(element: Element, localName: string): boolean {
	if (element.localName !== localName) return false;
	return (
		element.prefix === "a" ||
		element.tagName === `a:${localName}` ||
		/drawingml/i.test(element.namespaceURI ?? "")
	);
}

function isTextElement(element: Element): boolean {
	return (
		isWordElement(element, "t") ||
		isWordElement(element, "delText") ||
		isDrawingElement(element, "t")
	);
}

function descendantElements(element: Element): Element[] {
	return Array.from(element.getElementsByTagName("*"));
}

function hasWordAncestor(element: Element, localName: string): boolean {
	let parent = element.parentElement;
	while (parent) {
		if (isWordElement(parent, localName)) return true;
		parent = parent.parentElement;
	}
	return false;
}

function hasExcludedRevisionAncestor(
	element: Element,
	policy: DocxTrackedChangesPolicy,
): boolean {
	let parent = element.parentElement;
	while (parent) {
		if (revisionIsExcluded(parent, policy)) return true;
		parent = parent.parentElement;
	}
	return false;
}

function wordParagraphs(document: Document): Element[] {
	return descendantElements(document.documentElement).filter((element) =>
		isWordElement(element, "p"),
	);
}

function paragraphTextNodes(paragraph: Element): Element[] {
	return descendantElements(paragraph).filter(isTextElement);
}

function revisionIsExcluded(
	element: Element,
	policy: DocxTrackedChangesPolicy,
): boolean {
	const deleted =
		isWordElement(element, "del") || isWordElement(element, "moveFrom");
	const inserted =
		isWordElement(element, "ins") || isWordElement(element, "moveTo");
	return (
		(policy === "current" && deleted) || (policy === "original" && inserted)
	);
}

function fieldCharacterType(element: Element): string | undefined {
	if (!isWordElement(element, "fldChar")) return undefined;
	return (
		element.getAttribute("w:fldCharType") ??
		element.getAttribute("fldCharType") ??
		undefined
	)?.toLowerCase();
}

function collectTextFlows(
	paragraph: Element,
	options: Required<
		Pick<
			DocxParseOptions,
			"trackedChanges" | "includeTextBoxes" | "includeDrawingText"
		>
	>,
): TextFlow[] {
	const flows: TextFlow[] = [];
	let active: Element[] = [];
	let fieldDepth = 0;
	const flush = () => {
		if (active.length > 0) flows.push({ nodes: active });
		active = [];
	};
	const walk = (node: Node) => {
		if (node.nodeType !== 1) return;
		const element = node as Element;
		if (element !== paragraph && isWordElement(element, "p")) {
			flush();
			return;
		}
		if (revisionIsExcluded(element, options.trackedChanges)) {
			flush();
			return;
		}
		if (isWordElement(element, "fldSimple")) {
			flush();
			return;
		}
		const fieldType = fieldCharacterType(element);
		if (fieldType) {
			flush();
			if (fieldType === "begin") fieldDepth++;
			if (fieldType === "end") fieldDepth = Math.max(0, fieldDepth - 1);
			return;
		}
		if (isWordElement(element, "instrText")) return;
		if (
			isWordElement(element, "tab") ||
			isWordElement(element, "br") ||
			isWordElement(element, "cr")
		) {
			flush();
			return;
		}
		const isTextBox = isWordElement(element, "txbxContent");
		const isDrawing = isWordElement(element, "drawing");
		const isDrawingParagraph = isDrawingElement(element, "p");
		if (
			(isTextBox && !options.includeTextBoxes) ||
			(isDrawing && !options.includeDrawingText)
		) {
			flush();
			return;
		}
		const isolatedContainer = isTextBox || isDrawing || isDrawingParagraph;
		if (isolatedContainer) flush();
		if (isTextElement(element)) {
			if (fieldDepth === 0) active.push(element);
			return;
		}
		for (const child of Array.from(element.childNodes)) walk(child);
		if (isolatedContainer) flush();
	};
	for (const child of Array.from(paragraph.childNodes)) walk(child);
	flush();
	return flows;
}

export function segmentDocxXml(
	documentXml: string,
	tokensOverride?: string[],
	options: DocxParseOptions = {},
): DocxSegmentationResult {
	const xmlDoc = safeParseXml(documentXml);
	const paragraphs = wordParagraphs(xmlDoc);
	const segments: DocxSegment[] = [];
	const meta: DocxSegmentMeta[] = [];
	const effectiveOptions = {
		trackedChanges: options.trackedChanges ?? "current",
		includeTextBoxes: options.includeTextBoxes ?? true,
		includeDrawingText: options.includeDrawingText ?? true,
	};

	for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
		if (hasExcludedRevisionAncestor(paragraph, effectiveOptions.trackedChanges))
			continue;
		if (
			!effectiveOptions.includeTextBoxes &&
			hasWordAncestor(paragraph, "txbxContent")
		)
			continue;
		if (
			!effectiveOptions.includeDrawingText &&
			hasWordAncestor(paragraph, "drawing")
		)
			continue;
		const allTextNodes = paragraphTextNodes(paragraph);
		for (const flow of collectTextFlows(paragraph, effectiveOptions)) {
			const paragraphText = flow.nodes
				.map((node) => node.textContent ?? "")
				.join("");
			if (!paragraphText.trim()) continue;
			const nodeRanges = buildNodeRanges(flow.nodes);
			const tokens = tokensOverride ?? getActiveTokens();
			const splitSegments =
				tokens.length > 0
					? (splitTextWithPreferences(
							paragraphText,
							tokens,
							getActiveTokens,
						) as SplitPiece[])
					: splitParagraphIntoSegments(paragraphText);
			for (const splitSegment of splitSegments) {
				const fragments: DocxSegmentFragment[] = [];
				const metaFragments: DocxSegmentMeta["fragments"] = [];
				for (const range of nodeRanges) {
					const overlapStart = Math.max(range.start, splitSegment.start);
					const overlapEnd = Math.min(range.end, splitSegment.end);
					if (overlapStart >= overlapEnd) continue;
					fragments.push({
						node: range.node,
						start: overlapStart - range.start,
						end: overlapEnd - range.start,
					});
					metaFragments.push({
						paragraphIndex,
						textNodeIndex: allTextNodes.indexOf(range.node),
						start: overlapStart - range.start,
						end: overlapEnd - range.start,
					});
				}
				if (metaFragments.length === 0) continue;
				segments.push({
					text: splitSegment.text,
					separator: splitSegment.separator,
					fragments,
				});
				meta.push({
					part: options.part ?? WORD_TEXT_PARTS.document,
					separator: splitSegment.separator,
					fragments: metaFragments,
				});
			}
		}
	}
	return { xmlDoc, segments, meta };
}

export function getDocxTextPartPaths(
	parts: Record<string, string | Blob>,
	options: DocxPackageParseOptions = {},
): string[] {
	const selected = Object.entries(parts)
		.filter((entry): entry is [string, string] => typeof entry[1] === "string")
		.map(([path]) => path)
		.filter((path) => {
			if (path === WORD_TEXT_PARTS.document) return true;
			if (/^word\/(?:header|footer)\d*\.xml$/i.test(path))
				return options.includeHeadersFooters ?? true;
			if (
				path === WORD_TEXT_PARTS.footnotes ||
				path === WORD_TEXT_PARTS.endnotes
			)
				return options.includeNotes ?? true;
			if (path === WORD_TEXT_PARTS.comments)
				return options.includeComments ?? true;
			return false;
		});
	const rank = (path: string) => {
		if (path === WORD_TEXT_PARTS.document) return 0;
		if (/^word\/header/i.test(path)) return 1;
		if (/^word\/footer/i.test(path)) return 2;
		if (path === WORD_TEXT_PARTS.footnotes) return 3;
		if (path === WORD_TEXT_PARTS.endnotes) return 4;
		return 5;
	};
	return selected.sort(
		(first, second) =>
			rank(first) - rank(second) || first.localeCompare(second),
	);
}

export function segmentDocxParts(
	parts: Record<string, string | Blob>,
	tokensOverride?: string[],
	options: DocxPackageParseOptions = {},
): DocxPackageSegmentationResult {
	const segments: DocxSegment[] = [];
	const meta: DocxSegmentMeta[] = [];
	const paths = getDocxTextPartPaths(parts, options);
	for (const part of paths) {
		const xml = parts[part];
		if (typeof xml !== "string") continue;
		const parsed = segmentDocxXml(xml, tokensOverride, { ...options, part });
		segments.push(...parsed.segments);
		meta.push(...parsed.meta);
	}
	return { segments, meta, parts: paths };
}

export function applyTranslationsToDocxXml(
	documentXml: string,
	translatedSegments: string[],
	tokensOverride?: string[],
	metaOverride?: DocxSegmentMeta[],
): string {
	const validMeta =
		metaOverride &&
		metaOverride.length > 0 &&
		metaOverride.length === translatedSegments.length &&
		metaOverride.every(
			(entry) =>
				entry.fragments.length > 0 &&
				entry.fragments.every(
					(fragment) =>
						Number.isInteger(fragment.paragraphIndex) &&
						Number.isInteger(fragment.textNodeIndex) &&
						fragment.start >= 0 &&
						fragment.end >= fragment.start,
				),
		);
	if (validMeta)
		return applyWithMeta(documentXml, translatedSegments, metaOverride);
	const tokens = tokensOverride ?? getDefaultTokens();
	const parsed = segmentDocxXml(documentXml, tokens);
	if (parsed.segments.length === 0) return documentXml;
	return applyWithMeta(
		documentXml,
		translatedSegments.map(
			(value, index) => value ?? parsed.segments[index]?.text ?? "",
		),
		parsed.meta,
	);
}

interface NodeEdit {
	start: number;
	end: number;
	text: string;
}

function applyWithMeta(
	documentXml: string,
	translatedSegments: string[],
	meta: DocxSegmentMeta[],
): string {
	const xmlDoc = safeParseXml(documentXml);
	const paragraphs = wordParagraphs(xmlDoc);
	const edits = new Map<Element, NodeEdit[]>();
	for (const [segmentIndex, segmentMeta] of meta.entries()) {
		const replacement = translatedSegments[segmentIndex] ?? "";
		const totalSpan =
			segmentMeta.fragments.reduce(
				(total, fragment) => total + fragment.end - fragment.start,
				0,
			) || 1;
		let originalConsumed = 0;
		let replacementConsumed = 0;
		for (const [fragmentIndex, fragment] of segmentMeta.fragments.entries()) {
			const paragraph = paragraphs[fragment.paragraphIndex];
			if (!paragraph) continue;
			const node = paragraphTextNodes(paragraph)[fragment.textNodeIndex];
			if (!node) continue;
			originalConsumed += fragment.end - fragment.start;
			const replacementEnd =
				fragmentIndex === segmentMeta.fragments.length - 1
					? replacement.length
					: Math.round((originalConsumed / totalSpan) * replacement.length);
			const piece = replacement.slice(replacementConsumed, replacementEnd);
			replacementConsumed = replacementEnd;
			edits.set(node, [
				...(edits.get(node) ?? []),
				{ start: fragment.start, end: fragment.end, text: piece },
			]);
		}
	}
	for (const [node, nodeEdits] of edits) {
		let text = node.textContent ?? "";
		for (const edit of [...nodeEdits].sort(
			(first, second) => second.start - first.start,
		))
			text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
		node.textContent = text;
		if (
			/^\s|\s$/.test(text) &&
			node.getAttribute("xml:space") !== "preserve" &&
			node.getAttributeNS("http://www.w3.org/XML/1998/namespace", "space") !==
				"preserve"
		)
			node.setAttributeNS(
				"http://www.w3.org/XML/1998/namespace",
				"xml:space",
				"preserve",
			);
	}
	// Some browser-compatible DOM implementations serialize U+00A0 as the
	// HTML-only &nbsp; entity. OOXML is XML and only accepts predefined or
	// numeric entities, so normalize it at the serialization boundary.
	return new XMLSerializer()
		.serializeToString(xmlDoc)
		.replaceAll("&nbsp;", "&#160;");
}
