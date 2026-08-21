import type { AuxiliarySegmentMeta, TypeRef, UserData } from "$lib/types/types";
import { assertProjectExportQuality } from "./qualityAssurance";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import {
	createTextSkeleton,
	getTextSkeletonContent,
	type AuxiliaryValueReplacement,
} from "./skeleton";
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
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";

export type AuxiliaryResourceProfile = "inf" | "reg" | "freemind";

export const AUXILIARY_RESOURCE_EXTENSIONS = ["inf", "reg", "mm"] as const;
export const AUXILIARY_RESOURCE_MIME_TYPES = [
	"text/plain",
	"application/x-windows-registry",
	"application/x-freemind",
	"application/xml",
	"text/xml",
] as const;

interface Candidate {
	value: string;
	replacement: Omit<AuxiliaryValueReplacement, "kind" | "unitIndex">;
	meta: AuxiliarySegmentMeta;
	unitId: string;
	path: string[];
	line?: number;
	contexts: Array<{ type: string; value: string }>;
	note?: string;
}

interface PhysicalLine {
	start: number;
	contentEnd: number;
	end: number;
	line: number;
}

interface InfEntry {
	section: string;
	key: string;
	value: string;
	start: number;
	end: number;
	line: number;
	comment?: string;
}

interface ParsedInf {
	entries: InfEntry[];
	warnings: string[];
	hasVersionSignature: boolean;
	hasStringsSection: boolean;
}

interface RegEntry {
	keyPath: string;
	valueName: string;
	value: string;
	type: "REG_SZ" | "REG_EXPAND_SZ" | "REG_MULTI_SZ";
	location: "reg-string" | "reg-expand" | "reg-multi";
	start: number;
	end: number;
	line: number;
}

interface ParsedReg {
	header: "Windows Registry Editor Version 5.00" | "REGEDIT4";
	entries: RegEntry[];
}

function auxiliaryError(message: string): SafeInputError {
	return new SafeInputError("AUXILIARY_RESOURCE_INVALID", message);
}

function physicalLines(content: string): PhysicalLine[] {
	const lines: PhysicalLine[] = [];
	let start = 0;
	let line = 1;
	while (start < content.length) {
		let cursor = start;
		while (
			cursor < content.length &&
			content[cursor] !== "\r" &&
			content[cursor] !== "\n"
		)
			cursor++;
		const contentEnd = cursor;
		if (content[cursor] === "\r") cursor++;
		if (content[cursor] === "\n") cursor++;
		lines.push({ start, contentEnd, end: cursor, line });
		start = cursor;
		line++;
	}
	if (content.length === 0) return [];
	return lines;
}

function lineText(content: string, line: PhysicalLine): string {
	const raw = content.slice(line.start, line.contentEnd);
	return line.line === 1 ? raw.replace(/^\ufeff/, "") : raw;
}

function commentOffset(value: string, marker = ";"): number {
	let quoted = false;
	for (let index = 0; index < value.length; index++) {
		if (value[index] === '"') {
			if (quoted && value[index + 1] === '"') index++;
			else quoted = !quoted;
		} else if (!quoted && value[index] === marker) return index;
	}
	return value.length;
}

function continuedInfLine(value: string): boolean {
	const visible = value.slice(0, commentOffset(value)).trimEnd();
	if (!visible.endsWith("\\")) return false;
	let quoted = false;
	for (let index = 0; index < visible.length - 1; index++) {
		if (visible[index] !== '"') continue;
		if (quoted && visible[index + 1] === '"') index++;
		else quoted = !quoted;
	}
	return !quoted;
}

function decodeInfString(raw: string, line: number): string {
	const value = raw.trim();
	if (!value.startsWith('"')) {
		if (value.includes('"'))
			throw auxiliaryError(
				`INF string on line ${line} contains an unmatched quote.`,
			);
		return value;
	}
	if (!value.endsWith('"') || value.length < 2)
		throw auxiliaryError(`INF string on line ${line} is not terminated.`);
	const inner = value.slice(1, -1);
	let decoded = "";
	for (let index = 0; index < inner.length; index++) {
		if (inner[index] !== '"') decoded += inner[index];
		else if (inner[index + 1] === '"') {
			decoded += '"';
			index++;
		} else {
			throw auxiliaryError(
				`INF string on line ${line} has an unmatched embedded quote.`,
			);
		}
	}
	return decoded;
}

