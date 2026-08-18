import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { TtmlSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type TtmlValueReplacement } from "./skeleton";
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

const TTML_NAMESPACES = new Set([
	"http://www.w3.org/ns/ttml",
	"http://www.w3.org/2006/10/ttaf1",
]);
const METADATA_NAMES = new Set([
	"metadata",
	"title",
	"desc",
	"copyright",
	"agent",
	"name",
]);

export interface TtmlTimingParameters {
	frameRate: number;
	subFrameRate: number;
	tickRate: number;
}

export interface TtmlCue {
	index: number;
	elementId: number;
	id?: string;
	startMs: number;
	endMs: number;
	region?: string;
	style?: string;
	language?: string;
}

export interface TtmlModel {
	profile: "ttml1" | "ttml2" | "imsc1";
	syntax: XmlSyntaxDocument;
	timing: TtmlTimingParameters;
	cues: TtmlCue[];
	warnings: string[];
}

function invalidTtml(message: string): SafeInputError {
	return new SafeInputError("TTML_INVALID", message);
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(entry) => entry.qName === name || entry.localName === name,
	)?.value;
}

function positiveNumber(value: string | undefined, fallback: number): number {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0)
		throw invalidTtml(`TTML timing parameter “${value}” must be positive.`);
	return parsed;
}

function timingParameters(root: XmlElementLocation): TtmlTimingParameters {
	let frameRate = positiveNumber(attribute(root, "frameRate"), 30);
	const multiplier = attribute(root, "frameRateMultiplier");
	if (multiplier) {
		const match = multiplier.trim().match(/^(\d+)\s+(\d+)$/);
		if (!match || Number(match[2]) === 0)
			throw invalidTtml(
				"TTML frameRateMultiplier must contain a non-zero numerator and denominator.",
			);
		frameRate *= Number(match[1]) / Number(match[2]);
	}
	const subFrameRate = positiveNumber(attribute(root, "subFrameRate"), 1);
	const tickRate = positiveNumber(
		attribute(root, "tickRate"),
		frameRate * subFrameRate,
	);
	return { frameRate, subFrameRate, tickRate };
}

