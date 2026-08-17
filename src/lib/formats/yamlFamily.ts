import {
	isAlias,
	isMap,
	isScalar,
	isSeq,
	parseAllDocuments,
	type Scalar,
} from "yaml";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import type { TypeRef, YamlSegmentMeta } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import {
	matchesJsonSelector,
	normalizeImportOptions,
	parseList,
} from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type YamlScalarReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export type YamlScalarStyle = YamlScalarReplacement["style"];
export type YamlScalarValueType = YamlScalarReplacement["valueType"];

export interface YamlDuplicateKey {
	documentIndex: number;
	path: string[];
	key: string;
	occurrences: number;
}

export interface YamlScalarLocation {
	documentIndex: number;
	path: string[];
	start: number;
	end: number;
	value: string;
	valueType: YamlScalarValueType;
	style: YamlScalarStyle;
	tag?: string;
	anchor?: string;
	comments: string[];
}

export interface YamlSyntaxDocument {
	scalars: YamlScalarLocation[];
	duplicateKeys: YamlDuplicateKey[];
	warnings: string[];
	documentCount: number;
}

export function parseYamlSyntax(content: string): YamlSyntaxDocument {
	let documents: ReturnType<typeof parseAllDocuments>;
	try {
		documents = parseAllDocuments(content, {
			keepSourceTokens: true,
			prettyErrors: false,
			strict: true,
			uniqueKeys: false,
			version: "1.2",
		});
	} catch (error) {
		throw yamlError(error);
	}
	const parseErrors = documents.flatMap((document) => document.errors);
	if (parseErrors.length) throw yamlError(parseErrors[0]);

	const scalars: YamlScalarLocation[] = [];
	const duplicateKeys: YamlDuplicateKey[] = [];
	const warnings = documents.flatMap((document) =>
		document.warnings.map((warning) => warning.message),
	);

	for (const [documentIndex, document] of documents.entries()) {
		walkYamlNode(document.contents, documentIndex, [], scalars, duplicateKeys);
	}
	return {
		scalars,
		duplicateKeys,
		warnings,
		documentCount: documents.length,
	};
}

function walkYamlNode(
	node: unknown,
	documentIndex: number,
	path: string[],
	scalars: YamlScalarLocation[],
	duplicateKeys: YamlDuplicateKey[],
): void {
	if (!node || isAlias(node)) return;
	if (isScalar(node)) {
		const scalar = node as Scalar<unknown>;
		if (!scalar.range) return;
		const valueType = yamlValueType(scalar.value);
		const style = yamlStyle(scalar.type);
		scalars.push({
			documentIndex,
			path: path.length ? [...path] : ["$"],
			start: scalar.range[0],
			end: scalar.range[1],
			value:
				valueType === "string"
					? String(scalar.value ?? "")
					: (scalar.source ?? String(scalar.value)),
			valueType,
			style,
			...(scalar.tag ? { tag: scalar.tag } : {}),
			...(scalar.anchor ? { anchor: scalar.anchor } : {}),
			comments: commentsFor(scalar),
		});
		return;
	}
	if (isMap(node)) {
		const occurrences = new Map<string, number>();
		for (const [pairIndex, pair] of node.items.entries()) {
			const key = yamlKey(pair.key, pairIndex);
			occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
			walkYamlNode(
				pair.value,
				documentIndex,
				[...path, key],
				scalars,
				duplicateKeys,
			);
		}
		for (const [key, occurrencesCount] of occurrences) {
			if (occurrencesCount > 1)
				duplicateKeys.push({
					documentIndex,
					path: [...path, key],
					key,
					occurrences: occurrencesCount,
				});
		}
		return;
	}
	if (isSeq(node)) {
		for (const [index, item] of node.items.entries())
			walkYamlNode(
				item,
				documentIndex,
				[...path, String(index)],
				scalars,
				duplicateKeys,
			);
	}
}

function yamlKey(node: unknown, pairIndex: number): string {
	if (isScalar(node)) return String(node.value ?? "null");
	return `?complex-${pairIndex + 1}`;
}

function yamlValueType(value: unknown): YamlScalarValueType {
	if (value === null) return "null";
	switch (typeof value) {
		case "boolean":
			return "boolean";
		case "number":
		case "bigint":
			return "number";
		default:
			return "string";
	}
}

