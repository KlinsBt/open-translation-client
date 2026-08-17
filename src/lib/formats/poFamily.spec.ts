// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildPoTranslation,
	buildPoTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationPo";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { runProjectExportQuality } from "./qualityAssurance";
import { importPoFile, parsePoCatalog, validatePoFile } from "./poFamily";
import type { FormatOptionValues } from "./types";

const header = `msgid ""
msgstr ""
"Project-Id-Version: OpenTLC\\n"
"Language: de\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Plural-Forms: nplurals=2; plural=n != 1;\\n"

`;

async function importProject(
	content: BlobPart,
	name = "messages.po",
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, {
		type: "text/x-gettext-translation",
	});
	const result = await importPoFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected PO segments");
	return {
		file,
		result,
		project: makeUserData({
			type: "po",
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

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("GNU gettext PO/POT workflow", () => {
	it("imports headers, contexts, comments, references, flags, previous values, continued strings, and every plural form", async () => {
		const source = `${header}# Translator note
#. Extracted help
#: src/main.c:10 lib/ui.c:5
#, fuzzy, c-format
#| msgid "Old %s"
msgctxt "menu"
msgid "One %s file"
msgid_plural "Many %s "
"files"
msgstr[0] "Eine %s Datei"
msgstr[1] "Viele %s Dateien"
`;
		const { result } = await importProject(source);

		expect(result.segments).toEqual(["One %s file", "Many %s files"]);
		expect(result.targetSegments).toEqual([
			"Eine %s Datei",
			"Viele %s Dateien",
		]);
		expect(result.document.metadata).toMatchObject({
			nplurals: 2,
			charset: "utf-8",
			isTemplate: false,
			header: {
				Language: "de",
				"Plural-Forms": "nplurals=2; plural=n != 1;",
			},
		});
		expect(result.document.units[1].contexts).toEqual(
			expect.arrayContaining([
				{ type: "gettext-context", value: "menu" },
				{ type: "gettext-plural-index", value: "1" },
				{ type: "gettext-flags", value: "fuzzy, c-format" },
			]),
		);
		expect(result.document.units[0].notes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					category: "gettext-translator",
					text: "Translator note",
				}),
				expect.objectContaining({
					category: "gettext-extracted",
					text: "Extracted help",
				}),
				expect.objectContaining({
					category: "gettext-previous",
					text: 'msgid "Old %s"',
				}),
			]),
		);
	});

	it("patches only msgstr fragments while preserving wrapping and all source-side syntax", async () => {
		const source = `${header}#. Keep
msgctxt "button"
msgid "Open file"
msgstr ""
"Datei "
"öffnen"
`;
		const { project } = await importProject(source, "ui.po", {}, [
			"Dokument öffnen",
		]);
		const output = buildPoTranslation(project);

		expect(output).toContain('#. Keep\nmsgctxt "button"\nmsgid "Open file"');
		expect(output).toContain('msgstr ""\n"Dokument"\n" öffnen"');
		expect(parsePoCatalog(output).entries[1].fields.at(-1)?.value).toBe(
			"Dokument öffnen",
		);
	});

	it("treats POT as a source template and supplies blank targets", async () => {
		const source = `${header}msgid "Hello"
msgstr ""

msgid "One item"
msgid_plural "Many items"
msgstr[0] ""
msgstr[1] ""
`;
		const { result, project } = await importProject(
			source,
			"messages.pot",
			{},
			["Hallo", "Ein Eintrag", "Viele Einträge"],
		);
		expect(result.targetSegments).toEqual(["", "", ""]);
		expect(result.document.metadata?.isTemplate).toBe(true);
		const output = buildPoTranslation(project);
		expect(output).toContain('msgid "Hello"\nmsgstr "Hallo"');
		expect(output).toContain('msgstr[1] "Viele Einträge"');
	});

	it("supports fuzzy and obsolete selection without changing workflow markers", async () => {
		const source = `${header}#, fuzzy
msgid "Review me"
msgstr "Prüfen"

#~ msgid "Old"
#~ msgstr "Alt"
`;
		const defaults = await importPoFile(new File([source], "workflow.po"));
		if (defaults.kind !== "segments") throw new Error("Expected segments");
		expect(defaults.segments).toEqual(["Review me"]);

		const selected = await importProject(
			source,
			"workflow.po",
			{ includeFuzzy: false, includeObsolete: true },
			["Neu"],
		);
		expect(selected.result.segments).toEqual(["Old"]);
		expect(selected.result.document.units[0].notes).toContainEqual(
			expect.objectContaining({ category: "gettext-obsolete" }),
		);
		expect(buildPoTranslation(selected.project)).toContain('#~ msgstr "Neu"');
	});

	it("validates plural counts and contiguous indices against the header", async () => {
		for (const body of [
			'msgid "One"\nmsgid_plural "Many"\nmsgstr[0] "Ein"\n',
			'msgid "One"\nmsgid_plural "Many"\nmsgstr[0] "Ein"\nmsgstr[2] "Viele"\n',
			'msgid "One"\nmsgstr[0] "Ein"\n',
		]) {
			await expect(
				validatePoFile(new File([`${header}${body}`], "bad.po")),
			).resolves.toMatchObject({ valid: false, errorCode: "PO_MALFORMED" });
		}
	});

	it("distinguishes absent and empty contexts and rejects duplicate message keys", () => {
		expect(() =>
			parsePoCatalog(
				`${header}msgid "Same"\nmsgstr "A"\n\nmsgid "Same"\nmsgstr "B"\n`,
			),
		).toThrow(/Duplicate PO message key/);
		expect(() =>
			parsePoCatalog(
				`${header}msgid "Same"\nmsgstr "A"\n\nmsgctxt ""\nmsgid "Same"\nmsgstr "B"\n`,
			),
		).not.toThrow();
	});

	it("QA-checks gettext format placeholders", async () => {
		const source = `${header}#, c-format
msgid "Deleted %2$d files for %1$s"
msgstr ""
`;
		const { project } = await importProject(source, "format.po", {}, [
			"Dateien gelöscht",
		]);
		expect(runProjectExportQuality(project).issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "MISSING_PLACEHOLDER",
					token: "%2$d",
				}),
			]),
		);
		project.translationData.seg2 = ["Für %1$s wurden %2$d Dateien gelöscht"];
		expect(runProjectExportQuality(project).valid).toBe(true);
	});

	it("preserves ISO-8859-1 catalogs and rejects unrepresentable targets", async () => {
		const source = `${header.replace("UTF-8", "ISO-8859-1")}msgid "Café"\nmsgstr ""\n`;
		const latin1 = Uint8Array.from(
			Array.from(source).map((character) => character.charCodeAt(0)),
		);
		const { result, project } = await importProject(latin1, "latin.po", {}, [
			"Été",
		]);
		expect(result.segments).toEqual(["Café"]);
		expect(result.document.metadata?.charset).toBe("iso-8859-1");
		const output = await bytes(buildPoTranslationBlob(project));
		expect(output).toContain(0xc9);
		expect(output).toContain(0xe9);
		project.translationData.seg2 = ["Hallo 👋"];
		expect(() => buildPoTranslationBlob(project)).toThrow(
			/cannot be represented/,
		);
	});

	it("decodes C escapes and preserves identity bytes", async () => {
		const source = `${header}msgid "Line\\nTab\\tQuote\\\""
msgstr "Zeile\\nTab\\tZitat\\\""
`;
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual(['Line\nTab\tQuote"']);
		expect(result.targetSegments).toEqual(['Zeile\nTab\tZitat"']);
		expect(await bytes(buildPoTranslationBlob(project))).toEqual(
			new TextEncoder().encode(source),
		);
	});

	it("rejects malformed grammar and blocks structural edits or stale mappings", async () => {
		for (const source of [
			'msgid "Missing translation"\n',
			'msgid "Broken\nmsgstr ""\n',
			'msgid "One"\nmsgstr "A"\nmsgstr "B"\n',
		]) {
			await expect(
				validatePoFile(new File([source], "broken.po")),
			).resolves.toMatchObject({ valid: false, errorCode: "PO_MALFORMED" });
		}
		const { project } = await importProject(
			`${header}msgid "Hello"\nmsgstr ""\n`,
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton)
			throw new Error("Expected PO skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 5;
		expect(() => buildPoTranslation(project)).toThrow(/do not align uniquely/);
	});

	it("produces a catalog accepted by GNU msgfmt when the tool is available", async () => {
		const source = `${header}#, c-format
msgid "Found %d file"
msgid_plural "Found %d files"
msgstr[0] ""
msgstr[1] ""
`;
		const { project } = await importProject(source, "valid.po", {}, [
			"%d Datei gefunden",
			"%d Dateien gefunden",
		]);
		const output = buildPoTranslation(project);
		const directory = mkdtempSync(join(tmpdir(), "opentlc-po-"));
		try {
			const input = join(directory, "messages.po");
			const destination = join(directory, "messages.mo");
			writeFileSync(input, output, "utf8");
			const checked = spawnSync(
				"msgfmt",
				["--check", "--check-format", "-o", destination, input],
				{ encoding: "utf8", timeout: 5_000 },
			);
			if (
				checked.error &&
				"code" in checked.error &&
				checked.error.code === "ENOENT"
			)
				return;
			expect(checked.status, checked.stderr).toBe(0);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("imports a 1,000-message catalog deterministically", async () => {
		const source = `${header}${Array.from(
			{ length: 1_000 },
			(_, index) => `msgid "Message ${index}"\nmsgstr ""\n`,
		).join("\n")}`;
		const first = await importPoFile(new File([source], "large.po"));
		const second = await importPoFile(new File([source], "large.po"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