export function parseInf(content: string): ParsedInf {
	const lines = physicalLines(content);
	const entries: InfEntry[] = [];
	const warnings: string[] = [];
	const seen = new Set<string>();
	let section = "";
	let pendingComment: string | undefined;
	let hasVersionSignature = false;
	let hasStringsSection = false;
	for (let index = 0; index < lines.length; index++) {
		const first = lines[index];
		const visible = lineText(content, first);
		const trimmed = visible.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith(";")) {
			pendingComment = trimmed.slice(1).trim();
			continue;
		}
		if (trimmed.startsWith("[")) {
			const match = trimmed.match(/^\[([^\]\r\n]+)\]\s*(?:;.*)?$/);
			if (!match)
				throw auxiliaryError(
					`INF section header on line ${first.line} is malformed.`,
				);
			section = match[1].trim();
			if (/^strings(?:\.[0-9a-f]{4})?$/i.test(section))
				hasStringsSection = true;
			pendingComment = undefined;
			continue;
		}

		const group = [first];
		while (continuedInfLine(lineText(content, group.at(-1)!))) {
			const next = lines[++index];
			if (!next)
				throw auxiliaryError(
					`INF continuation on line ${group.at(-1)!.line} has no following line.`,
				);
			group.push(next);
		}
		const logicalParts = group.map((line, partIndex) => {
			const raw = lineText(content, line);
			const withoutComment = raw.slice(0, commentOffset(raw));
			const continued = partIndex < group.length - 1;
			const value = continued
				? withoutComment.trimEnd().slice(0, -1)
				: withoutComment;
			return partIndex === 0 ? value : value.trimStart();
		});
		const logical = logicalParts.join("");
		const equals = logical.indexOf("=");
		if (equals < 1)
			throw auxiliaryError(
				`INF directive on line ${first.line} has no key/value delimiter.`,
			);
		const key = logical.slice(0, equals).trim();
		if (!key)
			throw auxiliaryError(
				`INF directive on line ${first.line} has an empty key.`,
			);
		const firstEquals = visible.indexOf("=");
		let start = first.start + firstEquals + 1;
		while (/[ \t]/.test(content[start] ?? "")) start++;
		const last = group.at(-1)!;
		const lastRaw = lineText(content, last);
		const lastComment = commentOffset(lastRaw);
		let end = last.start + lastComment;
		while (end > start && /[ \t]/.test(content[end - 1])) end--;
		const rawValue = logical.slice(equals + 1);
		if (
			section.toLowerCase() === "version" &&
			key.toLowerCase() === "signature"
		) {
			hasVersionSignature =
				/^\s*["']?\$(?:windows nt|chicago)\$["']?\s*$/i.test(rawValue);
		}
		if (/^strings(?:\.[0-9a-f]{4})?$/i.test(section)) {
			const value = decodeInfString(rawValue, first.line);
			const identity = `${section.toLowerCase()}\u0000${key.toLowerCase()}`;
			if (seen.has(identity))
				warnings.push(`Duplicate INF string key ${section}.${key}.`);
			seen.add(identity);
			entries.push({
				section,
				key,
				value,
				start,
				end,
				line: first.line,
				...(pendingComment ? { comment: pendingComment } : {}),
			});
		}
		pendingComment = undefined;
	}
	if (!hasVersionSignature)
		throw auxiliaryError(
			"Windows INF detection requires a [Version] section with a valid Signature entry.",
		);
	if (!hasStringsSection)
		throw auxiliaryError(
			"The INF has no [Strings] or [Strings.LanguageID] resource section.",
		);
	return { entries, warnings, hasVersionSignature, hasStringsSection };
}

