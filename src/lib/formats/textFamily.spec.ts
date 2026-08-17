// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { importTextFile, validateTextFile } from "./importers";
import { decodeTextBytes } from "./safeInput";
import type { FormatOptionValues } from "./types";
import {
	buildTextTranslationBlob,
	buildTextTranslationFromProject,
	encodeTextBytes,
} from "$lib/functions/outputGeneration/outputGenerationText";
import {
	combineSegmentData,
	splitSegmentData,
} from "$lib/functions/parsing/segmentationLogic";

async function importProject(
	file: File,
	options: FormatOptionValues,
	targets?: string[],
) {
	const result = await importTextFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected segmented TXT");
	return {
		result,
		project: makeUserData({
			type: "text",
			seg1: result.segments,
			seg2: targets ?? [...result.segments],
			checked: result.segments.map(() => false),
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

async function bytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("TXT family import and export", () => {
	it("preserves mixed line endings, whitespace-only lines, and a final newline", async () => {
		const source = "One\r\n\r\nTwo\r  \rThree\nFour\n";
		const { result, project } = await importProject(
			new File([source], "mixed.txt", { type: "text/plain" }),
			{ segmentationMode: "lines" },
			["Eins", "Zwei", "Drei", "Vier"],
		);

		expect(result.segments).toEqual(["One", "Two", "Three", "Four"]);
		expect(
			result.document.units.map((unit) => unit.sourceLocation?.line),
		).toEqual([1, 3, 5, 6]);
		expect(buildTextTranslationFromProject(project)).toBe(
			"Eins\r\n\r\nZwei\r  \rDrei\nVier\n",
		);
	});

	it("supports paragraph, sentence, preference, and document modes without source normalization", async () => {
		const paragraphs = await importProject(
			new File([" First line\r\ncontinued \r\n \r\n Second "], "p.txt"),
			{ segmentationMode: "paragraphs" },
		);
		expect(paragraphs.result.segments).toEqual([
			"First line\r\ncontinued",
			"Second",
		]);

		for (const mode of ["sentences", "preferences"] as const) {
			const sentence = await importProject(
				new File(["Hello.\r\n\r\nNext! Last"], `${mode}.txt`),
				{ segmentationMode: mode },
			);
			expect(sentence.result.segments).toEqual(["Hello.", "Next!", "Last"]);
			expect(buildTextTranslationFromProject(sentence.project)).toBe(
				"Hello.\r\n\r\nNext! Last",
			);
		}

		const document = await importProject(
			new File(["  Whole\rDocument  "], "document.txt"),
			{ segmentationMode: "document" },
		);
		expect(document.result.segments).toEqual(["  Whole\rDocument  "]);
	});

	it("keeps a UTF-8 BOM outside the editable document segment", async () => {
		const source = encodeTextBytes("Hello", "utf-8", true);
		const { result, project } = await importProject(
			new File([source], "bom.txt", { type: "text/plain" }),
			{ segmentationMode: "document" },
			["Hallo"],
		);

		expect(result.segments).toEqual(["Hello"]);
		expect(buildTextTranslationFromProject(project)).toBe("\ufeffHallo");
		expect(
			[...(await bytes(buildTextTranslationBlob(project)))].slice(0, 3),
		).toEqual([0xef, 0xbb, 0xbf]);
	});

	it.each([
		["utf-16le", [0xff, 0xfe]],
		["utf-16be", [0xfe, 0xff]],
	] as const)(
		"round-trips translated %s with its endianness and BOM",
		async (encoding, bom) => {
			const source = encodeTextBytes("Hello 🌍", encoding, true);
			const { project } = await importProject(
				new File([source], `${encoding}.txt`, { type: "text/plain" }),
				{ segmentationMode: "document" },
				["Hallo 🌍"],
			);
			const output = await bytes(buildTextTranslationBlob(project));

			expect([...output.slice(0, 2)]).toEqual(bom);
			expect(decodeTextBytes(output)).toMatchObject({
				encoding,
				hasBom: true,
				text: "\ufeffHallo 🌍",
			});
		},
	);

	it("returns the exact original bytes for an identity export", async () => {
		const source = encodeTextBytes("Same\r\nbytes", "utf-16le", true);
		const { project } = await importProject(
			new File([source], "identity.txt", { type: "text/plain" }),
			{ segmentationMode: "lines" },
		);

		expect(await bytes(buildTextTranslationBlob(project))).toEqual(source);
	});

	it("allows explicit encoding and BOM conversion", async () => {
		const source = encodeTextBytes("Hello", "utf-16le", true);
		const { project } = await importProject(
			new File([source], "convert.txt", { type: "text/plain" }),
			{
				segmentationMode: "document",
				outputEncoding: "utf-8",
				byteOrderMark: "never",
			},
			["Hallo"],
		);
		const output = await bytes(buildTextTranslationBlob(project));

		expect([...output.slice(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
		expect(new TextDecoder().decode(output)).toBe("Hallo");
	});

	it("preserves code points by default and normalizes targets only when requested", async () => {
		const decomposed = "Cafe\u0301";
		const sourceFile = new File([decomposed], "unicode.txt", {
			type: "text/plain",
		});
		const preserve = await importProject(
			sourceFile,
			{ segmentationMode: "document" },
			[decomposed],
		);
		expect(buildTextTranslationFromProject(preserve.project)).toBe(decomposed);

		const normalized = await importProject(
			sourceFile,
			{ segmentationMode: "document", unicodeNormalization: "nfc" },
			[decomposed],
		);
		expect(buildTextTranslationFromProject(normalized.project)).toBe("Café");
	});

	it("marks RTL units and preserves bidi controls through translation", async () => {
		const rtl = "\u202Bمرحبا بالعالم\u202C";
		const { result, project } = await importProject(
			new File([`${rtl}\nEnglish`], "bidi.txt", { type: "text/plain" }),
			{ segmentationMode: "lines" },
			["\u202Bשלום\u202C", "Deutsch"],
		);

		expect(result.document.units.map((unit) => unit.source.direction)).toEqual([
			"rtl",
			"ltr",
		]);
		expect(buildTextTranslationFromProject(project)).toBe(
			"\u202Bשלום\u202C\nDeutsch",
		);
	});

	it("rejects invalid input bytes and unsafe unpaired-surrogate output", async () => {
		const malformed = new File(
			[new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0x28])],
			"broken.txt",
		);
		await expect(validateTextFile(malformed)).resolves.toMatchObject({
			valid: false,
			errorCode: "TEXT_INVALID_ENCODING",
		});
		expect(() => encodeTextBytes("broken \ud800", "utf-8", false)).toThrow(
			/unpaired Unicode surrogate/,
		);
	});

	it("keeps empty and whitespace-only files lossless without creating units", async () => {
		for (const source of ["", " \r\n\r\n\t"]) {
			const { result, project } = await importProject(
				new File([source], "empty.txt", { type: "text/plain" }),
				{ segmentationMode: "lines" },
			);
			expect(result.segments).toEqual([]);
			expect(buildTextTranslationFromProject(project)).toBe(source);
			expect(
				new TextDecoder().decode(
					await bytes(buildTextTranslationBlob(project)),
				),
			).toBe(source);
		}
	});

	it("keeps TXT skeleton mappings aligned across join and split", async () => {
		const { project } = await importProject(
			new File(["One\r\nTwo"], "join.txt", { type: "text/plain" }),
			{ segmentationMode: "lines" },
			["Eins", "Zwei"],
		);
		const joined = combineSegmentData(project.translationData, 0);
		expect(joined.error).toBeUndefined();
		expect(joined.data.skeleton?.replacements).toHaveLength(1);
		expect(
			buildTextTranslationFromProject({
				...project,
				translationData: joined.data,
			}),
		).toBe("EinsZwei");

		const split = splitSegmentData(joined.data, 0, 3);
		expect(split.restoredJoinBoundary).toBe(true);
		expect(split.data.skeleton?.replacements).toHaveLength(2);
		expect(
			buildTextTranslationFromProject({
				...project,
				translationData: split.data,
			}),
		).toBe("Eins\r\nZwei");
	});
});
