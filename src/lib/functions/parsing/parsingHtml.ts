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
}

interface SplitSegment {
	text: string;
	separator: string;
}

// Split text into sentence-like pieces while keeping trailing whitespace as separator
function splitTextWithSeparators(text: string): SplitSegment[] {
	const segments: SplitSegment[] = [];
	const length = text.length;
	let cursor = 0;

	while (cursor < length) {
		let boundary = length;

		for (let i = cursor; i < length; i++) {
			const char = text[i];
			if (char === "." || char === "?" || char === "!" || char === "。" || char === "！" || char === "？") {
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
		const tokens = text.trim().split(/\s+/).filter((token) => token.length > 0);
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
export function segmentHtmlContent(htmlContent: string): HtmlSegmentation {
	const parser = new DOMParser();
	const doc = parser.parseFromString(htmlContent, "text/html");

	const textSegments: HtmlTextSegment[] = [];
	const attributeSegments: HtmlAttributeSegment[] = [];
	const attributesToCheck = ["placeholder", "value", "alt", "title"];

	function walk(node: Node) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (isInsideSkippedTag(node)) return;
			const text = node.textContent ?? "";
			const pieces = splitTextWithSeparators(text);
			for (const piece of pieces) {
				textSegments.push({
					node: node as Text,
					text: piece.text,
					separator: piece.separator,
				});
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
				const pieces = splitTextWithSeparators(attrValue);
				for (const piece of pieces) {
					attributeSegments.push({
						element: el,
						attribute: attr,
						text: piece.text,
						separator: piece.separator,
					});
				}
			}
		}

		node.childNodes.forEach((child) => walk(child));
	}

	walk(doc.body);

	const allSegments: string[] = [
		...textSegments.map((segment) => segment.text),
		...attributeSegments.map((segment) => segment.text),
	];

	return { doc, textSegments, attributeSegments, allSegments };
}

export function applyTranslationsToHtml(
	htmlContent: string,
	translatedSegments: string[],
): string {
	const { doc, textSegments, attributeSegments } = segmentHtmlContent(htmlContent);
	const serializer = new XMLSerializer();

	// Update text nodes
	const nodePieces = new Map<Text, string[]>();
	let cursor = 0;
	for (const segment of textSegments) {
		const translated = translatedSegments[cursor] ?? segment.text;
		cursor++;
		const arr = nodePieces.get(segment.node) || [];
		arr.push(`${translated}${segment.separator}`);
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
		const attrMap = attrPieces.get(segment.element) || new Map<string, string[]>();
		const arr = attrMap.get(segment.attribute) || [];
		arr.push(`${translated}${segment.separator}`);
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