function decodeRegEscapes(raw: string, line: number): string {
	let output = "";
	for (let index = 0; index < raw.length; index++) {
		if (raw[index] !== "\\") output += raw[index];
		else {
			const escaped = raw[++index];
			if (escaped !== "\\" && escaped !== '"')
				throw auxiliaryError(
					`Registry string on line ${line} uses unsupported escape \\${escaped ?? ""}.`,
				);
			output += escaped;
		}
	}
	return output;
}

function parseRegHex(raw: string, line: number): Uint8Array {
	const compact = raw.replace(/\\\s*(?:\r\n|\n|\r)\s*/g, "").trim();
	if (!compact) return new Uint8Array();
	const parts = compact.split(",").map((part) => part.trim());
	if (parts.some((part) => !/^[0-9a-f]{2}$/i.test(part)))
		throw auxiliaryError(
			`Registry hexadecimal data on line ${line} is malformed.`,
		);
	return Uint8Array.from(parts.map((part) => Number.parseInt(part, 16)));
}

function decodeUtf16Le(bytes: Uint8Array, line: number): string {
	if (bytes.length % 2 !== 0)
		throw auxiliaryError(
			`Registry UTF-16 data on line ${line} has an odd byte count.`,
		);
	try {
		return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
	} catch {
		throw auxiliaryError(`Registry UTF-16 data on line ${line} is invalid.`);
	}
}

export function parseReg(content: string): ParsedReg {
	const lines = physicalLines(content);
	let header: ParsedReg["header"] | undefined;
	let currentKey = "";
	const entries: RegEntry[] = [];
	for (let index = 0; index < lines.length; index++) {
		const first = lines[index];
		const visible = lineText(content, first);
		const trimmed = visible.trim();
		if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#"))
			continue;
		if (!header) {
			if (
				trimmed !== "Windows Registry Editor Version 5.00" &&
				trimmed !== "REGEDIT4"
			)
				throw auxiliaryError(
					"Registry files must begin with “Windows Registry Editor Version 5.00” or “REGEDIT4”.",
				);
			header = trimmed;
			continue;
		}
		if (trimmed.startsWith("[")) {
			const match = trimmed.match(/^\[(-?)([^\]\r\n]+)\]$/);
			if (!match)
				throw auxiliaryError(
					`Registry key on line ${first.line} is malformed.`,
				);
			currentKey = match[1] ? "" : match[2];
			continue;
		}
		if (!currentKey) {
			if (/^(?:@|"(?:\\.|[^"\\])+")\s*=\s*-$/.test(trimmed)) continue;
			throw auxiliaryError(
				`Registry value on line ${first.line} is outside a writable key.`,
			);
		}
		const nameMatch = visible.match(/^\s*(?:(@)|"((?:\\.|[^"\\])*)")\s*=\s*/);
		if (!nameMatch)
			throw auxiliaryError(
				`Registry value on line ${first.line} is malformed.`,
			);
		const valueName = nameMatch[1]
			? "@"
			: decodeRegEscapes(nameMatch[2], first.line);
		const rhsStartInLine = nameMatch[0].length;
		const rhsFirst = visible.slice(rhsStartInLine);
		const group = [first];
		if (/^hex(?:\([0-9a-f]+\))?:/i.test(rhsFirst)) {
			while (/\\\s*$/.test(lineText(content, group.at(-1)!))) {
				const next = lines[++index];
				if (!next)
					throw auxiliaryError(
						`Registry continuation on line ${group.at(-1)!.line} has no following line.`,
					);
				group.push(next);
			}
		}
		const last = group.at(-1)!;
		let end = last.contentEnd;
		while (end > first.start && /[ \t]/.test(content[end - 1])) end--;
		const start = first.start + rhsStartInLine;
		const rhs = content.slice(start, end);
		if (rhs.trim() === "-") continue;
		const quoted = rhs.match(/^"((?:\\.|[^"\\])*)"\s*$/s);
		if (quoted) {
			entries.push({
				keyPath: currentKey,
				valueName,
				value: decodeRegEscapes(quoted[1], first.line),
				type: "REG_SZ",
				location: "reg-string",
				start,
				end,
				line: first.line,
			});
			continue;
		}
		const hex = rhs.match(/^hex\(([0-9a-f]+)\):([\s\S]*)$/i);
		if (hex && (hex[1].toLowerCase() === "2" || hex[1].toLowerCase() === "7")) {
			const bytes = parseRegHex(hex[2], first.line);
			const decoded = decodeUtf16Le(bytes, first.line);
			if (!decoded.endsWith("\u0000"))
				throw auxiliaryError(
					`Registry ${hex[1] === "2" ? "expandable" : "multi"} string on line ${first.line} is not NUL-terminated.`,
				);
			if (hex[1].toLowerCase() === "2") {
				entries.push({
					keyPath: currentKey,
					valueName,
					value: decoded.replace(/\u0000+$/, ""),
					type: "REG_EXPAND_SZ",
					location: "reg-expand",
					start,
					end,
					line: first.line,
				});
			} else {
				if (!decoded.endsWith("\u0000\u0000"))
					throw auxiliaryError(
						`Registry multi-string on line ${first.line} lacks its double-NUL terminator.`,
					);
				entries.push({
					keyPath: currentKey,
					valueName,
					value: decoded
						.replace(/\u0000\u0000$/, "")
						.split("\u0000")
						.join("\n"),
					type: "REG_MULTI_SZ",
					location: "reg-multi",
					start,
					end,
					line: first.line,
				});
			}
			continue;
		}
		if (/^(?:dword|qword|hex(?:\([0-9a-f]+\))?):/i.test(rhs)) continue;
		throw auxiliaryError(
			`Registry value on line ${first.line} has an unsupported or malformed type.`,
		);
	}
	if (!header) throw auxiliaryError("The Registry header is missing.");
	return { header, entries };
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(item) => item.qName === name || item.localName === name,
	)?.value;
}

