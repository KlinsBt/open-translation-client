import * as CFB from "cfb";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import { assertProjectExportQuality } from "./qualityAssurance";
import {
	readSafeFileBytes,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import { createPackageSkeleton, skeletonHasIdentityTargets } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import type {
	OutlookMsgSegmentMeta,
	TypeRef,
	UserData,
} from "$lib/types/types";
import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { segmentHtmlContent } from "$lib/functions/parsing/parsingHtml";

export const OUTLOOK_MSG_EXTENSIONS = ["msg"] as const;
export const OUTLOOK_MSG_MIME_TYPES = [
	"application/vnd.ms-outlook",
	"application/x-msg",
] as const;

const MAX_CFB_ENTRIES = 10_000;
const MAX_RECIPIENTS = 500;
const MAX_ATTACHMENTS = 256;
const MAX_BODY_CHARACTERS = 20_000_000;
const MAX_HEADER_CHARACTERS = 16_384;
const PROPERTY_STREAM = "__properties_version1.0";
const MESSAGE_CLASS_STREAM = /^__substg1\.0_001a00(?:1f|1e)$/i;
const RECIPIENT_STORAGE = /^__recip_version1\.0_#[0-9a-f]{8}$/i;
const ATTACHMENT_STORAGE = /^__attach_version1\.0_#[0-9a-f]{8}$/i;
const EMBEDDED_MESSAGE_STORAGE = /^__substg1\.0_3701000d$/i;

interface MsgRecipient {
	name: string;
	email: string;
	type: "to" | "cc" | "bcc" | "unknown";
}

interface MsgAttachment {
	name: string;
	contentLength?: number;
	hidden: boolean;
}

export interface OutlookMsgInspection {
	bytes: Uint8Array;
	messageClass: string;
	senderName: string;
	senderEmail: string;
	recipients: MsgRecipient[];
	attachments: MsgAttachment[];
	subject: string;
	body: string;
	bodyKind: "plain" | "html";
	created?: string;
	sent?: string;
	delivered?: string;
}

interface OutlookCompoundFile {
	paths: string[][];
	streams: Map<string, Uint8Array>;
}

function invalidMsg(message: string): SafeInputError {
	return new SafeInputError("OUTLOOK_MSG_INVALID", message);
}

function normalizeCfbPath(path: string): string[] {
	const parts = path.split("/").filter(Boolean);
	return parts.slice(1).map((part) => part.toLowerCase());
}

function uniqueTopLevelStorages(
	paths: readonly string[][],
	pattern: RegExp,
): string[] {
	return [
		...new Set(
			paths
				.filter((path) => path.length > 0 && pattern.test(path[0]))
				.map((path) => path[0].toLowerCase()),
		),
	];
}

function parseCfbStructure(bytes: Uint8Array): OutlookCompoundFile {
	let container: CFB.CFB$Container;
	try {
		container = CFB.parse(bytes, { raw: false });
	} catch {
		throw invalidMsg(
			"The Outlook item has a malformed OLE compound-file structure.",
		);
	}
	if (container.FullPaths.length > MAX_CFB_ENTRIES)
		throw invalidMsg(
			`The Outlook item contains too many compound-file entries (${container.FullPaths.length}; limit ${MAX_CFB_ENTRIES}).`,
		);
	const paths = container.FullPaths.map(normalizeCfbPath);
	const streams = new Map<string, Uint8Array>();
	for (const [index, path] of paths.entries()) {
		const entry = container.FileIndex[index];
		// MS-CFB directory entry type 2 is a stream. The cfb package exposes
		// the enum to TypeScript but not from every browser/runtime build.
		if (!entry || entry.type !== 2) continue;
		streams.set(
			path.join("/"),
			entry.content instanceof Uint8Array
				? Uint8Array.from(entry.content)
				: Uint8Array.from(entry.content ?? []),
		);
	}
	const topLevelNames = paths
		.filter((path) => path.length === 1)
		.map((path) => path[0]);
	if (!topLevelNames.some((name) => name === PROPERTY_STREAM))
		throw invalidMsg("The Outlook item has no top-level MAPI property stream.");
	if (!topLevelNames.some((name) => MESSAGE_CLASS_STREAM.test(name)))
		throw invalidMsg(
			"The Outlook item has no MAPI message-class property stream.",
		);
	const recipients = uniqueTopLevelStorages(paths, RECIPIENT_STORAGE);
	const attachments = uniqueTopLevelStorages(paths, ATTACHMENT_STORAGE);
	if (recipients.length > MAX_RECIPIENTS)
		throw invalidMsg(
			`The Outlook item contains too many recipients (${recipients.length}; limit ${MAX_RECIPIENTS}).`,
		);
	if (attachments.length > MAX_ATTACHMENTS)
		throw invalidMsg(
			`The Outlook item contains too many attachments (${attachments.length}; limit ${MAX_ATTACHMENTS}).`,
		);
	if (
		paths.some((path) =>
			path.some((name) => EMBEDDED_MESSAGE_STORAGE.test(name)),
		)
	)
		throw invalidMsg(
			"Embedded or nested Outlook messages are not imported. Remove the nested message or save it as a separate MSG file.",
		);
	return { paths, streams };
}

function streamPath(prefix: string, name: string): string {
	return prefix ? `${prefix}/${name.toLowerCase()}` : name.toLowerCase();
}

function streamAt(
	compound: OutlookCompoundFile,
	prefix: string,
	name: string,
): Uint8Array | undefined {
	return compound.streams.get(streamPath(prefix, name));
}

function decodeUnicode(bytes: Uint8Array): string {
	let value = "";
	for (let index = 0; index + 1 < bytes.length; index += 2) {
		const code = bytes[index] | (bytes[index + 1] << 8);
		if (code === 0) break;
		value += String.fromCharCode(code);
	}
	return value;
}

function decodeAnsi(bytes: Uint8Array): string {
	const terminator = bytes.indexOf(0);
	const content = terminator >= 0 ? bytes.subarray(0, terminator) : bytes;
	return new TextDecoder("windows-1252", { fatal: false }).decode(content);
}

function propertyString(
	compound: OutlookCompoundFile,
	prefix: string,
	propertyId: string,
): string {
	const id = propertyId.toLowerCase().padStart(4, "0");
	const unicode = streamAt(compound, prefix, `__substg1.0_${id}001f`);
	if (unicode) return stringField(decodeUnicode(unicode));
	const ansi = streamAt(compound, prefix, `__substg1.0_${id}001e`);
	return ansi ? stringField(decodeAnsi(ansi)) : "";
}

function fixedProperties(
	compound: OutlookCompoundFile,
	prefix: string,
): Map<number, Uint8Array> {
	const stream = streamAt(compound, prefix, PROPERTY_STREAM);
	const values = new Map<number, Uint8Array>();
	if (!stream) return values;
	const headerLength = prefix ? 8 : 32;
	if (stream.length < headerLength || (stream.length - headerLength) % 16 !== 0)
		throw invalidMsg(
			`The MAPI property stream${prefix ? ` in ${prefix}` : ""} has an invalid length.`,
		);
	const view = new DataView(
		stream.buffer,
		stream.byteOffset,
		stream.byteLength,
	);
	for (let offset = headerLength; offset + 16 <= stream.length; offset += 16) {
		const tag = view.getUint32(offset, true);
		values.set(tag, stream.slice(offset + 8, offset + 16));
	}
	return values;
}

function fixedUint32(
	properties: ReadonlyMap<number, Uint8Array>,
	tag: number,
): number | undefined {
	const value = properties.get(tag);
	return value && value.length >= 4
		? new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(
				0,
				true,
			)
		: undefined;
}

function fixedBoolean(
	properties: ReadonlyMap<number, Uint8Array>,
	tag: number,
): boolean {
	const value = properties.get(tag);
	return Boolean(value && value.length >= 2 && (value[0] || value[1]));
}

function fixedFileTime(
	properties: ReadonlyMap<number, Uint8Array>,
	tag: number,
): string | undefined {
	const value = properties.get(tag);
	if (!value || value.length < 8) return undefined;
	const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
	const ticks =
		(BigInt(view.getUint32(4, true)) << 32n) | BigInt(view.getUint32(0, true));
	if (ticks === 0n) return undefined;
	const unixMilliseconds = ticks / 10_000n - 11_644_473_600_000n;
	const numeric = Number(unixMilliseconds);
	if (!Number.isFinite(numeric)) return undefined;
	const date = new Date(numeric);
	return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function stringField(value: unknown): string {
	return typeof value === "string" ? value.replace(/\0+$/g, "").trim() : "";
}

function recipientType(value: number | undefined): MsgRecipient["type"] {
	return value === 1
		? "to"
		: value === 2
			? "cc"
			: value === 3
				? "bcc"
				: "unknown";
}

function attachmentName(value: string): string {
	const raw = stringField(value);
	return (raw.replaceAll("\\", "/").split("/").at(-1) ?? "")
		.replace(/[\u0000-\u001f\u007f]/g, "")
		.slice(0, 255);
}

function htmlBody(compound: OutlookCompoundFile): string {
	const text = propertyString(compound, "", "1013");
	if (text) return text;
	const binary = streamAt(compound, "", "__substg1.0_10130102");
	if (!binary) return "";
	if (binary.length >= 2 && binary[0] === 0xff && binary[1] === 0xfe)
		return stringField(decodeUnicode(binary.subarray(2)));
	return stringField(new TextDecoder("utf-8", { fatal: false }).decode(binary));
}

function selectBody(
	plainBody: string,
	htmlContent: string,
	preference: string,
): { body: string; bodyKind: "plain" | "html" } {
	const plain = stringField(plainBody);
	const html = stringField(htmlContent);
	if (plain.length > MAX_BODY_CHARACTERS || html.length > MAX_BODY_CHARACTERS)
		throw invalidMsg(
			`The Outlook message body exceeds the ${MAX_BODY_CHARACTERS.toLocaleString()}-character safety limit.`,
		);
	if (preference === "plain-only") {
		if (!plain) throw invalidMsg("The Outlook item has no plain-text body.");
		return { body: plain, bodyKind: "plain" };
	}
	if (preference === "html-only") {
		if (!html) throw invalidMsg("The Outlook item has no HTML body.");
		return { body: html, bodyKind: "html" };
	}
	if (preference === "prefer-html" && html)
		return { body: html, bodyKind: "html" };
	if (plain) return { body: plain, bodyKind: "plain" };
	if (html) return { body: html, bodyKind: "html" };
	return { body: "", bodyKind: "plain" };
}

export async function inspectOutlookMsgFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<OutlookMsgInspection> {
	const normalized = normalizeImportOptions("outlook-msg", options);
	const bytes = await readSafeFileBytes(file, context);
	throwIfAborted(context?.signal);
	const compound = parseCfbStructure(bytes);
	throwIfAborted(context?.signal);
	const messageClass = propertyString(compound, "", "001a");
	if (!messageClass)
		throw invalidMsg("The Outlook item has an empty MAPI message class.");
	const recipientStorages = uniqueTopLevelStorages(
		compound.paths,
		RECIPIENT_STORAGE,
	);
	const recipients = recipientStorages.map((prefix) => {
		const properties = fixedProperties(compound, prefix);
		return {
			name: propertyString(compound, prefix, "3001"),
			email:
				propertyString(compound, prefix, "39fe") ||
				propertyString(compound, prefix, "3003"),
			type: recipientType(fixedUint32(properties, 0x0c150003)),
		};
	});
	const attachmentStorages = uniqueTopLevelStorages(
		compound.paths,
		ATTACHMENT_STORAGE,
	);
	const attachments = attachmentStorages.map((prefix) => {
		const properties = fixedProperties(compound, prefix);
		const content = streamAt(compound, prefix, "__substg1.0_37010102");
		return {
			name: attachmentName(
				propertyString(compound, prefix, "3707") ||
					propertyString(compound, prefix, "3704") ||
					propertyString(compound, prefix, "3001"),
			),
			contentLength: content?.length,
			hidden: fixedBoolean(properties, 0x7ffe000b),
		};
	});
	if (
		recipients.length > MAX_RECIPIENTS ||
		attachments.length > MAX_ATTACHMENTS
	)
		throw invalidMsg(
			"The decoded recipient or attachment count exceeds its safety limit.",
		);
	const rootProperties = fixedProperties(compound, "");
	const selectedBody = selectBody(
		propertyString(compound, "", "1000"),
		htmlBody(compound),
		String(normalized.bodyPreference),
	);
	throwIfAborted(context?.signal);
	return {
		bytes,
		messageClass,
		senderName: propertyString(compound, "", "0c1a"),
		senderEmail:
			propertyString(compound, "", "5d01") ||
			propertyString(compound, "", "0c1f"),
		recipients,
		attachments,
		subject: propertyString(compound, "", "0037"),
		...selectedBody,
		created: fixedFileTime(rootProperties, 0x30070040),
		sent: fixedFileTime(rootProperties, 0x00390040),
		delivered: fixedFileTime(rootProperties, 0x0e060040),
	};
}

export async function validateOutlookMsgFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await inspectOutlookMsgFile(file, undefined, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not a supported Outlook MSG item.",
				};
	}
}

