import {
	SafeInputError,
	assertSafeFileSize,
	safeParseXml,
	throwIfAborted,
	type SafeInputContext,
	type SupportedTextEncoding,
} from "./safeInput";

export const LARGE_TEXT_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_STREAM_CHUNK_BYTES = 256 * 1024;
export const DEFAULT_MAX_XML_RECORD_CHARS = 16 * 1024 * 1024;
export const DEFAULT_MAX_XML_HEADER_CHARS = 16 * 1024 * 1024;
export const DEFAULT_MAX_XML_SKELETON_CHARS = 32 * 1024 * 1024;

export interface StreamingTextOptions {
	chunkBytes?: number;
	maxFileBytes?: number;
	yieldEveryChunks?: number;
}

export interface StreamingTextInfo {
	encoding: SupportedTextEncoding;
	hasBom: boolean;
}

export interface StreamingTextFile extends StreamingTextInfo {
	text: string;
}

export interface BatchProcessingOptions {
	batchSize?: number;
	signal?: AbortSignal;
	yieldControl?: () => Promise<void>;
}

export interface XmlRecordScanOptions extends StreamingTextOptions {
	recordNames: readonly string[];
	/** Allows one inert, exactly matched external DOCTYPE; entity declarations remain forbidden. */
	allowedDoctype?: RegExp;
	maxRecordChars?: number;
	maxHeaderChars?: number;
	collectSkeleton?: boolean;
	maxSkeletonChars?: number;
	batchSize?: number;
}

export interface XmlRecordScanResult {
	header: string;
	/** XML outside the streamed records, with a numbered placeholder per record. */
	skeleton?: string;
	namespaceDeclarations: string;
	recordCount: number;
	maxBufferedChars: number;
	yieldCount: number;
	durationMs: number;
	textInfo: StreamingTextInfo;
}

export type XmlRecordHandler = (
	recordXml: string,
	recordIndex: number,
	namespaceDeclarations: string,
) => void | Promise<void>;

interface EncodingPrefix extends StreamingTextInfo {
	offset: number;
}

export async function processInBatches<T>(
	items: readonly T[],
	processBatch: (
		batch: readonly T[],
		batchIndex: number,
	) => void | Promise<void>,
	options: BatchProcessingOptions = {},
): Promise<number> {
	const batchSize = Math.max(1, options.batchSize ?? 100);
	const yieldControl = options.yieldControl ?? yieldToMainThread;
	let batchCount = 0;
	for (let start = 0; start < items.length; start += batchSize) {
		throwIfAborted(options.signal);
		await processBatch(items.slice(start, start + batchSize), batchCount);
		batchCount++;
		if (start + batchSize < items.length) await yieldControl();
	}
	throwIfAborted(options.signal);
	return batchCount;
}

export async function* streamSafeTextChunks(
	file: File,
	context?: SafeInputContext,
	options: StreamingTextOptions = {},
): AsyncGenerator<string, StreamingTextInfo> {
	const chunkBytes = Math.max(
		4,
		options.chunkBytes ?? DEFAULT_STREAM_CHUNK_BYTES,
	);
	const maxFileBytes = options.maxFileBytes ?? LARGE_TEXT_MAX_BYTES;
	const yieldEveryChunks = Math.max(1, options.yieldEveryChunks ?? 8);
	assertSafeFileSize(file, { maxFileBytes });
	throwIfAborted(context?.signal);

	let decoder: TextDecoder | undefined;
	let textInfo: StreamingTextInfo = { encoding: "utf-8", hasBom: false };
	let chunkIndex = 0;
	for (let start = 0; start < file.size; start += chunkBytes) {
		throwIfAborted(context?.signal);
		const end = Math.min(file.size, start + chunkBytes);
		let bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
		if (!decoder) {
			const prefix = detectEncodingPrefix(bytes);
			textInfo = { encoding: prefix.encoding, hasBom: prefix.hasBom };
			decoder = new TextDecoder(prefix.encoding, { fatal: true });
			bytes = bytes.subarray(prefix.offset);
		}
		let text: string;
		try {
			text = decoder.decode(bytes, { stream: end < file.size });
		} catch {
			throw new SafeInputError(
				"TEXT_INVALID_ENCODING",
				`The file is not valid ${textInfo.encoding.toUpperCase()} text.`,
				{ encoding: textInfo.encoding },
			);
		}
		context?.onProgress?.({
			phase: "reading",
			completed: end,
			total: file.size,
			message: `Streaming ${file.name}`,
		});
		if (text) yield text;
		chunkIndex++;
		if (chunkIndex % yieldEveryChunks === 0) await yieldToMainThread();
	}
	if (!decoder) {
		return textInfo;
	}
	const finalText = decoder.decode();
	if (finalText) yield finalText;
	throwIfAborted(context?.signal);
	return textInfo;
}

