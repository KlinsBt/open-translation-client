import { safeParseXml } from "$lib/formats/safeInput";
import type { PptxSegmentMeta } from "$lib/types/types";
import { getActiveTokens } from "./parsingPreferences";
import {
	splitTextWithPreferences,
	type SplitPiece,
} from "./splitWithPreferences";

export interface PptxParseOptions {
	slides?: Set<number> | null;
	includeNotes?: boolean;
	includeMastersLayouts?: boolean;
	includeChartText?: boolean;
	includeSmartArtText?: boolean;
	includeAltText?: boolean;
}

export interface PptxSlideEntry {
	index: number;
	id: string;
	path: string;
}

export interface PptxSegment {
	text: string;
	separator: string;
	meta: PptxSegmentMeta;
}

export interface PptxPackageSegmentationResult {
	segments: PptxSegment[];
	parts: string[];
	slides: PptxSlideEntry[];
}

export interface PptxComment {
	slidePath: string;
	text: string;
	authorId?: string;
}

const OFFICE_REL =
	"http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function descendants(root: Document | Element): Element[] {
	return Array.from(root.getElementsByTagName("*"));
}

function isDrawing(element: Element, localName: string): boolean {
	return (
		element.localName === localName &&
		(element.prefix === "a" || /drawingml/i.test(element.namespaceURI ?? ""))
	);
}

function isPresentation(element: Element, localName: string): boolean {
	return (
		element.localName === localName &&
		(element.prefix === "p" ||
			/presentationml/i.test(element.namespaceURI ?? ""))
	);
}

function resolvePackageTarget(
	baseDirectory: string,
	target: string,
): string | null {
	if (/^[a-z][a-z\d+.-]*:/i.test(target)) return null;
	const result: string[] = target.startsWith("/")
		? []
		: baseDirectory.split("/").filter(Boolean);
	for (const part of target.replaceAll("\\", "/").split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (result.length === 0) return null;
			result.pop();
		} else result.push(part);
	}
	return result.join("/");
}

interface Relationship {
	id: string;
	type: string;
	target: string;
}

function relationships(
	parts: Record<string, string | Blob>,
	relsPath: string,
	baseDirectory: string,
): Relationship[] {
	const xml = parts[relsPath];
	if (typeof xml !== "string") return [];
	return descendants(safeParseXml(xml))
		.filter((element) => element.localName === "Relationship")
		.flatMap((element) => {
			if (element.getAttribute("TargetMode")?.toLowerCase() === "external")
				return [];
			const id = element.getAttribute("Id");
			const type = element.getAttribute("Type");
			const target = element.getAttribute("Target");
			const resolved = target
				? resolvePackageTarget(baseDirectory, target)
				: null;
			return id && type && resolved ? [{ id, type, target: resolved }] : [];
		});
}

export function getPresentationSlides(
	parts: Record<string, string | Blob>,
): PptxSlideEntry[] {
	const presentationXml = parts["ppt/presentation.xml"];
	if (typeof presentationXml !== "string") return [];
	const byId = new Map(
		relationships(parts, "ppt/_rels/presentation.xml.rels", "ppt")
			.filter((relationship) => /\/slide$/i.test(relationship.type))
			.map((relationship) => [relationship.id, relationship.target]),
	);
	const serializedRelationshipIds = Array.from(
		presentationXml.matchAll(/<(?:[\w.-]+:)?sldId\b([^>]*)\/?\s*>/gi),
	).map(
		(match) =>
			match[1].match(/\b[\w.-]+:id\s*=\s*["']([^"']+)["']/i)?.[1] ?? "",
	);
	return descendants(safeParseXml(presentationXml))
		.filter((element) => isPresentation(element, "sldId"))
		.flatMap((element, index) => {
			// happy-dom collapses `id` and `r:id` on elements that contain both,
			// so retain a raw-XML fallback for this standardized attribute pair.
			const relationshipId =
				element.getAttributeNS(OFFICE_REL, "id") ||
				element.getAttribute("r:id") ||
				serializedRelationshipIds[index];
			const path = relationshipId ? byId.get(relationshipId) : undefined;
			return path ? [{ index: index + 1, id: relationshipId!, path }] : [];
		});
}

function relationshipPathForPart(part: string): string {
	const slash = part.lastIndexOf("/");
	const directory = slash >= 0 ? part.slice(0, slash) : "";
	const name = part.slice(slash + 1);
	return `${directory ? `${directory}/` : ""}_rels/${name}.rels`;
}

function relatedParts(
	parts: Record<string, string | Blob>,
	part: string,
	matcher: RegExp,
): string[] {
	const directory = part.slice(0, Math.max(0, part.lastIndexOf("/")));
	return relationships(parts, relationshipPathForPart(part), directory)
		.filter((relationship) => matcher.test(relationship.type))
		.map((relationship) => relationship.target)
		.filter((path) => typeof parts[path] === "string");
}

