import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { TypeRef, XmlSegmentMeta } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type XmlValueReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import {
	parseXmlSyntax,
	type XmlElementLocation,
	type XmlSyntaxDocument,
	type XmlValueLocation,
} from "./xmlFamily";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const ITS_NAMESPACE = "http://www.w3.org/2005/11/its";

function invalidSvg(message: string): SafeInputError {
	return new SafeInputError("SVG_INVALID", message);
}

export function maskInertSvgContent(content: string): string {
	return content
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (value) =>
			" ".repeat(value.length),
		)
		.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (value) =>
			" ".repeat(value.length),
		);
}

function attr(element: XmlElementLocation, name: string): string | undefined {
	return element.attributes.find(
		(entry) => entry.localName === name || entry.qName === name,
	)?.value;
}

function ancestors(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation[] {
	const output = [element];
	let current = element;
	while (current.parentId !== undefined) {
		current = syntax.elements[current.parentId];
		output.push(current);
	}
	return output;
}

function isHidden(chain: readonly XmlElementLocation[]): boolean {
	return chain.some((element) => {
		const style = attr(element, "style") ?? "";
		return (
			attr(element, "display") === "none" ||
			attr(element, "visibility") === "hidden" ||
			attr(element, "aria-hidden") === "true" ||
			/(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\s*(?:;|$)/i.test(
				style,
			)
		);
	});
}

function isTranslateDisabled(chain: readonly XmlElementLocation[]): boolean {
	return chain.some((element) => {
		const plain = element.attributes.find(
			(entry) => entry.qName === "translate",
		)?.value;
		const its = element.attributes.find(
			(entry) =>
				entry.namespaceUri === ITS_NAMESPACE && entry.localName === "translate",
		)?.value;
		return plain === "no" || its === "no";
	});
}

function validateSvgSyntax(content: string): XmlSyntaxDocument {
	const syntax = parseXmlSyntax(maskInertSvgContent(content));
	const root = syntax.elements[0];
	if (
		!root ||
		root.localName.toLowerCase() !== "svg" ||
		(root.namespaceUri !== undefined && root.namespaceUri !== SVG_NAMESPACE)
	)
		throw invalidSvg(
			"The document root is not an SVG element in the SVG namespace.",
		);
	return syntax;
}

export async function validateSvgFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		validateSvgSyntax(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not safe, well-formed SVG." };
	}
}

export async function importSvgFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("svg", options);
	const read = await readSafeTextFile(file, context);
	const syntax = validateSvgSyntax(read.text);
	const elementSelectors = new Set(
		parseList(filterOptions.elementSelectors).map((value) =>
			value.toLowerCase(),
		),
	);
	const attributeSelectors = new Set(
		parseList(filterOptions.attributeSelectors).map((value) =>
			value.toLowerCase(),
		),
	);
	const candidates: XmlValueLocation[] = [];
	for (const value of syntax.values) {
		const element = syntax.elements[value.elementId];
		const chain = ancestors(element, syntax);
		const names = new Set(chain.map((entry) => entry.localName.toLowerCase()));
		if (names.has("script") || names.has("style")) continue;
		if (names.has("metadata") && !filterOptions.includeMetadata) continue;
		if (!filterOptions.includeHiddenText && isHidden(chain)) continue;
		if (
			filterOptions.respectTranslateMetadata &&
			(isTranslateDisabled(chain) || !element.effectiveTranslate)
		)
			continue;
		if (
			elementSelectors.has("*") ||
			elementSelectors.has(element.localName.toLowerCase()) ||
			(filterOptions.includeMetadata && names.has("metadata"))
		)
			candidates.push(value);
	}
	for (const element of syntax.elements) {
		const chain = ancestors(element, syntax);
		if (!filterOptions.includeHiddenText && isHidden(chain)) continue;
		if (filterOptions.respectTranslateMetadata && isTranslateDisabled(chain))
			continue;
		for (const entry of element.attributes)
			if (
				attributeSelectors.has(entry.localName.toLowerCase()) &&
				entry.namespaceUri !== ITS_NAMESPACE &&
				entry.value.trim()
			)
				candidates.push({
					location: "attribute",
					elementId: element.id,
					path: [...element.path, `@${entry.qName}`],
					attribute: entry.qName,
					start: entry.start,
					end: entry.end,
					value: entry.value,
				});
	}
	const segments: string[] = [];
	const meta: XmlSegmentMeta[] = [];
	const replacements: XmlValueReplacement[] = [];
	const locations: XmlValueLocation[] = [];
	for (const candidate of candidates.sort((a, b) => a.start - b.start)) {
		const mode = String(filterOptions.segmentationMode);
		const pieces =
			mode === "sentences"
				? segmentPlainText(candidate.value, "sentences")
				: mode === "preferences"
					? splitTextWithPreferences(candidate.value)
					: [{ text: candidate.value, separator: "" }];
		const effective = pieces.filter((piece) => piece.text.trim());
		for (const piece of effective.length
			? effective
			: [{ text: candidate.value, separator: "" }]) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			const common = {
				path: candidate.path,
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
			locations.push(candidate);
		}
	}
	const document = createNeutralDocument({
		format: "svg",
		sourceSegments: segments,
		sourceLocations: locations.map((entry, segmentIndex) => ({
			part: file.name,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: "SVG 1.1/2 XML",
		encoding: read.encoding,
		hasBom: read.hasBom,
		security:
			"Scripts and styles are masked during parsing and preserved as inert source bytes.",
	};
	for (const [index, entry] of locations.entries()) {
		const element = syntax.elements[entry.elementId];
		document.units[index].contexts.push({
			type: "svg-path",
			value: entry.path.join("/"),
		});
		for (const [type, value] of [
			["svg-id", attr(element, "id")],
			["svg-language", attr(element, "lang")],
			["svg-style", attr(element, "style")],
		] as const)
			if (value) document.units[index].contexts.push({ type, value });
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"svg",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "svg-xml" } as TypeRef,
		segmentsMeta: meta,
	};
}
