import type { QtTsSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type QtTsValueReplacement } from "./skeleton";
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

interface QtTsValue {
	context: string;
	messageId?: string;
	source: string;
	target: string;
	form?: number;
	variant?: number;
	start: number;
	end: number;
	state?: string;
	stateAttributeStart?: number;
	stateAttributeEnd?: number;
	notes: string[];
	locations: string[];
}

export function parseQtTs(content: string): {
	values: QtTsValue[];
	warnings: string[];
	sourceLanguage?: string;
	targetLanguage?: string;
} {
	const safeContent = content.replace(/<!DOCTYPE\s+TS\s*>/i, (match) =>
		" ".repeat(match.length),
	);
	const syntax = parseXmlSyntax(safeContent);
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	if (!root || root.qName !== "TS")
		throw invalidQtTs("Qt Linguist files must have a <TS> root.");
	const values: QtTsValue[] = [];
	const warnings: string[] = [];
	for (const contextElement of children(syntax.elements, root, "context")) {
		const contextNameElement = children(
			syntax.elements,
			contextElement,
			"name",
		)[0];
		const context = contextNameElement
			? elementText(content, contextNameElement)
			: "";
		if (!context) warnings.push("A Qt context has no name.");
		for (const message of children(
			syntax.elements,
			contextElement,
			"message",
		)) {
			const sourceElement = children(syntax.elements, message, "source")[0];
			const translation = children(syntax.elements, message, "translation")[0];
			if (!sourceElement || !translation) {
				warnings.push(
					`A message in ${context || "(unnamed)"} has no source or translation.`,
				);
				continue;
			}
			if (
				hasElementChildren(syntax.elements, sourceElement) ||
				translation.endTagStart === undefined
			) {
				warnings.push(
					`A structurally complex message in ${context} was protected.`,
				);
				continue;
			}
			const source = elementText(content, sourceElement);
			const state = attribute(translation, "type");
			const stateRange = state
				? fullAttributeRange(content, translation, "type")
				: undefined;
			const messageId = attribute(message, "id");
			const notes = children(syntax.elements, message)
				.filter((element) =>
					[
						"comment",
						"extracomment",
						"translatorcomment",
						"oldsource",
					].includes(element.localName),
				)
				.map((element) => elementText(content, element))
				.filter(Boolean);
			const locations = children(syntax.elements, message, "location").map(
				(element) =>
					`${attribute(element, "filename") ?? ""}:${attribute(element, "line") ?? ""}`,
			);
			const numerus = children(syntax.elements, translation, "numerusform");
			const variants = children(syntax.elements, translation, "lengthvariant");
			const targets: Array<{
				element: XmlElementLocation;
				form?: number;
				variant?: number;
			}> = numerus.length
				? numerus.map((element, form) => ({ element, form }))
				: variants.length
					? variants.map((element, variant) => ({ element, variant }))
					: [{ element: translation }];
			for (const target of targets) {
				if (
					target.element.endTagStart === undefined ||
					hasElementChildren(syntax.elements, target.element)
				) {
					warnings.push(
						`A structurally complex target in ${context} was protected.`,
					);
					continue;
				}
				const start = target.element.startTagEnd + 1;
				const end = target.element.endTagStart;
				values.push({
					context,
					...(messageId ? { messageId } : {}),
					source,
					target: decodeXmlText(content.slice(start, end)),
					...(target.form !== undefined ? { form: target.form } : {}),
					...(target.variant !== undefined ? { variant: target.variant } : {}),
					start,
					end,
					...(state ? { state } : {}),
					...(stateRange
						? {
								stateAttributeStart: stateRange.start,
								stateAttributeEnd: stateRange.end,
							}
						: {}),
					notes,
					locations,
				});
			}
		}
	}
	return {
		values,
		warnings,
		sourceLanguage: attribute(root, "sourcelanguage"),
		targetLanguage: attribute(root, "language"),
	};
}

function children(
	elements: XmlElementLocation[],
	parent: XmlElementLocation,
	localName?: string,
): XmlElementLocation[] {
	return elements.filter(
		(element) =>
			element.parentId === parent.id &&
			(!localName || element.localName === localName),
	);
}

function hasElementChildren(
	elements: XmlElementLocation[],
	parent: XmlElementLocation,
): boolean {
	return elements.some((element) => element.parentId === parent.id);
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find((candidate) => candidate.localName === name)
		?.value;
}