export function parseTtmlTime(
	value: string,
	parameters: TtmlTimingParameters,
): number {
	const clock = value.match(
		/^(\d+):([0-5]\d):([0-5]\d)(?:(?:\.(\d+))|(?::(\d+)(?:\.(\d+))?))?$/,
	);
	if (clock) {
		const base =
			Number(clock[1]) * 3_600_000 +
			Number(clock[2]) * 60_000 +
			Number(clock[3]) * 1_000;
		if (clock[4]) return base + Number(`0.${clock[4]}`) * 1_000;
		if (!clock[5]) return base;
		const frames = Number(clock[5]);
		const subframes = Number(clock[6] ?? 0);
		if (frames >= Math.ceil(parameters.frameRate))
			throw invalidTtml(
				`TTML frame value in “${value}” exceeds the effective frame rate.`,
			);
		return (
			base +
			((frames + subframes / parameters.subFrameRate) / parameters.frameRate) *
				1_000
		);
	}
	const offset = value.match(/^(\d+(?:\.\d+)?)(h|m|s|ms|f|t)$/);
	if (!offset)
		throw invalidTtml(`Unsupported TTML timing expression “${value}”.`);
	const amount = Number(offset[1]);
	return (
		amount *
		({
			h: 3_600_000,
			m: 60_000,
			s: 1_000,
			ms: 1,
			f: 1_000 / parameters.frameRate,
			t: 1_000 / parameters.tickRate,
		}[offset[2]] ?? 0)
	);
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

function inherited(
	chain: readonly XmlElementLocation[],
	name: string,
): string | undefined {
	return chain
		.map((element) => attribute(element, name))
		.find((value) => value !== undefined);
}

function ancestorBeginMs(
	chainRootFirst: readonly XmlElementLocation[],
	parameters: TtmlTimingParameters,
	through: number,
): number {
	let value = 0;
	for (let index = 0; index <= through; index++) {
		const begin = attribute(chainRootFirst[index], "begin");
		if (begin) value += parseTtmlTime(begin, parameters);
	}
	return value;
}

function cueTiming(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
	parameters: TtmlTimingParameters,
): { startMs: number; endMs: number } {
	const chain = ancestors(element, syntax).reverse();
	const startMs = ancestorBeginMs(chain, parameters, chain.length - 1);
	const end = attribute(element, "end");
	const dur = attribute(element, "dur");
	let endMs: number | undefined;
	if (end)
		endMs =
			ancestorBeginMs(chain, parameters, chain.length - 2) +
			parseTtmlTime(end, parameters);
	else if (dur) endMs = startMs + parseTtmlTime(dur, parameters);
	else
		for (let index = chain.length - 2; index >= 0; index--) {
			const ancestorEnd = attribute(chain[index], "end");
			if (ancestorEnd) {
				endMs =
					ancestorBeginMs(chain, parameters, index - 1) +
					parseTtmlTime(ancestorEnd, parameters);
				break;
			}
			const ancestorDur = attribute(chain[index], "dur");
			if (ancestorDur) {
				endMs =
					ancestorBeginMs(chain, parameters, index) +
					parseTtmlTime(ancestorDur, parameters);
				break;
			}
		}
	if (endMs === undefined || endMs <= startMs)
		throw invalidTtml(
			"Every TTML paragraph needs an effective end or positive duration.",
		);
	return { startMs, endMs };
}

export function parseTtmlDocument(content: string): TtmlModel {
	const syntax = parseXmlSyntax(content);
	const root = syntax.elements[0];
	if (
		!root ||
		root.localName !== "tt" ||
		!root.namespaceUri ||
		!TTML_NAMESPACES.has(root.namespaceUri)
	)
		throw invalidTtml(
			"TTML requires a tt root in a supported W3C timed-text namespace.",
		);
	const timing = timingParameters(root);
	for (const element of syntax.elements)
		for (const name of ["begin", "end", "dur"] as const) {
			const value = attribute(element, name);
			if (value) parseTtmlTime(value, timing);
		}
	const declaredProfile = [
		attribute(root, "profile"),
		attribute(root, "contentProfiles"),
		attribute(root, "processorProfiles"),
	]
		.filter(Boolean)
		.join(" ");
	const profile: TtmlModel["profile"] = /imsc/i.test(declaredProfile)
		? "imsc1"
		: attribute(root, "version")?.startsWith("2")
			? "ttml2"
			: "ttml1";
	const styleIds = new Set<string>();
	const regionIds = new Set<string>();
	for (const element of syntax.elements) {
		const id = attribute(element, "id");
		if (!id) continue;
		const set =
			element.localName === "style"
				? styleIds
				: element.localName === "region"
					? regionIds
					: undefined;
		if (!set) continue;
		if (set.has(id))
			throw invalidTtml(`Duplicate TTML ${element.localName} ID “${id}”.`);
		set.add(id);
	}
	for (const element of syntax.elements) {
		const style = attribute(element, "style");
		if (style)
			for (const id of style.split(/\s+/).filter(Boolean))
				if (!styleIds.has(id))
					throw invalidTtml(`TTML references missing style “${id}”.`);
		const region = attribute(element, "region");
		if (region && !regionIds.has(region))
			throw invalidTtml(`TTML references missing region “${region}”.`);
	}
	const cueElements = syntax.elements.filter(
		(element) => element.localName === "p",
	);
	if (!cueElements.length) throw invalidTtml("TTML contains no timed p cues.");
	const cues = cueElements.map((element, index): TtmlCue => {
		const chain = ancestors(element, syntax);
		return {
			index,
			elementId: element.id,
			...(attribute(element, "id") ? { id: attribute(element, "id") } : {}),
			...cueTiming(element, syntax, timing),
			...(inherited(chain, "region")
				? { region: inherited(chain, "region") }
				: {}),
			...(inherited(chain, "style")
				? { style: inherited(chain, "style") }
				: {}),
			...(inherited(chain, "lang")
				? { language: inherited(chain, "lang") }
				: {}),
		};
	});
	const warnings: string[] = [];
	for (let index = 1; index < cues.length; index++) {
		if (cues[index].startMs < cues[index - 1].startMs)
			warnings.push(`TTML cue ${index + 1} starts before cue ${index}.`);
		if (cues[index].startMs < cues[index - 1].endMs)
			warnings.push(`TTML cue ${index + 1} overlaps cue ${index}.`);
	}
	return { profile, syntax, timing, cues, warnings };
}

export async function validateTtmlFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseTtmlDocument(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not safe, valid TTML." };
	}
}