export async function readStreamingTextFile(
	file: File,
	context?: SafeInputContext,
	options: StreamingTextOptions = {},
): Promise<StreamingTextFile> {
	const chunks: string[] = [];
	const stream = streamSafeTextChunks(file, context, options);
	let textInfo: StreamingTextInfo = { encoding: "utf-8", hasBom: false };
	while (true) {
		const next = await stream.next();
		if (next.done) {
			textInfo = next.value;
			break;
		}
		chunks.push(next.value);
	}
	return {
		...textInfo,
		text: `${textInfo.hasBom ? "\ufeff" : ""}${chunks.join("")}`,
	};
}

export async function scanXmlRecords(
	file: File,
	options: XmlRecordScanOptions,
	onRecord: XmlRecordHandler,
	context?: SafeInputContext,
): Promise<XmlRecordScanResult> {
	if (options.recordNames.length === 0)
		throw new Error("At least one XML record name is required.");
	const startedAt = performance.now();
	const maxRecordChars = options.maxRecordChars ?? DEFAULT_MAX_XML_RECORD_CHARS;
	const maxHeaderChars = options.maxHeaderChars ?? DEFAULT_MAX_XML_HEADER_CHARS;
	const maxSkeletonChars =
		options.maxSkeletonChars ?? DEFAULT_MAX_XML_SKELETON_CHARS;
	const batchSize = Math.max(1, options.batchSize ?? 250);
	const startPattern = new RegExp(
		`<(?![!?/])(?:[\\w.-]+:)?(?:${options.recordNames.map(escapeRegExp).join("|")})(?=[\\s/>])`,
		"i",
	);
	let buffer = "";
	let header = "";
	let skeleton = options.collectSkeleton ? "" : undefined;
	let recordCount = 0;
	let maxBufferedChars = 0;
	let yieldCount = 0;
	let seenRecord = false;
	let safetyTail = "";
	let textInfo: StreamingTextInfo = { encoding: "utf-8", hasBom: false };
	let namespaceDeclarations = "";
	const chunks = streamSafeTextChunks(file, context, options);

	while (true) {
		const next = await chunks.next();
		if (next.done) {
			textInfo = next.value;
			break;
		}
		const safetyWindow = `${safetyTail}${next.value}`;
		safetyTail = inspectXmlDeclarations(safetyWindow, options.allowedDoctype);
		buffer += next.value;
		maxBufferedChars = Math.max(maxBufferedChars, buffer.length);

		while (true) {
			const match = startPattern.exec(buffer);
			if (!match) {
				const keep = Math.min(buffer.length, 128);
				const consumable = buffer.slice(0, buffer.length - keep);
				if (!seenRecord) {
					header += consumable;
					assertHeaderSize(header, maxHeaderChars);
				}
				namespaceDeclarations = mergeNamespaceDeclarations(
					namespaceDeclarations,
					consumable,
				);
				skeleton = appendXmlSkeleton(skeleton, consumable, maxSkeletonChars);
				buffer = buffer.slice(buffer.length - keep);
				break;
			}
			const interstitial = buffer.slice(0, match.index);
			if (!seenRecord) {
				header += interstitial;
				assertHeaderSize(header, maxHeaderChars);
			}
			namespaceDeclarations = mergeNamespaceDeclarations(
				namespaceDeclarations,
				interstitial,
			);
			skeleton = appendXmlSkeleton(skeleton, interstitial, maxSkeletonChars);
			buffer = buffer.slice(match.index);
			const recordEnd = findCompleteElementEnd(buffer);
			if (recordEnd < 0) {
				if (buffer.length > maxRecordChars) {
					throw new SafeInputError(
						"XML_MALFORMED",
						`An XML record exceeds the ${maxRecordChars}-character safety limit.`,
						{ limit: maxRecordChars },
					);
				}
				break;
			}
			const record = buffer.slice(0, recordEnd);
			buffer = buffer.slice(recordEnd);
			seenRecord = true;
			skeleton = appendXmlSkeleton(
				skeleton,
				`<opentlc-stream-record xmlns="urn:opentlc:stream" index="${recordCount}"/>`,
				maxSkeletonChars,
			);
			await onRecord(record, recordCount, namespaceDeclarations);
			recordCount++;
			context?.onProgress?.({
				phase: "parsing",
				completed: recordCount,
				total: 0,
				message: `Parsed ${recordCount.toLocaleString()} XML records`,
			});
			if (recordCount % batchSize === 0) {
				await yieldToMainThread();
				yieldCount++;
			}
		}
	}

	if (!seenRecord) {
		header += buffer;
		assertHeaderSize(header, maxHeaderChars);
		skeleton = appendXmlSkeleton(skeleton, buffer, maxSkeletonChars);
	} else if (startPattern.test(buffer)) {
		throw new SafeInputError(
			"XML_MALFORMED",
			"The final XML record is incomplete.",
		);
	} else {
		skeleton = appendXmlSkeleton(skeleton, buffer, maxSkeletonChars);
	}
	if (recordCount === 0) {
		throw new SafeInputError(
			"XML_MALFORMED",
			`The XML file contains no <${options.recordNames.join("> or <")}> records.`,
		);
	}
	return {
		header,
		...(skeleton === undefined ? {} : { skeleton }),
		namespaceDeclarations,
		recordCount,
		maxBufferedChars,
		yieldCount,
		durationMs: performance.now() - startedAt,
		textInfo,
	};
}