function yamlStyle(type: Scalar.Type | undefined): YamlScalarStyle {
	switch (type) {
		case "QUOTE_SINGLE":
		case "QUOTE_DOUBLE":
		case "BLOCK_LITERAL":
		case "BLOCK_FOLDED":
			return type;
		default:
			return "PLAIN";
	}
}

function commentsFor(node: Scalar<unknown>): string[] {
	return [node.commentBefore, node.comment]
		.filter((comment): comment is string => Boolean(comment?.trim()))
		.map((comment) => comment.trim());
}

function yamlError(error: unknown): SafeInputError {
	const reason =
		error instanceof Error ? error.message : "Malformed YAML input.";
	return new SafeInputError("YAML_MALFORMED", reason);
}

export async function validateYamlFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseYamlSyntax(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file does not contain valid YAML." };
	}
}

export async function importYamlFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("yaml", options);
	const read = await readSafeTextFile(file, context);
	const syntax = parseYamlSyntax(read.text);
	const selectors = parseList(filterOptions.pathSelectors);
	const selected = syntax.scalars.filter(
		(scalar) =>
			matchesJsonSelector(scalar.path, selectors) &&
			(scalar.valueType === "string" ||
				Boolean(filterOptions.includeNonStringScalars)),
	);
	const segments: string[] = [];
	const meta: YamlSegmentMeta[] = [];
	const replacements: YamlScalarReplacement[] = [];
	const details: YamlScalarLocation[] = [];

	for (const scalar of selected) {
		const mode = String(filterOptions.segmentationMode);
		const pieces =
			mode === "value"
				? [{ text: scalar.value, separator: "" }]
				: mode === "sentences"
					? segmentPlainText(scalar.value, "sentences")
					: splitTextWithPreferences(scalar.value);
		const effective = pieces.some((piece) => piece.text.trim().length > 0)
			? pieces.filter((piece) => piece.text.trim().length > 0)
			: [{ text: scalar.value, separator: "" }];
		for (const piece of effective) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator ?? ""}`);
			const common = {
				documentIndex: scalar.documentIndex,
				path: [...scalar.path],
				start: scalar.start,
				end: scalar.end,
				originalValue: scalar.value,
				valueType: scalar.valueType,
				style: scalar.style,
				separator: piece.separator ?? "",
			};
			meta.push(common);
			replacements.push({ kind: "yaml-scalar", unitIndex, ...common });
			details.push(scalar);
		}
	}

	const document = createNeutralDocument({
		format: "yaml",
		sourceSegments: segments,
		targetSegments: segments.map(() => ""),
		sourceLocations: details.map((scalar, index) => ({
			part: file.name,
			path: [String(scalar.documentIndex), ...scalar.path],
			segmentIndex: index,
			metadata: { start: scalar.start, end: scalar.end },
		})),
	});
	document.metadata = {
		documentCount: syntax.documentCount,
		duplicateKeys: syntax.duplicateKeys.map((duplicate) => ({ ...duplicate })),
		warnings: [...syntax.warnings],
		encoding: read.encoding,
		hasBom: read.hasBom,
	};
	for (const [index, scalar] of details.entries()) {
		const unit = document.units[index];
		if (!unit) continue;
		unit.contexts.push({
			type: "yaml-path",
			value: `${scalar.documentIndex}:${scalar.path.join(".")}`,
		});
		if (scalar.tag) unit.contexts.push({ type: "yaml-tag", value: scalar.tag });
		if (scalar.anchor)
			unit.contexts.push({ type: "yaml-anchor", value: scalar.anchor });
		unit.notes.push(
			...scalar.comments.map((text) => ({
				category: "yaml-comment",
				text,
				appliesTo: "source" as const,
			})),
		);
		const duplicate = syntax.duplicateKeys.find(
			(entry) =>
				entry.documentIndex === scalar.documentIndex &&
				entry.path.length === scalar.path.length &&
				entry.path.every((part, pathIndex) => part === scalar.path[pathIndex]),
		);
		if (duplicate)
			unit.notes.push({
				category: "yaml-duplicate-key",
				text: `The YAML key “${duplicate.key}” occurs ${duplicate.occurrences} times in this mapping. Every occurrence is preserved.`,
				appliesTo: "source",
				priority: 1,
			});
	}

	return {
		kind: "segments",
		segments,
		targetSegments: segments.map(() => ""),
		document,
		skeleton: await createTextSkeleton(
			file,
			"yaml",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: {
			documentCount: String(syntax.documentCount),
		} as TypeRef,
		segmentsMeta: meta,
	};
}
