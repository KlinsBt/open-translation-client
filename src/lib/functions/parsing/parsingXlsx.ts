
import { splitTextWithPreferences, type SplitPiece } from "./splitWithPreferences";
import { getActiveTokens } from "./parsingPreferences";

export interface SharedStringFragment {
	node: Element;
	start: number;
	end: number;
}

export interface SharedStringSegment {
	text: string;
	separator: string;
	fragments: SharedStringFragment[];
}

export interface SharedStringSegmentationResult {
	xmlDoc: Document;
	segments: SharedStringSegment[];
}

export interface ValueCellSegment {
	text: string;
	sheetPath: string;
	node: Element;
}

export interface InlineStringFragment {
	node: Element;
	start: number;
	end: number;
}

export interface InlineStringSegment {
	text: string;
	separator: string;
	sheetPath: string;
	fragments: InlineStringFragment[];
}

export interface SheetSegmentation {
	sheetPath: string;
	xmlDoc: Document;
	inlineSegments: InlineStringSegment[];
	valueSegments: ValueCellSegment[];
}

export interface WorkbookSegmentation {
	shared: SharedStringSegmentationResult;
	sheets: SheetSegmentation[];
	allSegments: string[];
}

interface NodeRange {
	node: Element;
	start: number;
	end: number;
}

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

export function segmentSharedStringsXml(
	sharedStringsXml: string,
): SharedStringSegmentationResult {
	const parser = new DOMParser();
	const xmlDoc = parser.parseFromString(sharedStringsXml, "application/xml");
	const siElements = Array.from(xmlDoc.getElementsByTagName("si"));
	const segments: SharedStringSegment[] = [];
	const tokens = getActiveTokens();

	for (const si of siElements) {
		const textNodes = Array.from(si.getElementsByTagName("t"));
		if (textNodes.length === 0) continue;

		const combinedText = textNodes
			.map((node) => node.textContent || "")
			.join("");

		const ranges = buildNodeRanges(textNodes);
		const pieces =
			tokens.length > 0
				? (splitTextWithPreferences(combinedText) as SplitPiece[])
				: [
						{
							text: combinedText,
							start: 0,
							end: combinedText.length,
							separator: "",
						},
					];

		for (const piece of pieces) {
			const fragments = ranges
				.map((range) => {
					const overlapStart = Math.max(range.start, piece.start);
					const overlapEnd = Math.min(range.end, piece.end);
					if (overlapStart < overlapEnd) {
						return {
							node: range.node,
							start: overlapStart - range.start,
							end: overlapEnd - range.start,
						};
					}
					return null;
				})
				.filter(Boolean) as SharedStringFragment[];

			if (fragments.length === 0) continue;

			segments.push({
				text: piece.text,
				separator: piece.separator,
				fragments,
			});
		}
	}

	return { xmlDoc, segments };
}

