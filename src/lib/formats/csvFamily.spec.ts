// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildCsvTranslation,
	buildCsvTranslationBlob,
	getCsvFormulaInjectionWarnings,
} from "$lib/functions/outputGeneration/outputGenerationCsv";
import {
	combineSegmentData,
	splitSegmentData,
} from "$lib/functions/parsing/segmentationLogic";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { importCsvFile, validateCsvFile } from "./importers";
import { decodeTextBytes } from "./safeInput";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name = "messages.csv",
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, {
		type: name.endsWith(".tsv") ? "text/tab-separated-values" : "text/csv",
	});
	const result = await importCsvFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected CSV segments");
	return {
		file,
		result,
		project: makeUserData({
			type: "csv",
			name,
			seg1: result.segments,
			seg2: targets ?? result.targetSegments ?? result.segments.map(() => ""),
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

async function bytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

describe("CSV and TSV import/export", () => {
	it("parses RFC 4180 quoting, escaped quotes, commas, CRLF, and multiline fields", async () => {
		const source =
			'Key,Source,Locked\r\n1,"Hello, ""friend""\r\nSecond line",keep\r\n';
		const { result, project } = await importProject(source, "quoted.csv", {
			importMode: "source-column",
			sourceColumn: "Source",
		});

		expect(result.segments).toEqual(['Hello, "friend"\r\nSecond line']);
		project.translationData.seg2 = ['Hallo, "Freund"\nZweite Zeile'];
		expect(buildCsvTranslation(project)).toBe(
			'Key,Source,Locked\r\n1,"Hallo, ""Freund""\nZweite Zeile",keep\r\n',
		);
	});

	it("detects TSV from its extension and preserves tabs and untouched columns", async () => {
		const source = "Key\tSource\tTarget\tLocked\nwelcome\tHello\tHallo\tkeep\n";
		const { result, project } = await importProject(
			source,
			"messages.tsv",
			{
				importMode: "multilingual-columns",
				keyColumn: "Key",
				sourceColumn: "Source",
				targetColumn: "Target",
			},
			["Guten Tag"],
		);

		expect(result.segments).toEqual(["Hello"]);
		expect(result.targetSegments).toEqual(["Hallo"]);
		expect(buildCsvTranslation(project)).toBe(
			"Key\tSource\tTarget\tLocked\nwelcome\tHello\tGuten Tag\tkeep\n",
		);
		expect(buildCsvTranslationBlob(project).type).toContain(
			"text/tab-separated-values",
		);
	});

	it("auto-detects semicolons and supports headerless numeric selectors", async () => {
		const { result, project } = await importProject(
			"1;Hello;keep\r\n2;World;locked",
			"regional.csv",
			{
				hasHeader: false,
				importMode: "source-column",
				sourceColumn: "2",
			},
			["Hallo", "Welt"],
		);
		expect(result.segments).toEqual(["Hello", "World"]);
		expect(result.document.metadata?.delimiter).toBe(";");
		expect(buildCsvTranslation(project)).toBe("1;Hallo;keep\r\n2;Welt;locked");
	});

	it("supports all-text mode while excluding headers and empty cells", async () => {
		const { result } = await importProject(
			"First,Second,Third\nOne,,Three\n",
			"all.csv",
			{ importMode: "all-text" },
		);
		expect(result.segments).toEqual(["One", "Three"]);
		expect(result.targetSegments).toEqual(["", ""]);
	});

	it("attaches keys, contexts, source locations, and multilingual targets", async () => {
		const { result } = await importProject(
			"ID,English,German,Screen\nwelcome,Hello,Hallo,Home\n",
			"columns.csv",
			{
				importMode: "multilingual-columns",
				keyColumn: "ID",
				sourceColumn: "English",
				targetColumn: "German",
				contextColumn: "Screen",
			},
		);
		const unit = result.document.units[0];
		expect(unit.contexts).toEqual([
			{ type: "csv-key", value: "welcome" },
			{ type: "csv-context", value: "Home" },
		]);
		expect(unit.sourceLocation).toMatchObject({ row: 2, column: 2 });
		expect(result.targetSegments).toEqual(["Hallo"]);
	});

	it("supports semicolon dialects, single quotes, and backslash escaping", async () => {
		const source = "Key;Source\n1;'It\\'s; valid'\n";
		const { result, project } = await importProject(
			source,
			"custom.csv",
			{
				delimiter: "semicolon",
				quoteCharacter: "single",
				escapeMode: "backslash",
				importMode: "source-column",
				sourceColumn: "B",
			},
			["C'est; bon"],
		);
		expect(result.segments).toEqual(["It's; valid"]);
		expect(buildCsvTranslation(project)).toBe("Key;Source\n1;'C\\'est; bon'\n");
	});

	it("quotes translated delimiters, line breaks, and quote characters when needed", async () => {
		const { project } = await importProject(
			"Key,Source\n1,Hello\n",
			"quote.csv",
			{ importMode: "source-column", sourceColumn: "B" },
			['One, "two"\nthree'],
		);
		expect(buildCsvTranslation(project)).toBe(
			'Key,Source\n1,"One, ""two""\nthree"\n',
		);
	});

	it("fails safely when quoting is disabled but a translation requires it", async () => {
		const { project } = await importProject(
			"Key,Source\n1,Hello\n",
			"no-quotes.csv",
			{
				quoteCharacter: "none",
				importMode: "source-column",
				sourceColumn: "B",
			},
			["Hello, world"],
		);
		expect(() => buildCsvTranslation(project)).toThrow(/quoting is disabled/i);
	});

	it("preserves formula-like cells as data and emits source/target warnings", async () => {
		const { result, project } = await importProject(
			'Key,Source,Target\n1,"=HYPERLINK(""https://example.test"")",@old\n',
			"formulas.csv",
			{
				importMode: "multilingual-columns",
				sourceColumn: "B",
				targetColumn: "C",
			},
		);
		expect(result.segments).toEqual(['=HYPERLINK("https://example.test")']);
		expect(
			result.document.units[0].notes.map((note) => note.appliesTo),
		).toEqual(["source", "target"]);
		expect(result.document.metadata?.formulaInjectionWarnings).toBe(2);
		project.translationData.seg2 = ["+SUM(1,2)"];
		expect(getCsvFormulaInjectionWarnings(project)).toEqual([0]);
		expect(buildCsvTranslation(project)).toContain('"+SUM(1,2)"');
	});

	it("returns exact UTF-16 bytes for identity and retains encoding after translation", async () => {
		const source = encodeTextBytes(
			"Key,Source\r\n1,Hello\r\n",
			"utf-16le",
			true,
		);
		const identity = await importProject(
			source,
			"utf16.csv",
			{
				importMode: "source-column",
				sourceColumn: "B",
			},
			["Hello"],
		);
		expect(await bytes(buildCsvTranslationBlob(identity.project))).toEqual(
			source,
		);

		identity.project.translationData.seg2 = ["Hallo"];
		expect(
			decodeTextBytes(await bytes(buildCsvTranslationBlob(identity.project))),
		).toMatchObject({
			encoding: "utf-16le",
			hasBom: true,
			text: "\ufeffKey,Source\r\n1,Hallo\r\n",
		});
	});

	it("reports malformed quotes and invalid encodings without partial imports", async () => {
		for (const source of [
			'Key,Source\n1,"unterminated',
			'Key,Source\n1,un"quoted',
			'Key,Source\n1,"closed"junk',
		]) {
			const file = new File([source], "broken.csv", { type: "text/csv" });
			await expect(validateCsvFile(file)).resolves.toMatchObject({
				valid: false,
			});
			await expect(importCsvFile(file)).rejects.toBeDefined();
		}
		const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0xc3, 0x28]);
		await expect(
			validateCsvFile(new File([bytes], "broken.csv")),
		).resolves.toMatchObject({
			valid: false,
			errorCode: "TEXT_INVALID_ENCODING",
		});
	});

	it("records ragged rows while preserving their order and bytes", async () => {
		const source = "A,B,C\r\n1,Hello,keep\r\n2,World\r\n3,Again,keep,extra\r\n";
		const { result, project } = await importProject(
			source,
			"ragged.csv",
			{
				importMode: "source-column",
				sourceColumn: "B",
			},
			["Hallo", "Welt", "Nochmals"],
		);
		expect(result.document.metadata?.raggedRows).toEqual([3, 4]);
		expect(buildCsvTranslation(project)).toBe(
			"A,B,C\r\n1,Hallo,keep\r\n2,Welt\r\n3,Nochmals,keep,extra\r\n",
		);
	});

	it("resolves columns by header, letters, and 1-based numbers and rejects bad selectors", async () => {
		for (const selector of ["Source", "B", "2"]) {
			const { result } = await importProject(
				"Key,Source\n1,Hello\n",
				"selector.csv",
				{ importMode: "source-column", sourceColumn: selector },
			);
			expect(result.segments).toEqual(["Hello"]);
		}
		await expect(
			importCsvFile(new File(["Key,Source\n1,Hello"], "selector.csv"), {
				importMode: "source-column",
				sourceColumn: "missing header",
			}),
		).rejects.toThrow(/not a header name/i);
	});

	it("blocks split and join operations that would corrupt row/column alignment", async () => {
		const { project } = await importProject(
			"Key,Source\n1,Hello world\n2,Next\n",
			"structure.csv",
			{ importMode: "source-column", sourceColumn: "B" },
		);
		expect(splitSegmentData(project.translationData, 0, 5).error).toMatch(
			/row and column alignment/,
		);
		expect(combineSegmentData(project.translationData, 0).error).toMatch(
			/row and column alignment/,
		);
	});

	it("refuses export when persisted field mappings no longer align", async () => {
		const { project } = await importProject(
			"Key,Source\n1,Hello\n",
			"corrupt.csv",
			{ importMode: "source-column", sourceColumn: "B" },
			["Hallo"],
		);
		project.translationData.skeleton!.replacements[0].unitIndex = 5;
		expect(() => buildCsvTranslation(project)).toThrow(/do not align uniquely/);
	});
});