function splitAttachmentFileName(name: string): {
	base: string;
	extension: string;
} {
	const dot = name.lastIndexOf(".");
	return dot > 0
		? { base: name.slice(0, dot), extension: name.slice(dot) }
		: { base: name, extension: "" };
}

export async function importOutlookMsgFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("outlook-msg", options);
	const inspected = await inspectOutlookMsgFile(file, filterOptions, context);
	const segments: string[] = [];
	const meta: OutlookMsgSegmentMeta[] = [];
	if (filterOptions.includeSubject === true && inspected.subject) {
		segments.push(inspected.subject);
		meta.push({ profile: "outlook-msg-source-only", kind: "subject" });
	}
	if (inspected.body) {
		if (inspected.bodyKind === "plain") {
			for (const part of segmentPlainText(inspected.body, "paragraphs")) {
				segments.push(part.text);
				meta.push({
					profile: "outlook-msg-source-only",
					kind: "body",
					bodyKind: "plain",
					separator: part.separator,
				});
			}
		} else {
			const html = segmentHtmlContent(inspected.body, [], {
				includeTextNodes: true,
				translatableAttributes: [],
				excludedElements: [
					"script",
					"style",
					"iframe",
					"object",
					"embed",
					"applet",
					"form",
					"svg",
				],
				respectTranslateMetadata: true,
				profile: "html",
			});
			for (const [index, text] of html.allSegments.entries()) {
				if (!text.trim()) continue;
				segments.push(text);
				meta.push({
					profile: "outlook-msg-source-only",
					kind: "body",
					bodyKind: "html",
					separator: html.meta[index]?.separator || "\n\n",
				});
			}
		}
	}
	if (filterOptions.includeAttachmentNames === true) {
		for (const [
			attachmentIndex,
			attachment,
		] of inspected.attachments.entries()) {
			if (!attachment.name || attachment.hidden) continue;
			const name = splitAttachmentFileName(attachment.name);
			if (!name.base) continue;
			segments.push(name.base);
			meta.push({
				profile: "outlook-msg-source-only",
				kind: "attachment-name",
				attachmentIndex,
				originalFileName: attachment.name,
				extension: name.extension,
			});
		}
	}
	if (!segments.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"The Outlook item has no subject, selected body, or attachment names to translate.",
		);
	const sourceLocations = meta.map((entry, segmentIndex) => ({
		part: entry.kind,
		path:
			entry.kind === "attachment-name"
				? ["attachments", entry.attachmentIndex ?? segmentIndex, "name"]
				: [entry.kind],
		segmentIndex,
		metadata: {
			messageClass: inspected.messageClass,
			bodyKind: entry.bodyKind,
		},
	}));
	const document = createNeutralDocument({
		format: "outlook-msg",
		sourceSegments: segments,
		sourceLocations,
		unitIds: meta.map((entry, index) =>
			entry.kind === "attachment-name"
				? `attachment-${entry.attachmentIndex ?? index}`
				: `${entry.kind}-${index + 1}`,
		),
	});
	const recipientSummary = inspected.recipients
		.map(
			(recipient) => `${recipient.type}: ${recipient.name || recipient.email}`,
		)
		.filter(Boolean)
		.join("; ");
	for (const unit of document.units) {
		unit.contexts.push({
			type: "outlook-message-class",
			value: inspected.messageClass,
		});
		if (inspected.senderName || inspected.senderEmail)
			unit.contexts.push({
				type: "outlook-sender",
				value:
					[inspected.senderName, inspected.senderEmail]
						.filter(Boolean)
						.join(" <") +
					(inspected.senderName && inspected.senderEmail ? ">" : ""),
			});
		if (recipientSummary)
			unit.contexts.push({
				type: "outlook-recipients",
				value: recipientSummary,
			});
		if (inspected.sent)
			unit.contexts.push({ type: "outlook-sent", value: inspected.sent });
	}
	for (const [index, entry] of meta.entries()) {
		if (entry.kind !== "attachment-name") continue;
		const attachment = inspected.attachments[entry.attachmentIndex ?? -1];
		if (!attachment) continue;
		document.units[index]?.notes.push({
			category: "attachment",
			text: `Only the attachment display name is editable. Its ${attachment.contentLength ?? "unknown"} bytes remain opaque in the retained source MSG.`,
			appliesTo: "unit",
		});
	}
	document.metadata = {
		profile: "MS-OXMSG source-only",
		messageClass: inspected.messageClass,
		bodyKind: inspected.bodyKind,
		attachmentCount: inspected.attachments.length,
		recipientCount: inspected.recipients.length,
		exportPolicy: "exact-msg-identity-or-safe-eml-delivery",
		security:
			"Attachments, embedded objects, unknown MAPI properties, scripts, external resources, and nested messages are never executed or fetched.",
	};
	const typeRef: TypeRef = {
		profile: "outlook-msg-source-only",
		messageClass: inspected.messageClass,
		senderName: inspected.senderName,
		senderEmail: inspected.senderEmail,
		recipients: inspected.recipients,
		attachments: inspected.attachments,
		created: inspected.created ?? "",
		sent: inspected.sent ?? "",
		delivered: inspected.delivered ?? "",
		bodyKind: inspected.bodyKind,
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(file, "outlook-msg", {}, []),
		filterOptions,
		typeRef,
		segmentsMeta: meta,
	};
}

