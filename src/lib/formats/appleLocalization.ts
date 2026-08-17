import type { AppleSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import {
	parseJsonSyntax,
	type JsonObjectNode,
	type JsonPrimitiveNode,
	type JsonSyntaxNode,
} from "./jsonSyntax";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type AppleValueReplacement } from "./skeleton";
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

export type AppleLocalizationProfile = "strings" | "stringsdict" | "xcstrings";

interface AppleValue {
	profile: AppleLocalizationProfile;
	key: string;
	path: string[];
	value: string;
	targetValue?: string;
	start: number;
	end: number;
	comment?: string;
	state?: string;
	targetLanguage?: string;
	insertionGroup?: string;
	insertionStart?: number;
	sourceObjectStart?: number;
	sourceObjectEnd?: number;
	relativePath?: string[];
	insertLocalizationsProperty?: boolean;
}

export function detectAppleProfile(
	name: string,
	content: string,
	requested = "auto",
): AppleLocalizationProfile {
	if (requested !== "auto") return requested as AppleLocalizationProfile;
	const extension = name.toLowerCase().split(".").at(-1);
	if (extension === "stringsdict") return "stringsdict";
	if (extension === "xcstrings") return "xcstrings";
	if (extension === "strings") return "strings";
	const trimmed = content.trimStart();
	if (trimmed.startsWith("{")) return "xcstrings";
	if (/<plist(?:\s|>)/.test(trimmed)) return "stringsdict";
	return "strings";
}

export function parseAppleStrings(content: string): {
	values: AppleValue[];
	warnings: string[];
} {
	const values: AppleValue[] = [];
	const warnings: string[] = [];
	const keys = new Set<string>();
	let cursor = content.startsWith("\ufeff") ? 1 : 0;
	let pendingComment: string | undefined;
	while (cursor < content.length) {
		const skipped = skipStringsTrivia(content, cursor);
		cursor = skipped.cursor;
		if (skipped.comments.length)
			pendingComment = skipped.comments.at(-1)?.trim() || pendingComment;
		if (cursor >= content.length) break;
		const key = parseStringsQuoted(content, cursor);
		cursor = skipStringsWhitespace(content, key.end);
		if (content[cursor++] !== "=")
			throw invalidApple("Expected = after an Apple .strings key.");
		cursor = skipStringsWhitespace(content, cursor);
		const value = parseStringsQuoted(content, cursor);
		cursor = skipStringsWhitespace(content, value.end);
		if (content[cursor++] !== ";")
			throw invalidApple("Expected ; after an Apple .strings value.");
		if (keys.has(key.value))
			warnings.push(`Duplicate Apple .strings key ${key.value}.`);
		keys.add(key.value);
		values.push({
			profile: "strings",
			key: key.value,
			path: [key.value],
			value: value.value,
			start: value.start,
			end: value.end,
			...(pendingComment ? { comment: pendingComment } : {}),
		});
		pendingComment = undefined;
	}
	return { values, warnings };
}

function skipStringsTrivia(
	content: string,
	start: number,
): { cursor: number; comments: string[] } {
	let cursor = start;
	const comments: string[] = [];
	while (cursor < content.length) {
		cursor = skipStringsWhitespace(content, cursor);
		if (content.startsWith("/*", cursor)) {
			const end = content.indexOf("*/", cursor + 2);
			if (end < 0) throw invalidApple("Apple block comment is not terminated.");
			comments.push(content.slice(cursor + 2, end));
			cursor = end + 2;
			continue;
		}
		if (content.startsWith("//", cursor)) {
			const end = content.indexOf("\n", cursor + 2);
			comments.push(content.slice(cursor + 2, end < 0 ? undefined : end));
			cursor = end < 0 ? content.length : end + 1;
			continue;
		}
		break;
	}
	return { cursor, comments };
}

function skipStringsWhitespace(content: string, start: number): number {
	let cursor = start;
	while (/\s/.test(content[cursor] ?? "")) cursor++;
	return cursor;
}

