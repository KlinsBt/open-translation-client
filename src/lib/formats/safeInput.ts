import JSZip from "jszip";
import type { SkeletonSource } from "./skeleton";

export type SafeInputErrorCode =
	| "ABORTED"
	| "FILE_TOO_LARGE"
	| "FILE_CHANGED"
	| "ARCHIVE_INVALID"
	| "ARCHIVE_UNSUPPORTED"
	| "ARCHIVE_TOO_MANY_ENTRIES"
	| "ARCHIVE_EXPANDED_TOO_LARGE"
	| "ARCHIVE_RATIO_EXCEEDED"
	| "ARCHIVE_DUPLICATE_PATH"
	| "ARCHIVE_UNSAFE_PATH"
	| "ARCHIVE_ENCRYPTED_ENTRY"
	| "TEXT_INVALID_ENCODING"
	| "JSON_MALFORMED"
	| "YAML_MALFORMED"
	| "PO_MALFORMED"
	| "XML_UNSAFE_DECLARATION"
	| "XML_UNSUPPORTED_ITS"
	| "ANDROID_RESOURCE_INVALID"
	| "APPLE_LOCALIZATION_INVALID"
	| "PROPERTIES_MALFORMED"
	| "RESX_INVALID"
	| "XML_MALFORMED";

export class SafeInputError extends Error {
	readonly name = "SafeInputError";

	constructor(
		readonly code: SafeInputErrorCode,
		message: string,
		readonly details: Readonly<Record<string, string | number>> = {},
	) {
		super(message);
	}
}

export interface SafeInputProgress {
	phase: "reading" | "inspecting" | "extracting" | "parsing";
	completed: number;
	total: number;
	message: string;
}

export interface SafeInputContext {
	signal?: AbortSignal;
	onProgress?: (progress: SafeInputProgress) => void;
}

export interface SafeInputPolicy {
	maxFileBytes: number;
	maxArchiveEntries: number;
	maxExpandedBytes: number;
	maxExpansionRatio: number;
}

export const DEFAULT_SAFE_INPUT_POLICY: Readonly<SafeInputPolicy> = {
	maxFileBytes: 100 * 1024 * 1024,
	maxArchiveEntries: 10_000,
	maxExpandedBytes: 512 * 1024 * 1024,
	maxExpansionRatio: 200,
};

export type SupportedTextEncoding =
	| "utf-8"
	| "utf-16le"
	| "utf-16be"
	| "iso-8859-1"
	| "windows-1252";

export interface SafeTextFile {
	bytes: Uint8Array;
	text: string;
	encoding: SupportedTextEncoding;
	hasBom: boolean;
}

export interface SafeArchiveEntry {
	path: string;
	compressedSize: number;
	uncompressedSize: number;
	directory: boolean;
}

export interface SafeArchiveInspection {
	bytes: Uint8Array;
	entries: SafeArchiveEntry[];
	totalCompressedBytes: number;
	totalExpandedBytes: number;
}

export interface SafeZipPackage extends SafeArchiveInspection {
	parts: Record<string, string | Blob>;
	source: SkeletonSource;
}

function policyWith(
	override: Partial<SafeInputPolicy> | undefined,
): SafeInputPolicy {
	return { ...DEFAULT_SAFE_INPUT_POLICY, ...override };
}

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) {
		throw new SafeInputError("ABORTED", "The import was cancelled.");
	}
}

function report(
	context: SafeInputContext | undefined,
	progress: SafeInputProgress,
): void {
	context?.onProgress?.(progress);
}

export function assertSafeFileSize(
	file: Pick<File, "name" | "size">,
	policyOverride?: Partial<SafeInputPolicy>,
): void {
	const policy = policyWith(policyOverride);
	if (file.size > policy.maxFileBytes) {
		throw new SafeInputError(
			"FILE_TOO_LARGE",
			`“${file.name}” is too large to import safely (${formatBytes(file.size)}; limit ${formatBytes(policy.maxFileBytes)}).`,
			{ size: file.size, limit: policy.maxFileBytes },
		);
	}
}

