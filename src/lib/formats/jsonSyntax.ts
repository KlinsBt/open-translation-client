export type JsonPrimitiveType = "string" | "number" | "boolean" | "null";

interface JsonNodeBase {
	start: number;
	end: number;
	path: string[];
	address: number[];
}

export interface JsonPrimitiveNode extends JsonNodeBase {
	kind: "primitive";
	valueType: JsonPrimitiveType;
	value: string | number | boolean | null;
	raw: string;
}

export interface JsonArrayNode extends JsonNodeBase {
	kind: "array";
	elements: JsonSyntaxNode[];
}

export interface JsonPropertyNode {
	key: string;
	keyStart: number;
	keyEnd: number;
	occurrence: number;
	value: JsonSyntaxNode;
}

export interface JsonObjectNode extends JsonNodeBase {
	kind: "object";
	properties: JsonPropertyNode[];
}

export type JsonSyntaxNode = JsonPrimitiveNode | JsonArrayNode | JsonObjectNode;

export interface JsonDuplicateKey {
	path: string[];
	key: string;
	occurrences: number;
	keyRanges: Array<{ start: number; end: number }>;
}

export interface JsonSyntaxDocument {
	root: JsonSyntaxNode;
	primitives: JsonPrimitiveNode[];
	duplicateKeys: JsonDuplicateKey[];
}

export class JsonSyntaxError extends Error {
	readonly name = "JsonSyntaxError";

	constructor(
		message: string,
		readonly offset: number,
	) {
		super(`${message} (character ${offset + 1}).`);
	}
}

class JsonSyntaxParser {
	private cursor = 0;
	private readonly primitives: JsonPrimitiveNode[] = [];
	private readonly duplicateKeys: JsonDuplicateKey[] = [];

	constructor(private readonly text: string) {}

	parse(): JsonSyntaxDocument {
		if (this.text.startsWith("\ufeff")) this.cursor = 1;
		this.skipWhitespace();
		if (this.cursor === this.text.length)
			throw new JsonSyntaxError("The JSON document is empty", this.cursor);
		const root = this.parseValue([], []);
		this.skipWhitespace();
		if (this.cursor !== this.text.length)
			throw new JsonSyntaxError(
				"Unexpected content follows the JSON value",
				this.cursor,
			);
		return {
			root,
			primitives: this.primitives,
			duplicateKeys: this.duplicateKeys,
		};
	}

	private skipWhitespace(): void {
		while (/[\u0020\u0009\u000a\u000d]/.test(this.text[this.cursor] ?? ""))
			this.cursor++;
	}

	private parseStringToken(): {
		start: number;
		end: number;
		value: string;
		raw: string;
	} {
		const start = this.cursor;
		if (this.text[this.cursor] !== '"')
			throw new JsonSyntaxError("Expected a JSON string", this.cursor);
		this.cursor++;
		let escaped = false;
		while (this.cursor < this.text.length) {
			const character = this.text[this.cursor++];
			if (escaped) {
				escaped = false;
				continue;
			}
			if (character === "\\") {
				escaped = true;
				continue;
			}
			if (character === '"') {
				const end = this.cursor;
				const raw = this.text.slice(start, end);
				try {
					return { start, end, raw, value: JSON.parse(raw) as string };
				} catch {
					throw new JsonSyntaxError("The JSON string escape is invalid", start);
				}
			}
		}
		throw new JsonSyntaxError("The JSON string is not terminated", start);
	}

	private parseValue(path: string[], address: number[]): JsonSyntaxNode {
		this.skipWhitespace();
		const character = this.text[this.cursor];
		if (character === "{") return this.parseObject(path, address);
		if (character === "[") return this.parseArray(path, address);
		if (character === '"') {
			const token = this.parseStringToken();
			return this.addPrimitive({
				kind: "primitive",
				...token,
				path,
				address,
				valueType: "string",
			});
		}
		return this.parseLiteral(path, address);
	}

