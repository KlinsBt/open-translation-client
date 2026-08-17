import type { AndroidSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type AndroidValueReplacement } from "./skeleton";
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

const ANDROID_QUANTITIES = new Set([
	"zero",
	"one",
	"two",
	"few",
	"many",
	"other",
]);

interface AndroidResourceValue {
	element: XmlElementLocation;
	resourceType: AndroidSegmentMeta["resourceType"];
	name: string;
	index?: number;
	quantity?: string;
	formatted: boolean;
	translatable: boolean;
	start: number;
	end: number;
	value: string;
	comment?: string;
}

export function parseAndroidResources(
	content: string,
	context?: SafeInputContext,
): {
	values: AndroidResourceValue[];
	warnings: string[];
} {
	const syntax = parseXmlSyntax(content, context);
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	if (!root || root.localName !== "resources")
		throw invalidAndroid("Android resources must have a <resources> root.");
	const rootChildren = syntax.elements.filter(
		(element) => element.parentId === root.id,
	);
	const values: AndroidResourceValue[] = [];
	const warnings: string[] = [];
	const keys = new Set<string>();
	for (const resource of rootChildren) {
		if (!["string", "string-array", "plurals"].includes(resource.localName))
			continue;
		const resourceType =
			resource.localName as AndroidSegmentMeta["resourceType"];
		const name = attribute(resource, "name");
		if (!name)
			throw invalidAndroid(`<${resource.qName}> is missing its required name.`);
		const key = `${resourceType}:${name}`;
		if (keys.has(key)) warnings.push(`Duplicate Android resource ${key}.`);
		keys.add(key);
		const translatable = attribute(resource, "translatable") !== "false";
		const formatted = attribute(resource, "formatted") !== "false";
		const comment = precedingComment(content, resource.startTagStart);
		if (resourceType === "string") {
			const value = valueFromElement(
				content,
				resource,
				resourceType,
				name,
				formatted,
				translatable,
				comment,
			);
			if (value) values.push(value);
			continue;
		}
		const items = syntax.elements.filter(
			(element) =>
				element.parentId === resource.id && element.localName === "item",
		);
		const seenQuantities = new Set<string>();
		for (const [index, item] of items.entries()) {
			const quantity =
				resourceType === "plurals" ? attribute(item, "quantity") : undefined;
			if (resourceType === "plurals") {
				if (!quantity || !ANDROID_QUANTITIES.has(quantity))
					throw invalidAndroid(
						`Plural ${name} has an invalid or missing quantity.`,
					);
				if (seenQuantities.has(quantity))
					throw invalidAndroid(
						`Plural ${name} repeats the ${quantity} quantity.`,
					);
				seenQuantities.add(quantity);
			}
			const value = valueFromElement(
				content,
				item,
				resourceType,
				name,
				formatted,
				translatable,
				precedingComment(content, item.startTagStart) ?? comment,
			);
			if (value)
				values.push({
					...value,
					...(resourceType === "string-array" ? { index } : {}),
					...(quantity ? { quantity } : {}),
				});
		}
		if (resourceType === "plurals" && !seenQuantities.has("other"))
			throw invalidAndroid(`Plural ${name} must include an other quantity.`);
	}
	return { values, warnings };
}

function valueFromElement(
	content: string,
	element: XmlElementLocation,
	resourceType: AndroidSegmentMeta["resourceType"],
	name: string,
	formatted: boolean,
	translatable: boolean,
	comment?: string,
): AndroidResourceValue | undefined {
	if (element.selfClosing || element.endTagStart === undefined)
		return undefined;
	const start = element.startTagEnd + 1;
	const end = element.endTagStart;
	return {
		element,
		resourceType,
		name,
		formatted,
		translatable,
		start,
		end,
		value: decodeAndroidFragment(content.slice(start, end)),
		...(comment ? { comment } : {}),
	};
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find((candidate) => candidate.localName === name)
		?.value;
}

function precedingComment(content: string, start: number): string | undefined {
	const prefix = content.slice(0, start);
	const match = prefix.match(/<!--([\s\S]*?)-->\s*$/);
	return match?.[1].trim() || undefined;
}

