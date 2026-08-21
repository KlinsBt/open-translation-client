import JSZip from "jszip";
import { applyTranslationsToDocxXml } from "$lib/functions/parsing/parsingDocx";
import type {
	DocxSegmentMeta,
	LegacyBilingualDocxSegmentMeta as LegacyDocxSegmentMeta,
	LegacyBilingualOleSegmentMeta as LegacyOleSegmentMeta,
	LegacyBilingualProfile,
	LegacyBilingualRtfSegmentMeta as LegacyRtfSegmentMeta,
	LegacyBilingualSegmentMeta,
	LegacyBilingualXmlSegmentMeta as LegacyXmlSegmentMeta,
	TypeRef,
	UserData,
} from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { collectLegacyParagraphs } from "./legacyOffice";
import { normalizeImportOptions } from "./options";
import { assertProjectExportQuality } from "./qualityAssurance";
import {
	createSkeletonSource,
	decodeTextBytes,
	readSafeFileBytes,
	readSafeTextFile,
	readSafeZipPackage,
	SafeInputError,
	safeParseXml,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import {
	createPackageSkeleton,
	createTextSkeleton,
	type DocxTextReplacement,
	type TextRangeReplacement,
} from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import {
	decodeXmlText,
	parseXmlSyntax,
	type XmlElementLocation,
} from "./xmlFamily";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";

export const LEGACY_BILINGUAL_EXTENSIONS = [
	"ttx",
	"itd",
	"txml",
	"doc",
	"docx",
	"rtf",
	"bak",
] as const;

export const LEGACY_BILINGUAL_MIME_TYPES = [
	"application/xml",
	"text/xml",
	"application/rtf",
	"text/rtf",
	"application/msword",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/octet-stream",
] as const;

interface ProtectedMarkup {
	display: string;
	tokens: Record<string, string>;
}

interface ParsedLegacyBilingual {
	profile: LegacyBilingualProfile;
	segments: string[];
	targets: string[];
	meta: LegacyBilingualSegmentMeta[];
	sourceLanguage?: string;
	targetLanguage?: string;
	parts?: Record<string, string | Blob>;
	warnings: string[];
}

const WORKBENCH_PAIR = /\{0>([\s\S]*?)<\}(\d{1,3})\{>([\s\S]*?)<0\{/g;
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const TOKEN_PATTERN = /\{ut(\d+)\}/g;

function extensionOf(name: string): string {
	return name.toLowerCase().split(".").at(-1) ?? "";
}

function hasOleSignature(bytes: Uint8Array): boolean {
	return OLE_SIGNATURE.every((value, index) => bytes[index] === value);
}

function isWordElement(element: Element, name: string): boolean {
	return (
		element.localName === name &&
		(element.prefix === "w" ||
			element.tagName === `w:${name}` ||
			/wordprocessingml/i.test(element.namespaceURI ?? ""))
	);
}

function attribute(
	element: XmlElementLocation,
	...names: string[]
): string | undefined {
	const expected = new Set(names.map((name) => name.toLowerCase()));
	return element.attributes.find(
		(candidate) =>
			expected.has(candidate.qName.toLowerCase()) ||
			expected.has(candidate.localName.toLowerCase()),
	)?.value;
}

function children(
	elements: readonly XmlElementLocation[],
	parent: XmlElementLocation,
	...names: string[]
): XmlElementLocation[] {
	const expected = new Set(names.map((name) => name.toLowerCase()));
	return elements.filter(
		(element) =>
			element.parentId === parent.id &&
			expected.has(element.localName.toLowerCase()),
	);
}

function descendants(
	elements: readonly XmlElementLocation[],
	parent: XmlElementLocation,
	...names: string[]
): XmlElementLocation[] {
	const expected = new Set(names.map((name) => name.toLowerCase()));
	const ancestors = new Set([parent.id]);
	const output: XmlElementLocation[] = [];
	for (const element of elements) {
		if (element.parentId === undefined || !ancestors.has(element.parentId))
			continue;
		ancestors.add(element.id);
		if (expected.has(element.localName.toLowerCase())) output.push(element);
	}
	return output;
}

function elementInnerRange(element: XmlElementLocation): {
	start: number;
	end: number;
} {
	if (element.selfClosing)
		return { start: element.startTagStart, end: element.startTagEnd + 1 };
	if (element.endTagStart === undefined)
		throw new SafeInputError(
			"XML_MALFORMED",
			`The <${element.qName}> element has no closing tag.`,
		);
	return { start: element.startTagEnd + 1, end: element.endTagStart };
}

function protectedXmlContent(
	innerXml: string,
	startAt = 1,
	existing: Record<string, string> = {},
): ProtectedMarkup {
	const tokens = { ...existing };
	let next = Math.max(
		startAt,
		...Object.keys(tokens).map((key) => Number(key.replace(/\D/g, "")) + 1),
	);
	let display = "";
	let cursor = 0;
	const usedExisting = new Set<string>();
	const inline =
		/<(?:[\w.-]+:)?(?:ut|ph|x|bx|ex|bpt|ept|it)\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?(?:ut|ph|x|bx|ex|bpt|ept|it)\s*>|<!--[\s\S]*?-->|<\/?[A-Za-z_][^<>]*?>/gi;
	for (const match of innerXml.matchAll(inline)) {
		const index = match.index ?? 0;
		if (index > cursor) display += decodeXmlText(innerXml.slice(cursor, index));
		const matchingExisting = Object.entries(tokens).find(
			([key, raw]) => raw === match[0] && !usedExisting.has(key),
		)?.[0];
		const key = matchingExisting ?? String(next++);
		usedExisting.add(key);
		tokens[key] = match[0];
		display += `{ut${key}}`;
		cursor = index + match[0].length;
	}
	if (cursor < innerXml.length)
		display += decodeXmlText(innerXml.slice(cursor));
	return { display, tokens };
}

function requiredTokens(
	source: ProtectedMarkup,
	target: ProtectedMarkup,
): string[] {
	const targetKeys = tokenKeys(target.display);
	return targetKeys.length ? targetKeys : tokenKeys(source.display);
}

function tokenKeys(value: string): string[] {
	return [...value.matchAll(TOKEN_PATTERN)].map((match) => match[1]);
}

function xmlProfile(
	content: string,
	fileName: string,
): "ttx" | "itd" | "txml" | undefined {
	const syntax = parseXmlSyntax(content);
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	if (!root) return undefined;
	const name = root.localName.toLowerCase();
	const extension = extensionOf(fileName);
	if (
		name === "tradostag" &&
		descendants(syntax.elements, root, "tu").some(
			(unit) => children(syntax.elements, unit, "tuv").length >= 2,
		)
	)
		return "ttx";
	if (
		name === "txml" &&
		descendants(syntax.elements, root, "segment").some(
			(unit) =>
				descendants(syntax.elements, unit, "source").length > 0 &&
				descendants(syntax.elements, unit, "target").length > 0,
		)
	)
		return "txml";
	const itdSignature =
		name === "itd" ||
		name === "sdlx" ||
		/\b(?:xmlns(?::\w+)?|version)=["'][^"']*(?:itd|sdlx|sdl)[^"']*["']/i.test(
			content.slice(root.startTagStart, root.startTagEnd + 1),
		);
	if (
		itdSignature &&
		["itd", "sdlx", "document"].includes(name) &&
		(extension === "itd" || name !== "document")
	)
		return "itd";
	return undefined;
}

function pairElements(
	profile: "ttx" | "itd" | "txml",
	elements: readonly XmlElementLocation[],
): Array<{
	unit: XmlElementLocation;
	source: XmlElementLocation;
	target: XmlElementLocation;
}> {
	if (profile === "ttx")
		return elements
			.filter((element) => element.localName.toLowerCase() === "tu")
			.flatMap((unit) => {
				const variants = children(elements, unit, "tuv");
				return variants.length >= 2
					? [{ unit, source: variants[0], target: variants[1] }]
					: [];
			});
	const units = elements.filter((element) =>
		(profile === "txml"
			? ["segment"]
			: ["segment", "seg", "tu", "translationunit"]
		).includes(element.localName.toLowerCase()),
	);
	return units.flatMap((unit) => {
		const nested = descendants(
			elements,
			unit,
			"source",
			"src",
			"source_segment",
			"sourcecontent",
		);
		const targets = descendants(
			elements,
			unit,
			"target",
			"trg",
			"target_segment",
			"targetcontent",
		);
		return nested[0] && targets[0]
			? [{ unit, source: nested[0], target: targets[0] }]
			: [];
	});
}

export function parseLegacyBilingualXml(
	content: string,
	fileName: string,
): ParsedLegacyBilingual {
	const profile = xmlProfile(content, fileName);
	if (!profile)
		throw new SafeInputError(
			"XML_MALFORMED",
			"The XML has no recognized TTX, ITD, or TXML bilingual signature.",
		);
	const syntax = parseXmlSyntax(content);
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	)!;
	const pairs = pairElements(profile, syntax.elements);
	if (!pairs.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			`The ${profile.toUpperCase()} document has no complete source/target units.`,
		);
	const segments: string[] = [];
	const targets: string[] = [];
	const meta: LegacyXmlSegmentMeta[] = [];
	for (const [index, pair] of pairs.entries()) {
		const sourceRange = elementInnerRange(pair.source);
		const targetRange = elementInnerRange(pair.target);
		const sourceInner = pair.source.selfClosing
			? ""
			: content.slice(sourceRange.start, sourceRange.end);
		const targetInner = pair.target.selfClosing
			? ""
			: content.slice(targetRange.start, targetRange.end);
		const source = protectedXmlContent(sourceInner);
		const target = protectedXmlContent(
			targetInner,
			Object.keys(source.tokens).length + 1,
			source.tokens,
		);
		const unitId =
			attribute(pair.unit, "id", "segmentid", "mid") ??
			`${profile}-${index + 1}`;
		const translate = attribute(pair.unit, "translate");
		const lock = attribute(pair.unit, "locked", "lock");
		const locked =
			/^(?:no|false)$/i.test(translate ?? "") ||
			/^(?:1|yes|true|locked)$/i.test(lock ?? "") ||
			/^(?:no|false)$/i.test(attribute(pair.source, "translate") ?? "");
		const status = attribute(
			pair.unit,
			"status",
			"state",
			"translation_status",
			"MatchPercent",
		);
		segments.push(source.display);
		targets.push(target.display);
		meta.push({
			profile,
			unitId,
			originalSource: source.display,
			originalTarget: target.display,
			locked,
			...(status ? { status } : {}),
			start: targetRange.start,
			end: targetRange.end,
			targetMode: pair.target.selfClosing ? "self-closing" : "inner",
			targetQName: pair.target.qName,
			...(pair.target.selfClosing
				? {
						targetStartTag: content.slice(
							pair.target.startTagStart,
							pair.target.startTagEnd + 1,
						),
					}
				: {}),
			tokens: target.tokens,
			requiredTokens: requiredTokens(source, target),
		});
	}
	return {
		profile,
		segments,
		targets,
		meta,
		sourceLanguage:
			attribute(root, "SourceLanguage", "source-language", "srcLang") ??
			attribute(pairs[0].source, "Lang", "lang", "xml:lang"),
		targetLanguage:
			attribute(root, "TargetLanguage", "target-language", "targetLang") ??
			attribute(pairs[0].target, "Lang", "lang", "xml:lang"),
		warnings: [],
	};
}

interface RtfCharacter {
	value: string;
	start: number;
	end: number;
}

function decodeRtfHex(value: string): string {
	return new TextDecoder("windows-1252").decode(
		new Uint8Array([Number.parseInt(value, 16)]),
	);
}

function scanRtfCharacters(content: string): RtfCharacter[][] {
	const skipped = new Set([
		"fonttbl",
		"colortbl",
		"stylesheet",
		"info",
		"pict",
		"object",
		"datastore",
		"themedata",
		"colorschememapping",
		"listtable",
		"listoverridetable",
	]);
	const paragraphs: RtfCharacter[][] = [];
	let current: RtfCharacter[] = [];
	const states: Array<{ skip: boolean; uc: number }> = [{ skip: false, uc: 1 }];
	const flush = () => {
		if (current.length) paragraphs.push(current);
		current = [];
	};
	for (let index = 0; index < content.length; ) {
		const state = states.at(-1)!;
		if (content[index] === "{") {
			const destination = content
				.slice(index)
				.match(/^\{\s*\\\*?\\?([a-zA-Z]+)/)?.[1]
				?.toLowerCase();
			states.push({
				skip: state.skip || skipped.has(destination ?? ""),
				uc: state.uc,
			});
			index++;
			continue;
		}
		if (content[index] === "}") {
			if (states.length > 1) states.pop();
			index++;
			continue;
		}
		if (content[index] !== "\\") {
			if (!state.skip)
				current.push({ value: content[index], start: index, end: index + 1 });
			index++;
			continue;
		}
		const escaped = content[index + 1];
		if (["\\", "{", "}"].includes(escaped)) {
			if (!state.skip)
				current.push({ value: escaped, start: index, end: index + 2 });
			index += 2;
			continue;
		}
		if (
			escaped === "'" &&
			/^[0-9a-f]{2}$/i.test(content.slice(index + 2, index + 4))
		) {
			if (!state.skip)
				current.push({
					value: decodeRtfHex(content.slice(index + 2, index + 4)),
					start: index,
					end: index + 4,
				});
			index += 4;
			continue;
		}
		const control = content.slice(index).match(/^\\([a-zA-Z]+)(-?\d+)? ?/);
		if (control) {
			const word = control[1].toLowerCase();
			const parameter =
				control[2] === undefined ? undefined : Number(control[2]);
			const controlEnd = index + control[0].length;
			if (!state.skip && word === "par") flush();
			else if (!state.skip && (word === "line" || word === "tab"))
				current.push({
					value: word === "line" ? "\n" : "\t",
					start: index,
					end: controlEnd,
				});
			else if (word === "uc" && parameter !== undefined)
				state.uc = Math.max(0, parameter);
			else if (!state.skip && word === "u" && parameter !== undefined) {
				const codePoint = parameter < 0 ? parameter + 65536 : parameter;
				const end = Math.min(content.length, controlEnd + state.uc);
				current.push({
					value: String.fromCharCode(codePoint),
					start: index,
					end,
				});
				index = end;
				continue;
			}
			index = controlEnd;
			continue;
		}
		index += Math.min(2, content.length - index);
	}
	flush();
	return paragraphs;
}

function rawFragments(
	characters: readonly RtfCharacter[],
	start: number,
	end: number,
): Array<{ start: number; end: number }> {
	if (start === end) {
		const offset = characters[start]?.start ?? characters.at(-1)?.end ?? 0;
		return [{ start: offset, end: offset }];
	}
	const output: Array<{ start: number; end: number }> = [];
	for (const character of characters.slice(start, end)) {
		const previous = output.at(-1);
		if (previous?.end === character.start) previous.end = character.end;
		else output.push({ start: character.start, end: character.end });
	}
	return output;
}

function parseWorkbenchRtf(content: string): ParsedLegacyBilingual {
	if (!/^\s*\{\\rtf\d/i.test(content))
		throw new SafeInputError("RTF_INVALID", "The file has no RTF header.");
	if (!/(?:\\v\b|tw4win(?:Mark|External|Internal))/i.test(content))
		throw new SafeInputError(
			"RTF_INVALID",
			"The RTF has no Trados Workbench hidden-text or tw4win style signature.",
		);
	const segments: string[] = [];
	const targets: string[] = [];
	const meta: LegacyRtfSegmentMeta[] = [];
	for (const characters of scanRtfCharacters(content)) {
		const text = characters.map((character) => character.value).join("");
		for (const match of text.matchAll(WORKBENCH_PAIR)) {
			const whole = match[0];
			const sourceOffset = whole.indexOf(match[1]);
			const targetMarker = whole.indexOf("{>", sourceOffset + match[1].length);
			const targetOffset = targetMarker + 2;
			const base = match.index ?? 0;
			segments.push(match[1]);
			targets.push(match[3]);
			meta.push({
				profile: "workbench-rtf",
				unitId: `workbench-${meta.length + 1}`,
				originalSource: match[1],
				originalTarget: match[3],
				locked: false,
				status: match[2],
				fragments: rawFragments(
					characters,
					base + targetOffset,
					base + targetOffset + match[3].length,
				),
			});
		}
	}
	if (!segments.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"No valid Trados Workbench bilingual delimiters were found.",
		);
	return {
		profile: "workbench-rtf",
		segments,
		targets,
		meta,
		warnings: [],
	};
}

function docxTextNodes(paragraph: Element): Element[] {
	return Array.from(paragraph.getElementsByTagName("*")).filter(
		(element) =>
			isWordElement(element, "t") || isWordElement(element, "delText"),
	);
}

function parseWorkbenchDocxPart(
	xml: string,
	part: string,
): { segments: string[]; targets: string[]; meta: LegacyDocxSegmentMeta[] } {
	const document = safeParseXml(xml);
	const paragraphs = Array.from(document.getElementsByTagName("*")).filter(
		(element) => isWordElement(element, "p"),
	);
	const segments: string[] = [];
	const targets: string[] = [];
	const meta: LegacyDocxSegmentMeta[] = [];
	for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
		const nodes = docxTextNodes(paragraph);
		const text = nodes.map((node) => node.textContent ?? "").join("");
		const ranges: Array<{ start: number; end: number }> = [];
		let cursor = 0;
		for (const node of nodes) {
			const length = (node.textContent ?? "").length;
			ranges.push({ start: cursor, end: cursor + length });
			cursor += length;
		}
		for (const match of text.matchAll(WORKBENCH_PAIR)) {
			const whole = match[0];
			const targetMarker = whole.indexOf(
				"{>",
				whole.indexOf(match[1]) + match[1].length,
			);
			const targetStart = (match.index ?? 0) + targetMarker + 2;
			const targetEnd = targetStart + match[3].length;
			const fragments: DocxSegmentMeta["fragments"] = [];
			for (const [textNodeIndex, range] of ranges.entries()) {
				const overlapStart = Math.max(range.start, targetStart);
				const overlapEnd = Math.min(range.end, targetEnd);
				if (overlapStart < overlapEnd)
					fragments.push({
						paragraphIndex,
						textNodeIndex,
						start: overlapStart - range.start,
						end: overlapEnd - range.start,
					});
			}
			if (!fragments.length && targetStart === targetEnd) {
				const nodeIndex = ranges.findIndex(
					(range) => targetStart >= range.start && targetStart <= range.end,
				);
				if (nodeIndex >= 0)
					fragments.push({
						paragraphIndex,
						textNodeIndex: nodeIndex,
						start: targetStart - ranges[nodeIndex].start,
						end: targetStart - ranges[nodeIndex].start,
					});
			}
			if (!fragments.length) continue;
			segments.push(match[1]);
			targets.push(match[3]);
			meta.push({
				profile: "workbench-docx",
				part,
				unitId: `workbench-${part}-${meta.length + 1}`,
				originalSource: match[1],
				originalTarget: match[3],
				locked: false,
				status: match[2],
				fragments,
			});
		}
	}
	return { segments, targets, meta };
}

async function parseWorkbenchDocx(
	file: File,
	context?: SafeInputContext,
): Promise<ParsedLegacyBilingual> {
	const archive = await readSafeZipPackage(file, context);
	const documentXml = archive.parts["word/document.xml"];
	const stylesXml = archive.parts["word/styles.xml"];
	if (typeof documentXml !== "string")
		throw new SafeInputError(
			"ARCHIVE_INVALID",
			"The DOCX package has no word/document.xml part.",
		);
	if (
		!/(?:tw4win(?:Mark|External|Internal)|w:(?:vanish|specVanish))/i.test(
			`${documentXml}\n${typeof stylesXml === "string" ? stylesXml : ""}`,
		)
	)
		throw new SafeInputError(
			"ARCHIVE_INVALID",
			"The DOCX package has no Trados Workbench hidden-text or tw4win style signature.",
		);
	const parsed = parseWorkbenchDocxPart(documentXml, "word/document.xml");
	if (!parsed.segments.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"No valid Trados Workbench bilingual delimiters were found in the DOCX package.",
		);
	return {
		profile: "workbench-docx",
		...parsed,
		parts: archive.parts,
		warnings: [],
	};
}

async function parseWorkbenchOle(
	bytes: Uint8Array,
	context?: SafeInputContext,
): Promise<ParsedLegacyBilingual> {
	throwIfAborted(context?.signal);
	const { Ream } = await import("reamkit");
	const parsed = Ream.parse(bytes);
	if (parsed.format !== "doc")
		throw new SafeInputError(
			"LEGACY_OFFICE_INVALID",
			"The OLE streams do not contain a Word document.",
		);
	const segments: string[] = [];
	const targets: string[] = [];
	const meta: LegacyOleSegmentMeta[] = [];
	for (const paragraph of collectLegacyParagraphs(parsed.flow))
		for (const match of paragraph.text.matchAll(WORKBENCH_PAIR)) {
			segments.push(match[1]);
			targets.push(match[3]);
			meta.push({
				profile: "workbench-ole",
				unitId: `workbench-ole-${meta.length + 1}`,
				originalSource: match[1],
				originalTarget: match[3],
				locked: false,
				status: match[2],
			});
		}
	if (!segments.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"The Word binary contains no Trados Workbench bilingual delimiters.",
		);
	return {
		profile: "workbench-ole",
		segments,
		targets,
		meta,
		warnings: [
			"Binary Workbench DOC is imported locally and exported as a safe bilingual RTF because rewriting OLE Word streams in the browser is not sufficiently specified.",
		],
	};
}

async function parseLegacyFile(
	file: File,
	context?: SafeInputContext,
): Promise<{
	parsed: ParsedLegacyBilingual;
	read?: Awaited<ReturnType<typeof readSafeTextFile>>;
}> {
	const extension = extensionOf(file.name);
	if (extension === "docx")
		return { parsed: await parseWorkbenchDocx(file, context) };
	const bytes = await readSafeFileBytes(file, context);
	if (hasOleSignature(bytes))
		return { parsed: await parseWorkbenchOle(bytes, context) };
	const decoded = decodeTextBytes(bytes);
	const read = {
		bytes,
		text: decoded.text,
		encoding: decoded.encoding,
		hasBom: decoded.hasBom,
	} as Awaited<ReturnType<typeof readSafeTextFile>>;
	return {
		parsed: /^\s*\{\\rtf\d/i.test(decoded.text)
			? parseWorkbenchRtf(decoded.text)
			: parseLegacyBilingualXml(decoded.text, file.name),
		read,
	};
}

export async function validateLegacyBilingualFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		if (!LEGACY_BILINGUAL_EXTENSIONS.includes(extensionOf(file.name) as never))
			return {
				valid: false,
				reason: "A supported legacy bilingual filename is required.",
			};
		await parseLegacyFile(file, context);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			reason:
				error instanceof Error
					? error.message
					: "The file has no recognized legacy bilingual structure.",
			errorCode: error instanceof SafeInputError ? error.code : undefined,
		};
	}
}

export async function importLegacyBilingualFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const normalized = normalizeImportOptions("legacy-bilingual", options);
	const { parsed: allUnits, read } = await parseLegacyFile(file, context);
	const selectedIndexes = allUnits.meta.flatMap((entry, index) =>
		Boolean(normalized.includeLocked) || !entry.locked ? [index] : [],
	);
	const parsed: ParsedLegacyBilingual = {
		...allUnits,
		segments: selectedIndexes.map((index) => allUnits.segments[index]),
		targets: selectedIndexes.map((index) => allUnits.targets[index]),
		meta: selectedIndexes.map((index) => allUnits.meta[index]),
	};
	if (!parsed.meta.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"No legacy bilingual units match the selected import options.",
		);
	const replacements = parsed.meta.map((entry, unitIndex) =>
		entry.profile === "workbench-docx"
			? ({
					kind: "docx-text",
					unitIndex,
					part: entry.part,
					fragments: entry.fragments.map((fragment) => ({ ...fragment })),
				} satisfies DocxTextReplacement)
			: ({
					kind: "text-range",
					unitIndex,
					start:
						entry.profile === "workbench-rtf"
							? (entry.fragments[0]?.start ?? 0)
							: entry.profile === "workbench-ole"
								? 0
								: entry.start,
					end:
						entry.profile === "workbench-rtf"
							? (entry.fragments.at(-1)?.end ?? 0)
							: entry.profile === "workbench-ole"
								? 0
								: entry.end,
				} satisfies TextRangeReplacement),
	);
	const document = createNeutralDocument({
		format: "legacy-bilingual",
		sourceSegments: parsed.segments,
		targetSegments: parsed.targets,
		...(parsed.sourceLanguage ? { sourceLanguage: parsed.sourceLanguage } : {}),
		...(parsed.targetLanguage ? { targetLanguage: parsed.targetLanguage } : {}),
		unitIds: parsed.meta.map((entry) => entry.unitId),
		sourceLocations: parsed.meta.map((entry, segmentIndex) => ({
			part: entry.profile === "workbench-docx" ? entry.part : file.name,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: parsed.profile,
		roundTrip:
			parsed.profile === "workbench-ole" ? "conversion-only-to-rtf" : true,
		warnings: parsed.warnings,
		processing: "on-device",
		safety:
			"Macros, scripts, formulas, embedded objects, and external entities are never executed.",
	};
	for (const [index, entry] of parsed.meta.entries()) {
		const unit = document.units[index];
		unit.translatable = !entry.locked;
		unit.metadata = {
			legacyBilingual: {
				profile: entry.profile,
				locked: entry.locked,
				...(entry.status ? { status: entry.status } : {}),
			},
		};
		if (entry.status)
			unit.contexts.push({ type: "legacy-status", value: entry.status });
	}
	const skeleton = parsed.parts
		? await createPackageSkeleton(
				file,
				"legacy-bilingual",
				parsed.parts,
				replacements,
			)
		: await createTextSkeleton(
				file,
				"legacy-bilingual",
				read?.text ?? "",
				replacements,
				read ? createSkeletonSource(file, read) : undefined,
			);
	return {
		kind: "segments",
		segments: parsed.segments,
		targetSegments: parsed.targets,
		document,
		skeleton,
		filterOptions: normalized,
		typeRef: {
			profile: parsed.profile,
			sourceExtension: extensionOf(file.name),
			warnings: parsed.warnings,
		} as TypeRef,
		segmentsMeta: parsed.meta,
	};
}

function legacyMeta(project: UserData): LegacyBilingualSegmentMeta[] {
	const meta = project.translationData.segmentsMeta as
		| LegacyBilingualSegmentMeta[]
		| undefined;
	if (!meta || meta.length !== project.translationData.seg1.length)
		throw new Error(
			"Legacy bilingual export requires complete source/target mapping metadata.",
		);
	return meta;
}

function identityTargets(
	project: UserData,
	meta: readonly LegacyBilingualSegmentMeta[],
): boolean {
	return meta.every(
		(entry, index) =>
			project.translationData.seg1[index] === entry.originalSource &&
			project.translationData.seg2[index] === entry.originalTarget,
	);
}

function escapeXmlText(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function renderProtectedXml(
	value: string,
	entry: LegacyXmlSegmentMeta,
): string {
	const seen = new Map<string, number>();
	let output = "";
	let cursor = 0;
	for (const match of value.matchAll(TOKEN_PATTERN)) {
		const index = match.index ?? 0;
		output += escapeXmlText(value.slice(cursor, index));
		const key = match[1];
		const raw = entry.tokens[key];
		if (!raw)
			throw new Error(
				`Legacy bilingual unit ${entry.unitId} contains an unknown inline token {ut${key}}.`,
			);
		seen.set(key, (seen.get(key) ?? 0) + 1);
		output += raw;
		cursor = index + match[0].length;
	}
	output += escapeXmlText(value.slice(cursor));
	for (const key of entry.requiredTokens) {
		const count = seen.get(key) ?? 0;
		if (count !== 1)
			throw new Error(
				`Legacy bilingual unit ${entry.unitId} must contain protected inline token {ut${key}} exactly once.`,
			);
	}
	for (const [key, count] of seen)
		if (count !== 1)
			throw new Error(
				`Legacy bilingual unit ${entry.unitId} duplicates protected inline token {ut${key}}.`,
			);
	return output;
}

function replaceTextRanges(
	content: string,
	edits: Array<{ start: number; end: number; value: string }>,
): string {
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	return output;
}

function escapeRtf(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index++) {
		const character = value[index];
		if (["\\", "{", "}"].includes(character)) output += `\\${character}`;
		else if (character === "\n") output += "\\line ";
		else if (character === "\t") output += "\\tab ";
		else {
			const code = value.charCodeAt(index);
			output +=
				code >= 32 && code <= 126
					? character
					: `\\u${code > 32767 ? code - 65536 : code}?`;
		}
	}
	return output;
}

function originalSourceBlob(project: UserData): Blob {
	const blob = project.translationData.skeleton?.source.originalFile;
	if (!(blob instanceof Blob))
		throw new Error(
			"The original legacy bilingual file is no longer available.",
		);
	return blob;
}

export async function buildLegacyBilingualTranslation(
	project: UserData,
): Promise<{
	blob: Blob;
	extension: string;
	mimeType: string;
}> {
	assertProjectExportQuality(project);
	const meta = legacyMeta(project);
	const profile = meta[0]?.profile;
	if (!profile || meta.some((entry) => entry.profile !== profile))
		throw new Error("Legacy bilingual profile metadata is inconsistent.");
	for (const [index, entry] of meta.entries()) {
		if (project.translationData.seg1[index] !== entry.originalSource)
			throw new Error(
				`Source unit ${entry.unitId} changed; same-family export only writes target content.`,
			);
		if (
			entry.locked &&
			project.translationData.seg2[index] !== entry.originalTarget
		)
			throw new Error(
				`Locked unit ${entry.unitId} was changed. Restore its original target before export.`,
			);
	}
	const sourceExtension =
		typeof project.translationData.typeRef === "object" &&
		typeof project.translationData.typeRef.sourceExtension === "string"
			? project.translationData.typeRef.sourceExtension
			: profile === "workbench-rtf"
				? "rtf"
				: profile;
	if (identityTargets(project, meta))
		return {
			blob: originalSourceBlob(project),
			extension: sourceExtension,
			mimeType:
				project.translationData.skeleton?.source.mimeType ||
				"application/octet-stream",
		};
	if (profile === "workbench-docx") {
		const skeleton = project.translationData.skeleton;
		if (!skeleton || skeleton.payload.kind !== "package")
			throw new Error(
				"Workbench DOCX export requires its original package skeleton.",
			);
		const parts = { ...skeleton.payload.parts };
		const groups = new Map<
			string,
			{ targets: string[]; meta: DocxSegmentMeta[] }
		>();
		for (const [index, entry] of (meta as LegacyDocxSegmentMeta[]).entries()) {
			const group = groups.get(entry.part) ?? { targets: [], meta: [] };
			group.targets.push(project.translationData.seg2[index] ?? "");
			group.meta.push({ part: entry.part, fragments: entry.fragments });
			groups.set(entry.part, group);
		}
		for (const [part, group] of groups) {
			const xml = parts[part];
			if (typeof xml !== "string")
				throw new Error(`The Workbench DOCX part ${part} is missing.`);
			parts[part] = applyTranslationsToDocxXml(
				xml,
				group.targets,
				[],
				group.meta,
			);
			safeParseXml(parts[part] as string);
		}
		const zip = await JSZip.loadAsync(
			await originalSourceBlob(project).arrayBuffer(),
		);
		for (const [path, value] of Object.entries(parts))
			if (value !== skeleton.payload.parts[path]) zip.file(path, value);
		return {
			blob: await zip.generateAsync({
				type: "blob",
				mimeType:
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			}),
			extension: "docx",
			mimeType:
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		};
	}
	if (profile === "workbench-ole") {
		const body = meta
			.map(
				(entry, index) =>
					`{\\v \\{0\\>${escapeRtf(entry.originalSource)}\\<\\}100\\{\\>${escapeRtf(project.translationData.seg2[index] ?? "")}\\<0\\{}}\\par`,
			)
			.join("\n");
		return {
			blob: new Blob([`{\\rtf1\\ansi\\deff0\n${body}\n}`], {
				type: "application/rtf",
			}),
			extension: "rtf",
			mimeType: "application/rtf",
		};
	}
	const skeleton = project.translationData.skeleton;
	if (!skeleton || skeleton.payload.kind !== "text")
		throw new Error(
			"Legacy bilingual export requires its positional text skeleton.",
		);
	if (profile === "workbench-rtf") {
		const edits: Array<{ start: number; end: number; value: string }> = [];
		for (const [index, entry] of (meta as LegacyRtfSegmentMeta[]).entries())
			for (const [fragmentIndex, fragment] of entry.fragments.entries())
				edits.push({
					...fragment,
					value:
						fragmentIndex === 0
							? escapeRtf(project.translationData.seg2[index] ?? "")
							: "",
				});
		const output = replaceTextRanges(skeleton.payload.content, edits);
		parseWorkbenchRtf(output);
		const encoding = skeleton.source.encoding ?? "windows-1252";
		return {
			blob: new Blob(
				[encodeTextBytes(output, encoding, skeleton.source.hasBom ?? false)],
				{ type: `application/rtf;charset=${encoding}` },
			),
			extension: sourceExtension,
			mimeType: `application/rtf;charset=${encoding}`,
		};
	}
	const edits = (meta as LegacyXmlSegmentMeta[]).map((entry, index) => {
		const inner = renderProtectedXml(
			project.translationData.seg2[index] ?? "",
			entry,
		);
		const value =
			entry.targetMode === "self-closing"
				? `${(entry.targetStartTag ?? `<${entry.targetQName}/>`).replace(/\/\s*>$/, ">")}${inner}</${entry.targetQName}>`
				: inner;
		return { start: entry.start, end: entry.end, value };
	});
	const output = replaceTextRanges(skeleton.payload.content, edits);
	parseLegacyBilingualXml(output, `roundtrip.${sourceExtension}`);
	const encoding = skeleton.source.encoding ?? "utf-8";
	return {
		blob: new Blob(
			[encodeTextBytes(output, encoding, skeleton.source.hasBom ?? false)],
			{ type: `application/xml;charset=${encoding}` },
		),
		extension: sourceExtension,
		mimeType: `application/xml;charset=${encoding}`,
	};
}

export async function generateLegacyBilingualTranslation(
	project: UserData,
): Promise<void> {
	const output = await buildLegacyBilingualTranslation(project);
	const sourceName =
		project.translationData.skeleton?.source.name ||
		project.translationData.name;
	const base = (sourceName || "translation")
		.replace(new RegExp(`\\.${output.extension}$`, "i"), "")
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
	const url = URL.createObjectURL(output.blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${base}.translated.${output.extension}`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
