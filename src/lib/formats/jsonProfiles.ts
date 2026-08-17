import { matchesJsonSelector, parseList } from "./options";
import {
	getJsonProperty,
	jsonStringArray,
	jsonStringValue,
	type JsonObjectNode,
	type JsonPrimitiveNode,
	type JsonSyntaxDocument,
	type JsonSyntaxNode,
} from "./jsonSyntax";
import type { FormatOptionValues } from "./types";

export type JsonProfileId =
	| "generic"
	| "arb"
	| "i18next"
	| "chrome"
	| "locjson";

export interface JsonProfileExtraction {
	profile: JsonProfileId;
	sourceNodes: JsonPrimitiveNode[];
	destinationNodes: JsonPrimitiveNode[];
	sourceText: string;
	targetText: string;
	path: string[];
	address: number[];
	valueType: JsonPrimitiveNode["valueType"];
	key?: string;
	context?: string;
	contexts: Array<{ type: string; value: string }>;
	notes: Array<{
		category: string;
		text: string;
		appliesTo?: "source" | "target" | "unit";
	}>;
}

export function resolveJsonProfile(
	document: JsonSyntaxDocument,
	fileName: string,
	requested: string,
): JsonProfileId {
	if (requested !== "auto") return requested as JsonProfileId;
	const lower = fileName.toLowerCase();
	if (lower.endsWith(".arb")) return "arb";
	if (lower.endsWith(".locjson")) return "locjson";
	if (
		/(?:^|[/\\])messages\.json$/i.test(fileName) &&
		isChromeRoot(document.root)
	)
		return "chrome";
	return "generic";
}

export function extractJsonProfile(
	document: JsonSyntaxDocument,
	profile: JsonProfileId,
	options: Readonly<FormatOptionValues>,
): JsonProfileExtraction[] {
	switch (profile) {
		case "arb":
			return extractArb(document.root);
		case "i18next":
			return extractI18next(document.primitives);
		case "chrome":
			return extractChrome(document.root);
		case "locjson":
			return extractLocjson(document.root);
		default:
			return extractGeneric(document.root, document.primitives, options);
	}
}

function extractGeneric(
	root: JsonSyntaxNode,
	primitives: readonly JsonPrimitiveNode[],
	options: Readonly<FormatOptionValues>,
): JsonProfileExtraction[] {
	const selectors = parseList(options.pathSelectors);
	const keyField = String(options.keyField ?? "").trim();
	const contextField = String(options.contextField ?? "").trim();
	return primitives.flatMap((node) => {
		if (!matchesJsonSelector(node.path, selectors)) return [];
		if (!options.includeNonStringValues && node.valueType !== "string")
			return [];
		if (
			[keyField, contextField].filter(Boolean).includes(node.path.at(-1) ?? "")
		)
			return [];
		const parent = nodeAtAddress(root, node.address.slice(0, -1));
		const object = parent?.kind === "object" ? parent : undefined;
		const key = primitiveDisplay(getJsonProperty(object, keyField)?.value);
		const context = primitiveDisplay(
			getJsonProperty(object, contextField)?.value,
		);
		return [baseExtraction("generic", [node], [node], key, context)];
	});
}

function extractArb(root: JsonSyntaxNode): JsonProfileExtraction[] {
	if (root.kind !== "object")
		throw new Error("ARB requires a top-level JSON object.");
	return root.properties.flatMap((property) => {
		if (property.key.startsWith("@")) return [];
		if (
			property.value.kind !== "primitive" ||
			property.value.valueType !== "string"
		)
			return [];
		const metadata = getJsonProperty(root, `@${property.key}`)?.value;
		const metadataObject = metadata?.kind === "object" ? metadata : undefined;
		const description = jsonStringValue(
			getJsonProperty(metadataObject, "description")?.value,
		);
		const placeholders = getJsonProperty(metadataObject, "placeholders")?.value;
		const placeholderNames =
			placeholders?.kind === "object"
				? placeholders.properties.map((entry) => entry.key)
				: [];
		const extraction = baseExtraction(
			"arb",
			[property.value],
			[property.value],
			property.key,
			description,
		);
		extraction.contexts.push({ type: "arb-key", value: property.key });
		if (placeholderNames.length)
			extraction.contexts.push({
				type: "arb-placeholders",
				value: placeholderNames.join(", "),
			});
		if (description)
			extraction.notes.push({
				category: "arb-description",
				text: description,
				appliesTo: "source",
			});
		return [extraction];
	});
}

function extractI18next(
	primitives: readonly JsonPrimitiveNode[],
): JsonProfileExtraction[] {
	return primitives.flatMap((node) => {
		if (node.valueType !== "string") return [];
		const key = node.path.join(".");
		const extraction = baseExtraction("i18next", [node], [node], key);
		extraction.contexts.push({ type: "i18next-key", value: key });
		const plural = node.path
			.at(-1)
			?.match(/_(zero|one|two|few|many|other)$/)?.[1];
		if (plural)
			extraction.contexts.push({ type: "i18next-plural", value: plural });
		return [extraction];
	});
}

