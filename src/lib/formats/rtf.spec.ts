import { describe, expect, it } from "vitest";
import type { UserData } from "$lib/types/types";
import {
	buildRtfTranslationBlob,
	extractRtfParagraphs,
	importRtfFile,
	validateRtfFile,
} from "./rtf";

const SAMPLE_RTF = String.raw`{\rtf1\ansi\deff0
{\fonttbl{\f0 Arial;}}
{\header Header text\par}
Hello \b world\b0.\par
Unicode \u8364? value.\par
}`;

function projectFromImport(
	result: Awaited<ReturnType<typeof importRtfFile>>,
	targets: string[],
): UserData {
	if (result.kind !== "segments") throw new Error("Expected segments");
	return {
		translationData: {
			name: "sample.rtf",
			targetLang: "de",
			sourceLang: "en",
			creationDate: "0",
			seg1: result.segments,
			seg2: targets,
			checked: result.segments.map(() => true),
			type: "rtf",
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

describe("RTF native round trip", () => {
	it("extracts formatted and Unicode paragraphs while ignoring tables", () => {
		expect(extractRtfParagraphs(SAMPLE_RTF).map(({ text }) => text)).toEqual([
			"Header text",
			"Hello world.",
			"Unicode € value.",
		]);
		expect(
			extractRtfParagraphs(SAMPLE_RTF, false).map(({ text }) => text),
		).toEqual(["Hello world.", "Unicode € value."]);
	});

	it("rejects content without an RTF header", async () => {
		const file = new File(["plain text"], "fake.rtf", {
			type: "application/rtf",
		});
		expect((await validateRtfFile(file)).valid).toBe(false);
		await expect(importRtfFile(file)).rejects.toMatchObject({
			code: "RTF_INVALID",
		});
	});

	it("reopens translated output and preserves the RTF formatting structure", async () => {
		const imported = await importRtfFile(
			new File([SAMPLE_RTF], "sample.rtf", { type: "application/rtf" }),
			{ includeHeadersFooters: false },
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments).toEqual(["Hello world.", "Unicode € value."]);
		const output = buildRtfTranslationBlob(
			projectFromImport(imported, ["Hallo Welt.", "Wert {€}."]),
		);
		const text = await output.text();
		expect(text).toContain("\\fonttbl");
		expect(text).toContain("\\b");
		expect(text).toContain(String.raw`Wert \{\u8364?\}.`);

		const reopened = await importRtfFile(
			new File([output], "translated.rtf", { type: "application/rtf" }),
			{ includeHeadersFooters: false },
		);
		expect(reopened.kind).toBe("segments");
		if (reopened.kind === "segments")
			expect(reopened.segments).toEqual(["Hallo Welt.", "Wert {€}."]);
	});
});
