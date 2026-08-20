// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import {
	SafeInputError,
	decodeTextBytes,
	inspectSafeZipFile,
	inspectZipBytes,
	readSafeFileBytes,
	readSafeZipPackage,
	safeParseXml,
	type SafeInputProgress,
} from "./safeInput";
import { getFormatAdapter } from "./registry";

async function zipBytes(
	entries: Record<string, string | Uint8Array>,
	compression: "STORE" | "DEFLATE" = "STORE",
): Promise<Uint8Array> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	return zip.generateAsync({ type: "uint8array", compression });
}

function findEocd(bytes: Uint8Array): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = bytes.length - 22; offset >= 0; offset--) {
		if (view.getUint32(offset, true) === 0x06054b50) return offset;
	}
	throw new Error("Test ZIP has no EOCD");
}

function withDuplicateFirstEntry(bytes: Uint8Array): Uint8Array {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const eocd = findEocd(bytes);
	const centralOffset = view.getUint32(eocd + 16, true);
	const centralSize = view.getUint32(eocd + 12, true);
	const entryCount = view.getUint16(eocd + 10, true);
	const nameLength = view.getUint16(centralOffset + 28, true);
	const extraLength = view.getUint16(centralOffset + 30, true);
	const commentLength = view.getUint16(centralOffset + 32, true);
	const firstLength = 46 + nameLength + extraLength + commentLength;
	const result = new Uint8Array(bytes.length + firstLength);
	result.set(bytes.subarray(0, eocd), 0);
	result.set(bytes.subarray(centralOffset, centralOffset + firstLength), eocd);
	result.set(bytes.subarray(eocd), eocd + firstLength);
	const resultView = new DataView(result.buffer);
	const newEocd = eocd + firstLength;
	resultView.setUint16(newEocd + 8, entryCount + 1, true);
	resultView.setUint16(newEocd + 10, entryCount + 1, true);
	resultView.setUint32(newEocd + 12, centralSize + firstLength, true);
	return result;
}

function expectSafeCode(action: () => unknown, code: SafeInputError["code"]) {
	try {
		action();
		throw new Error("Expected SafeInputError");
	} catch (error) {
		expect(error).toBeInstanceOf(SafeInputError);
		expect((error as SafeInputError).code).toBe(code);
	}
}

describe("safe file reads and encodings", () => {
	it("enforces file limits with a typed diagnostic", async () => {
		const file = new File(["12345"], "large.txt");
		await expect(
			readSafeFileBytes(file, undefined, { maxFileBytes: 4 }),
		).rejects.toMatchObject({ code: "FILE_TOO_LARGE", details: { limit: 4 } });
	});

	it("detects UTF-8 and UTF-16 byte-order marks", () => {
		expect(
			decodeTextBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69])),
		).toMatchObject({
			text: "\ufeffHi",
			encoding: "utf-8",
			hasBom: true,
		});
		expect(
			decodeTextBytes(new Uint8Array([0xff, 0xfe, 0x48, 0, 0x69, 0])),
		).toMatchObject({
			text: "\ufeffHi",
			encoding: "utf-16le",
			hasBom: true,
		});
	});

	it("rejects invalid UTF-8 and unsupported UTF-32", () => {
		expectSafeCode(
			() => decodeTextBytes(new Uint8Array([0xc3, 0x28])),
			"TEXT_INVALID_ENCODING",
		);
		expectSafeCode(
			() => decodeTextBytes(new Uint8Array([0xff, 0xfe, 0, 0, 65, 0, 0, 0])),
			"TEXT_INVALID_ENCODING",
		);
	});

	it("honors an already-aborted operation", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			readSafeFileBytes(new File(["text"], "notes.txt"), {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "ABORTED" });
	});
});

