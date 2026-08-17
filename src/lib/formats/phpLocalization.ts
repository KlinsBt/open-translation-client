import type { PhpSegmentMeta, TypeRef } from "$lib/types/types";
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
import { createTextSkeleton, type PhpValueReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export interface PhpStringLeaf {
	path: string[];
	value: string;
	start: number;
	end: number;
	quote: "'" | '"';
	line: number;
	comment?: string;
}

export interface ParsedPhpLocalization {
	leaves: PhpStringLeaf[];
	warnings: string[];
}

function invalidPhp(
	content: string,
	offset: number,
	message: string,
): SafeInputError {
	const before = content.slice(0, offset);
	const line = before.split("\n").length;
	const lastBreak = before.lastIndexOf("\n");
	const column = offset - lastBreak;
	return new SafeInputError(
		"PHP_LOCALIZATION_INVALID",
		`PHP localization syntax at line ${line}, column ${column}: ${message}`,
		{ offset, line, column },
	);
}

class StaticPhpArrayParser {
	private cursor = 0;
	private readonly leaves: PhpStringLeaf[] = [];
	private readonly warnings: string[] = [];
	private readonly seen = new Set<string>();

	constructor(private readonly content: string) {}

	parse(): ParsedPhpLocalization {
		this.skipTrivia();
		if (!this.consume("<?php"))
			throw invalidPhp(
				this.content,
				this.cursor,
				"expected the <?php opening tag.",
			);
		this.skipTrivia();
		this.expectKeyword("return");
		this.skipTrivia();
		this.parseArray([]);
		this.skipTrivia();
		this.expect(";");
		this.skipTrivia();
		if (this.consume("?>")) this.skipTrivia();
		if (this.cursor !== this.content.length)
			throw invalidPhp(
				this.content,
				this.cursor,
				"dynamic statements or trailing content are not supported.",
			);
		return { leaves: this.leaves, warnings: this.warnings };
	}

	private parseArray(path: string[]): void {
		let close: "]" | ")";
		if (this.consume("[")) close = "]";
		else {
			this.expectKeyword("array");
			this.skipTrivia();
			this.expect("(");
			close = ")";
		}
		this.skipTrivia();
		if (this.consume(close)) return;
		while (true) {
			const comments = this.skipTrivia();
			const key = this.parseKey();
			this.skipTrivia();
			this.expect("=>");
			this.skipTrivia();
			const childPath = [...path, key];
			if (this.peek("[") || this.keywordAhead("array")) {
				this.parseArray(childPath);
			} else if (this.peek("'") || this.peek('\"')) {
				const leaf = this.parseString();
				leaf.path = childPath;
				const comment = comments.at(-1);
				if (comment) leaf.comment = comment;
				const identity = childPath.join("\u0000");
				if (this.seen.has(identity))
					this.warnings.push(
						`Duplicate PHP localization path ${childPath.join(".")}.`,
					);
				this.seen.add(identity);
				this.leaves.push(leaf);
			} else {
				throw invalidPhp(
					this.content,
					this.cursor,
					"only nested arrays and literal string values are allowed; variables, calls, concatenation, constants, and expressions are rejected.",
				);
			}
			this.skipTrivia();
			if (this.consume(close)) break;
			this.expect(",");
			this.skipTrivia();
			if (this.consume(close)) break;
		}
	}

	private parseKey(): string {
		if (this.peek("'") || this.peek('\"')) return this.parseString().value;
		const match = this.content.slice(this.cursor).match(/^-?\d+/);
		if (!match)
			throw invalidPhp(
				this.content,
				this.cursor,
				"expected a quoted string or integer array key.",
			);
		this.cursor += match[0].length;
		return match[0];
	}

	private parseString(): PhpStringLeaf {
		const quote = this.content[this.cursor] as "'" | '"';
		const line = this.content.slice(0, this.cursor).split("\n").length;
		this.cursor++;
		const start = this.cursor;
		let value = "";
		while (this.cursor < this.content.length) {
			const character = this.content[this.cursor];
			if (character === quote) {
				const end = this.cursor++;
				return { path: [], value, start, end, quote, line };
			}
			if (character === "\n" || character === "\r")
				throw invalidPhp(
					this.content,
					this.cursor,
					"literal strings cannot cross a line boundary.",
				);
			if (quote === '"' && character === "$")
				throw invalidPhp(
					this.content,
					this.cursor,
					"double-quoted interpolation is dynamic and is not supported; escape the dollar sign for literal text.",
				);
			if (character !== "\\") {
				value += character;
				this.cursor++;
				continue;
			}
			const escapeOffset = this.cursor++;
			if (this.cursor >= this.content.length)
				throw invalidPhp(
					this.content,
					escapeOffset,
					"unterminated escape sequence.",
				);
			const escaped = this.content[this.cursor++];
			if (quote === "'") {
				value += escaped === "'" || escaped === "\\" ? escaped : `\\${escaped}`;
				continue;
			}
			const simple: Record<string, string> = {
				n: "\n",
				r: "\r",
				t: "\t",
				v: "\v",
				e: "\u001b",
				f: "\f",
				"\\": "\\",
				'"': '"',
				$: "$",
			};
			if (escaped in simple) value += simple[escaped];
			else if (escaped === "x") {
				const digits = this.content.slice(this.cursor, this.cursor + 2);
				if (!/^[0-9A-Fa-f]{1,2}/.test(digits)) value += "\\x";
				else {
					const hex = digits.match(/^[0-9A-Fa-f]{1,2}/)![0];
					value += String.fromCharCode(Number.parseInt(hex, 16));
					this.cursor += hex.length;
				}
			} else if (/[0-7]/.test(escaped)) {
				const rest = this.content.slice(this.cursor, this.cursor + 2);
				const octal = `${escaped}${rest.match(/^[0-7]{0,2}/)?.[0] ?? ""}`;
				value += String.fromCharCode(Number.parseInt(octal, 8));
				this.cursor += octal.length - 1;
			} else value += `\\${escaped}`;
		}
		throw invalidPhp(this.content, start - 1, "unterminated string literal.");
	}

	private skipTrivia(): string[] {
		const comments: string[] = [];
		while (this.cursor < this.content.length) {
			const whitespace = this.content.slice(this.cursor).match(/^\s+/)?.[0];
			if (whitespace) {
				this.cursor += whitespace.length;
				continue;
			}
			if (this.peek("//") || this.peek("#")) {
				const markerLength = this.peek("//") ? 2 : 1;
				const end = this.content.indexOf("\n", this.cursor + markerLength);
				const stop = end < 0 ? this.content.length : end;
				comments.push(
					this.content.slice(this.cursor + markerLength, stop).trim(),
				);
				this.cursor = stop;
				continue;
			}
			if (this.peek("/*")) {
				const end = this.content.indexOf("*/", this.cursor + 2);
				if (end < 0)
					throw invalidPhp(
						this.content,
						this.cursor,
						"unterminated block comment.",
					);
				comments.push(
					this.content
						.slice(this.cursor + 2, end)
						.replace(/^\s*\* ?/gm, "")
						.trim(),
				);
				this.cursor = end + 2;
				continue;
			}
			break;
		}
		return comments.filter(Boolean);
	}

	private keywordAhead(keyword: string): boolean {
		return (
			this.content.slice(this.cursor, this.cursor + keyword.length) ===
				keyword &&
			!/[_A-Za-z0-9]/.test(this.content[this.cursor + keyword.length] ?? "")
		);
	}

	private expectKeyword(keyword: string): void {
		if (!this.keywordAhead(keyword))
			throw invalidPhp(this.content, this.cursor, `expected ${keyword}.`);
		this.cursor += keyword.length;
	}

	private peek(value: string): boolean {
		return this.content.startsWith(value, this.cursor);
	}

	private consume(value: string): boolean {
		if (!this.peek(value)) return false;
		this.cursor += value.length;
		return true;
	}

	private expect(value: string): void {
		if (!this.consume(value))
			throw invalidPhp(this.content, this.cursor, `expected ${value}.`);
	}
}

export function parsePhpLocalization(content: string): ParsedPhpLocalization {
	return new StaticPhpArrayParser(content).parse();
}

export async function validatePhpLocalizationFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parsePhpLocalization(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not a static PHP localization array.",
				};
	}
}