function segmentInlineStringsInSheet(
	sheetXml: string,
	sheetPath: string,
): SheetSegmentation {
	const parser = new DOMParser();
	const xmlDoc = parser.parseFromString(sheetXml, "application/xml");
	const cellElements = Array.from(xmlDoc.getElementsByTagName("c"));
	const inlineSegments: InlineStringSegment[] = [];
	const valueSegments: ValueCellSegment[] = [];
	const tokens = getActiveTokens();

	for (const cell of cellElements) {
		const type = cell.getAttribute("t");

		// inlineStr: <is><t>...</t></is>
		if (type === "inlineStr") {
			const tNodes = Array.from(cell.getElementsByTagName("t"));
			if (tNodes.length === 0) continue;
			const combinedText = tNodes.map((t) => t.textContent || "").join("");
			if (!combinedText) continue;

			const ranges = buildNodeRanges(tNodes);
			const pieces =
				tokens.length > 0
					? (splitTextWithPreferences(combinedText) as SplitPiece[])
					: [
							{
								text: combinedText,
								start: 0,
								end: combinedText.length,
								separator: "",
							},
						];

			for (const piece of pieces) {
				const fragments = ranges
					.map((range) => {
						const overlapStart = Math.max(range.start, piece.start);
						const overlapEnd = Math.min(range.end, piece.end);
						if (overlapStart < overlapEnd) {
							return {
								node: range.node,
								start: overlapStart - range.start,
								end: overlapEnd - range.start,
							};
						}
						return null;
					})
					.filter(Boolean) as InlineStringFragment[];

				if (fragments.length === 0) continue;

				inlineSegments.push({
					text: piece.text,
					separator: piece.separator,
					sheetPath,
					fragments,
				});
			}
		}

		// Plain string cells: t="str" with <v>text</v>
		if (type === "str") {
			const vNode = cell.getElementsByTagName("v")[0];
			if (!vNode) continue;
			const text = vNode.textContent || "";
			if (!text) continue;
			const pieces =
				tokens.length > 0
					? (splitTextWithPreferences(text) as SplitPiece[])
					: [
							{
								text,
								start: 0,
								end: text.length,
								separator: "",
							},
						];
			for (const piece of pieces) {
				const fragments: InlineStringFragment[] = [
					{
						node: vNode,
						start: Math.max(0, piece.start),
						end: Math.min(text.length, piece.end),
					},
				];
				inlineSegments.push({
					text: piece.text,
					separator: piece.separator,
					sheetPath,
					fragments,
				});
			}
		}

		// Other cells with values (numeric, formula results, booleans, dates, etc.)
		if (type !== "s" && type !== "str" && type !== "inlineStr") {
			const vNode = cell.getElementsByTagName("v")[0];
			if (!vNode) continue;
			const text = vNode.textContent || "";
			if (!text) continue;
			valueSegments.push({ text, sheetPath, node: vNode });
		}
	}

	return { sheetPath, xmlDoc, inlineSegments, valueSegments };
}

export function segmentWorkbookStrings(
	xmlContentMap: Record<string, string | Blob>,
): WorkbookSegmentation {
	const sharedStringsEntry = xmlContentMap["xl/sharedStrings.xml"];
	const shared =
		typeof sharedStringsEntry === "string"
			? segmentSharedStringsXml(sharedStringsEntry)
			: { xmlDoc: new DOMParser().parseFromString("<sst></sst>", "application/xml"), segments: [] };

	const sheetPaths = Object.keys(xmlContentMap)
		.filter(
			(path) =>
				path.startsWith("xl/worksheets/sheet") &&
				typeof xmlContentMap[path] === "string",
		)
		.sort();

	const sheets = sheetPaths.map((path) =>
		segmentInlineStringsInSheet(xmlContentMap[path] as string, path),
	);

	const allSegments: string[] = [
		...shared.segments.map((segment) => `${segment.text}${segment.separator ?? ""}`),
		...sheets.flatMap((sheet) => [
			...sheet.inlineSegments.map(
				(segment) => `${segment.text}${segment.separator ?? ""}`,
			),
			...sheet.valueSegments.map((segment) => segment.text),
		]),
	];

	return { shared, sheets, allSegments };
}

