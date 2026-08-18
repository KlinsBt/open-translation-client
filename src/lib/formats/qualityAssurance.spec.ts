// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { createNeutralDocument, createTextContent } from "./documentModel";
import {
	assertProjectExportQuality,
	ExportQaError,
	FORMAT_QA_POLICIES,
	formatExportQaResult,
	runProjectExportQuality,
} from "./qualityAssurance";
import { generateTextTranslation } from "$lib/functions/outputGeneration/outputGenerationText";
import { FORMAT_ADAPTERS } from "./registry";

function issueCodes(source: string, target: string, type = "json") {
	return runProjectExportQuality(
		makeUserData({
			type: type as "json" | "html",
			seg1: [source],
			seg2: [target],
			checked: [false],
		}),
	).issues.map((issue) => issue.code);
}

describe("placeholder export QA", () => {
	it("finds missing, duplicated, and unexpected placeholder occurrences", () => {
		const codes = issueCodes(
			"Hello {name}: %1$s has {{count}} files and ${folder}.",
			"Hallo %1$s %1$s hat {{other}} Dateien in ${folder}.",
		);
		expect(codes).toEqual(
			expect.arrayContaining([
				"MISSING_PLACEHOLDER",
				"DUPLICATED_PLACEHOLDER",
				"UNEXPECTED_PLACEHOLDER",
			]),
		);
	});

	it("allows named and positional reordering but blocks sequential printf reordering", () => {
		expect(
			issueCodes(
				"{first} then {second}: %1$s %2$d",
				"%2$d %1$s: {second} then {first}",
			),
		).not.toContain("REORDERED_PLACEHOLDER");
		expect(issueCodes("String: %s Number: %d", "Zahl: %d Text: %s")).toContain(
			"REORDERED_PLACEHOLDER",
		);
	});

	it("understands nested ICU arguments and reports malformed placeholder syntax", () => {
		expect(
			issueCodes(
				"{count, plural, one {# file} other {# files}} for {name}",
				"Für {name}: {count, plural, one {# Datei} other {# Dateien}}",
			),
		).not.toContain("REORDERED_PLACEHOLDER");
		expect(issueCodes("Hello {name}", "Hallo {name")).toContain(
			"MALFORMED_PLACEHOLDER",
		);
		expect(issueCodes("Value %s", "Wert %q")).toEqual(
			expect.arrayContaining(["MALFORMED_PLACEHOLDER", "MISSING_PLACEHOLDER"]),
		);
	});
});

describe("markup export QA", () => {
	it("detects missing, duplicated, unexpected, and improperly nested tags", () => {
		expect(issueCodes("<b>Hello</b>", "Hallo</b>")).toEqual(
			expect.arrayContaining(["MISSING_TAG", "MALFORMED_TAG"]),
		);
		expect(issueCodes("<br>Hello", "<br><br><img>Hallo")).toEqual(
			expect.arrayContaining(["DUPLICATED_TAG", "UNEXPECTED_TAG"]),
		);
		expect(issueCodes("<b><i>Hello</i></b>", "<b><i>Hallo</b></i>")).toContain(
			"MALFORMED_TAG",
		);
	});

	it("applies format-specific tag reorder rules", () => {
		const source = "<b>Bold</b><i>Italic</i>";
		const target = "<i>Kursiv</i><b>Fett</b>";
		expect(issueCodes(source, target, "json")).toContain("REORDERED_TAG");
		expect(issueCodes(source, target, "html")).not.toContain("REORDERED_TAG");
		expect(FORMAT_QA_POLICIES.html.allowTagReorder).toBe(true);
	});
});