export function decodeAndroidFragment(fragment: string): string {
	let result = "";
	let cursor = 0;
	while (cursor < fragment.length) {
		if (fragment.startsWith("<![CDATA[", cursor)) {
			const end = fragment.indexOf("]]>", cursor + 9);
			if (end < 0) throw invalidAndroid("Android CDATA is not terminated.");
			result += fragment.slice(cursor + 9, end);
			cursor = end + 3;
			continue;
		}
		if (fragment[cursor] === "<") {
			const end = findTagEnd(fragment, cursor);
			if (end >= 0) {
				result += fragment.slice(cursor, end + 1);
				cursor = end + 1;
				continue;
			}
		}
		const next = fragment.indexOf("<", cursor + 1);
		const end = next < 0 ? fragment.length : next;
		result += decodeXmlText(fragment.slice(cursor, end));
		cursor = end;
	}
	return result;
}

function findTagEnd(value: string, start: number): number {
	let quote = "";
	for (let index = start + 1; index < value.length; index++) {
		const character = value[index];
		if (quote) {
			if (character === quote) quote = "";
		} else if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index;
	}
	return -1;
}

function invalidAndroid(message: string): SafeInputError {
	return new SafeInputError("ANDROID_RESOURCE_INVALID", message);
}

export async function validateAndroidResourcesFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseAndroidResources(text, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not valid Android resources XML.",
				};
	}
}

export async function importAndroidResourcesFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("android", options);
	const read = await readSafeTextFile(file, context);
	const parsed = parseAndroidResources(read.text, context);
	const selected = parsed.values.filter(
		(value) =>
			(filterOptions.includeNonTranslatable || value.translatable) &&
			(filterOptions.includeEmpty || value.value.length > 0),
	);
	const segments = selected.map((value) => value.value);
	const meta: AndroidSegmentMeta[] = selected.map((value) => ({
		resourceType: value.resourceType,
		name: value.name,
		...(value.index !== undefined ? { index: value.index } : {}),
		...(value.quantity ? { quantity: value.quantity } : {}),
		start: value.start,
		end: value.end,
		originalValue: value.value,
		formatted: value.formatted,
		translatable: value.translatable,
	}));
	const replacements: AndroidValueReplacement[] = meta.map(
		(value, unitIndex) => ({ kind: "android-value", unitIndex, ...value }),
	);
	const document = createNeutralDocument({
		format: "android",
		sourceSegments: segments,
		targetSegments: segments.map(() => ""),
		unitIds: selected.map((value) =>
			value.resourceType === "string-array"
				? `${value.name}[${value.index}]`
				: value.resourceType === "plurals"
					? `${value.name}[${value.quantity}]`
					: value.name,
		),
		sourceLocations: selected.map((value, segmentIndex) => ({
			part: file.name,
			path: [
				"resources",
				value.resourceType,
				value.name,
				value.quantity ?? value.index ?? "value",
			],
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: "android-resources",
		encoding: read.encoding,
		hasBom: read.hasBom,
		warnings: parsed.warnings,
	};
	for (const [index, value] of selected.entries()) {
		const unit = document.units[index];
		unit.translatable = value.translatable;
		unit.contexts.push({ type: "android-resource", value: value.name });
		unit.contexts.push({ type: "android-type", value: value.resourceType });
		if (value.quantity)
			unit.contexts.push({ type: "plural-quantity", value: value.quantity });
		if (value.index !== undefined)
			unit.contexts.push({ type: "array-index", value: String(value.index) });
		if (value.comment)
			unit.notes.push({
				category: "developer-comment",
				text: value.comment,
				appliesTo: "source",
			});
		unit.metadata = {
			formatted: value.formatted,
			resourceType: value.resourceType,
		};
		if (value.quantity)
			unit.relationships = {
				plural: { groupId: value.name, category: value.quantity },
			};
	}
	return {
		kind: "segments",
		segments,
		targetSegments: segments.map(() => ""),
		document,
		skeleton: await createTextSkeleton(
			file,
			"android",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "android-resources" } as TypeRef,
		segmentsMeta: meta,
	};
}
