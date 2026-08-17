import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { PoSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	decodeTextBytes,
	readSafeFileBytes,
	SafeInputError,
	type SafeInputContext,
	type SupportedTextEncoding,
} from "./safeInput";
import { createTextSkeleton, type PoStringReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

interface PoStringFragment {
	start: number;
	end: number;
	value: string;
}

interface PoField {
	keyword: "msgctxt" | "msgid" | "msgid_plural" | "msgstr";
	pluralIndex?: number;
	value: string;
	fragments: PoStringFragment[];
}

export interface PoEntry {
	index: number;
	obsolete: boolean;
	comments: {
		translator: string[];
		extracted: string[];
		references: string[];
		flags: string[];
		previous: string[];
		other: string[];
	};
	fields: PoField[];
}

export interface PoCatalog {
	entries: PoEntry[];
	header: Record<string, string>;
	nplurals?: number;
	charset: SupportedTextEncoding;
}

interface SafePoText {
	bytes: Uint8Array;
	text: string;
	encoding: SupportedTextEncoding;
	hasBom: boolean;
}

export async function readPoText(
	file: File,
	context?: SafeInputContext,
): Promise<SafePoText> {
	const bytes = await readSafeFileBytes(file, context);
	const declared = declaredPoCharset(bytes);
	if (declared === "iso-8859-1" || declared === "windows-1252") {
		try {
			return {
				bytes,
				text: new TextDecoder(declared, { fatal: true }).decode(bytes),
				encoding: declared,
				hasBom: false,
			};
		} catch {
			throw new SafeInputError(
				"TEXT_INVALID_ENCODING",
				`The PO file is not valid ${declared.toUpperCase()} text.`,
			);
		}
	}
	if (declared && declared !== "utf-8")
		throw new SafeInputError(
			"TEXT_INVALID_ENCODING",
			`The PO charset “${declared}” is not supported safely. Convert the catalog to UTF-8, UTF-16, ISO-8859-1, or Windows-1252 first.`,
		);
	const decoded = decodeTextBytes(bytes);
	return decoded;
}

function declaredPoCharset(
	bytes: Uint8Array,
): SupportedTextEncoding | string | undefined {
	const ascii = Array.from(bytes.slice(0, Math.min(bytes.length, 16_384)))
		.map((byte) =>
			byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : " ",
		)
		.join("");
	const label = ascii.match(/charset\s*=\s*([A-Za-z0-9._-]+)/i)?.[1];
	if (!label || /^(?:charset|utf-?8)$/i.test(label))
		return label ? "utf-8" : undefined;
	if (/^(?:iso-?8859-?1|latin-?1)$/i.test(label)) return "iso-8859-1";
	if (/^(?:windows-?1252|cp1252)$/i.test(label)) return "windows-1252";
	if (/^utf-?16le$/i.test(label)) return "utf-16le";
	if (/^utf-?16be$/i.test(label)) return "utf-16be";
	return label.toLowerCase();
}

export function parsePoCatalog(
	content: string,
	charset: SupportedTextEncoding = "utf-8",
): PoCatalog {
	const entries: PoEntry[] = [];
	let current = emptyEntry(0);
	let activeField: PoField | undefined;
	for (const line of poLines(content)) {
		const raw = line.text.replace(/^\ufeff/, "");
		if (!raw.trim()) {
			finalizeCurrent();
			continue;
		}

		let body = raw;
		let bodyOffset = line.start + (line.text.length - raw.length);
		let obsolete = false;
		if (/^#~(?:\s|$)/.test(body)) {
			obsolete = true;
			const prefix = body.match(/^#~\s?/)![0];
			body = body.slice(prefix.length);
			bodyOffset += prefix.length;
		}

		if (!obsolete && body.startsWith("#")) {
			if (entryHasTranslation(current)) finalizeCurrent();
			addPoComment(current, body);
			activeField = undefined;
			continue;
		}

		const directive = body.match(
			/^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(.*)$/,
		);
		if (directive) {
			const keywordText = directive[1];
			const keyword = keywordText.startsWith("msgstr")
				? "msgstr"
				: (keywordText as PoField["keyword"]);
			if (
				(keyword === "msgctxt" || keyword === "msgid") &&
				entryHasTranslation(current)
			)
				finalizeCurrent();
			if (current.fields.length === 0 && current.comments.other.length === 0)
				current.obsolete = obsolete;
			if (current.obsolete !== obsolete)
				throw poMalformed(
					"Active and obsolete directives are mixed in one entry.",
					line.start,
				);
			const quoteSource = directive[3];
			const quoteOffset = bodyOffset + body.indexOf(quoteSource);
			const fragment = parsePoQuoted(quoteSource, quoteOffset);
			const pluralIndex =
				directive[2] === undefined ? undefined : Number(directive[2]);
			if (
				current.fields.some(
					(field) =>
						field.keyword === keyword && field.pluralIndex === pluralIndex,
				)
			)
				throw poMalformed(`Duplicate ${keywordText} directive.`, line.start);
			activeField = {
				keyword,
				...(pluralIndex !== undefined ? { pluralIndex } : {}),
				value: fragment.value,
				fragments: [fragment],
			};
			current.fields.push(activeField);
			continue;
		}

		if (/^\s*"/.test(body) && activeField) {
			const quoteSource = body.trimStart();
			const fragment = parsePoQuoted(
				quoteSource,
				bodyOffset + body.indexOf(quoteSource),
			);
			activeField.value += fragment.value;
			activeField.fragments.push(fragment);
			continue;
		}
		if (obsolete && body.startsWith("#")) {
			addPoComment(current, body);
			continue;
		}
		throw poMalformed("Unexpected PO syntax.", line.start);
	}
	finalizeCurrent();

	const headerEntry = entries.find(
		(entry) => !entry.obsolete && field(entry, "msgid")?.value === "",
	);
	const header = parsePoHeader(field(headerEntry, "msgstr")?.value ?? "");
	const npluralsText = header["Plural-Forms"]?.match(
		/(?:^|;)\s*nplurals\s*=\s*(\d+)/i,
	)?.[1];
	const nplurals = npluralsText ? Number(npluralsText) : undefined;
	validatePoEntries(entries, nplurals);
	return { entries, header, ...(nplurals ? { nplurals } : {}), charset };

	function finalizeCurrent(): void {
		if (!current.fields.length && !hasComments(current)) return;
		if (!current.fields.length)
			throw poMalformed(
				"A PO comment block is not followed by an entry.",
				content.length,
			);
		current.index = entries.length;
		entries.push(current);
		current = emptyEntry(entries.length);
		activeField = undefined;
	}
}

function emptyEntry(index: number): PoEntry {
	return {
		index,
		obsolete: false,
		comments: {
			translator: [],
			extracted: [],
			references: [],
			flags: [],
			previous: [],
			other: [],
		},
		fields: [],
	};
}

function hasComments(entry: PoEntry): boolean {
	return Object.values(entry.comments).some((values) => values.length > 0);
}

function entryHasTranslation(entry: PoEntry): boolean {
	return entry.fields.some((entryField) => entryField.keyword === "msgstr");
}

function addPoComment(entry: PoEntry, line: string): void {
	if (line.startsWith("#."))
		entry.comments.extracted.push(line.slice(2).trim());
	else if (line.startsWith("#:"))
		entry.comments.references.push(
			...line.slice(2).trim().split(/\s+/).filter(Boolean),
		);
	else if (line.startsWith("#,"))
		entry.comments.flags.push(
			...line
				.slice(2)
				.split(",")
				.map((flag) => flag.trim())
				.filter(Boolean),
		);
	else if (line.startsWith("#|"))
		entry.comments.previous.push(line.slice(2).trim());
	else if (/^#(?:\s|$)/.test(line))
		entry.comments.translator.push(line.slice(1).trim());
	else entry.comments.other.push(line);
}

function field(
	entry: PoEntry | undefined,
	keyword: PoField["keyword"],
	pluralIndex?: number,
): PoField | undefined {
	return entry?.fields.find(
		(entryField) =>
			entryField.keyword === keyword && entryField.pluralIndex === pluralIndex,
	);
}

function validatePoEntries(entries: PoEntry[], nplurals?: number): void {
	const keys = new Set<string>();
	for (const entry of entries.filter((candidate) => !candidate.obsolete)) {
		const msgid = field(entry, "msgid");
		if (!msgid) throw poMalformed(`Entry ${entry.index + 1} has no msgid.`, 0);
		const context = field(entry, "msgctxt")?.value;
		const key = `${context === undefined ? "<absent>" : context}\u0000${msgid.value}`;
		if (keys.has(key))
			throw poMalformed(
				`Duplicate PO message key for msgid “${msgid.value}”.`,
				0,
			);
		keys.add(key);
		const plural = field(entry, "msgid_plural");
		const translations = entry.fields
			.filter((entryField) => entryField.keyword === "msgstr")
			.sort(
				(first, second) =>
					(first.pluralIndex ?? -1) - (second.pluralIndex ?? -1),
			);
		if (!translations.length)
			throw poMalformed(`Entry ${entry.index + 1} has no msgstr.`, 0);
		if (
			!plural &&
			translations.some((translation) => translation.pluralIndex !== undefined)
		)
			throw poMalformed(
				`Entry ${entry.index + 1} has indexed msgstr fields but no msgid_plural.`,
				0,
			);
		if (plural) {
			if (
				translations.some(
					(translation) => translation.pluralIndex === undefined,
				)
			)
				throw poMalformed(
					`Plural entry ${entry.index + 1} contains an unindexed msgstr.`,
					0,
				);
			const indices = translations.map(
				(translation) => translation.pluralIndex!,
			);
			if (indices.some((value, index) => value !== index))
				throw poMalformed(
					`Plural entry ${entry.index + 1} has non-contiguous msgstr indices.`,
					0,
				);
			if (nplurals !== undefined && translations.length !== nplurals)
				throw poMalformed(
					`Plural entry ${entry.index + 1} has ${translations.length} forms; the header requires ${nplurals}.`,
					0,
				);
		} else if (
			translations.length !== 1 ||
			translations[0].pluralIndex !== undefined
		) {
			throw poMalformed(
				`Singular entry ${entry.index + 1} must have exactly one msgstr.`,
				0,
			);
		}
	}
}

function parsePoHeader(value: string): Record<string, string> {
	const header: Record<string, string> = {};
	for (const line of value.split("\n")) {
		const separator = line.indexOf(":");
		if (separator > 0)
			header[line.slice(0, separator).trim()] = line
				.slice(separator + 1)
				.trim();
	}
	return header;
}

function parsePoQuoted(
	source: string,
	absoluteOffset: number,
): PoStringFragment {
	if (!source.startsWith('"'))
		throw poMalformed("Expected a quoted PO string.", absoluteOffset);
	let value = "";
	let cursor = 1;
	while (cursor < source.length) {
		const character = source[cursor++];
		if (character === '"') {
			if (source.slice(cursor).trim())
				throw poMalformed(
					"Unexpected content after a PO string.",
					absoluteOffset + cursor,
				);
			return { start: absoluteOffset, end: absoluteOffset + cursor, value };
		}
		if (character === "\n" || character === "\r")
			throw poMalformed(
				"A physical line break occurs inside a PO string.",
				absoluteOffset + cursor - 1,
			);
		if (character !== "\\") {
			value += character;
			continue;
		}
		if (cursor >= source.length)
			throw poMalformed(
				"A PO escape is not terminated.",
				absoluteOffset + cursor - 1,
			);
		const escape = source[cursor++];
		const simple: Record<string, string> = {
			n: "\n",
			r: "\r",
			t: "\t",
			b: "\b",
			f: "\f",
			v: "\v",
			a: "\x07",
			"\\": "\\",
			'"': '"',
		};
		if (simple[escape] !== undefined) {
			value += simple[escape];
			continue;
		}
		if (/[0-7]/.test(escape)) {
			let digits = escape;
			while (digits.length < 3 && /[0-7]/.test(source[cursor] ?? ""))
				digits += source[cursor++];
			value += String.fromCodePoint(Number.parseInt(digits, 8));
			continue;
		}
		if (escape === "x") {
			let digits = "";
			while (/[0-9A-Fa-f]/.test(source[cursor] ?? ""))
				digits += source[cursor++];
			if (!digits)
				throw poMalformed(
					"A PO hexadecimal escape has no digits.",
					absoluteOffset + cursor,
				);
			value += String.fromCodePoint(Number.parseInt(digits, 16));
			continue;
		}
		value += escape;
	}
	throw poMalformed("A PO string is not terminated.", absoluteOffset);
}

function poLines(content: string): Array<{ text: string; start: number }> {
	const lines: Array<{ text: string; start: number }> = [];
	let start = 0;
	for (let index = 0; index <= content.length; index++) {
		if (
			index !== content.length &&
			content[index] !== "\n" &&
			content[index] !== "\r"
		)
			continue;
		lines.push({ text: content.slice(start, index), start });
		if (content[index] === "\r" && content[index + 1] === "\n") index++;
		start = index + 1;
	}
	return lines;
}

function poMalformed(message: string, offset: number): SafeInputError {
	return new SafeInputError(
		"PO_MALFORMED",
		`${message} (character ${offset + 1}).`,
	);
}

export async function validatePoFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const read = await readPoText(file, context);
		parsePoCatalog(read.text, read.encoding);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file does not contain a valid gettext catalog.",
				};
	}
}

