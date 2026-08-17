import {
	readSafeTextFile,
	safeParseXml,
	type SafeInputContext,
} from "./safeInput";

export const SRX_20_NAMESPACE = "http://www.lisa.org/srx20";
export const SRX_20_SCHEMA_URL =
	"https://www.ttt.org/oscarStandards/srx/srx20.xsd";
const SRX_MAX_FILE_BYTES = 5 * 1024 * 1024;
const SRX_MAX_RULES = 10_000;
const SRX_MAX_LANGUAGE_MAPS = 10_000;

export interface SrxFormatHandle {
	type: "start" | "end" | "isolated";
	include: boolean;
}

export interface SrxRule {
	break: boolean;
	beforeBreak?: string;
	afterBreak?: string;
}

export interface SrxLanguageRule {
	name: string;
	rules: SrxRule[];
}

export interface SrxLanguageMap {
	languagePattern: string;
	languageRuleName: string;
}

export interface SrxDocument {
	version: "2.0";
	header: {
		segmentSubflows: boolean;
		cascade: boolean;
		formatHandles: SrxFormatHandle[];
		extensions: string[];
	};
	languageRules: SrxLanguageRule[];
	languageMaps: SrxLanguageMap[];
}

export interface SrxValidationResult {
	valid: boolean;
	reason?: string;
}

export class SrxValidationError extends Error {
	readonly name = "SrxValidationError";
}

interface CompiledSrxRule {
	break: boolean;
	before?: RegExp;
	after?: RegExp;
}

function childElements(element: Element): Element[] {
	return Array.from(element.childNodes).filter(
		(node): node is Element => node.nodeType === 1,
	);
}

function srxChildren(element: Element, name?: string): Element[] {
	return childElements(element).filter(
		(child) =>
			child.namespaceURI === SRX_20_NAMESPACE &&
			(name === undefined || child.localName === name),
	);
}

function onlySrxChildren(
	element: Element,
	expected: readonly string[],
	context: string,
): Element[] {
	const children = childElements(element);
	for (const child of children) {
		if (
			child.namespaceURI !== SRX_20_NAMESPACE ||
			!expected.includes(child.localName)
		) {
			throw new SrxValidationError(
				`${context} contains unsupported <${child.tagName}> content.`,
			);
		}
	}
	return children;
}

function requiredAttribute(element: Element, name: string): string {
	const value = element.getAttribute(name);
	if (value === null || value.length === 0) {
		throw new SrxValidationError(
			`SRX <${element.localName}> is missing required ${name}.`,
		);
	}
	return value;
}

function assertAttributes(
	element: Element,
	allowed: readonly string[],
	context: string,
): void {
	for (const attribute of Array.from(element.attributes)) {
		if (
			attribute.name === "xmlns" ||
			attribute.name.startsWith("xmlns:") ||
			attribute.name === "xsi:schemaLocation" ||
			attribute.namespaceURI === "http://www.w3.org/2000/xmlns/" ||
			attribute.namespaceURI === "http://www.w3.org/2001/XMLSchema-instance"
		)
			continue;
		if (attribute.namespaceURI === null && allowed.includes(attribute.name))
			continue;
		throw new SrxValidationError(
			`${context} contains unsupported attribute “${attribute.name}”.`,
		);
	}
}

function yesNo(value: string, context: string): boolean {
	if (value === "yes") return true;
	if (value === "no") return false;
	throw new SrxValidationError(`${context} must be “yes” or “no”.`);
}

function oneChild(parent: Element, name: string): Element {
	const matches = srxChildren(parent, name);
	if (matches.length !== 1) {
		throw new SrxValidationError(
			`SRX <${parent.localName}> must contain exactly one <${name}>.`,
		);
	}
	return matches[0];
}

function escapeRegexLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceQuotedSequences(pattern: string): string {
	let output = "";
	let cursor = 0;
	while (cursor < pattern.length) {
		const start = pattern.indexOf("\\Q", cursor);
		if (start < 0) return output + pattern.slice(cursor);
		output += pattern.slice(cursor, start);
		const end = pattern.indexOf("\\E", start + 2);
		if (end < 0)
			throw new SrxValidationError(
				"SRX regex contains an unterminated \\Q quote.",
			);
		output += escapeRegexLiteral(pattern.slice(start + 2, end));
		cursor = end + 2;
	}
	return output;
}