function isChromeRoot(root: JsonSyntaxNode): root is JsonObjectNode {
	return (
		root.kind === "object" &&
		root.properties.length > 0 &&
		root.properties.every(
			(entry) =>
				entry.value.kind === "object" &&
				typeof jsonStringValue(
					getJsonProperty(entry.value, "message")?.value,
				) === "string",
		)
	);
}

function extractChrome(root: JsonSyntaxNode): JsonProfileExtraction[] {
	if (!isChromeRoot(root))
		throw new Error(
			"Chrome messages.json requires a top-level object whose entries contain string message fields.",
		);
	return root.properties.map((property) => {
		const message = getJsonProperty(
			property.value as JsonObjectNode,
			"message",
		)!.value as JsonPrimitiveNode;
		const description = jsonStringValue(
			getJsonProperty(property.value as JsonObjectNode, "description")?.value,
		);
		const placeholders = getJsonProperty(
			property.value as JsonObjectNode,
			"placeholders",
		)?.value;
		const names =
			placeholders?.kind === "object"
				? placeholders.properties.map((entry) => entry.key)
				: [];
		const extraction = baseExtraction(
			"chrome",
			[message],
			[message],
			property.key,
			description,
		);
		extraction.contexts.push({
			type: "chrome-message-name",
			value: property.key,
		});
		if (names.length)
			extraction.contexts.push({
				type: "chrome-placeholders",
				value: names.join(", "),
			});
		if (description)
			extraction.notes.push({
				category: "chrome-description",
				text: description,
				appliesTo: "source",
			});
		return extraction;
	});
}

function extractLocjson(root: JsonSyntaxNode): JsonProfileExtraction[] {
	if (root.kind !== "object")
		throw new Error("LocJSON requires a top-level JSON object.");
	const units = getJsonProperty(root, "units")?.value;
	if (units?.kind !== "array")
		throw new Error("LocJSON requires a top-level units array.");
	const keys = new Set<string>();
	return units.elements.map((unit, index) => {
		if (unit.kind !== "object")
			throw new Error(`LocJSON unit ${index + 1} must be an object.`);
		const key = jsonStringValue(getJsonProperty(unit, "key")?.value);
		if (!key) throw new Error(`LocJSON unit ${index + 1} has no string key.`);
		if (keys.has(key))
			throw new Error(`LocJSON unit key “${key}” is duplicated.`);
		keys.add(key);
		const sourceNodes = jsonStringArray(getJsonProperty(unit, "source")?.value);
		if (!sourceNodes?.length)
			throw new Error(
				`LocJSON unit “${key}” has no non-empty string source array.`,
			);
		const targetProperty = getJsonProperty(unit, "target")?.value;
		const targetNodes = targetProperty
			? jsonStringArray(targetProperty)
			: undefined;
		if (targetProperty && !targetNodes?.length)
			throw new Error(`LocJSON unit “${key}” has an invalid target array.`);
		const destinationNodes = targetNodes ?? sourceNodes;
		const extraction = baseExtraction(
			"locjson",
			sourceNodes,
			destinationNodes,
			key,
			undefined,
			targetNodes?.map((node) => node.value as string).join("") ?? "",
		);
		extraction.contexts.push({ type: "locjson-key", value: key });
		const properties = getJsonProperty(unit, "properties")?.value;
		const propertiesObject =
			properties?.kind === "object" ? properties : undefined;
		const comments = jsonStringArray(
			getJsonProperty(propertiesObject, "comments")?.value,
		)?.map((node) => node.value as string);
		if (comments?.length)
			extraction.notes.push({
				category: "locjson-comment",
				text: comments.join("\n"),
				appliesTo: "source",
			});
		return extraction;
	});
}

function baseExtraction(
	profile: JsonProfileId,
	sourceNodes: JsonPrimitiveNode[],
	destinationNodes: JsonPrimitiveNode[],
	key?: string,
	context?: string,
	targetText = "",
): JsonProfileExtraction {
	const first = destinationNodes[0];
	return {
		profile,
		sourceNodes,
		destinationNodes,
		sourceText: sourceNodes
			.map((node) => primitiveDisplay(node) ?? "")
			.join(""),
		targetText,
		path: [...first.path],
		address: [...first.address],
		valueType: first.valueType,
		...(key ? { key } : {}),
		...(context ? { context } : {}),
		contexts: [],
		notes: [],
	};
}

function primitiveDisplay(
	node: JsonSyntaxNode | undefined,
): string | undefined {
	if (node?.kind !== "primitive") return undefined;
	return node.valueType === "string" ? (node.value as string) : node.raw;
}

function nodeAtAddress(
	root: JsonSyntaxNode,
	address: readonly number[],
): JsonSyntaxNode | undefined {
	let node: JsonSyntaxNode | undefined = root;
	for (const index of address) {
		node =
			node?.kind === "object"
				? node.properties[index]?.value
				: node?.kind === "array"
					? node.elements[index]
					: undefined;
	}
	return node;
}