function ancestorElements(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation[] {
	const ancestors: XmlElementLocation[] = [];
	let current: XmlElementLocation | undefined = element;
	while (current) {
		ancestors.push(current);
		current =
			current.parentId === undefined
				? undefined
				: syntax.elements[current.parentId];
	}
	return ancestors;
}

function freeMindCandidates(
	syntax: XmlSyntaxDocument,
	includeNotes: boolean,
): Candidate[] {
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	if (!root || root.localName !== "map" || !attribute(root, "version"))
		throw auxiliaryError(
			'FreeMind detection requires a <map version="…"> root element.',
		);
	const nodes = syntax.elements.filter(
		(element) => element.localName === "node",
	);
	if (!nodes.length)
		throw auxiliaryError("The FreeMind map contains no node elements.");
	const ids = new Set<string>();
	for (const node of nodes) {
		const id = attribute(node, "ID");
		if (id && ids.has(id))
			throw auxiliaryError(`FreeMind node ID “${id}” is duplicated.`);
		if (id) ids.add(id);
	}
	const results: Candidate[] = [];
	for (const node of nodes) {
		const nodeId = attribute(node, "ID") ?? `node-${node.id + 1}`;
		const link = attribute(node, "LINK");
		const hasRichNode = syntax.elements.some(
			(element) =>
				element.parentId === node.id &&
				element.localName === "richcontent" &&
				attribute(element, "TYPE") === "NODE",
		);
		const textAttribute = node.attributes.find((item) => item.qName === "TEXT");
		if (textAttribute && !hasRichNode && textAttribute.value.trim()) {
			const path = [...node.path, "@TEXT"];
			results.push({
				value: textAttribute.value,
				replacement: {
					profile: "freemind",
					location: "xml-attribute",
					start: textAttribute.start,
					end: textAttribute.end,
					originalValue: textAttribute.value,
					path,
				},
				meta: {
					profile: "freemind",
					location: "xml-attribute",
					start: textAttribute.start,
					end: textAttribute.end,
					originalValue: textAttribute.value,
					path,
					nodeId,
					...(link ? { link } : {}),
				},
				unitId: `${nodeId}:text`,
				path,
				contexts: [
					{ type: "freemind-node-id", value: nodeId },
					...(link ? [{ type: "freemind-link", value: link }] : []),
				],
			});
		}
	}
	for (const value of syntax.values) {
		const element = syntax.elements[value.elementId];
		if (!element) continue;
		const ancestors = ancestorElements(element, syntax);
		if (!ancestors.some((item) => item.localName === "body")) continue;
		if (
			ancestors.some((item) =>
				[
					"script",
					"style",
					"object",
					"embed",
					"applet",
					"iframe",
					"form",
				].includes(item.localName.toLowerCase()),
			)
		)
			continue;
		const rich = ancestors.find((item) => item.localName === "richcontent");
		const node = ancestors.find((item) => item.localName === "node");
		if (!rich || !node) continue;
		const richType = attribute(rich, "TYPE");
		if (richType !== "NODE" && richType !== "NOTE") continue;
		if (richType === "NOTE" && !includeNotes) continue;
		const nodeId = attribute(node, "ID") ?? `node-${node.id + 1}`;
		const link = attribute(node, "LINK");
		const path = [...value.path];
		const location = value.location === "cdata" ? "xml-cdata" : "xml-text";
		results.push({
			value: value.value,
			replacement: {
				profile: "freemind",
				location,
				start: value.start,
				end: value.end,
				originalValue: value.value,
				path,
			},
			meta: {
				profile: "freemind",
				location,
				start: value.start,
				end: value.end,
				originalValue: value.value,
				path,
				nodeId,
				...(link ? { link } : {}),
				richContentType: richType,
			},
			unitId: `${nodeId}:${richType.toLowerCase()}:${value.start}`,
			path,
			contexts: [
				{ type: "freemind-node-id", value: nodeId },
				{ type: "rich-content", value: richType },
				...(link ? [{ type: "freemind-link", value: link }] : []),
			],
		});
	}
	return results.sort(
		(first, second) => first.replacement.start - second.replacement.start,
	);
}

function sectionMatches(
	section: string,
	selectors: readonly string[],
): boolean {
	return selectors.some((selector) => {
		const pattern = selector
			.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
			.replaceAll("*", ".*");
		return new RegExp(`^${pattern}$`, "i").test(section);
	});
}

function isProtectedInfMetadata(entry: InfEntry): boolean {
	return (
		/^\{?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}?$/i.test(
			entry.value.trim(),
		) ||
		/(?:^|[_.-])(?:guid|clsid|classid|hardwareid|service|servicename|dirid)$/i.test(
			entry.key,
		)
	);
}

export async function detectAuxiliaryResourceProfile(
	file: File,
	context?: SafeInputContext,
): Promise<AuxiliaryResourceProfile | undefined> {
	try {
		const { text } = await readSafeTextFile(file, context);
		return parseAuxiliaryProfile(text, context);
	} catch (error) {
		if (error instanceof SafeInputError && error.code === "ABORTED")
			throw error;
		return undefined;
	}
}

function parseAuxiliaryProfile(
	text: string,
	context?: SafeInputContext,
): AuxiliaryResourceProfile {
	const trimmed = text.replace(/^\ufeff/, "").trimStart();
	if (
		trimmed.startsWith("Windows Registry Editor Version 5.00") ||
		trimmed.startsWith("REGEDIT4")
	) {
		parseReg(text);
		return "reg";
	}
	if (trimmed.startsWith("<")) {
		const syntax = parseXmlSyntax(text, context);
		freeMindCandidates(syntax, true);
		return "freemind";
	}
	parseInf(text);
	return "inf";
}

export async function validateAuxiliaryResourceFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const read = await readSafeTextFile(file, context);
		parseAuxiliaryProfile(read.text, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The auxiliary resource file is malformed." };
	}
}