export async function readSafeFileBytes(
	file: File,
	context?: SafeInputContext,
	policyOverride?: Partial<SafeInputPolicy>,
): Promise<Uint8Array> {
	throwIfAborted(context?.signal);
	assertSafeFileSize(file, policyOverride);
	report(context, {
		phase: "reading",
		completed: 0,
		total: file.size,
		message: `Reading ${file.name}`,
	});
	let bytes: Uint8Array;
	if (typeof file.stream === "function") {
		bytes = new Uint8Array(file.size);
		const reader = file.stream().getReader();
		let offset = 0;
		const cancelReader = () => void reader.cancel("Import cancelled");
		context?.signal?.addEventListener("abort", cancelReader, { once: true });
		try {
			while (true) {
				throwIfAborted(context?.signal);
				const { value, done } = await reader.read();
				if (done) break;
				if (offset + value.byteLength > bytes.byteLength) {
					throw new SafeInputError(
						"FILE_CHANGED",
						"The file changed while it was being read.",
					);
				}
				bytes.set(value, offset);
				offset += value.byteLength;
				report(context, {
					phase: "reading",
					completed: offset,
					total: file.size,
					message: `Reading ${file.name}`,
				});
			}
			throwIfAborted(context?.signal);
			if (offset !== bytes.byteLength) bytes = bytes.slice(0, offset);
		} finally {
			context?.signal?.removeEventListener("abort", cancelReader);
			reader.releaseLock();
		}
	} else {
		bytes = new Uint8Array(await file.arrayBuffer());
	}
	throwIfAborted(context?.signal);
	report(context, {
		phase: "reading",
		completed: bytes.byteLength,
		total: file.size,
		message: `Read ${file.name}`,
	});
	return bytes;
}

export async function readSafeTextFile(
	file: File,
	context?: SafeInputContext,
	policyOverride?: Partial<SafeInputPolicy>,
): Promise<SafeTextFile> {
	const bytes = await readSafeFileBytes(file, context, policyOverride);
	return decodeTextBytes(bytes);
}

export function decodeTextBytes(bytes: Uint8Array): SafeTextFile {
	let encoding: SupportedTextEncoding = "utf-8";
	let hasBom = false;
	let offset = 0;
	if (
		bytes.length >= 4 &&
		((bytes[0] === 0xff &&
			bytes[1] === 0xfe &&
			bytes[2] === 0x00 &&
			bytes[3] === 0x00) ||
			(bytes[0] === 0x00 &&
				bytes[1] === 0x00 &&
				bytes[2] === 0xfe &&
				bytes[3] === 0xff))
	) {
		throw new SafeInputError(
			"TEXT_INVALID_ENCODING",
			"UTF-32 input is not supported. Convert the file to UTF-8 or UTF-16.",
		);
	}
	if (
		bytes.length >= 3 &&
		bytes[0] === 0xef &&
		bytes[1] === 0xbb &&
		bytes[2] === 0xbf
	) {
		hasBom = true;
		offset = 3;
	} else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
		encoding = "utf-16le";
		hasBom = true;
		offset = 2;
	} else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
		encoding = "utf-16be";
		hasBom = true;
		offset = 2;
	}

	try {
		const decoded = new TextDecoder(encoding, { fatal: true }).decode(
			bytes.subarray(offset),
		);
		return {
			bytes,
			text: hasBom ? `\ufeff${decoded}` : decoded,
			encoding,
			hasBom,
		};
	} catch {
		throw new SafeInputError(
			"TEXT_INVALID_ENCODING",
			`The file is not valid ${encoding.toUpperCase()} text.`,
			{ encoding },
		);
	}
}

export function createSkeletonSource(
	file: Pick<File, "name" | "type">,
	read: Pick<SafeTextFile, "bytes" | "encoding" | "hasBom">,
): SkeletonSource {
	return {
		name: file.name,
		mimeType: file.type,
		encoding: read.encoding,
		hasBom: read.hasBom,
		originalFile: new Blob([read.bytes], { type: file.type }),
	};
}

export async function inspectSafeZipFile(
	file: File,
	context?: SafeInputContext,
	policyOverride?: Partial<SafeInputPolicy>,
): Promise<SafeArchiveInspection> {
	const bytes = await readSafeFileBytes(file, context, policyOverride);
	report(context, {
		phase: "inspecting",
		completed: 0,
		total: bytes.byteLength,
		message: "Inspecting archive structure",
	});
	const inspection = inspectZipBytes(bytes, policyOverride);
	report(context, {
		phase: "inspecting",
		completed: bytes.byteLength,
		total: bytes.byteLength,
		message: "Archive structure is safe",
	});
	return inspection;
}