function parseStringsQuoted(
	content: string,
	start: number,
): { start: number; end: number; value: string } {
	if (content[start] !== '"')
		throw invalidApple("Apple .strings keys and values must be quoted.");
	let cursor = start + 1;
	let value = "";
	while (cursor < content.length) {
		const character = content[cursor++];
		if (character === '"') return { start, end: cursor, value };
		if (character !== "\\") {
			value += character;
			continue;
		}
		if (cursor >= content.length)
			throw invalidApple("Apple .strings escape is not terminated.");
		const escaped = content[cursor++];
		if (escaped === "n") value += "\n";
		else if (escaped === "r") value += "\r";
		else if (escaped === "t") value += "\t";
		else if (escaped === '"' || escaped === "\\") value += escaped;
		else if (escaped === "U" || escaped === "u") {
			const width = 4;
			const hex = content.slice(cursor, cursor + width);
			if (!new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex))
				throw invalidApple("Apple Unicode escape is invalid.");
			value += String.fromCodePoint(Number.parseInt(hex, 16));
			cursor += width;
		} else if (/[0-7]/.test(escaped)) {
			const remainder = content.slice(cursor).match(/^[0-7]{0,2}/)?.[0] ?? "";
			value += String.fromCodePoint(
				Number.parseInt(`${escaped}${remainder}`, 8),
			);
			cursor += remainder.length;
		} else value += escaped;
	}
	throw invalidApple("Apple .strings value is not terminated.");
}

export function parseAppleStringsdict(content: string): {
	values: AppleValue[];
	warnings: string[];
} {
	const safeContent = content.replace(
		/<!DOCTYPE\s+plist\s+PUBLIC\s+"-\/\/Apple\/\/DTD PLIST 1\.0\/\/EN"\s+"https?:\/\/www\.apple\.com\/DTDs\/PropertyList-1\.0\.dtd"\s*>/i,
		(match) => " ".repeat(match.length),
	);
	const syntax = parseXmlSyntax(safeContent);
	const plist = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	const rootDict = syntax.elements.find(
		(element) => element.parentId === plist?.id && element.localName === "dict",
	);
	if (!plist || plist.localName !== "plist" || !rootDict)
		throw invalidApple("Apple .stringsdict must be an XML plist dictionary.");
	const values: AppleValue[] = [];
	walkPlistDictionary(content, syntax.elements, rootDict, [], values);
	return { values, warnings: [] };
}

function walkPlistDictionary(
	content: string,
	elements: XmlElementLocation[],
	dictionary: XmlElementLocation,
	path: string[],
	values: AppleValue[],
): void {
	const children = elements.filter(
		(element) => element.parentId === dictionary.id,
	);
	for (let index = 0; index < children.length; index += 2) {
		const keyElement = children[index];
		const valueElement = children[index + 1];
		if (!keyElement || keyElement.localName !== "key" || !valueElement)
			throw invalidApple(
				"Apple plist dictionaries must contain key/value pairs.",
			);
		const key = plistElementText(content, keyElement);
		const nextPath = [...path, key];
		if (valueElement.localName === "dict") {
			walkPlistDictionary(content, elements, valueElement, nextPath, values);
			continue;
		}
		if (valueElement.localName !== "string") continue;
		if (
			![
				"NSStringLocalizedFormatKey",
				"zero",
				"one",
				"two",
				"few",
				"many",
				"other",
			].includes(key)
		)
			continue;
		if (valueElement.endTagStart === undefined)
			throw invalidApple("A .stringsdict string cannot be self-closing.");
		const start = valueElement.startTagEnd + 1;
		const end = valueElement.endTagStart;
		values.push({
			profile: "stringsdict",
			key: path[0] ?? key,
			path: nextPath,
			value: decodeXmlText(content.slice(start, end)),
			start,
			end,
		});
	}
}

function plistElementText(
	content: string,
	element: XmlElementLocation,
): string {
	if (element.endTagStart === undefined)
		throw invalidApple("Apple plist key cannot be self-closing.");
	return decodeXmlText(
		content.slice(element.startTagEnd + 1, element.endTagStart),
	);
}

