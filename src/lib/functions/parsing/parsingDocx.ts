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

export interface DocxSegmentationResult {
	xmlDoc: Document;
	segments: DocxSegment[];
}

// Split a paragraph into sentence-like chunks while keeping trailing whitespace
function splitParagraphIntoSegments(paragraphText: string): SplitSegment[] {
	const segments: SplitSegment[] = [];
	const length = paragraphText.length;
	let cursor = 0;

	while (cursor < length) {
		let boundary = length;

		// Find the next sentence-ending punctuation
		for (let i = cursor; i < length; i++) {
			const char = paragraphText[i];
			if (char === "." || char === "?" || char === "!") {
				boundary = i + 1;
				break;
			}
		}

		// Include trailing whitespace after the punctuation
		let end = boundary;
		while (end < length && /\s/.test(paragraphText[end])) {
			end++;
		}

		const rawSegment = paragraphText.slice(cursor, end);
		const leadingWhitespace = rawSegment.match(/^\s*/)![0].length;
		const trailingWhitespace = rawSegment.match(/\s*$/)![0].length;
		const trimmedStart = cursor + leadingWhitespace;
		const trimmedEnd = end - trailingWhitespace;
		const cleanedText = paragraphText.slice(trimmedStart, trimmedEnd);
		if (cleanedText.length > 0) {
			const separator = paragraphText.slice(trimmedEnd, end);
			segments.push({
				text: cleanedText,
				start: trimmedStart,
				end,
				separator,
			});
		}

		cursor = end;
	}

	return segments;
}

// Build ranges for each <w:t> node in the paragraph
function buildNodeRanges(textNodes: Element[]): NodeRange[] {
	const ranges: NodeRange[] = [];
	let offset = 0;

	for (const node of textNodes) {
		const text = node.textContent || "";
		ranges.push({
			node,
			start: offset,
			end: offset + text.length,
		});
		offset += text.length;
	}

	return ranges;
}

export function segmentDocxXml(documentXml: string): DocxSegmentationResult {
	const parser = new DOMParser();
	const xmlDoc = parser.parseFromString(documentXml, "application/xml");
	const paragraphs = Array.from(xmlDoc.getElementsByTagName("w:p"));
	const segments: DocxSegment[] = [];

	for (const paragraph of paragraphs) {
		const textNodes = Array.from(paragraph.getElementsByTagName("w:t"));
		if (textNodes.length === 0) continue;

		const paragraphText = textNodes
			.map((node) => node.textContent || "")
			.join("");

		if (paragraphText.trim().length === 0) continue;

		const nodeRanges = buildNodeRanges(textNodes);
		const splitSegments = splitParagraphIntoSegments(paragraphText);

		if (splitSegments.length === 0) continue;

		for (const splitSegment of splitSegments) {
			const fragments: DocxSegmentFragment[] = [];

			for (const range of nodeRanges) {
				const overlapStart = Math.max(range.start, splitSegment.start);
				const overlapEnd = Math.min(range.end, splitSegment.end);
				if (overlapStart < overlapEnd) {
					fragments.push({
						node: range.node,
						start: overlapStart - range.start,
						end: overlapEnd - range.start,
					});
				}
			}

			segments.push({
				text: splitSegment.text,
				separator: splitSegment.separator,
				fragments,
			});
		}
	}

	return { xmlDoc, segments };
}

export function applyTranslationsToDocxXml(
	documentXml: string,
	translatedSegments: string[],
): string {
	const { xmlDoc, segments } = segmentDocxXml(documentXml);
	if (segments.length === 0) return documentXml;

	const serializer = new XMLSerializer();
	const nodePieces = new Map<Element, string[]>();

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const translatedText = translatedSegments[i] ?? segment.text;
		const replacement = `${translatedText}${segment.separator ?? ""}`;
		const totalSpan =
			segment.fragments.reduce(
				(sum, fragment) => sum + (fragment.end - fragment.start),
				0,
			) || 1;

		let consumed = 0;

		segment.fragments.forEach((fragment, fragIndex) => {
			const fragmentLength = fragment.end - fragment.start;
			const isLast = fragIndex === segment.fragments.length - 1;
			const takeLength = isLast
				? replacement.length - consumed
				: Math.round((fragmentLength / totalSpan) * replacement.length);
			const nextConsumed = Math.max(consumed + takeLength, consumed);
			const piece = replacement.slice(consumed, nextConsumed);
			consumed = nextConsumed;

			const existing = nodePieces.get(fragment.node) || [];
			existing.push(piece);
			nodePieces.set(fragment.node, existing);
		});
	}

	nodePieces.forEach((pieces, node) => {
		node.textContent = pieces.join("");
	});

	return serializer.serializeToString(xmlDoc);
}