export function inspectZipBytes(
	bytes: Uint8Array,
	policyOverride?: Partial<SafeInputPolicy>,
): SafeArchiveInspection {
	const policy = policyWith(policyOverride);
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const eocdOffset = findEndOfCentralDirectory(view);
	if (eocdOffset < 0) {
		throw new SafeInputError(
			"ARCHIVE_INVALID",
			"The file has no valid ZIP central directory.",
		);
	}
	const entryCount = view.getUint16(eocdOffset + 10, true);
	const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
	const diskNumber = view.getUint16(eocdOffset + 4, true);
	const centralDisk = view.getUint16(eocdOffset + 6, true);
	const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
	const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
	if (
		entryCount === 0xffff ||
		centralDirectorySize === 0xffffffff ||
		centralDirectoryOffset === 0xffffffff
	) {
		throw new SafeInputError(
			"ARCHIVE_UNSUPPORTED",
			"ZIP64 archives are not supported for project imports.",
		);
	}
	if (
		diskNumber !== 0 ||
		centralDisk !== 0 ||
		entriesOnDisk !== entryCount ||
		centralDirectoryOffset + centralDirectorySize > eocdOffset
	) {
		throw new SafeInputError(
			"ARCHIVE_UNSUPPORTED",
			"Split, spanned, or structurally inconsistent ZIP archives are not supported.",
		);
	}
	if (entryCount > policy.maxArchiveEntries) {
		throw new SafeInputError(
			"ARCHIVE_TOO_MANY_ENTRIES",
			`The archive contains too many entries (${entryCount}; limit ${policy.maxArchiveEntries}).`,
			{ entries: entryCount, limit: policy.maxArchiveEntries },
		);
	}

	const entries: SafeArchiveEntry[] = [];
	const paths = new Set<string>();
	let cursor = centralDirectoryOffset;
	let totalCompressedBytes = 0;
	let totalExpandedBytes = 0;
	for (let index = 0; index < entryCount; index++) {
		if (
			cursor + 46 > view.byteLength ||
			view.getUint32(cursor, true) !== 0x02014b50
		) {
			throw new SafeInputError(
				"ARCHIVE_INVALID",
				"The ZIP central directory is truncated or malformed.",
			);
		}
		const flags = view.getUint16(cursor + 8, true);
		if ((flags & 0x1) !== 0) {
			throw new SafeInputError(
				"ARCHIVE_ENCRYPTED_ENTRY",
				"Encrypted archive entries cannot be imported.",
			);
		}
		const compressedSize = view.getUint32(cursor + 20, true);
		const uncompressedSize = view.getUint32(cursor + 24, true);
		if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
			throw new SafeInputError(
				"ARCHIVE_UNSUPPORTED",
				"ZIP64 archive entries are not supported for project imports.",
			);
		}
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const nameStart = cursor + 46;
		const nameEnd = nameStart + nameLength;
		if (nameEnd > view.byteLength) {
			throw new SafeInputError(
				"ARCHIVE_INVALID",
				"The ZIP entry name is truncated.",
			);
		}
		const path = new TextDecoder("utf-8", { fatal: false }).decode(
			bytes.subarray(nameStart, nameEnd),
		);
		paths.add(validateArchivePath(path, paths));
		totalCompressedBytes += compressedSize;
		totalExpandedBytes += uncompressedSize;
		if (totalExpandedBytes > policy.maxExpandedBytes) {
			throw new SafeInputError(
				"ARCHIVE_EXPANDED_TOO_LARGE",
				`The archive expands beyond the safe limit of ${formatBytes(policy.maxExpandedBytes)}.`,
				{ expandedSize: totalExpandedBytes, limit: policy.maxExpandedBytes },
			);
		}
		const entryRatio = uncompressedSize / Math.max(1, compressedSize);
		if (entryRatio > policy.maxExpansionRatio) {
			throw new SafeInputError(
				"ARCHIVE_RATIO_EXCEEDED",
				`Archive entry “${path}” has an unsafe expansion ratio (${entryRatio.toFixed(1)}×).`,
				{ ratio: entryRatio, limit: policy.maxExpansionRatio },
			);
		}
		entries.push({
			path,
			compressedSize,
			uncompressedSize,
			directory: path.endsWith("/"),
		});
		cursor = nameEnd + extraLength + commentLength;
	}
	const totalRatio = totalExpandedBytes / Math.max(1, totalCompressedBytes);
	if (totalRatio > policy.maxExpansionRatio) {
		throw new SafeInputError(
			"ARCHIVE_RATIO_EXCEEDED",
			`The archive has an unsafe total expansion ratio (${totalRatio.toFixed(1)}×).`,
			{ ratio: totalRatio, limit: policy.maxExpansionRatio },
		);
	}
	return { bytes, entries, totalCompressedBytes, totalExpandedBytes };
}