export function parseAppleXcstrings(
	content: string,
	sourceLanguageOption = "",
	targetLanguageOption = "",
	includeStale = true,
): {
	values: AppleValue[];
	warnings: string[];
	sourceLanguage: string;
	targetLanguage: string;
} {
	const syntax = parseJsonSyntax(content);
	if (syntax.duplicateKeys.length)
		throw invalidApple("String catalogs cannot contain duplicate JSON keys.");
	const root = asObject(syntax.root, "String catalog root");
	const declaredSourceNode = stringProperty(root, "sourceLanguage");
	const declaredSource = declaredSourceNode
		? String(declaredSourceNode.value)
		: undefined;
	const sourceLanguage = sourceLanguageOption || declaredSource || "en";
	const strings = objectProperty(root, "strings");
	if (!strings) throw invalidApple("String catalog has no strings object.");
	const available = new Set<string>();
	for (const resource of strings.properties) {
		const resourceObject = asObject(
			resource.value,
			`Catalog entry ${resource.key}`,
		);
		const localizations = objectProperty(resourceObject, "localizations");
		for (const localization of localizations?.properties ?? [])
			available.add(localization.key);
	}
	const targetLanguage =
		targetLanguageOption ||
		[...available].find((language) => language !== sourceLanguage) ||
		"und";
	const values: AppleValue[] = [];
	for (const resource of strings.properties) {
		const resourceObject = asObject(
			resource.value,
			`Catalog entry ${resource.key}`,
		);
		const stateNode = stringProperty(resourceObject, "extractionState");
		const state = stateNode ? String(stateNode.value) : undefined;
		if (!includeStale && state === "stale") continue;
		const commentNode = stringProperty(resourceObject, "comment");
		const comment = commentNode ? String(commentNode.value) : undefined;
		const localizations = objectProperty(resourceObject, "localizations");
		const sourceObject = localizations
			? objectProperty(localizations, sourceLanguage)
			: undefined;
		const targetObject = localizations
			? objectProperty(localizations, targetLanguage)
			: undefined;
		const sourceLeaves = sourceObject
			? stringUnitLeaves(sourceObject)
			: [
					{
						relativePath: ["stringUnit", "value"],
						value: resource.key,
					},
				];
		if (targetObject) {
			const targetLeaves = new Map(
				stringUnitLeaves(targetObject).map((leaf) => [
					leaf.relativePath.join("\u0000"),
					leaf,
				]),
			);
			for (const sourceLeaf of sourceLeaves) {
				const targetLeaf = targetLeaves.get(
					sourceLeaf.relativePath.join("\u0000"),
				);
				if (!targetLeaf?.node)
					throw invalidApple(
						`Catalog target ${targetLanguage} does not match the source variations for ${resource.key}.`,
					);
				values.push({
					profile: "xcstrings",
					key: resource.key,
					path: [
						"strings",
						resource.key,
						"localizations",
						targetLanguage,
						...sourceLeaf.relativePath,
					],
					value: sourceLeaf.value,
					targetValue: targetLeaf.value,
					start: targetLeaf.node.start,
					end: targetLeaf.node.end,
					...(comment ? { comment } : {}),
					...(state ? { state } : {}),
					targetLanguage,
				});
			}
			continue;
		}
		for (const sourceLeaf of sourceLeaves) {
			values.push({
				profile: "xcstrings",
				key: resource.key,
				path: [
					"strings",
					resource.key,
					"localizations",
					targetLanguage,
					...sourceLeaf.relativePath,
				],
				value: sourceLeaf.value,
				targetValue: "",
				start: (localizations ?? resourceObject).end - 1,
				end: (localizations ?? resourceObject).end - 1,
				...(comment ? { comment } : {}),
				...(state ? { state } : {}),
				targetLanguage,
				insertionGroup: resource.key,
				insertionStart: (localizations ?? resourceObject).end - 1,
				...(!localizations ? { insertLocalizationsProperty: true } : {}),
				...(sourceObject
					? {
							sourceObjectStart: sourceObject.start,
							sourceObjectEnd: sourceObject.end,
						}
					: {}),
				relativePath: sourceLeaf.relativePath,
			});
		}
	}
	return { values, warnings: [], sourceLanguage, targetLanguage };
}

function stringUnitLeaves(object: JsonObjectNode): Array<{
	relativePath: string[];
	value: string;
	node?: JsonPrimitiveNode;
}> {
	const leaves: Array<{
		relativePath: string[];
		value: string;
		node?: JsonPrimitiveNode;
	}> = [];
	const visit = (node: JsonSyntaxNode, path: string[]) => {
		if (node.kind === "object") {
			for (const property of node.properties)
				visit(property.value, [...path, property.key]);
			return;
		}
		if (
			node.kind === "primitive" &&
			node.valueType === "string" &&
			path.at(-1) === "value" &&
			path.at(-2) === "stringUnit"
		)
			leaves.push({ relativePath: path, value: String(node.value), node });
	};
	visit(object, []);
	if (!leaves.length)
		throw invalidApple("Catalog localization has no stringUnit values.");
	return leaves;
}

function asObject(node: JsonSyntaxNode, label: string): JsonObjectNode {
	if (node.kind !== "object") throw invalidApple(`${label} must be an object.`);
	return node;
}

function objectProperty(
	object: JsonObjectNode,
	key: string,
): JsonObjectNode | undefined {
	const node = object.properties.find(
		(property) => property.key === key,
	)?.value;
	return node?.kind === "object" ? node : undefined;
}