export async function importAuxiliaryResourceFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("auxiliary-resources", options);
	const read = await readSafeTextFile(file, context);
	const detected = parseAuxiliaryProfile(read.text, context);
	const requested = String(filterOptions.profile);
	const profile =
		requested === "auto" ? detected : (requested as AuxiliaryResourceProfile);
	if (profile !== detected)
		throw auxiliaryError(
			`The selected ${requested} profile does not match the detected ${detected} structure.`,
		);
	let candidates: Candidate[] = [];
	let warnings: string[] = [];
	let profileMetadata: Record<string, unknown> = {};
	if (profile === "inf") {
		const parsed = parseInf(read.text);
		warnings = parsed.warnings;
		const selectors = parseList(filterOptions.infSections);
		for (const entry of parsed.entries.filter(
			(item) =>
				sectionMatches(item.section, selectors) &&
				!isProtectedInfMetadata(item),
		)) {
			const common = {
				profile: "inf" as const,
				location: "inf-string" as const,
				start: entry.start,
				end: entry.end,
				originalValue: entry.value,
				key: entry.key,
			};
			candidates.push({
				value: entry.value,
				replacement: common,
				meta: { ...common, section: entry.section, line: entry.line },
				unitId: `${entry.section}:${entry.key}`,
				path: [entry.section, entry.key],
				line: entry.line,
				contexts: [
					{ type: "inf-section", value: entry.section },
					{ type: "inf-string-key", value: entry.key },
				],
				...(entry.comment ? { note: entry.comment } : {}),
			});
		}
		profileMetadata = {
			protectedContent:
				"Setup directives, tokens, paths, GUIDs, and comments are preserved and never interpreted.",
		};
	} else if (profile === "reg") {
		const parsed = parseReg(read.text);
		for (const entry of parsed.entries) {
			const common = {
				profile: "reg" as const,
				location: entry.location,
				start: entry.start,
				end: entry.end,
				originalValue: entry.value,
				key: entry.valueName,
			};
			candidates.push({
				value: entry.value,
				replacement: common,
				meta: {
					...common,
					line: entry.line,
					registryPath: entry.keyPath,
					registryType: entry.type,
				},
				unitId: `${entry.keyPath}:${entry.valueName}`,
				path: [entry.keyPath, entry.valueName],
				line: entry.line,
				contexts: [
					{ type: "registry-key", value: entry.keyPath },
					{ type: "registry-value", value: entry.valueName },
					{ type: "registry-type", value: entry.type },
				],
			});
		}
		profileMetadata = {
			header: parsed.header,
			protectedContent:
				"Keys, value names, numeric/binary data, deletions, and comments remain inert. Open TLC never imports a REG file into the operating system registry.",
		};
	} else {
		const syntax = parseXmlSyntax(read.text, context);
		candidates = freeMindCandidates(
			syntax,
			Boolean(filterOptions.includeFreeMindNotes),
		);
		profileMetadata = {
			version: attribute(syntax.elements[0], "version"),
			protectedContent:
				"Node IDs, links, arrows, hooks, scripts, forms, styles, icons, and unknown XML remain inert and byte-position preserved.",
		};
	}
	throwIfAborted(context?.signal);
	if (!candidates.length)
		throw auxiliaryError(
			`The ${profile.toUpperCase()} file has no translatable values under the selected options.`,
		);
	const segments = candidates.map((candidate) => candidate.value);
	const replacements: AuxiliaryValueReplacement[] = candidates.map(
		(candidate, unitIndex) => ({
			kind: "auxiliary-value",
			unitIndex,
			...candidate.replacement,
		}),
	);
	const document = createNeutralDocument({
		format: "auxiliary-resources",
		sourceSegments: segments,
		targetSegments: segments.map(() => ""),
		unitIds: candidates.map((candidate) => candidate.unitId),
		sourceLocations: candidates.map((candidate, segmentIndex) => ({
			part: file.name,
			path: candidate.path,
			...(candidate.line ? { line: candidate.line } : {}),
			segmentIndex,
		})),
	});
	document.metadata = {
		profile,
		encoding: read.encoding,
		hasBom: read.hasBom,
		warnings,
		...profileMetadata,
	};
	for (const [index, candidate] of candidates.entries()) {
		document.units[index].contexts.push(...candidate.contexts);
		if (candidate.note)
			document.units[index].notes.push({
				category: "developer-comment",
				text: candidate.note,
				appliesTo: "source",
			});
	}
	return {
		kind: "segments",
		segments,
		targetSegments: segments.map(() => ""),
		document,
		skeleton: await createTextSkeleton(
			file,
			"auxiliary-resources",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions: { ...filterOptions, profile },
		typeRef: { profile: `${profile}-auxiliary-resource` } as TypeRef,
		segmentsMeta: candidates.map((candidate) => candidate.meta),
	};
}