	private parseLiteral(path: string[], address: number[]): JsonPrimitiveNode {
		const start = this.cursor;
		const remainder = this.text.slice(start);
		let raw = "";
		let valueType: JsonPrimitiveType;
		let value: number | boolean | null;
		if (remainder.startsWith("true")) {
			raw = "true";
			valueType = "boolean";
			value = true;
		} else if (remainder.startsWith("false")) {
			raw = "false";
			valueType = "boolean";
			value = false;
		} else if (remainder.startsWith("null")) {
			raw = "null";
			valueType = "null";
			value = null;
		} else {
			const number = remainder.match(
				/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/,
			)?.[0];
			if (!number)
				throw new JsonSyntaxError("Expected a JSON value", this.cursor);
			raw = number;
			valueType = "number";
			value = Number(number);
		}
		this.cursor += raw.length;
		const next = this.text[this.cursor];
		if (next && !/[\u0020\u0009\u000a\u000d,\]}]/.test(next))
			throw new JsonSyntaxError(
				"The JSON literal has an invalid suffix",
				this.cursor,
			);
		return this.addPrimitive({
			kind: "primitive",
			start,
			end: this.cursor,
			path,
			address,
			valueType,
			value,
			raw,
		});
	}

	private addPrimitive(node: JsonPrimitiveNode): JsonPrimitiveNode {
		this.primitives.push(node);
		return node;
	}

	private parseObject(path: string[], address: number[]): JsonObjectNode {
		const start = this.cursor++;
		const properties: JsonPropertyNode[] = [];
		const occurrences = new Map<string, JsonPropertyNode[]>();
		this.skipWhitespace();
		if (this.text[this.cursor] === "}") {
			this.cursor++;
			return {
				kind: "object",
				start,
				end: this.cursor,
				path,
				address,
				properties,
			};
		}
		while (this.cursor < this.text.length) {
			this.skipWhitespace();
			const key = this.parseStringToken();
			this.skipWhitespace();
			if (this.text[this.cursor] !== ":")
				throw new JsonSyntaxError(
					"Expected a colon after the property name",
					this.cursor,
				);
			this.cursor++;
			const prior = occurrences.get(key.value) ?? [];
			const property: JsonPropertyNode = {
				key: key.value,
				keyStart: key.start,
				keyEnd: key.end,
				occurrence: prior.length,
				value: this.parseValue(
					[...path, key.value],
					[...address, properties.length],
				),
			};
			properties.push(property);
			prior.push(property);
			occurrences.set(key.value, prior);
			this.skipWhitespace();
			const delimiter = this.text[this.cursor++];
			if (delimiter === "}") break;
			if (delimiter !== ",")
				throw new JsonSyntaxError(
					"Expected an object comma or closing brace",
					this.cursor - 1,
				);
		}
		if (this.text[this.cursor - 1] !== "}")
			throw new JsonSyntaxError("The JSON object is not terminated", start);
		for (const [key, entries] of occurrences) {
			if (entries.length < 2) continue;
			this.duplicateKeys.push({
				path: [...path, key],
				key,
				occurrences: entries.length,
				keyRanges: entries.map((entry) => ({
					start: entry.keyStart,
					end: entry.keyEnd,
				})),
			});
		}
		return {
			kind: "object",
			start,
			end: this.cursor,
			path,
			address,
			properties,
		};
	}

	private parseArray(path: string[], address: number[]): JsonArrayNode {
		const start = this.cursor++;
		const elements: JsonSyntaxNode[] = [];
		this.skipWhitespace();
		if (this.text[this.cursor] === "]") {
			this.cursor++;
			return {
				kind: "array",
				start,
				end: this.cursor,
				path,
				address,
				elements,
			};
		}
		while (this.cursor < this.text.length) {
			const index = elements.length;
			elements.push(
				this.parseValue([...path, String(index)], [...address, index]),
			);
			this.skipWhitespace();
			const delimiter = this.text[this.cursor++];
			if (delimiter === "]") break;
			if (delimiter !== ",")
				throw new JsonSyntaxError(
					"Expected an array comma or closing bracket",
					this.cursor - 1,
				);
		}
		if (this.text[this.cursor - 1] !== "]")
			throw new JsonSyntaxError("The JSON array is not terminated", start);
		return { kind: "array", start, end: this.cursor, path, address, elements };
	}
}

export function parseJsonSyntax(content: string): JsonSyntaxDocument {
	return new JsonSyntaxParser(content).parse();
}

export function getJsonProperty(
	node: JsonObjectNode | undefined,
	key: string,
): JsonPropertyNode | undefined {
	return node?.properties.find((property) => property.key === key);
}

export function jsonStringValue(
	node: JsonSyntaxNode | undefined,
): string | undefined {
	return node?.kind === "primitive" && node.valueType === "string"
		? (node.value as string)
		: undefined;
}

export function jsonStringArray(
	node: JsonSyntaxNode | undefined,
): JsonPrimitiveNode[] | undefined {
	if (node?.kind !== "array") return undefined;
	const strings = node.elements.filter(
		(element): element is JsonPrimitiveNode =>
			element.kind === "primitive" && element.valueType === "string",
	);
	return strings.length === node.elements.length ? strings : undefined;
}