function typeRefRecord(project: UserData): Record<string, unknown> {
	return typeof project.translationData.typeRef === "object" &&
		!Array.isArray(project.translationData.typeRef) &&
		project.translationData.typeRef !== null
		? (project.translationData.typeRef as Record<string, unknown>)
		: {};
}

function safeHeader(value: string): string {
	return value
		.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ")
		.trim()
		.slice(0, MAX_HEADER_CHARACTERS);
}

function encodeHeaderWord(value: string): string {
	const safe = safeHeader(value);
	if (!safe) return "";
	const chunks: string[] = [];
	const encoder = new TextEncoder();
	let current = "";
	for (const character of safe) {
		const candidate = `${current}${character}`;
		if (current && encoder.encode(candidate).length > 36) {
			chunks.push(current);
			current = character;
		} else current = candidate;
	}
	if (current) chunks.push(current);
	return chunks
		.map((chunk) => `=?UTF-8?B?${base64(encoder.encode(chunk))}?=`)
		.join("\r\n ");
}

function base64(bytes: Uint8Array): string {
	const alphabet =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index] ?? 0;
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const word = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
		output += alphabet[(word >>> 18) & 63];
		output += alphabet[(word >>> 12) & 63];
		output += second === undefined ? "=" : alphabet[(word >>> 6) & 63];
		output += third === undefined ? "=" : alphabet[word & 63];
	}
	return output;
}

