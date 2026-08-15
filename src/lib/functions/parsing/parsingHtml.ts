import {
	splitTextWithPreferences,
	type SplitPiece,
} from "./splitWithPreferences";
import { getActiveTokens } from "./parsingPreferences";

export interface HtmlTextSegment {
	node: Text;
	text: string;
	separator: string;
}

export interface HtmlAttributeSegment {
	element: Element;
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

interface SplitSegment {
	text: string;
	separator: string;
}

export type HtmlMeta =
	| {
			kind: "text";
			path: number[];
			separator: string;
	  }
	| {
			kind: "attribute";
			path: number[];
			attribute: string;
			separator: string;
	  };

// Split text into sentence-like pieces while keeping trailing whitespace as separator
function splitTextWithSeparators(text: string): SplitSegment[] {
	const segments: SplitSegment[] = [];
	const length = text.length;
	let cursor = 0;

	while (cursor < length) {
		let boundary = length;

		for (let i = cursor; i < length; i++) {
			const char = text[i];
			if (
				char === "." ||
				char === "?" ||
				char === "!" ||
				char === "。" ||
				char === "！" ||
				char === "？"
			) {
				boundary = i + 1;
				break;
			}
		}

		let end = boundary;
		while (end < length && /\s/.test(text[end])) {
			end++;
		}

		const rawSegment = text.slice(cursor, end);
		const leadingWhitespace = rawSegment.match(/^\s*/)![0].length;
		const trailingWhitespace = rawSegment.match(/\s*$/)![0].length;
		const trimmedStart = cursor + leadingWhitespace;
		const trimmedEnd = end - trailingWhitespace;
		const cleanedText = text.slice(trimmedStart, trimmedEnd);

		if (cleanedText.length > 0) {
			const separator = text.slice(trimmedEnd, end);
			segments.push({ text: cleanedText, separator });
		}

		cursor = end;
	}

	// Fallback: if nothing matched punctuation, split by whitespace
	if (segments.length === 0) {
		const tokens = text
			.trim()
			.split(/\s+/)
			.filter((token) => token.length > 0);
		for (let i = 0; i < tokens.length; i++) {
			const sep = i === tokens.length - 1 ? "" : " ";
			segments.push({ text: tokens[i], separator: sep });
		}
	}

	return segments;
}

function isInsideSkippedTag(node: Node): boolean {
	let current: Node | null = node;
	while (current) {
		if (
			current.nodeType === Node.ELEMENT_NODE &&
			((current as Element).tagName.toLowerCase() === "script" ||
				(current as Element).tagName.toLowerCase() === "style")
		) {
			return true;
		}
		current = current.parentNode;
	}
	return false;
}

// Traverse DOM to collect text and attribute segments
export function segmentHtmlContent(
	htmlContent: string,
	tokensOverride?: string[],
): HtmlSegmentation {
	const parser = new DOMParser();
	const doc = parser.parseFromString(htmlContent, "text/html");

	const textSegments: HtmlTextSegment[] = [];
	const attributeSegments: HtmlAttributeSegment[] = [];
	const combinedSegments: string[] = [];
	const attributesToCheck = ["placeholder", "value", "alt", "title"];
	const tokens = tokensOverride ?? getActiveTokens();
	const meta: HtmlMeta[] = [];

	function buildPath(node: Node): number[] {
		const path: number[] = [];
		let current: Node | null = node;
		// Build path relative to body to avoid doctype/html offsets
		while (current && current.parentNode && current !== doc.body) {
			const siblings = Array.from(current.parentNode.childNodes);
			const idx = siblings.indexOf(current as ChildNode);
			path.push(idx);
			current = current.parentNode;
		}
		return path.reverse();
	}

	function walk(node: Node) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (isInsideSkippedTag(node)) return;
			const text = node.textContent ?? "";
			if (!text.trim()) return;
			const pieces =
				tokens.length > 0
					? (splitTextWithPreferences(text, tokens) as SplitPiece[])
					: splitTextWithSeparators(text);
			for (const piece of pieces) {
				if (!piece.text.trim()) continue;
				textSegments.push({
					node: node as Text,
					text: piece.text,
					separator: piece.separator,
				});
				meta.push({
					kind: "text",
					path: buildPath(node),
					separator: piece.separator,
				});
				combinedSegments.push(`${piece.text}${piece.separator ?? ""}`);
			}
			return;
		}

		if (node.nodeType === Node.ELEMENT_NODE) {
			const el = node as Element;
			const tag = el.tagName.toLowerCase();
			if (tag === "script" || tag === "style") {
				return; // skip script/style blocks entirely
			}
			for (const attr of attributesToCheck) {
				const attrValue = el.getAttribute(attr);
				if (!attrValue) continue;
				if (!attrValue.trim()) continue;
				const pieces =
					tokens.length > 0
						? (splitTextWithPreferences(attrValue, tokens) as SplitPiece[])
						: splitTextWithSeparators(attrValue);
				for (const piece of pieces) {
					if (!piece.text.trim()) continue;
					attributeSegments.push({
						element: el,
						attribute: attr,
						text: piece.text,
						separator: piece.separator,
					});
					meta.push({
						kind: "attribute",
						path: buildPath(el),
						attribute: attr,
						separator: piece.separator,
					});
					combinedSegments.push(`${piece.text}${piece.separator ?? ""}`);
				}
			}
		}