function inspectXmlDeclarations(
	window: string,
	allowedDoctype: RegExp | undefined,
): string {
	if (/<!ENTITY\b/i.test(window))
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"XML entity declarations are disabled for safety.",
		);
	let remainder = window;
	while (true) {
		const start = remainder.search(/<!DOCTYPE\b/i);
		if (start < 0) return remainder.slice(-64);
		const end = remainder.indexOf(">", start + 9);
		if (end < 0) {
			const pending = remainder.slice(start);
			if (pending.length > 2048)
				throw new SafeInputError(
					"XML_UNSAFE_DECLARATION",
					"The XML document type declaration is too large.",
				);
			return pending;
		}
		const declaration = remainder.slice(start, end + 1);
		if (!allowedDoctype || !allowedDoctype.test(declaration))
			throw new SafeInputError(
				"XML_UNSAFE_DECLARATION",
				"XML document type declarations are disabled unless an importer explicitly allows a known inert declaration.",
			);
		remainder = remainder.slice(end + 1);
	}
}

function appendXmlSkeleton(
	skeleton: string | undefined,
	value: string,
	maximum: number,
): string | undefined {
	if (skeleton === undefined || value.length === 0) return skeleton;
	const next = skeleton + value;
	if (next.length > maximum)
		throw new SafeInputError(
			"XML_MALFORMED",
			`XML structure outside streamed records exceeds the ${maximum}-character safety limit.`,
			{ limit: maximum },
		);
	return next;
}

export function parseXmlRecord(
	recordXml: string,
	namespaceDeclarations = "",
): Element {
	const document = safeParseXml(
		`<stream-root${namespaceDeclarations ? ` ${namespaceDeclarations}` : ""}>${recordXml}</stream-root>`,
	);
	// Some DOM implementations do not expose firstElementChild consistently for
	// namespace-rich XML, even though the element is present in childNodes.
	const record = Array.from(document.documentElement.childNodes).find(
		(node): node is Element => node.nodeType === 1,
	);
	if (!record)
		throw new SafeInputError("XML_MALFORMED", "The XML record is empty.");
	return record;
}

export interface CsvStreamOptions extends StreamingTextOptions {
	delimiter?: string;
	batchSize?: number;
	maxFieldChars?: number;
}

export async function streamCsvRows(
	file: File,
	onRow: (row: string[], rowIndex: number) => void | Promise<void>,
	context?: SafeInputContext,
	options: CsvStreamOptions = {},
): Promise<number> {
	const delimiter = options.delimiter ?? ",";
	if (delimiter.length !== 1)
		throw new Error("CSV delimiter must be one character.");
	const maxFieldChars = options.maxFieldChars ?? 8 * 1024 * 1024;
	const batchSize = Math.max(1, options.batchSize ?? 500);
	let row: string[] = [];
	let field = "";
	let quoted = false;
	let quotePending = false;
	let pendingCr = false;
	let rowCount = 0;

	const emitRow = async () => {
		row.push(field);
		field = "";
		await onRow(row, rowCount++);
		row = [];
		if (rowCount % batchSize === 0) await yieldToMainThread();
	};

	for await (const chunk of streamSafeTextChunks(file, context, options)) {
		for (let index = 0; index < chunk.length; index++) {
			const character = chunk[index];
			if (pendingCr) {
				pendingCr = false;
				if (character === "\n") continue;
			}
			if (quoted) {
				if (quotePending) {
					if (character === '"') {
						field += '"';
						quotePending = false;
						continue;
					}
					quoted = false;
					quotePending = false;
				} else if (character === '"') {
					quotePending = true;
					continue;
				} else {
					field += character;
					assertFieldSize(field, maxFieldChars);
					continue;
				}
			}
			if (character === '"' && field.length === 0) quoted = true;
			else if (character === delimiter) {
				row.push(field);
				field = "";
			} else if (character === "\n" || character === "\r") {
				await emitRow();
				pendingCr = character === "\r";
			} else {
				field += character;
				assertFieldSize(field, maxFieldChars);
			}
		}
	}
	if (quoted && !quotePending)
		throw new SafeInputError(
			"TEXT_INVALID_ENCODING",
			"The CSV file has an unterminated quoted field.",
		);
	if (field.length > 0 || row.length > 0) await emitRow();
	return rowCount;
}