export async function importPhpLocalizationFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("php", options);
	const selectors = parseList(filterOptions.pathSelectors);
	const read = await readSafeTextFile(file, context);
	const parsed = parsePhpLocalization(read.text);
	const selected = parsed.leaves.filter(
		(leaf) =>
			(filterOptions.includeEmpty || leaf.value.length > 0) &&
			matchesJsonSelector(leaf.path, selectors),
	);
	const segments = selected.map((leaf) => leaf.value);
	const meta: PhpSegmentMeta[] = selected.map((leaf) => ({
		path: leaf.path,
		start: leaf.start,
		end: leaf.end,
		originalValue: leaf.value,
		quote: leaf.quote,
	}));
	const replacements: PhpValueReplacement[] = meta.map((entry, unitIndex) => ({
		kind: "php-value",
		unitIndex,
		...entry,
	}));
	const document = createNeutralDocument({
		format: "php",
		sourceSegments: segments,
		unitIds: selected.map((leaf) => leaf.path.join(".")),
		sourceLocations: selected.map((leaf, segmentIndex) => ({
			part: file.name,
			path: leaf.path,
			line: leaf.line,
			segmentIndex,
		})),
	});
	document.metadata = {
		warnings: parsed.warnings,
		encoding: read.encoding,
		hasBom: read.hasBom,
		grammar: "static-return-array",
	};
	for (const [index, leaf] of selected.entries()) {
		document.units[index].contexts.push({
			type: "php-array-path",
			value: leaf.path.join("."),
		});
		if (leaf.comment)
			document.units[index].notes.push({
				category: "developer-comment",
				text: leaf.comment,
				appliesTo: "source",
			});
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createTextSkeleton(
			file,
			"php",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "static-php-localization-array" } as TypeRef,
		segmentsMeta: meta,
	};
}
