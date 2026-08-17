import {
	splitTextWithPreferences,
	type SplitPiece,
} from "./splitWithPreferences";
import { getActiveTokens, getDefaultTokens } from "./parsingPreferences";
import { safeParseXml } from "$lib/formats/safeInput";

export interface SharedStringFragment {
	node: Element;
	start: number;
	end: number;
}

export interface SharedStringSegment {
	text: string;
	separator: string;
	itemIndex: number;
	fragments: SharedStringFragment[];
}

export interface SharedStringSegmentationResult {
	xmlDoc: Document;
	segments: SharedStringSegment[];
}

export interface ValueCellSegment {
	text: string;
	sheetPath: string;
	sheetName: string;
	cellReference: string;
	row: number | null;
	column: number | null;
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
	sheetName: string;
	cellReference: string;
	row: number | null;
	column: number | null;
	fragments: InlineStringFragment[];
}

export interface XlsxFilterOptions {
	worksheetPaths?: readonly string[];
	columns?: ReadonlySet<number> | null;
	rows?: ReadonlySet<number> | null;
	includeHiddenSheets?: boolean;
	includeSharedStrings?: boolean;
	includeCellValues?: boolean;
}

export interface WorkbookSheetInfo {
	name: string;
	path: string;
	state: string;
	workbookIndex: number;
}

export interface SharedStringCellReference {
	sheetPath: string;
	sheetName: string;
	cellReference: string;
	itemIndex: number;
	valueNode: Element;
}

export interface SheetSegmentation {
	sheetPath: string;
	sheetName: string;
	state: string;
	xmlDoc: Document;
	sharedStringCells: SharedStringCellReference[];
	inlineSegments: InlineStringSegment[];
	valueSegments: ValueCellSegment[];
}

export interface WorkbookSegmentation {
	shared: SharedStringSegmentationResult;
	sheets: SheetSegmentation[];
	sheetCatalog: WorkbookSheetInfo[];
	allSegments: string[];
}

interface NodeRange {
	node: Element;
	start: number;
	end: number;
}

interface NodeEdit {
	start: number;
	end: number;
	text: string;
}

function elementsByLocalName(
	parent: Document | Element,
	name: string,
): Element[] {
	const root =
		parent.nodeType === 9
			? (parent as Document).documentElement
			: (parent as Element);
	return [root, ...Array.from(root.getElementsByTagName("*"))].filter(
		(element) => element.localName === name,
	);
}

function childByLocalName(parent: Element, name: string): Element | undefined {
	return Array.from(parent.childNodes).find(
		(child): child is Element =>
			child.nodeType === 1 && (child as Element).localName === name,
	);
}

