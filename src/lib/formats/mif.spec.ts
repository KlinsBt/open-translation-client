// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildMifTranslation,
	buildMifTranslationBlob,
	encodeMifString,
} from "$lib/functions/outputGeneration/outputGenerationMif";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	decodeMifString,
	importMifFile,
	parseMifDocument,
	validateMifFile,
} from "./mif";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "manual.mif", {
		type: "application/vnd.mif",
	});
	const result = await importMifFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected MIF segments");
	return {
		result,
		project: makeUserData({
			type: "mif",
			name: "manual.mif",
			seg1: result.segments,
			seg2: targets ?? [...result.segments],
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
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

describe("Adobe FrameMaker MIF workflow", () => {
	it("extracts configured tagged strings while preserving catalogs, conditions, xrefs, and nesting", async () => {
		const source = `<MIFFile 2020>
<PgfCatalog <Pgf <PgfTag \`Body'> > >
<ConditionCatalog <Condition <CTag \`Review'> > >
<Para
 <PgfTag \`Body'>
 <ParaLine <String \`Hello world'> >
 <Marker <MType 2> <MarkerText \`Index marker'> >
 <XRef <XRefName \`See Also'> <XRefSrcText \`Cross-reference label'> >
 <Variable <VariableDef \`Variable value'> >
>`;
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual(["Hello world", "Cross-reference label"]);
		project.translationData.seg2 = ["Hallo Welt", "Querverweis"];
		const output = buildMifTranslation(project);
		expect(output).toContain("<PgfTag `Body'>");
		expect(output).toContain("<CTag `Review'>");
		expect(output).toContain("<String `Hallo Welt'>");
		expect(output).toContain("<XRefSrcText `Querverweis'>");
		expect(output).toContain("<MarkerText `Index marker'>");
		expect(output).toContain("<VariableDef `Variable value'>");
	});

	it("supports marker, variable, and custom tag filters", async () => {
		const source = `<MIFFile 7.00>
<String \`Body'>
<MarkerText \`Marker'>
<VariableDef \`Variable'>
<CustomText \`Custom'>`;
		const result = await importMifFile(new File([source], "manual.mif"), {
			translatableTags: "CustomText",
			includeMarkers: true,
			includeVariables: true,
		});
		if (result.kind !== "segments") throw new Error("Expected MIF segments");
		expect(result.segments).toEqual(["Marker", "Variable", "Custom"]);
	});

	it("decodes and safely emits MIF escapes and delimiters", async () => {
		expect(decodeMifString("Caf\\xE9 ")).toBe("Café");
		expect(encodeMifString("quote ' tick ` slash \\ line\n")).toBe(
			"quote \\x27  tick \\x60  slash \\\\ line\\n",
		);
		const { project } = await importProject("<MIFFile 7.00>\n<String `Text'>");
		project.translationData.seg2 = ["quote ' tick ` slash \\"];
		const output = buildMifTranslation(project);
		expect(parseMifDocument(output).strings.at(-1)?.value).toBe(
			"quote ' tick ` slash \\",
		);
	});

	it("rejects missing signatures, unmatched tags, unterminated strings, and malformed escapes", async () => {
		const invalid = [
			"<String `Text'>",
			"<MIFFile 7.00>\n>",
			"<MIFFile 7.00>\n<Para <String `Text'>",
			"<MIFFile 7.00>\n<String `unterminated>",
			"<MIFFile 7.00>\n<String `bad \\xZZ '>",
		];
		for (const content of invalid)
			await expect(
				validateMifFile(new File([content], "bad.mif")),
			).resolves.toMatchObject({
				valid: false,
			});
	});

	it("preserves UTF-16 identity bytes and source encoding", async () => {
		const bytes = encodeTextBytes(
			"<MIFFile 2020>\n<String `Café'>",
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(await buildMifTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ["Kaffee"];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildMifTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain("Kaffee");
	});

	it("round-trips sentence segmentation and blocks stale structural edits", async () => {
		const { result, project } = await importProject(
			"<MIFFile 7.00>\n<String `First sentence. Second sentence.'>",
			{ segmentationMode: "sentences" },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = buildMifTranslation(project);
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		expect(() => buildMifTranslation(project)).toThrow(/do not align uniquely/);
	});

	it("imports 1,000 tagged strings deterministically", async () => {
		const source = `<MIFFile 2020>\n${Array.from(
			{ length: 1_000 },
			(_, index) => `<Para <ParaLine <String \`Message ${index}'> > >`,
		).join("\n")}`;
		const first = await importMifFile(new File([source], "large.mif"));
		const second = await importMifFile(new File([source], "large.mif"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected MIF segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