export async function importPoFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("po", options);
	const read = await readPoText(file, context);
	const catalog = parsePoCatalog(read.text, read.encoding);
	const isTemplate = /\.pot$/i.test(file.name);
	const segments: string[] = [];
	const targetSegments: string[] = [];
	const meta: PoSegmentMeta[] = [];
	const replacements: PoStringReplacement[] = [];
	const unitEntries: Array<{
		entry: PoEntry;
		translation: PoField;
		source: string;
	}> = [];

	for (const entry of catalog.entries) {
		const msgid = field(entry, "msgid")!;
		if (!entry.obsolete && msgid.value === "") continue;
		if (entry.obsolete && !filterOptions.includeObsolete) continue;
		if (entry.comments.flags.includes("fuzzy") && !filterOptions.includeFuzzy)
			continue;
		const plural = field(entry, "msgid_plural");
		const translations = entry.fields
			.filter((entryField) => entryField.keyword === "msgstr")
			.sort(
				(first, second) =>
					(first.pluralIndex ?? -1) - (second.pluralIndex ?? -1),
			);
		for (const translation of translations) {
			const source =
				translation.pluralIndex === undefined || translation.pluralIndex === 0
					? msgid.value
					: (plural?.value ?? msgid.value);
			const mode = String(filterOptions.segmentationMode);
			const pieces =
				mode === "value"
					? [{ text: source, separator: "" }]
					: mode === "sentences"
						? segmentPlainText(source, "sentences")
						: splitTextWithPreferences(source);
			const effective = pieces.filter((piece) => piece.text.trim().length > 0);
			for (const piece of effective.length
				? effective
				: [{ text: source, separator: "" }]) {
				const unitIndex = segments.length;
				segments.push(`${piece.text}${piece.separator ?? ""}`);
				targetSegments.push(
					pieces.length === 1 && !isTemplate ? translation.value : "",
				);
				const context = field(entry, "msgctxt")?.value;
				meta.push({
					entryIndex: entry.index,
					...(translation.pluralIndex !== undefined
						? { pluralIndex: translation.pluralIndex }
						: {}),
					...(context !== undefined ? { msgctxt: context } : {}),
					msgid: msgid.value,
					separator: piece.separator ?? "",
				});
				replacements.push({
					kind: "po-string",
					unitIndex,
					entryIndex: entry.index,
					...(translation.pluralIndex !== undefined
						? { pluralIndex: translation.pluralIndex }
						: {}),
					originalValue: translation.value,
					separator: piece.separator ?? "",
					fragments: translation.fragments.map((fragment) => ({
						start: fragment.start,
						end: fragment.end,
						originalValue: fragment.value,
					})),
				});
				unitEntries.push({ entry, translation, source });
			}
		}
	}

	const document = createNeutralDocument({
		format: "po",
		sourceSegments: segments,
		targetSegments,
		sourceLocations: unitEntries.map(({ entry, translation }, index) => ({
			part: file.name,
			path: [
				String(entry.index),
				translation.pluralIndex === undefined
					? "msgstr"
					: `msgstr[${translation.pluralIndex}]`,
			],
			segmentIndex: index,
		})),
	});
	document.metadata = {
		header: { ...catalog.header },
		nplurals: catalog.nplurals ?? null,
		charset: catalog.charset,
		isTemplate,
	};
	for (const [index, { entry, translation }] of unitEntries.entries()) {
		const unit = document.units[index];
		if (!unit) continue;
		const context = field(entry, "msgctxt")?.value;
		if (context !== undefined)
			unit.contexts.push({ type: "gettext-context", value: context });
		if (translation.pluralIndex !== undefined)
			unit.contexts.push({
				type: "gettext-plural-index",
				value: String(translation.pluralIndex),
			});
		if (entry.comments.flags.length)
			unit.contexts.push({
				type: "gettext-flags",
				value: entry.comments.flags.join(", "),
			});
		for (const [category, values] of Object.entries(entry.comments))
			for (const text of values)
				unit.notes.push({
					category: `gettext-${category}`,
					text,
					appliesTo: "source",
				});
		if (entry.obsolete)
			unit.notes.push({
				category: "gettext-obsolete",
				text: "This message is obsolete and remains prefixed with #~ on export.",
				appliesTo: "unit",
				priority: 1,
			});
	}

	return {
		kind: "segments",
		segments,
		targetSegments,
		document,
		skeleton: await createTextSkeleton(file, "po", read.text, replacements, {
			name: file.name,
			mimeType: file.type,
			encoding: read.encoding,
			hasBom: read.hasBom,
			originalFile: new Blob([read.bytes], { type: file.type }),
		}),
		filterOptions,
		typeRef: {
			isTemplate: String(isTemplate),
			charset: catalog.charset,
		} as TypeRef,
		segmentsMeta: meta,
	};
}