function translateIcuCharacterClasses(pattern: string): string {
	let output = "";
	let inClass = false;
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index];
		if (character === "[" && !inClass) {
			inClass = true;
			output += character;
			continue;
		}
		if (character === "]" && inClass) {
			inClass = false;
			output += character;
			continue;
		}
		if (character !== "\\" || index + 1 >= pattern.length) {
			output += character;
			continue;
		}
		const escaped = pattern[++index];
		if (!inClass && (escaped === "b" || escaped === "B"))
			throw new SrxValidationError(
				`SRX regex \\${escaped} uses ICU Unicode word-boundary semantics that are not compatible with JavaScript.`,
			);
		const positive = {
			d: "\\p{Nd}",
			w: "\\p{L}\\p{Nd}",
			s: "\\t\\n\\f\\r\\p{Z}",
		}[escaped];
		if (positive) {
			output += inClass ? positive : `[${positive}]`;
			continue;
		}
		const negative = {
			D: "\\p{Nd}",
			W: "\\p{L}\\p{Nd}",
			S: "\\t\\n\\f\\r\\p{Z}",
		}[escaped];
		if (negative) {
			if (inClass) {
				throw new SrxValidationError(
					`SRX regex \\${escaped} inside a character set is not compatible with JavaScript.`,
				);
			}
			output += `[^${negative}]`;
			continue;
		}
		output += `\\${escaped}`;
	}
	return output;
}