describe("safe ZIP inspection and extraction", () => {
	it("enforces entry-count and expanded-size limits", async () => {
		const bytes = await zipBytes({ "one.xml": "12345", "two.xml": "67890" });
		expectSafeCode(
			() => inspectZipBytes(bytes, { maxArchiveEntries: 1 }),
			"ARCHIVE_TOO_MANY_ENTRIES",
		);
		expectSafeCode(
			() => inspectZipBytes(bytes, { maxExpandedBytes: 9 }),
			"ARCHIVE_EXPANDED_TOO_LARGE",
		);
	});

	it("rejects suspicious expansion ratios", async () => {
		const bytes = await zipBytes({ "bomb.txt": "A".repeat(20_000) }, "DEFLATE");
		expectSafeCode(
			() => inspectZipBytes(bytes, { maxExpansionRatio: 10 }),
			"ARCHIVE_RATIO_EXCEEDED",
		);
	});

	it("rejects duplicate and traversal paths before extraction", async () => {
		const ordinary = await zipBytes({ "word/document.xml": "<document/>" });
		expectSafeCode(
			() => inspectZipBytes(withDuplicateFirstEntry(ordinary)),
			"ARCHIVE_DUPLICATE_PATH",
		);
		const traversal = await zipBytes({ "../outside.xml": "<outside/>" });
		expectSafeCode(() => inspectZipBytes(traversal), "ARCHIVE_UNSAFE_PATH");
	});

	it("reports progress and preserves non-XML entries as opaque blobs", async () => {
		const bytes = await zipBytes({
			"word/document.xml": "<document/>",
			"word/vbaProject.bin": new Uint8Array([0, 1, 2, 255]),
			"scripts/helper.js": "globalThis.wasExecuted = true",
		});
		const progress: SafeInputProgress[] = [];
		const result = await readSafeZipPackage(
			new File([bytes], "document.docx"),
			{ onProgress: (update) => progress.push(update) },
		);
		expect(result.parts["word/document.xml"]).toBe("<document/>");
		expect(result.parts["word/vbaProject.bin"]).toBeInstanceOf(Blob);
		expect(result.parts["scripts/helper.js"]).toBeInstanceOf(Blob);
		expect((globalThis as any).wasExecuted).toBeUndefined();
		expect(new Set(progress.map((update) => update.phase))).toEqual(
			new Set(["reading", "inspecting", "extracting"]),
		);
	});

	it("can be cancelled between extracted entries", async () => {
		const bytes = await zipBytes({ "one.xml": "one", "two.xml": "two" });
		const controller = new AbortController();
		await expect(
			readSafeZipPackage(new File([bytes], "archive.zip"), {
				signal: controller.signal,
				onProgress: ({ phase }) => {
					if (phase === "extracting") controller.abort();
				},
			}),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("cancels a reader when abort fires during stream construction", async () => {
		const controller = new AbortController();
		const file = new File(["slow content"], "slow.txt");
		let cancelled = false;
		Object.defineProperty(file, "stream", {
			value: () =>
				new ReadableStream<Uint8Array>({
					start() {
						controller.abort();
					},
					cancel() {
						cancelled = true;
					},
				}),
		});
		await expect(
			readSafeFileBytes(file, { signal: controller.signal }),
		).rejects.toMatchObject({ code: "ABORTED" });
		expect(cancelled).toBe(true);
	});

	it("returns typed safety failures from Office validators", async () => {
		const bytes = await zipBytes({ "word/document.xml": "<document/>" });
		const result = await getFormatAdapter("docx").validate(
			new File([bytes], "document.docx"),
			undefined,
		);
		expect(result).toEqual({ valid: true });
		await expect(
			inspectSafeZipFile(new File([bytes], "document.docx"), undefined, {
				maxArchiveEntries: 0,
			}),
		).rejects.toMatchObject({ code: "ARCHIVE_TOO_MANY_ENTRIES" });
	});

	it("blocks entity declarations embedded in Office XML", async () => {
		const bytes = await zipBytes({
			"word/document.xml":
				'<!DOCTYPE document [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>',
		});
		await expect(
			getFormatAdapter("docx").importFile(new File([bytes], "unsafe.docx")),
		).rejects.toMatchObject({ code: "XML_UNSAFE_DECLARATION" });
	});
});

describe("safe XML parsing", () => {
	it("parses ordinary namespaced XML", () => {
		const document = safeParseXml('<w:document xmlns:w="urn:test"/>');
		expect(document.documentElement.localName).toBe("document");
	});

	it("rejects DTD and entity declarations before DOM parsing", () => {
		expectSafeCode(
			() =>
				safeParseXml(
					'<!DOCTYPE root [<!ENTITY external SYSTEM "file:///etc/passwd">]><root>&external;</root>',
				),
			"XML_UNSAFE_DECLARATION",
		);
	});

	it("rejects malformed XML", () => {
		expectSafeCode(() => safeParseXml("<root><child></root>"), "XML_MALFORMED");
	});
});