		node.childNodes.forEach((child) => walk(child));
	}

	walk(doc.body);

	return {
		doc,
		textSegments,
		attributeSegments,
		allSegments: combinedSegments,
		meta,
	};
}

export function applyTranslationsToHtml(
	htmlContent: string,
	translatedSegments: string[],
	tokensOverride?: string[],
	metaOverride?: HtmlMeta[],
): string {
	const hasValidMeta =
		metaOverride &&
		metaOverride.length > 0 &&
		metaOverride.length === translatedSegments.length;

	if (hasValidMeta) {
		return applyWithMeta(htmlContent, translatedSegments, metaOverride);
	}

	const { doc, textSegments, attributeSegments } = segmentHtmlContent(
		htmlContent,
		tokensOverride,
	);
	const serializer = new XMLSerializer();
	const ensureWithSeparator = (text: string, separator?: string) => {
		if (!separator) return text;
		return text.endsWith(separator) ? text : `${text}${separator}`;
	};

	// Update text nodes
	const nodePieces = new Map<Text, string[]>();
	let cursor = 0;
	for (const segment of textSegments) {
		const translated = translatedSegments[cursor] ?? segment.text;
		cursor++;
		const arr = nodePieces.get(segment.node) || [];
		arr.push(ensureWithSeparator(translated, segment.separator));
		nodePieces.set(segment.node, arr);
	}

	nodePieces.forEach((pieces, node) => {
		node.textContent = pieces.join("");
	});

	// Update attributes
	const attrPieces = new Map<Element, Map<string, string[]>>();
	for (const segment of attributeSegments) {
		const translated = translatedSegments[cursor] ?? segment.text;
		cursor++;
		const attrMap =
			attrPieces.get(segment.element) || new Map<string, string[]>();
		const arr = attrMap.get(segment.attribute) || [];
		arr.push(ensureWithSeparator(translated, segment.separator));
		attrMap.set(segment.attribute, arr);
		attrPieces.set(segment.element, attrMap);
	}

	for (const segment of attributeSegments) {
		const attrMap = attrPieces.get(segment.element);
		if (!attrMap) continue;
		const pieces = attrMap.get(segment.attribute);
		if (!pieces) continue;
		segment.element.setAttribute(segment.attribute, pieces.join(""));
		attrMap.delete(segment.attribute);
	}

	return serializer.serializeToString(doc);
}

function resolvePath(doc: Document, path: number[]): Node | null {
	let current: Node | null = doc.body;
	if (!current) return null;
	for (const idx of path) {
		if (!current.childNodes || idx < 0 || idx >= current.childNodes.length) {
			return null;
		}
		current = current.childNodes[idx];
	}
	return current;
}

function applyWithMeta(
	htmlContent: string,
	translatedSegments: string[],
	meta: HtmlMeta[],
): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(htmlContent, "text/html");
	const textPieces = new Map<Node, string[]>();
	const attrPieces = new Map<Element, Map<string, string[]>>();

	for (let i = 0; i < meta.length; i++) {
		const entry = meta[i];
		const translated = translatedSegments[i] ?? "";
		const sep = entry.separator || "";

		if (entry.kind === "text") {
			const node = resolvePath(doc, entry.path);
			if (!node || node.nodeType !== Node.TEXT_NODE) continue;
			const arr = textPieces.get(node) || [];
			let base = translated;
			if (sep && base.endsWith(sep)) {
				base = base.slice(0, -sep.length);
			}
			arr.push(sep ? `${base}${sep}` : base);
			textPieces.set(node, arr);
		} else if (entry.kind === "attribute") {
			const node = resolvePath(doc, entry.path);
			if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
			const el = node as Element;
			const map = attrPieces.get(el) || new Map<string, string[]>();
			const arr = map.get(entry.attribute) || [];
			let base = translated;
			if (sep && base.endsWith(sep)) {
				base = base.slice(0, -sep.length);
			}
			arr.push(sep ? `${base}${sep}` : base);
			map.set(entry.attribute, arr);
			attrPieces.set(el, map);
		}
	}

	textPieces.forEach((pieces, node) => {
		(node as Text).textContent = pieces.join("");
	});

	attrPieces.forEach((attrMap, el) => {
		attrMap.forEach((pieces, attr) => {
			el.setAttribute(attr, pieces.join(""));
		});
	});

	return new XMLSerializer().serializeToString(doc);
}