export function applyTranslationsToSharedStringsXml(
	sharedStringsXml: string,
	translatedSegments: string[],
): string {
	const { xmlDoc, segments } = segmentSharedStringsXml(sharedStringsXml);
	if (segments.length === 0) return sharedStringsXml;

	const serializer = new XMLSerializer();
	const nodePieces = new Map<Element, string[]>();

	const ensureWithSeparator = (text: string, separator?: string) => {
		if (!separator) return text;
		return text.endsWith(separator) ? text : `${text}${separator}`;
	};

	for (let i = 0; i < segments.length; i++) {
		const segment = segments[i];
		const translatedText = translatedSegments[i] ?? segment.text;
		const replacement = ensureWithSeparator(translatedText, segment.separator);
		const fragments = segment.fragments;
		const totalSpan =
			fragments.reduce(
				(sum, fragment) => sum + (fragment.end - fragment.start),
				0,
			) || 1;

		let consumed = 0;

		fragments.forEach((fragment, index) => {
			const fragmentLength = fragment.end - fragment.start;
			const isLast = index === fragments.length - 1;
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

function applyTranslationsToInlineSegments(
	sheet: SheetSegmentation,
	translatedSegments: string[],
	startIndex: number,
): { updatedXml: string; nextIndex: number; xmlDoc: Document } {
	const { xmlDoc, inlineSegments } = sheet;
	if (inlineSegments.length === 0) {
		return {
			updatedXml: new XMLSerializer().serializeToString(xmlDoc),
			nextIndex: startIndex,
			xmlDoc,
		};
	}

	const serializer = new XMLSerializer();
	const nodePieces = new Map<Element, string[]>();
	let cursor = startIndex;
	const ensureWithSeparator = (text: string, separator?: string) => {
		if (!separator) return text;
		return text.endsWith(separator) ? text : `${text}${separator}`;
	};

	for (let i = 0; i < inlineSegments.length; i++) {
		const segment = inlineSegments[i];
		const translatedText = translatedSegments[cursor] ?? segment.text;
		const replacement = ensureWithSeparator(translatedText, segment.separator);
		cursor++;

		const fragments = segment.fragments;
		const totalSpan =
			fragments.reduce(
				(sum, fragment) => sum + (fragment.end - fragment.start),
				0,
			) || 1;

		let consumed = 0;

		fragments.forEach((fragment, index) => {
			const fragmentLength = fragment.end - fragment.start;
			const isLast = index === fragments.length - 1;
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

	return {
		updatedXml: serializer.serializeToString(xmlDoc),
		nextIndex: cursor,
		xmlDoc,
	};
}

function applyTranslationsToValueSegments(
	sheet: SheetSegmentation,
	translatedSegments: string[],
	startIndex: number,
): { updatedXml: string; nextIndex: number; xmlDoc: Document } {
	const { xmlDoc, valueSegments } = sheet;
	if (valueSegments.length === 0) {
		return {
			updatedXml: new XMLSerializer().serializeToString(xmlDoc),
			nextIndex: startIndex,
			xmlDoc,
		};
	}

	let cursor = startIndex;
	for (const segment of valueSegments) {
		const translatedText = translatedSegments[cursor] ?? segment.text;
		cursor++;
		segment.node.textContent = translatedText;
	}

	return {
		updatedXml: new XMLSerializer().serializeToString(xmlDoc),
		nextIndex: cursor,
		xmlDoc,
	};
}

export function applyTranslationsToWorkbook(
	xmlContentMap: Record<string, string | Blob>,
	translatedSegments: string[],
): Record<string, string | Blob> {
	const updatedMap: Record<string, string | Blob> = { ...xmlContentMap };
	const { shared, sheets } = segmentWorkbookStrings(xmlContentMap);

	// Shared strings
	const sharedCount = shared.segments.length;
	if (sharedCount > 0 && typeof xmlContentMap["xl/sharedStrings.xml"] === "string") {
		updatedMap["xl/sharedStrings.xml"] = applyTranslationsToSharedStringsXml(
			xmlContentMap["xl/sharedStrings.xml"] as string,
			translatedSegments.slice(0, sharedCount),
		);
	}

	// Inline/str cells
	let cursor = sharedCount;
	for (const sheet of sheets) {
		const inlineResult = applyTranslationsToInlineSegments(
			sheet,
			translatedSegments,
			cursor,
		);
		cursor = inlineResult.nextIndex;

		// Apply to value cells on the same xmlDoc
		const valueResult = applyTranslationsToValueSegments(
			{ ...sheet, xmlDoc: inlineResult.xmlDoc },
			translatedSegments,
			cursor,
		);
		cursor = valueResult.nextIndex;
		updatedMap[sheet.sheetPath] = valueResult.updatedXml;
	}

	return updatedMap;
}