function splitFallback(text: string): SplitPiece[] {
	const pieces: SplitPiece[] = [];
	let cursor = 0;
	for (let index = 0; index < text.length; index++) {
		if (![".", "?", "!", "。", "！", "？"].includes(text[index])) continue;
		let end = index + 1;
		while (end < text.length && /\s/.test(text[end])) end++;
		const raw = text.slice(cursor, end);
		const leading = raw.match(/^\s*/)?.[0].length ?? 0;
		const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
		const start = cursor + leading;
		const textEnd = end - trailing;
		if (textEnd > start)
			pieces.push({
				text: text.slice(start, textEnd),
				start,
				end: textEnd,
				separator: text.slice(textEnd, end),
			});
		cursor = end;
		index = end - 1;
	}
	if (cursor < text.length) {
		const raw = text.slice(cursor);
		const leading = raw.match(/^\s*/)?.[0].length ?? 0;
		const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
		const start = cursor + leading;
		const end = text.length - trailing;
		if (end > start)
			pieces.push({
				text: text.slice(start, end),
				start,
				end,
				separator: text.slice(end),
			});
	}
	return pieces;
}

function hasAncestor(element: Element, predicate: (entry: Element) => boolean) {
	let current = element.parentElement;
	while (current) {
		if (predicate(current)) return true;
		current = current.parentElement;
	}
	return false;
}

function isProtectedNotesPlaceholder(paragraph: Element): boolean {
	let shape: Element | null = paragraph.parentElement;
	while (shape && !isPresentation(shape, "sp")) shape = shape.parentElement;
	if (!shape) return false;
	const placeholder = descendants(shape).find((entry) =>
		isPresentation(entry, "ph"),
	);
	return ["sldImg", "dt", "sldNum", "hdr", "ftr"].includes(
		placeholder?.getAttribute("type") ?? "",
	);
}

export function segmentPresentationPart(
	xml: string,
	part: string,
	tokensOverride?: string[],
	includeAltText = false,
): PptxSegment[] {
	const document = safeParseXml(xml);
	const paragraphs = descendants(document).filter((element) =>
		isDrawing(element, "p"),
	);
	const segments: PptxSegment[] = [];
	for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
		if (
			part.startsWith("ppt/notesSlides/") &&
			isProtectedNotesPlaceholder(paragraph)
		)
			continue;
		const allTextNodes = descendants(paragraph).filter((element) =>
			isDrawing(element, "t"),
		);
		const nodes = allTextNodes.filter(
			(node) => !hasAncestor(node, (ancestor) => isDrawing(ancestor, "fld")),
		);
		const text = nodes.map((node) => node.textContent ?? "").join("");
		if (!text.trim()) continue;
		let offset = 0;
		const ranges = nodes.map((node) => {
			const start = offset;
			offset += (node.textContent ?? "").length;
			return { node, start, end: offset };
		});
		const tokens = tokensOverride ?? getActiveTokens();
		const pieces =
			tokens.length > 0
				? (splitTextWithPreferences(
						text,
						tokens,
						getActiveTokens,
					) as SplitPiece[])
				: splitFallback(text);
		for (const piece of pieces) {
			const fragments: Extract<PptxSegmentMeta, { kind: "text" }>["fragments"] =
				[];
			for (const range of ranges) {
				const start = Math.max(range.start, piece.start);
				const end = Math.min(range.end, piece.end);
				if (start >= end) continue;
				fragments.push({
					paragraphIndex,
					textNodeIndex: allTextNodes.indexOf(range.node),
					start: start - range.start,
					end: end - range.start,
				});
			}
			if (fragments.length)
				segments.push({
					text: piece.text,
					separator: piece.separator,
					meta: {
						kind: "text",
						part,
						separator: piece.separator,
						fragments,
					},
				});
		}
	}
	if (includeAltText) {
		const properties = descendants(document).filter((element) =>
			isPresentation(element, "cNvPr"),
		);
		for (const [elementIndex, element] of properties.entries()) {
			for (const attribute of ["title", "descr"] as const) {
				const value = element.getAttribute(attribute);
				if (!value?.trim()) continue;
				segments.push({
					text: value,
					separator: "",
					meta: { kind: "attribute", part, elementIndex, attribute },
				});
			}
		}
	}
	return segments;
}