function encodeInfValue(value: string): string {
	if (/[\r\n]/.test(value))
		throw new Error("INF string translations cannot contain line breaks.");
	if ([...value].length + 1 > 4096)
		throw new Error(
			"INF string translations are limited to 4095 characters plus their terminator.",
		);
	return `"${value.replaceAll('"', '""')}"`;
}

function encodeRegString(value: string): string {
	if (/[\r\n\u0000]/.test(value))
		throw new Error(
			"REG_SZ translations cannot contain line breaks or NUL characters.",
		);
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function utf16Le(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length * 2);
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		bytes[index * 2] = code & 0xff;
		bytes[index * 2 + 1] = code >>> 8;
	}
	return bytes;
}

function encodeRegHex(type: "2" | "7", value: string): string {
	if (value.includes("\u0000"))
		throw new Error(
			"Registry string translations cannot contain embedded NUL characters.",
		);
	const normalized =
		type === "7"
			? `${value.split(/\r?\n/).join("\u0000")}\u0000\u0000`
			: `${value}\u0000`;
	const values = [...utf16Le(normalized)].map((byte) =>
		byte.toString(16).padStart(2, "0"),
	);
	const rows: string[] = [];
	for (let index = 0; index < values.length; index += 24)
		rows.push(values.slice(index, index + 24).join(","));
	return `hex(${type}):${rows.join(",\\\r\n  ")}`;
}