function textElements(parent: Element): Element[] {
	return elementsByLocalName(parent, "t");
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

function splitCellText(text: string, tokens: readonly string[]): SplitPiece[] {
	if (tokens.length === 0)
		return [{ text, start: 0, end: text.length, separator: "" }];
	return splitTextWithPreferences(text, [...tokens]);
}

function fragmentsForPiece(
	ranges: readonly NodeRange[],
	piece: SplitPiece,
): InlineStringFragment[] {
	return ranges.flatMap((range) => {
		const start = Math.max(range.start, piece.start);
		const end = Math.min(range.end, piece.end);
		return start < end
			? [
					{
						node: range.node,
						start: start - range.start,
						end: end - range.start,
					},
				]
			: [];
	});
}

function columnNumber(reference: string): number | null {
	const letters = reference.match(/^([A-Z]+)/i)?.[1];
	if (!letters) return null;
	return [...letters.toUpperCase()].reduce(
		(total, character) => total * 26 + character.charCodeAt(0) - 64,
		0,
	);
}

function rowNumber(reference: string, cell: Element): number | null {
	const fromReference = Number(reference.match(/(\d+)$/)?.[1]);
	if (Number.isInteger(fromReference) && fromReference > 0)
		return fromReference;
	const row =
		cell.parentElement?.localName === "row" ? cell.parentElement : null;
	const fromRow = Number(row?.getAttribute("r"));
	return Number.isInteger(fromRow) && fromRow > 0 ? fromRow : null;
}

function resolvePackageTarget(baseDirectory: string, target: string): string {
	if (target.startsWith("/")) return target.slice(1);
	const stack: string[] = [];
	for (const part of `${baseDirectory}/${target}`.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") stack.pop();
		else stack.push(part);
	}
	return stack.join("/");
}

export function getWorkbookSheetCatalog(
	parts: Record<string, string | Blob>,
): WorkbookSheetInfo[] {
	const workbookXml = parts["xl/workbook.xml"];
	const relationshipsXml = parts["xl/_rels/workbook.xml.rels"];
	if (typeof workbookXml === "string") {
		const workbook = safeParseXml(workbookXml);
		const relationships =
			typeof relationshipsXml === "string"
				? safeParseXml(relationshipsXml)
				: undefined;
		const targets = new Map<string, string>();
		if (relationships)
			for (const relationship of elementsByLocalName(
				relationships,
				"Relationship",
			)) {
				const id = relationship.getAttribute("Id");
				const target = relationship.getAttribute("Target");
				if (id && target) targets.set(id, resolvePackageTarget("xl", target));
			}
		const catalog = elementsByLocalName(workbook, "sheet").flatMap(
			(sheet, workbookIndex) => {
				const relationshipId =
					sheet.getAttribute("r:id") ??
					sheet.getAttributeNS(
						"http://schemas.openxmlformats.org/officeDocument/2006/relationships",
						"id",
					) ??
					"";
				const path = targets.get(relationshipId);
				if (!path || typeof parts[path] !== "string") return [];
				return [
					{
						name: sheet.getAttribute("name") ?? `Sheet ${workbookIndex + 1}`,
						path,
						state: (sheet.getAttribute("state") ?? "visible").toLowerCase(),
						workbookIndex,
					},
				];
			},
		);
		if (catalog.length > 0) return catalog;
	}
	return Object.keys(parts)
		.filter(
			(path) =>
				/^xl\/worksheets\/[^/]+\.xml$/i.test(path) &&
				typeof parts[path] === "string",
		)
		.sort((first, second) =>
			first.localeCompare(second, undefined, { numeric: true }),
		)
		.map((path, workbookIndex) => ({
			name:
				path
					.split("/")
					.at(-1)
					?.replace(/\.xml$/i, "") ?? path,
			path,
			state: "visible",
			workbookIndex,
		}));
}

function sheetMatchesSelectors(
	sheet: WorkbookSheetInfo,
	selectors: readonly string[] | undefined,
): boolean {
	if (!selectors?.length) return true;
	const fileName = sheet.path.split("/").at(-1)?.toLowerCase() ?? "";
	const candidates = new Set([
		sheet.name.toLowerCase(),
		sheet.path.toLowerCase(),
		fileName,
		fileName.replace(/\.xml$/i, ""),
	]);
	return selectors.some((selector) => candidates.has(selector.toLowerCase()));
}

export function segmentSharedStringsXml(
	sharedStringsXml: string,
	tokensOverride?: string[],
	selectedItemIndexes?: ReadonlySet<number>,
): SharedStringSegmentationResult {
	const xmlDoc = safeParseXml(sharedStringsXml);
	const siElements = elementsByLocalName(xmlDoc, "si");
	const segments: SharedStringSegment[] = [];
	const tokens = tokensOverride ?? getActiveTokens();
	for (const [itemIndex, si] of siElements.entries()) {
		if (selectedItemIndexes && !selectedItemIndexes.has(itemIndex)) continue;
		const nodes = textElements(si);
		if (nodes.length === 0) continue;
		const combinedText = nodes.map((node) => node.textContent ?? "").join("");
		if (!combinedText) continue;
		const ranges = buildNodeRanges(nodes);
		for (const piece of splitCellText(combinedText, tokens)) {
			const fragments = fragmentsForPiece(ranges, piece);
			if (fragments.length === 0) continue;
			segments.push({
				text: piece.text,
				separator: piece.separator,
				itemIndex,
				fragments,
			});
		}
	}
	return { xmlDoc, segments };
}

function segmentSheet(
	sheetXml: string,
	sheet: WorkbookSheetInfo,
	tokensOverride: string[] | undefined,
	filterOptions: XlsxFilterOptions,
): SheetSegmentation {
	const xmlDoc = safeParseXml(sheetXml);
	const sharedStringCells: SharedStringCellReference[] = [];
	const inlineSegments: InlineStringSegment[] = [];
	const valueSegments: ValueCellSegment[] = [];
	const tokens = tokensOverride ?? getActiveTokens();
	for (const cell of elementsByLocalName(xmlDoc, "c")) {
		const cellReference = cell.getAttribute("r") ?? "";
		const column = columnNumber(cellReference);
		const row = rowNumber(cellReference, cell);
		if (
			filterOptions.columns &&
			(column === null || !filterOptions.columns.has(column))
		)
			continue;
		if (filterOptions.rows && (row === null || !filterOptions.rows.has(row)))
			continue;
		// Formula values are cached calculation results, not source content.
		if (childByLocalName(cell, "f")) continue;
		const type = cell.getAttribute("t") ?? "";
		if (type === "s") {
			if (filterOptions.includeSharedStrings === false) continue;
			const valueNode = childByLocalName(cell, "v");
			const itemIndex = Number(valueNode?.textContent);
			if (!valueNode || !Number.isInteger(itemIndex) || itemIndex < 0) continue;
			sharedStringCells.push({
				sheetPath: sheet.path,
				sheetName: sheet.name,
				cellReference,
				itemIndex,
				valueNode,
			});
			continue;
		}
		if (type === "inlineStr") {
			const nodes = textElements(childByLocalName(cell, "is") ?? cell);
			const text = nodes.map((node) => node.textContent ?? "").join("");
			if (!text) continue;
			const ranges = buildNodeRanges(nodes);
			for (const piece of splitCellText(text, tokens)) {
				const fragments = fragmentsForPiece(ranges, piece);
				if (fragments.length === 0) continue;
				inlineSegments.push({
					text: piece.text,
					separator: piece.separator,
					sheetPath: sheet.path,
					sheetName: sheet.name,
					cellReference,
					row,
					column,
					fragments,
				});
			}
			continue;
		}
		if (type === "str") {
			const valueNode = childByLocalName(cell, "v");
			const text = valueNode?.textContent ?? "";
			if (!valueNode || !text) continue;
			for (const piece of splitCellText(text, tokens)) {
				inlineSegments.push({
					text: piece.text,
					separator: piece.separator,
					sheetPath: sheet.path,
					sheetName: sheet.name,
					cellReference,
					row,
					column,
					fragments: [
						{
							node: valueNode,
							start: piece.start,
							end: piece.end,
						},
					],
				});
			}
			continue;
		}
		if (filterOptions.includeCellValues === false) continue;
		const valueNode = childByLocalName(cell, "v");
		const text = valueNode?.textContent ?? "";
		if (!valueNode || !text) continue;
		valueSegments.push({
			text,
			sheetPath: sheet.path,
			sheetName: sheet.name,
			cellReference,
			row,
			column,
			node: valueNode,
		});
	}
	return {
		sheetPath: sheet.path,
		sheetName: sheet.name,
		state: sheet.state,
		xmlDoc,
		sharedStringCells,
		inlineSegments,
		valueSegments,
	};
}

export function segmentWorkbookStrings(
	parts: Record<string, string | Blob>,
	tokensOverride?: string[],
	filterOptions: XlsxFilterOptions = {},
): WorkbookSegmentation {
	const sheetCatalog = getWorkbookSheetCatalog(parts);
	const selectedCatalog = sheetCatalog.filter(
		(sheet) =>
			sheetMatchesSelectors(sheet, filterOptions.worksheetPaths) &&
			((filterOptions.includeHiddenSheets ?? true) ||
				sheet.state === "visible"),
	);
	const sheets = selectedCatalog.map((sheet) =>
		segmentSheet(
			parts[sheet.path] as string,
			sheet,
			tokensOverride,
			filterOptions,
		),
	);
	const selectedSharedIndexes = new Set(
		sheets.flatMap((sheet) =>
			sheet.sharedStringCells.map((reference) => reference.itemIndex),
		),
	);
	const sharedStringsEntry = parts["xl/sharedStrings.xml"];
	const hasWorkbookRelationships =
		typeof parts["xl/_rels/workbook.xml.rels"] === "string";
	const shared =
		filterOptions.includeSharedStrings !== false &&
		typeof sharedStringsEntry === "string"
			? segmentSharedStringsXml(
					sharedStringsEntry,
					tokensOverride,
					hasWorkbookRelationships || selectedSharedIndexes.size > 0
						? selectedSharedIndexes
						: undefined,
				)
			: {
					xmlDoc: safeParseXml("<sst></sst>"),
					segments: [],
				};
	const allSegments = [
		...shared.segments.map(
			(segment) => `${segment.text}${segment.separator ?? ""}`,
		),
		...sheets.flatMap((sheet) => [
			...sheet.inlineSegments.map(
				(segment) => `${segment.text}${segment.separator ?? ""}`,
			),
			...sheet.valueSegments.map((segment) => segment.text),
		]),
	];
	return { shared, sheets, sheetCatalog, allSegments };
}

function setPreservedText(node: Element, text: string): void {
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

function applySegmentEdits<
	T extends { text: string; fragments: SharedStringFragment[] },
>(segments: readonly T[], translations: readonly string[]): void {
	const edits = new Map<Element, NodeEdit[]>();
	for (const [segmentIndex, segment] of segments.entries()) {
		const replacement = translations[segmentIndex] ?? segment.text;
		const totalSpan =
			segment.fragments.reduce(
				(total, fragment) => total + fragment.end - fragment.start,
				0,
			) || 1;
		let sourceConsumed = 0;
		let replacementConsumed = 0;
		for (const [fragmentIndex, fragment] of segment.fragments.entries()) {
			sourceConsumed += fragment.end - fragment.start;
			const replacementEnd =
				fragmentIndex === segment.fragments.length - 1
					? replacement.length
					: Math.round((sourceConsumed / totalSpan) * replacement.length);
			const values = edits.get(fragment.node) ?? [];
			values.push({
				start: fragment.start,
				end: fragment.end,
				text: replacement.slice(replacementConsumed, replacementEnd),
			});
			edits.set(fragment.node, values);
			replacementConsumed = replacementEnd;
		}
	}
	for (const [node, nodeEdits] of edits) {
		let text = node.textContent ?? "";
		for (const edit of [...nodeEdits].sort(
			(first, second) => second.start - first.start,
		))
			text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
		setPreservedText(node, text);
	}
}

function serializeSpreadsheetXml(document: Document): string {
	return new XMLSerializer()
		.serializeToString(document)
		.replaceAll("&nbsp;", "&#160;");
}

export function applyTranslationsToSharedStringsXml(
	sharedStringsXml: string,
	translatedSegments: string[],
	tokensOverride?: string[],
): string {
	const parsed = segmentSharedStringsXml(
		sharedStringsXml,
		tokensOverride ?? getDefaultTokens(),
	);
	if (parsed.segments.length === 0) return sharedStringsXml;
	applySegmentEdits(parsed.segments, translatedSegments);
	return serializeSpreadsheetXml(parsed.xmlDoc);
}

function clonedItemSegments(
	originalItem: Element,
	clone: Element,
	segments: readonly SharedStringSegment[],
): SharedStringSegment[] {
	const originals = textElements(originalItem);
	const clones = textElements(clone);
	return segments.map((segment) => ({
		...segment,
		fragments: segment.fragments.flatMap((fragment) => {
			const index = originals.indexOf(fragment.node);
			return index >= 0 && clones[index]
				? [{ ...fragment, node: clones[index] }]
				: [];
		}),
	}));
}

export function applyTranslationsToWorkbook(
	parts: Record<string, string | Blob>,
	translatedSegments: string[],
	tokensOverride?: string[],
	filterOptions: XlsxFilterOptions = {},
): Record<string, string | Blob> {
	const updated: Record<string, string | Blob> = { ...parts };
	const tokens = tokensOverride ?? getDefaultTokens();
	const workbook = segmentWorkbookStrings(parts, tokens, filterOptions);
	const sharedCount = workbook.shared.segments.length;
	const sharedXml = parts["xl/sharedStrings.xml"];
	if (sharedCount > 0 && typeof sharedXml === "string") {
		const references = workbook.sheets.flatMap(
			(sheet) => sheet.sharedStringCells,
		);
		if (references.length === 0) {
			updated["xl/sharedStrings.xml"] = applyTranslationsToSharedStringsXml(
				sharedXml,
				translatedSegments.slice(0, sharedCount),
				tokens,
			);
		} else {
			const root = workbook.shared.xmlDoc.documentElement;
			const items = elementsByLocalName(root, "si");
			const segmentsByItem = new Map<
				number,
				Array<{ segment: SharedStringSegment; translation: string }>
			>();
			for (const [index, segment] of workbook.shared.segments.entries()) {
				const values = segmentsByItem.get(segment.itemIndex) ?? [];
				values.push({
					segment,
					translation: translatedSegments[index] ?? segment.text,
				});
				segmentsByItem.set(segment.itemIndex, values);
			}
			for (const [itemIndex, values] of segmentsByItem) {
				const original = items[itemIndex];
				if (!original) continue;
				const clone = original.cloneNode(true) as Element;
				const clonedSegments = clonedItemSegments(
					original,
					clone,
					values.map((value) => value.segment),
				);
				applySegmentEdits(
					clonedSegments,
					values.map((value) => value.translation),
				);
				const newIndex = elementsByLocalName(root, "si").length;
				root.appendChild(clone);
				for (const reference of references)
					if (reference.itemIndex === itemIndex)
						reference.valueNode.textContent = String(newIndex);
			}
			if (root.hasAttribute("uniqueCount"))
				root.setAttribute(
					"uniqueCount",
					String(elementsByLocalName(root, "si").length),
				);
			updated["xl/sharedStrings.xml"] = serializeSpreadsheetXml(
				workbook.shared.xmlDoc,
			);
		}
	}

	let cursor = sharedCount;
	for (const sheet of workbook.sheets) {
		const inlineTranslations = translatedSegments.slice(
			cursor,
			cursor + sheet.inlineSegments.length,
		);
		applySegmentEdits(sheet.inlineSegments, inlineTranslations);
		cursor += sheet.inlineSegments.length;
		for (const segment of sheet.valueSegments) {
			segment.node.textContent = translatedSegments[cursor] ?? segment.text;
			cursor++;
		}
		if (
			sheet.sharedStringCells.length > 0 ||
			sheet.inlineSegments.length > 0 ||
			sheet.valueSegments.length > 0
		)
			updated[sheet.sheetPath] = serializeSpreadsheetXml(sheet.xmlDoc);
	}
	return updated;
}