describe("structured inline-code export QA", () => {
	function richProject(type: "json" | "html" = "json") {
		const document = createNeutralDocument({
			format: type,
			sourceSegments: ["AB"],
			targetSegments: ["AB"],
			unitIds: ["rich-unit"],
		});
		document.units[0].source.fragments = [
			{ kind: "code", id: "a", codeType: "standalone" },
			{ kind: "text", text: "A" },
			{ kind: "code", id: "b", codeType: "standalone" },
			{ kind: "text", text: "B" },
		];
		document.units[0].target.fragments = [
			{ kind: "code", id: "b", codeType: "standalone" },
			{ kind: "text", text: "B" },
			{ kind: "code", id: "a", codeType: "standalone" },
			{ kind: "text", text: "A" },
		];
		return makeUserData({
			type,
			seg1: ["AB"],
			seg2: ["BA"],
			checked: [false],
			documentModel: document,
		});
	}

	it("blocks protected-code reordering unless the format permits it", () => {
		expect(runProjectExportQuality(richProject("json")).issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "REORDERED_INLINE_CODE",
					unitId: "rich-unit",
				}),
			]),
		);
		expect(
			runProjectExportQuality(richProject("html")).issues.map(
				(issue) => issue.code,
			),
		).not.toContain("REORDERED_INLINE_CODE");
	});

	it("detects missing, duplicate, unknown, and crossed paired codes", () => {
		const project = richProject();
		project.translationData.documentModel!.units[0].source.fragments = [
			{ kind: "code", id: "s1", codeType: "start", pairId: "outer" },
			{ kind: "code", id: "s2", codeType: "start", pairId: "inner" },
			{ kind: "text", text: "text" },
			{ kind: "code", id: "e2", codeType: "end", pairId: "inner" },
			{ kind: "code", id: "e1", codeType: "end", pairId: "outer" },
		];
		project.translationData.documentModel!.units[0].target.fragments = [
			{ kind: "code", id: "s1", codeType: "start", pairId: "outer" },
			{ kind: "code", id: "s2", codeType: "start", pairId: "inner" },
			{ kind: "text", text: "Text" },
			{ kind: "code", id: "e1", codeType: "end", pairId: "outer" },
			{ kind: "code", id: "e1", codeType: "end", pairId: "outer" },
			{ kind: "code", id: "new", codeType: "standalone" },
		];
		const codes = runProjectExportQuality(project).issues.map(
			(issue) => issue.code,
		);
		expect(codes).toEqual(
			expect.arrayContaining([
				"MISSING_INLINE_CODE",
				"DUPLICATED_INLINE_CODE",
				"UNEXPECTED_INLINE_CODE",
				"MALFORMED_INLINE_CODE",
			]),
		);
	});

	it("rejects a code whose boundary type or pair identity changed", () => {
		const project = richProject();
		const unit = project.translationData.documentModel!.units[0];
		unit.source.fragments = [
			{ kind: "code", id: "open", codeType: "start", pairId: "bold" },
			{ kind: "text", text: "Text" },
			{ kind: "code", id: "close", codeType: "end", pairId: "bold" },
		];
		unit.target.fragments = [
			{ kind: "code", id: "open", codeType: "start", pairId: "italic" },
			{ kind: "text", text: "Text" },
			{ kind: "code", id: "close", codeType: "end", pairId: "italic" },
		];
		expect(
			runProjectExportQuality(project).issues.map((issue) => issue.code),
		).toContain("MALFORMED_INLINE_CODE");
	});

	it("honors explicitly deletable standalone codes", () => {
		const project = richProject();
		const unit = project.translationData.documentModel!.units[0];
		unit.source.fragments = [
			{
				kind: "code",
				id: "optional",
				codeType: "standalone",
				canDelete: true,
			},
		];
		unit.target.fragments = [];
		expect(runProjectExportQuality(project)).toMatchObject({ valid: true });
	});
});

describe("export blocking and messages", () => {
	it("throws a typed, segment-oriented error before a real download", async () => {
		const project = makeUserData({
			type: "text",
			seg1: ["Hello {name}"],
			seg2: ["Hallo"],
			checked: [false],
		});
		const result = runProjectExportQuality(project);
		expect(() => assertProjectExportQuality(project)).toThrow(ExportQaError);
		expect(formatExportQaResult(result)).toMatch(
			/Export blocked.*Segment 1.*missing/i,
		);
		await expect(generateTextTranslation(project)).rejects.toBeInstanceOf(
			ExportQaError,
		);
	});

	it("guards every registered format download adapter", async () => {
		for (const adapter of FORMAT_ADAPTERS.filter(
			(adapter) => adapter.capabilities.export,
		)) {
			const project = makeUserData({
				type: adapter.id,
				seg1: ["Hello {name}"],
				seg2: ["Hallo"],
				checked: [false],
			});
			await expect(adapter.exportFile(project)).rejects.toBeInstanceOf(
				ExportQaError,
			);
		}
	});

	it("returns a concise success result for clean projects", () => {
		const result = runProjectExportQuality(
			makeUserData({ seg1: ["Hello {name}"], seg2: ["Hallo {name}"] }),
		);
		expect(result).toEqual({ valid: true, issues: [], checkedUnits: 1 });
		expect(formatExportQaResult(result)).toBe(
			"Export QA passed for 1 segment.",
		);
	});
});