function encodeXml(
	value: string,
	location: AuxiliaryValueReplacement["location"],
): string {
	if (location === "xml-cdata")
		return value.replaceAll("]]>", "]]]]><![CDATA[>");
	let encoded = value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	if (location === "xml-attribute")
		encoded = encoded.replaceAll('"', "&quot;").replaceAll("'", "&apos;");
	return encoded;
}

export function buildAuxiliaryResourceTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "auxiliary-resources");
	if (content === undefined)
		throw new Error(
			"Auxiliary resource export requires its original positional text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is AuxiliaryValueReplacement =>
			replacement.kind === "auxiliary-value",
	);
	if (
		replacements.length !== data.seg2.length ||
		new Set(replacements.map((replacement) => replacement.unitIndex)).size !==
			replacements.length
	)
		throw new Error(
			"Auxiliary resource mappings do not align uniquely with target segments.",
		);
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const replacement of replacements) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		let value: string;
		if (replacement.location === "inf-string")
			value = encodeInfValue(translated);
		else if (replacement.location === "reg-string")
			value = encodeRegString(translated);
		else if (replacement.location === "reg-expand")
			value = encodeRegHex("2", translated);
		else if (replacement.location === "reg-multi")
			value = encodeRegHex("7", translated);
		else value = encodeXml(translated, replacement.location);
		edits.push({ start: replacement.start, end: replacement.end, value });
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	const profile = replacements[0]?.profile;
	if (profile === "inf") parseInf(output);
	else if (profile === "reg") parseReg(output);
	else if (profile === "freemind")
		freeMindCandidates(parseXmlSyntax(output), true);
	return output;
}

export function buildAuxiliaryResourceTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildAuxiliaryResourceTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "auxiliary-resources");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(output, encoding, hasBom)], {
		type: `${data.skeleton?.source.mimeType || "text/plain"};charset=${encoding}`,
	});
}

export async function generateAuxiliaryResourceTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "resource.inf";
	const requested = project.translationData.name || sourceName;
	const extension = sourceName.toLowerCase().split(".").at(-1);
	const suffix = AUXILIARY_RESOURCE_EXTENSIONS.includes(
		extension as (typeof AUXILIARY_RESOURCE_EXTENSIONS)[number],
	)
		? extension!
		: "inf";
	const name = new RegExp(`\\.${suffix}$`, "i").test(requested)
		? requested
		: `${requested}.${suffix}`;
	const url = URL.createObjectURL(
		buildAuxiliaryResourceTranslationBlob(project),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