function foldBase64(value: string): string {
	return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function emailAddress(value: string): string {
	const safe = safeHeader(value).replace(/[<>,;"'\s]/g, "");
	return /^[^@]+@[^@]+\.[^@]+$/.test(safe) ? safe : "";
}

function addressHeader(name: string, email: string): string {
	const address = emailAddress(email);
	if (!address) return "";
	const encodedName = encodeHeaderWord(name);
	return encodedName ? `${encodedName} <${address}>` : address;
}

function arrayField<T>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : [];
}

function outputParts(project: UserData): {
	subject: string;
	body: string;
	attachments: string[];
} {
	const meta = (project.translationData.segmentsMeta ?? []).filter(
		(entry): entry is OutlookMsgSegmentMeta =>
			"profile" in entry && entry.profile === "outlook-msg-source-only",
	);
	let subject = "";
	let body = "";
	const attachments: string[] = [];
	for (const [index, entry] of meta.entries()) {
		const translated =
			project.translationData.seg2[index] ||
			project.translationData.seg1[index] ||
			"";
		if (entry.kind === "subject") subject = translated;
		else if (entry.kind === "body")
			body += `${translated}${entry.separator ?? "\n\n"}`;
		else {
			const safeName = translated
				.replaceAll("\\", "/")
				.split("/")
				.at(-1)
				?.replace(/[\u0000-\u001f\u007f]/g, "")
				.trim();
			attachments.push(
				`${safeName || "attachment"}${entry.extension ?? ""}`.slice(0, 255),
			);
		}
	}
	return { subject, body: body.trimEnd(), attachments };
}

export async function buildOutlookMsgDelivery(project: UserData): Promise<{
	blob: Blob;
	extension: "msg" | "eml";
}> {
	assertProjectExportQuality(project);
	const original = project.translationData.skeleton?.source.originalFile;
	if (!(original instanceof Blob))
		throw new Error(
			"Outlook MSG export requires the original file retained in IndexedDB.",
		);
	if (
		skeletonHasIdentityTargets(
			project.translationData.seg1,
			project.translationData.seg2,
		)
	)
		return { blob: original, extension: "msg" };
	const reference = typeRefRecord(project);
	const parts = outputParts(project);
	const recipients = arrayField<MsgRecipient>(reference.recipients);
	const originalAttachments = arrayField<MsgAttachment>(reference.attachments);
	const headers = [
		"MIME-Version: 1.0",
		"X-Mailer: Open TLC safe MSG delivery",
		`X-OpenTLC-Source-Format: MS-OXMSG`,
		`X-OpenTLC-Attachments-Omitted: ${originalAttachments.length}`,
	];
	const from = addressHeader(
		stringField(reference.senderName),
		stringField(reference.senderEmail),
	);
	if (from) headers.push(`From: ${from}`);
	for (const type of ["to", "cc", "bcc"] as const) {
		const values = recipients
			.filter((recipient) => recipient.type === type)
			.map((recipient) => addressHeader(recipient.name, recipient.email))
			.filter(Boolean);
		if (values.length)
			headers.push(
				`${type[0].toUpperCase()}${type.slice(1)}: ${values.join(", ")}`,
			);
	}
	if (parts.subject)
		headers.push(`Subject: ${encodeHeaderWord(parts.subject)}`);
	const dateValue = safeHeader(
		stringField(reference.sent || reference.delivered || reference.created),
	);
	const date = new Date(dateValue);
	if (dateValue && !Number.isNaN(date.getTime()))
		headers.push(`Date: ${date.toUTCString()}`);
	headers.push("Content-Type: text/plain; charset=UTF-8");
	headers.push("Content-Transfer-Encoding: base64");
	const attachmentInventory = parts.attachments.length
		? `\n\n---\nAttachment names translated in Open TLC:\n${parts.attachments.map((name) => `- ${name}`).join("\n")}`
		: originalAttachments.length
			? `\n\n---\nOpen TLC retained ${originalAttachments.length} opaque attachment${originalAttachments.length === 1 ? "" : "s"} in the source MSG; attachment payloads are not embedded in this safe EML delivery.`
			: "";
	const encodedBody = foldBase64(
		base64(new TextEncoder().encode(`${parts.body}${attachmentInventory}\n`)),
	);
	return {
		blob: new Blob([`${headers.join("\r\n")}\r\n\r\n${encodedBody}\r\n`], {
			type: "message/rfc822",
		}),
		extension: "eml",
	};
}

export async function generateOutlookMsgTranslation(
	project: UserData,
): Promise<void> {
	const output = await buildOutlookMsgDelivery(project);
	const url = URL.createObjectURL(output.blob);
	const link = document.createElement("a");
	link.href = url;
	const base = (project.translationData.name || "message").replace(
		/\.msg$/i,
		"",
	);
	link.download = `${base}.translated.${output.extension}`;
	link.click();
	URL.revokeObjectURL(url);
}