export function getPresentationComments(
	parts: Record<string, string | Blob>,
	slides = getPresentationSlides(parts),
): PptxComment[] {
	const comments: PptxComment[] = [];
	for (const slide of slides) {
		for (const path of relatedParts(parts, slide.path, /\/comments$/i)) {
			const xml = parts[path];
			if (typeof xml !== "string") continue;
			const document = safeParseXml(xml);
			for (const comment of descendants(document).filter(
				(element) =>
					element.localName === "cm" || element.localName === "comment",
			)) {
				const textElement = descendants(comment).find(
					(element) =>
						element.localName === "text" || element.localName === "t",
				);
				const text = textElement?.textContent?.trim();
				if (text)
					comments.push({
						slidePath: slide.path,
						text,
						authorId:
							comment.getAttribute("authorId") ??
							comment.getAttribute("authorIdIdx") ??
							undefined,
					});
			}
		}
	}
	return comments;
}

export function segmentPresentationPackage(
	parts: Record<string, string | Blob>,
	tokensOverride?: string[],
	options: PptxParseOptions = {},
): PptxPackageSegmentationResult {
	const slides = getPresentationSlides(parts).filter(
		(slide) =>
			options.slides === null ||
			!options.slides ||
			options.slides.has(slide.index),
	);
	const selected: string[] = [];
	const add = (path: string) => {
		if (typeof parts[path] === "string" && !selected.includes(path))
			selected.push(path);
	};
	for (const slide of slides) {
		add(slide.path);
		if (options.includeNotes ?? true)
			for (const path of relatedParts(parts, slide.path, /\/notesSlide$/i))
				add(path);
		if (options.includeChartText ?? true)
			for (const path of relatedParts(parts, slide.path, /\/chart$/i))
				add(path);
		if (options.includeSmartArtText ?? true)
			for (const path of relatedParts(parts, slide.path, /\/diagramData$/i))
				add(path);
	}
	if (options.includeMastersLayouts)
		Object.keys(parts)
			.filter((path) =>
				/^ppt\/(?:slideMasters|slideLayouts)\/[^/]+\.xml$/i.test(path),
			)
			.sort()
			.forEach(add);
	const segments = selected.flatMap((part) =>
		segmentPresentationPart(
			parts[part] as string,
			part,
			tokensOverride,
			options.includeAltText ?? true,
		),
	);
	return { segments, parts: selected, slides };
}

interface NodeEdit {
	start: number;
	end: number;
	text: string;
}

function safeCodeUnitBoundary(text: string, boundary: number): number {
	if (
		boundary > 0 &&
		boundary < text.length &&
		/[\uD800-\uDBFF]/.test(text[boundary - 1]) &&
		/[\uDC00-\uDFFF]/.test(text[boundary])
	)
		return boundary + 1;
	return boundary;
}

export function applyTranslationsToPresentationPart(
	xml: string,
	translations: readonly string[],
	meta: readonly PptxSegmentMeta[],
): string {
	if (!meta.length) return xml;
	const document = safeParseXml(xml);
	const paragraphs = descendants(document).filter((element) =>
		isDrawing(element, "p"),
	);
	const properties = descendants(document).filter((element) =>
		isPresentation(element, "cNvPr"),
	);
	const edits = new Map<Element, NodeEdit[]>();
	for (const [index, entry] of meta.entries()) {
		const translation = translations[index];
		if (translation === undefined) continue;
		if (entry.kind === "attribute") {
			properties[entry.elementIndex]?.setAttribute(
				entry.attribute,
				translation,
			);
			continue;
		}
		const total =
			entry.fragments.reduce(
				(sum, fragment) => sum + fragment.end - fragment.start,
				0,
			) || 1;
		let originalOffset = 0;
		let translatedOffset = 0;
		for (const [fragmentIndex, fragment] of entry.fragments.entries()) {
			const paragraph = paragraphs[fragment.paragraphIndex];
			const node = paragraph
				? descendants(paragraph).filter((element) => isDrawing(element, "t"))[
						fragment.textNodeIndex
					]
				: undefined;
			if (!node) continue;
			originalOffset += fragment.end - fragment.start;
			const proportionalEnd =
				fragmentIndex === entry.fragments.length - 1
					? translation.length
					: Math.round((originalOffset / total) * translation.length);
			const translatedEnd = safeCodeUnitBoundary(translation, proportionalEnd);
			edits.set(node, [
				...(edits.get(node) ?? []),
				{
					start: fragment.start,
					end: fragment.end,
					text: translation.slice(translatedOffset, translatedEnd),
				},
			]);
			translatedOffset = translatedEnd;
		}
	}
	for (const [node, nodeEdits] of edits) {
		let text = node.textContent ?? "";
		for (const edit of [...nodeEdits].sort((a, b) => b.start - a.start))
			text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`;
		node.textContent = text;
		if (/^\s|\s$/.test(text))
			node.setAttributeNS(
				"http://www.w3.org/XML/1998/namespace",
				"xml:space",
				"preserve",
			);
	}
	return new XMLSerializer()
		.serializeToString(document)
		.replaceAll("&nbsp;", "&#160;");
}