function elementText(content: string, element: XmlElementLocation): string {
	if (element.endTagStart === undefined) return "";
	return decodeXmlText(
		content.slice(element.startTagEnd + 1, element.endTagStart),
	);
}

function fullAttributeRange(
	content: string,
	element: XmlElementLocation,
	name: string,
): { start: number; end: number } | undefined {
	const attributeLocation = element.attributes.find(
		(candidate) => candidate.localName === name,
	);
	if (!attributeLocation) return undefined;
	let start = content.lastIndexOf(
		attributeLocation.qName,
		attributeLocation.start,
	);
	if (start < element.startTagStart) return undefined;
	while (start > element.startTagStart && /\s/.test(content[start - 1]))
		start--;
	return { start, end: attributeLocation.end + 1 };
}

function invalidQtTs(message: string): SafeInputError {
	return new SafeInputError("QT_TS_INVALID", message);
}

export async function validateQtTsFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseQtTs(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not valid Qt Linguist TS XML." };
	}
}

export async function importQtTsFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("qt-ts", options);
	const read = await readSafeTextFile(file, context);
	const parsed = parseQtTs(read.text);
	const values = parsed.values.filter((value) => {
		if (value.state === "obsolete")
			return Boolean(filterOptions.includeObsolete);
		if (value.state === "vanished")
			return Boolean(filterOptions.includeVanished);
		if (value.state === "unfinished")
			return Boolean(filterOptions.includeUnfinished);
		return true;
	});
	const segments = values.map((value) => value.source);
	const targets = values.map((value) => value.target);
	const meta: QtTsSegmentMeta[] = values.map((value) => ({
		context: value.context,
		...(value.messageId ? { messageId: value.messageId } : {}),
		...(value.form !== undefined ? { form: value.form } : {}),
		...(value.variant !== undefined ? { variant: value.variant } : {}),
		start: value.start,
		end: value.end,
		originalValue: value.target,
		...(value.state ? { state: value.state } : {}),
		...(value.stateAttributeStart !== undefined
			? { stateAttributeStart: value.stateAttributeStart }
			: {}),
		...(value.stateAttributeEnd !== undefined
			? { stateAttributeEnd: value.stateAttributeEnd }
			: {}),
	}));
	const replacements: QtTsValueReplacement[] = meta.map((value, unitIndex) => ({
		kind: "qt-ts-value",
		unitIndex,
		...value,
	}));
	const document = createNeutralDocument({
		format: "qt-ts",
		sourceSegments: segments,
		targetSegments: targets,
		...(parsed.sourceLanguage ? { sourceLanguage: parsed.sourceLanguage } : {}),
		...(parsed.targetLanguage ? { targetLanguage: parsed.targetLanguage } : {}),
		unitIds: values.map(
			(value, index) =>
				value.messageId ??
				`${value.context}:${value.form ?? value.variant ?? index}`,
		),
		sourceLocations: values.map((value, segmentIndex) => ({
			part: file.name,
			path: [
				"TS",
				value.context,
				value.messageId ?? segmentIndex,
				value.form ?? value.variant ?? "translation",
			],
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: "qt-linguist-ts",
		warnings: parsed.warnings,
		encoding: read.encoding,
		hasBom: read.hasBom,
	};
	for (const [index, value] of values.entries()) {
		const unit = document.units[index];
		unit.contexts.push({ type: "qt-context", value: value.context });
		for (const location of value.locations)
			unit.contexts.push({ type: "source-location", value: location });
		if (value.state)
			unit.contexts.push({ type: "qt-state", value: value.state });
		for (const note of value.notes)
			unit.notes.push({
				category: "qt-comment",
				text: note,
				appliesTo: "source",
			});
		if (value.form !== undefined)
			unit.relationships = {
				plural: {
					groupId: value.messageId ?? value.context,
					category: String(value.form),
				},
			};
		if (value.variant !== undefined)
			unit.relationships = {
				variant: {
					groupId: value.messageId ?? value.context,
					key: String(value.variant),
				},
			};
	}
	return {
		kind: "segments",
		segments,
		targetSegments: targets,
		document,
		skeleton: await createTextSkeleton(
			file,
			"qt-ts",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "qt-linguist-ts" } as TypeRef,
		segmentsMeta: meta,
	};
}