function detectEncodingPrefix(bytes: Uint8Array): EncodingPrefix {
	if (
		bytes.length >= 4 &&
		((bytes[0] === 0xff &&
			bytes[1] === 0xfe &&
			bytes[2] === 0 &&
			bytes[3] === 0) ||
			(bytes[0] === 0 &&
				bytes[1] === 0 &&
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
	)
		return { encoding: "utf-8", hasBom: true, offset: 3 };
	if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
		return { encoding: "utf-16le", hasBom: true, offset: 2 };
	if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
		return { encoding: "utf-16be", hasBom: true, offset: 2 };
	return { encoding: "utf-8", hasBom: false, offset: 0 };
}

function findCompleteElementEnd(xml: string): number {
	const stack: string[] = [];
	let cursor = 0;
	while (cursor < xml.length) {
		const open = xml.indexOf("<", cursor);
		if (open < 0) return -1;
		if (xml.startsWith("<!--", open)) {
			const end = xml.indexOf("-->", open + 4);
			if (end < 0) return -1;
			cursor = end + 3;
			continue;
		}
		if (xml.startsWith("<![CDATA[", open)) {
			const end = xml.indexOf("]]>", open + 9);
			if (end < 0) return -1;
			cursor = end + 3;
			continue;
		}
		if (xml.startsWith("<?", open)) {
			const end = xml.indexOf("?>", open + 2);
			if (end < 0) return -1;
			cursor = end + 2;
			continue;
		}
		const close = findTagClose(xml, open + 1);
		if (close < 0) return -1;
		const tag = xml.slice(open + 1, close).trim();
		if (tag.startsWith("!")) {
			cursor = close + 1;
			continue;
		}
		if (tag.startsWith("/")) {
			const name = tag.slice(1).trim().split(/\s/, 1)[0];
			if (stack.pop() !== name)
				throw new SafeInputError(
					"XML_MALFORMED",
					`Unexpected closing XML tag </${name}>.`,
				);
			if (stack.length === 0) return close + 1;
		} else if (!tag.endsWith("/")) {
			const name = tag.split(/[\s/>]/, 1)[0];
			if (!name)
				throw new SafeInputError("XML_MALFORMED", "An XML tag has no name.");
			stack.push(name);
		} else if (stack.length === 0) {
			return close + 1;
		}
		cursor = close + 1;
	}
	return -1;
}

function findTagClose(xml: string, start: number): number {
	let quote = "";
	for (let index = start; index < xml.length; index++) {
		const character = xml[index];
		if (quote) {
			if (character === quote) quote = "";
		} else if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index;
	}
	return -1;
}

function mergeNamespaceDeclarations(current: string, xml: string): string {
	const declarations = new Map<string, string>();
	for (const source of [current, xml]) {
		for (const match of source.matchAll(
			/(?:^|\s)(xmlns(?::[\w.-]+)?)\s*=\s*("[^"]*"|'[^']*')/g,
		))
			declarations.set(match[1], `${match[1]}=${match[2]}`);
	}
	return [...declarations.values()].join(" ");
}

function assertHeaderSize(header: string, maximum: number): void {
	if (header.length > maximum)
		throw new SafeInputError(
			"XML_MALFORMED",
			`XML metadata before the first record exceeds the ${maximum}-character safety limit.`,
			{ limit: maximum },
		);
}

function assertFieldSize(field: string, maximum: number): void {
	if (field.length > maximum)
		throw new SafeInputError(
			"TEXT_INVALID_ENCODING",
			`A delimited-text field exceeds the ${maximum}-character safety limit.`,
			{ limit: maximum },
		);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function yieldToMainThread(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}