function stringProperty(
	object: JsonObjectNode,
	key: string,
): JsonPrimitiveNode | undefined {
	const node = object.properties.find(
		(property) => property.key === key,
	)?.value;
	return node?.kind === "primitive" && node.valueType === "string"
		? node
		: undefined;
}

function invalidApple(message: string): SafeInputError {
	return new SafeInputError("APPLE_LOCALIZATION_INVALID", message);
}

export async function validateAppleLocalizationFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const read = await readSafeTextFile(file, context);
		const profile = detectAppleProfile(file.name, read.text);
		if (profile === "strings") parseAppleStrings(read.text);
		else if (profile === "stringsdict") parseAppleStringsdict(read.text);
		else parseAppleXcstrings(read.text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not valid Apple localization data.",
				};
	}
}

export async function importAppleLocalizationFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("apple", options);
	const read = await readSafeTextFile(file, context);
	const profile = detectAppleProfile(
		file.name,
		read.text,
		String(filterOptions.profile),
	);
	let values: AppleValue[];
	let warnings: string[];
	let sourceLanguage = String(filterOptions.sourceLanguage);
	let targetLanguage = String(filterOptions.targetLanguage);
	if (profile === "strings")
		({ values, warnings } = parseAppleStrings(read.text));
	else if (profile === "stringsdict")
		({ values, warnings } = parseAppleStringsdict(read.text));
	else {
		const parsed = parseAppleXcstrings(
			read.text,
			sourceLanguage,
			targetLanguage,
			Boolean(filterOptions.includeStale),
		);
		({ values, warnings, sourceLanguage, targetLanguage } = parsed);
	}
	const segments = values.map((value) => value.value);
	const targets = values.map((value) => value.targetValue ?? "");
	const meta: AppleSegmentMeta[] = values.map((value) => ({
		profile,
		key: value.key,
		path: value.path,
		start: value.start,
		end: value.end,
		originalValue: value.targetValue ?? value.value,
		...(profile === "strings" ? { quote: '"' as const } : {}),
		...(value.targetLanguage ? { targetLanguage: value.targetLanguage } : {}),
		...(value.insertionGroup ? { insertionGroup: value.insertionGroup } : {}),
		...(value.insertionStart !== undefined
			? { insertionStart: value.insertionStart }
			: {}),
		...(value.sourceObjectStart !== undefined
			? { sourceObjectStart: value.sourceObjectStart }
			: {}),
		...(value.sourceObjectEnd !== undefined
			? { sourceObjectEnd: value.sourceObjectEnd }
			: {}),
		...(value.relativePath ? { relativePath: value.relativePath } : {}),
		...(value.insertLocalizationsProperty
			? { insertLocalizationsProperty: true }
			: {}),
	}));
	const replacements: AppleValueReplacement[] = meta.map(
		(value, unitIndex) => ({ kind: "apple-value", unitIndex, ...value }),
	);
	const document = createNeutralDocument({
		format: "apple",
		sourceSegments: segments,
		targetSegments: targets,
		...(sourceLanguage ? { sourceLanguage } : {}),
		...(targetLanguage ? { targetLanguage } : {}),
		unitIds: values.map(
			(value) => `${value.key}:${value.path.slice(1).join(".")}`,
		),
		sourceLocations: values.map((value, segmentIndex) => ({
			part: file.name,
			path: value.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile,
		warnings,
		encoding: read.encoding,
		hasBom: read.hasBom,
		...(sourceLanguage ? { sourceLanguage } : {}),
		...(targetLanguage ? { targetLanguage } : {}),
	};
	for (const [index, value] of values.entries()) {
		const unit = document.units[index];
		unit.contexts.push({ type: "apple-key", value: value.key });
		unit.contexts.push({ type: "apple-profile", value: profile });
		if (value.state)
			unit.contexts.push({ type: "extraction-state", value: value.state });
		const plural = value.path.find((part) =>
			["zero", "one", "two", "few", "many", "other"].includes(part),
		);
		if (plural)
			unit.relationships = {
				plural: { groupId: value.key, category: plural },
			};
		if (value.comment)
			unit.notes.push({
				category: "developer-comment",
				text: value.comment,
				appliesTo: "source",
			});
	}
	return {
		kind: "segments",
		segments,
		targetSegments: targets,
		document,
		skeleton: await createTextSkeleton(
			file,
			"apple",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions: {
			...filterOptions,
			...(profile === "xcstrings" ? { sourceLanguage, targetLanguage } : {}),
		},
		typeRef: { profile: `apple-${profile}` } as TypeRef,
		segmentsMeta: meta,
	};
}