export async function importTtmlFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("ttml", options);
	const read = await readSafeTextFile(file, context);
	const model = parseTtmlDocument(read.text);
	if (
		filterOptions.profile !== "auto" &&
		filterOptions.profile !== model.profile
	)
		throw invalidTtml(
			`Requested ${filterOptions.profile} but the document declares ${model.profile}.`,
		);
	if (
		filterOptions.overlapPolicy === "error" &&
		model.warnings.some((warning) => warning.includes("overlaps"))
	)
		throw invalidTtml(
			model.warnings.find((warning) => warning.includes("overlaps"))!,
		);
	const candidates: Array<{ value: XmlValueLocation; cue?: TtmlCue }> = [];
	for (const value of model.syntax.values) {
		const element = model.syntax.elements[value.elementId];
		const chain = ancestors(element, model.syntax);
		const cueElement = chain.find((entry) => entry.localName === "p");
		if (cueElement) {
			const cue = model.cues.find(
				(entry) => entry.elementId === cueElement.id,
			)!;
			candidates.push({ value, cue });
		} else if (
			filterOptions.includeMetadata &&
			chain.some((entry) => METADATA_NAMES.has(entry.localName))
		)
			candidates.push({ value });
	}
	const segments: string[] = [];
	const meta: TtmlSegmentMeta[] = [];
	const replacements: TtmlValueReplacement[] = [];
	for (const { value, cue } of candidates.sort(
		(a, b) => a.value.start - b.value.start,
	)) {
		const pieces =
			filterOptions.segmentationMode === "sentences"
				? segmentPlainText(value.value, "sentences")
				: filterOptions.segmentationMode === "preferences"
					? splitTextWithPreferences(value.value)
					: [{ text: value.value, separator: "" }];
		const effective = pieces.filter((piece) => piece.text.trim());
		for (const piece of effective.length
			? effective
			: [{ text: value.value, separator: "" }]) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			const common = {
				profile: model.profile,
				cueIndex: cue?.index ?? -1,
				startMs: cue?.startMs ?? 0,
				endMs: cue?.endMs ?? 0,
				...(cue?.region ? { region: cue.region } : {}),
				...(cue?.style ? { style: cue.style } : {}),
				...(cue?.language ? { language: cue.language } : {}),
				path: value.path,
				start: value.start,
				end: value.end,
				originalValue: value.value,
				separator: piece.separator ?? "",
			};
			meta.push(common);
			replacements.push({
				kind: "ttml-value",
				unitIndex,
				location: value.location,
				...common,
			});
		}
	}
	const document = createNeutralDocument({
		format: "ttml",
		sourceSegments: segments,
		unitIds: meta.map((entry, index) =>
			entry.cueIndex >= 0
				? `cue-${entry.cueIndex + 1}-${index + 1}`
				: `metadata-${index + 1}`,
		),
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: file.name,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: model.profile,
		frameRate: model.timing.frameRate,
		tickRate: model.timing.tickRate,
		warnings: filterOptions.overlapPolicy === "allow" ? [] : model.warnings,
		encoding: read.encoding,
	};
	for (const [index, entry] of meta.entries()) {
		if (entry.cueIndex >= 0)
			document.units[index].contexts.push({
				type: "subtitle-time-range-ms",
				value: `${entry.startMs}-${entry.endMs}`,
			});
		for (const [type, value] of [
			["ttml-region", entry.region],
			["ttml-style", entry.style],
			["ttml-language", entry.language],
		] as const)
			if (value) document.units[index].contexts.push({ type, value });
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"ttml",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions: { ...filterOptions, profile: model.profile },
		typeRef: { profile: model.profile } as TypeRef,
		segmentsMeta: meta,
	};
}