export async function readSafeZipPackage(
	file: File,
	context?: SafeInputContext,
	policyOverride?: Partial<SafeInputPolicy>,
): Promise<SafeZipPackage> {
	const inspection = await inspectSafeZipFile(file, context, policyOverride);
	throwIfAborted(context?.signal);
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(inspection.bytes);
	} catch {
		throw new SafeInputError(
			"ARCHIVE_INVALID",
			"The file is not a readable ZIP package.",
		);
	}
	const parts: Record<string, string | Blob> = {};
	const files = inspection.entries.filter((entry) => !entry.directory);
	for (const [index, metadata] of files.entries()) {
		throwIfAborted(context?.signal);
		const entry = zip.file(metadata.path);
		if (!entry) {
			throw new SafeInputError(
				"ARCHIVE_INVALID",
				`Archive entry “${metadata.path}” could not be read.`,
			);
		}
		const asText = isTextPackagePart(metadata.path);
		parts[metadata.path] = await entry.async(asText ? "string" : "blob", () =>
			throwIfAborted(context?.signal),
		);
		report(context, {
			phase: "extracting",
			completed: index + 1,
			total: files.length,
			message: `Extracting ${metadata.path}`,
		});
	}
	return {
		...inspection,
		parts,
		source: {
			name: file.name,
			mimeType: file.type,
			originalFile: new Blob([inspection.bytes], { type: file.type }),
		},
	};
}

export function safeParseXml(
	xml: string,
	context?: SafeInputContext,
): Document {
	throwIfAborted(context?.signal);
	report(context, {
		phase: "parsing",
		completed: 0,
		total: xml.length,
		message: "Parsing XML",
	});
	if (/<!DOCTYPE\b|<!ENTITY\b/i.test(xml)) {
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"XML document type and entity declarations are disabled for safety.",
		);
	}
	const document = new DOMParser().parseFromString(xml, "application/xml");
	const parserError = document.getElementsByTagName("parsererror")[0];
	if (parserError) {
		throw new SafeInputError("XML_MALFORMED", "The XML document is malformed.");
	}
	throwIfAborted(context?.signal);
	report(context, {
		phase: "parsing",
		completed: xml.length,
		total: xml.length,
		message: "XML parsed",
	});
	return document;
}

export async function readSafeXmlFile(
	file: File,
	context?: SafeInputContext,
	policyOverride?: Partial<SafeInputPolicy>,
): Promise<Document> {
	const { text } = await readSafeTextFile(file, context, policyOverride);
	return safeParseXml(text, context);
}

export function parseSafeJson<T = unknown>(text: string): T {
	try {
		return JSON.parse(text.replace(/^\ufeff/, "")) as T;
	} catch {
		throw new SafeInputError(
			"JSON_MALFORMED",
			"The file does not contain valid JSON.",
		);
	}
}

export function safeInputMessage(error: unknown): string {
	return error instanceof SafeInputError
		? error.message
		: error instanceof Error
			? error.message
			: "The file could not be imported.";
}

function findEndOfCentralDirectory(view: DataView): number {
	const minimum = Math.max(0, view.byteLength - 65_557);
	for (let offset = view.byteLength - 22; offset >= minimum; offset--) {
		if (view.getUint32(offset, true) === 0x06054b50) return offset;
	}
	return -1;
}

function validateArchivePath(path: string, existing: Set<string>): string {
	const normalized = path.normalize("NFC");
	if (
		!path ||
		/[\u0000-\u001f\\]/.test(path) ||
		normalized.startsWith("/") ||
		/^[a-z]:\//i.test(normalized) ||
		normalized.split("/").includes("..")
	) {
		throw new SafeInputError(
			"ARCHIVE_UNSAFE_PATH",
			`Archive entry “${path || "(empty)"}” has an unsafe path.`,
		);
	}
	if (existing.has(normalized)) {
		throw new SafeInputError(
			"ARCHIVE_DUPLICATE_PATH",
			`Archive entry “${path}” occurs more than once.`,
		);
	}
	return normalized;
}

function isTextPackagePart(path: string): boolean {
	return path === "[Content_Types].xml" || /\.(?:xml|rels|txt)$/i.test(path);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