function translateIcuRegex(pattern: string): { source: string; flags: string } {
	if (pattern.length > 16_384)
		throw new SrxValidationError(
			"SRX regex exceeds the 16,384-character limit.",
		);
	if (/\(\?>|\(\?[imsx-]+:/.test(pattern))
		throw new SrxValidationError(
			"SRX regex uses an ICU group construct that is not supported safely.",
		);
	if (/(?:[*+?]|\{\d+(?:,\d*)?\})\+/.test(pattern))
		throw new SrxValidationError(
			"SRX regex uses a possessive quantifier unsupported by JavaScript.",
		);
	if (/\\(?:G|N\{|R|X)/.test(pattern))
		throw new SrxValidationError(
			"SRX regex uses an ICU escape unsupported by the browser regex engine.",
		);
	let source = replaceQuotedSequences(pattern);
	let flags = "u";
	if (source.startsWith("(?i)")) {
		flags += "i";
		source = source.slice(4);
	}
	source = source
		.replace(/\\U([0-9a-fA-F]{8})/g, (_, hex: string) => {
			const value = Number.parseInt(hex, 16);
			if (value > 0x10ffff)
				throw new SrxValidationError(
					`SRX regex has invalid code point U+${hex}.`,
				);
			return `\\u{${value.toString(16)}}`;
		})
		.replace(/\\x\{([0-9a-fA-F]{1,6})\}/g, "\\u{$1}")
		.replace(/\\x([0-9a-fA-F]{4})/g, "\\u$1")
		.replace(/\\A/g, "^")
		.replace(/\\[zZ]/g, "$");
	source = translateIcuCharacterClasses(source);
	return { source, flags };
}

function compilePattern(
	pattern: string,
	position: "before" | "after" | "language",
): RegExp {
	const translated = translateIcuRegex(pattern);
	const source =
		position === "before"
			? `(?:${translated.source})$`
			: position === "after"
				? `^(?:${translated.source})`
				: translated.source;
	try {
		return new RegExp(source, translated.flags);
	} catch (error) {
		throw new SrxValidationError(
			`SRX ${position} regex is not compatible with this browser: ${error instanceof Error ? error.message : "invalid expression"}`,
		);
	}
}

function validateRegexes(document: SrxDocument): void {
	for (const languageRule of document.languageRules) {
		for (const rule of languageRule.rules) {
			if (rule.beforeBreak !== undefined)
				compilePattern(rule.beforeBreak, "before");
			if (rule.afterBreak !== undefined)
				compilePattern(rule.afterBreak, "after");
		}
		compileRules(languageRule.rules);
	}
	for (const map of document.languageMaps)
		compilePattern(map.languagePattern, "language");
}

export function parseSrx20(xml: string): SrxDocument {
	if (xml.length > SRX_MAX_FILE_BYTES)
		throw new SrxValidationError("SRX file exceeds the 5 MiB workflow limit.");
	const parsed = safeParseXml(xml);
	const root = parsed.documentElement;
	if (root.localName !== "srx" || root.namespaceURI !== SRX_20_NAMESPACE)
		throw new SrxValidationError(
			`SRX root must be <srx> in the ${SRX_20_NAMESPACE} namespace.`,
		);
	if (root.getAttribute("version") !== "2.0")
		throw new SrxValidationError("Only SRX version 2.0 is supported.");
	assertAttributes(root, ["version"], "SRX root");
	const rootChildren = onlySrxChildren(root, ["header", "body"], "SRX root");
	if (
		rootChildren.length !== 2 ||
		rootChildren[0].localName !== "header" ||
		rootChildren[1].localName !== "body"
	)
		throw new SrxValidationError("SRX requires header followed by body.");
	const headerElement = rootChildren[0];
	const bodyElement = rootChildren[1];
	const formatHandles: SrxFormatHandle[] = [];
	const extensions: string[] = [];
	let seenExtension = false;
	assertAttributes(headerElement, ["segmentsubflows", "cascade"], "SRX header");
	assertAttributes(bodyElement, [], "SRX body");
	for (const child of childElements(headerElement)) {
		if (child.namespaceURI !== SRX_20_NAMESPACE) {
			seenExtension = true;
			extensions.push(new XMLSerializer().serializeToString(child));
			continue;
		}
		if (child.localName !== "formathandle" || seenExtension)
			throw new SrxValidationError(
				"SRX header format handles must precede foreign extensions.",
			);
		const type = requiredAttribute(child, "type");
		assertAttributes(child, ["type", "include"], "SRX format handle");
		if (!(["start", "end", "isolated"] as string[]).includes(type))
			throw new SrxValidationError(`Invalid SRX format-handle type “${type}”.`);
		formatHandles.push({
			type: type as SrxFormatHandle["type"],
			include: yesNo(requiredAttribute(child, "include"), "Format include"),
		});
	}
	if (formatHandles.length > 3)
		throw new SrxValidationError(
			"SRX header allows at most three format handles.",
		);

	onlySrxChildren(bodyElement, ["languagerules", "maprules"], "SRX body");
	const languageRulesElement = oneChild(bodyElement, "languagerules");
	const mapRulesElement = oneChild(bodyElement, "maprules");
	assertAttributes(languageRulesElement, [], "SRX language rules");
	assertAttributes(mapRulesElement, [], "SRX map rules");
	const bodyChildren = srxChildren(bodyElement);
	if (
		bodyChildren[0] !== languageRulesElement ||
		bodyChildren[1] !== mapRulesElement ||
		bodyChildren.length !== 2
	)
		throw new SrxValidationError(
			"SRX body requires languagerules followed by maprules.",
		);

	const languageRules = onlySrxChildren(
		languageRulesElement,
		["languagerule"],
		"SRX language rules",
	).map((languageRule): SrxLanguageRule => {
		assertAttributes(languageRule, ["languagerulename"], "SRX language rule");
		const rules = onlySrxChildren(
			languageRule,
			["rule"],
			"SRX language rule",
		).map((rule): SrxRule => {
			assertAttributes(rule, ["break"], "SRX rule");
			const children = onlySrxChildren(
				rule,
				["beforebreak", "afterbreak"],
				"SRX rule",
			);
			if (children.length === 0 || children.length > 2)
				throw new SrxValidationError(
					"Each SRX rule requires beforebreak and/or afterbreak.",
				);
			const before = srxChildren(rule, "beforebreak");
			const after = srxChildren(rule, "afterbreak");
			if (before.length > 1 || after.length > 1)
				throw new SrxValidationError(
					"An SRX rule cannot repeat beforebreak or afterbreak.",
				);
			if (
				before[0] &&
				after[0] &&
				children.indexOf(before[0]) > children.indexOf(after[0])
			)
				throw new SrxValidationError(
					"SRX beforebreak must precede afterbreak.",
				);
			if (before[0]) assertAttributes(before[0], [], "SRX beforebreak");
			if (after[0]) assertAttributes(after[0], [], "SRX afterbreak");
			if (
				(before[0] && childElements(before[0]).length > 0) ||
				(after[0] && childElements(after[0]).length > 0)
			)
				throw new SrxValidationError(
					"SRX break expressions must contain text only.",
				);
			const breakAttribute = rule.getAttribute("break");
			return {
				break:
					breakAttribute === null ? true : yesNo(breakAttribute, "Rule break"),
				...(before[0] ? { beforeBreak: before[0].textContent ?? "" } : {}),
				...(after[0] ? { afterBreak: after[0].textContent ?? "" } : {}),
			};
		});
		if (rules.length === 0)
			throw new SrxValidationError(
				"Each SRX language rule needs at least one rule.",
			);
		return {
			name: requiredAttribute(languageRule, "languagerulename"),
			rules,
		};
	});
	if (languageRules.length === 0)
		throw new SrxValidationError("SRX needs at least one language rule.");
	if (
		languageRules.reduce(
			(total, languageRule) => total + languageRule.rules.length,
			0,
		) > SRX_MAX_RULES
	)
		throw new SrxValidationError(
			`SRX exceeds the ${SRX_MAX_RULES.toLocaleString()}-rule safety limit.`,
		);
	const names = new Set(languageRules.map((rule) => rule.name));
	if (names.size !== languageRules.length)
		throw new SrxValidationError("SRX language-rule names must be unique.");

	const languageMaps = onlySrxChildren(
		mapRulesElement,
		["languagemap"],
		"SRX map rules",
	).map((map): SrxLanguageMap => {
		assertAttributes(
			map,
			["languagepattern", "languagerulename"],
			"SRX language map",
		);
		return {
			languagePattern: requiredAttribute(map, "languagepattern"),
			languageRuleName: requiredAttribute(map, "languagerulename"),
		};
	});
	if (languageMaps.length === 0)
		throw new SrxValidationError("SRX needs at least one language map.");
	if (languageMaps.length > SRX_MAX_LANGUAGE_MAPS)
		throw new SrxValidationError(
			`SRX exceeds the ${SRX_MAX_LANGUAGE_MAPS.toLocaleString()}-map safety limit.`,
		);
	for (const map of languageMaps) {
		if (!names.has(map.languageRuleName))
			throw new SrxValidationError(
				`SRX language map references missing rule “${map.languageRuleName}”.`,
			);
	}

	const document: SrxDocument = {
		version: "2.0",
		header: {
			segmentSubflows: yesNo(
				requiredAttribute(headerElement, "segmentsubflows"),
				"Header segmentsubflows",
			),
			cascade: yesNo(
				requiredAttribute(headerElement, "cascade"),
				"Header cascade",
			),
			formatHandles,
			extensions,
		},
		languageRules,
		languageMaps,
	};
	validateRegexes(document);
	return document;
}

function escapeXml(value: string): string {
	return value.replace(
		/[<>&'\"]/g,
		(character) =>
			({
				"<": "&lt;",
				">": "&gt;",
				"&": "&amp;",
				"'": "&apos;",
				'"': "&quot;",
			})[character]!,
	);
}

export function serializeSrx20(document: SrxDocument): string {
	validateRegexes(document);
	const names = new Set(document.languageRules.map((rule) => rule.name));
	if (names.size !== document.languageRules.length)
		throw new SrxValidationError("SRX language-rule names must be unique.");
	for (const map of document.languageMaps)
		if (!names.has(map.languageRuleName))
			throw new SrxValidationError(
				`SRX language map references missing rule “${map.languageRuleName}”.`,
			);
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<srx xmlns="${SRX_20_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="${SRX_20_NAMESPACE} ${SRX_20_SCHEMA_URL}" version="2.0">`,
		`  <header segmentsubflows="${document.header.segmentSubflows ? "yes" : "no"}" cascade="${document.header.cascade ? "yes" : "no"}">`,
	];
	for (const handle of document.header.formatHandles)
		lines.push(
			`    <formathandle type="${handle.type}" include="${handle.include ? "yes" : "no"}"/>`,
		);
	for (const extension of document.header.extensions)
		lines.push(`    ${extension}`);
	lines.push("  </header>", "  <body>", "    <languagerules>");
	for (const languageRule of document.languageRules) {
		lines.push(
			`      <languagerule languagerulename="${escapeXml(languageRule.name)}">`,
		);
		for (const rule of languageRule.rules) {
			lines.push(`        <rule break="${rule.break ? "yes" : "no"}">`);
			if (rule.beforeBreak !== undefined)
				lines.push(
					`          <beforebreak>${escapeXml(rule.beforeBreak)}</beforebreak>`,
				);
			if (rule.afterBreak !== undefined)
				lines.push(
					`          <afterbreak>${escapeXml(rule.afterBreak)}</afterbreak>`,
				);
			lines.push("        </rule>");
		}
		lines.push("      </languagerule>");
	}
	lines.push("    </languagerules>", "    <maprules>");
	for (const map of document.languageMaps)
		lines.push(
			`      <languagemap languagepattern="${escapeXml(map.languagePattern)}" languagerulename="${escapeXml(map.languageRuleName)}"/>`,
		);
	lines.push("    </maprules>", "  </body>", "</srx>", "");
	const serialized = lines.join("\n");
	parseSrx20(serialized);
	return serialized;
}

export function getSrxRulesForLanguage(
	document: SrxDocument,
	languageCode: string,
): SrxRule[] {
	const rulesByName = new Map(
		document.languageRules.map((languageRule) => [
			languageRule.name,
			languageRule.rules,
		]),
	);
	const selected: SrxRule[] = [];
	for (const map of document.languageMaps) {
		if (!compilePattern(map.languagePattern, "language").test(languageCode))
			continue;
		selected.push(...(rulesByName.get(map.languageRuleName) ?? []));
		if (!document.header.cascade) break;
	}
	return selected;
}

function compileRules(rules: readonly SrxRule[]): CompiledSrxRule[] {
	return rules.map((rule) => {
		const before =
			rule.beforeBreak === undefined
				? undefined
				: translateIcuRegex(rule.beforeBreak);
		const after =
			rule.afterBreak === undefined
				? undefined
				: translateIcuRegex(rule.afterBreak);
		try {
			return {
				break: rule.break,
				...(before
					? {
							before: new RegExp(
								`(?<=(?:${before.source}))`,
								`${before.flags.includes("i") ? "i" : ""}gu`,
							),
						}
					: {}),
				...(after
					? {
							after: new RegExp(
								`(?=(?:${after.source}))`,
								`${after.flags.includes("i") ? "i" : ""}gu`,
							),
						}
					: {}),
			};
		} catch (error) {
			throw new SrxValidationError(
				`SRX boundary regex is not compatible with this browser: ${error instanceof Error ? error.message : "invalid expression"}`,
			);
		}
	});
}

function advanceCodePoint(text: string, index: number): number {
	if (index >= text.length) return text.length + 1;
	const first = text.charCodeAt(index);
	const second = text.charCodeAt(index + 1);
	return first >= 0xd800 &&
		first <= 0xdbff &&
		second >= 0xdc00 &&
		second <= 0xdfff
		? index + 2
		: index + 1;
}

function boundaryMatches(text: string, matcher: RegExp): Set<number> {
	const positions = new Set<number>();
	matcher.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = matcher.exec(text))) {
		if (match.index > 0 && match.index < text.length)
			positions.add(match.index);
		if (match[0].length === 0)
			matcher.lastIndex = advanceCodePoint(text, matcher.lastIndex);
	}
	return positions;
}

export function findSrxBreakPositions(
	text: string,
	document: SrxDocument,
	languageCode: string,
): number[] {
	const rules = compileRules(getSrxRulesForLanguage(document, languageCode));
	const matches = rules.map((rule) => ({
		...(rule.before ? { before: boundaryMatches(text, rule.before) } : {}),
		...(rule.after ? { after: boundaryMatches(text, rule.after) } : {}),
	}));
	const boundaries: number[] = [];
	for (let position = 1; position < text.length; position++) {
		const code = text.charCodeAt(position);
		const previous = text.charCodeAt(position - 1);
		if (
			code >= 0xdc00 &&
			code <= 0xdfff &&
			previous >= 0xd800 &&
			previous <= 0xdbff
		)
			continue;
		for (const [index, rule] of rules.entries()) {
			if (matches[index].before && !matches[index].before.has(position))
				continue;
			if (matches[index].after && !matches[index].after.has(position)) continue;
			if (rule.break) boundaries.push(position);
			break;
		}
	}
	return boundaries;
}

export function validateSrx20(xml: string): SrxValidationResult {
	try {
		parseSrx20(xml);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			reason: error instanceof Error ? error.message : "Invalid SRX 2.0 file.",
		};
	}
}

export async function importSrx20File(
	file: File,
	context?: SafeInputContext,
): Promise<SrxDocument> {
	const { text } = await readSafeTextFile(file, context, {
		maxFileBytes: SRX_MAX_FILE_BYTES,
	});
	return parseSrx20(text);
}

export function buildSrx20Blob(document: SrxDocument): Blob {
	return new Blob([serializeSrx20(document)], {
		type: "application/srx+xml;charset=utf-8",
	});
}
