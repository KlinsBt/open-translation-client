// @vitest-environment happy-dom

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildWindowsRcTranslation,
	buildWindowsRcTranslationBlob,
	encodeRcString,
} from "$lib/functions/outputGeneration/outputGenerationWindowsRc";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	decodeRcString,
	importWindowsRcFile,
	parseWindowsRcDocument,
	validateWindowsRcFile,
} from "./windowsRc";
import type { FormatOptionValues } from "./types";

const source = `#include "resource.h"
#define BUILD_LABEL "Internal build"
IDI_APP ICON "app.ico"

IDD_MAIN DIALOGEX 0, 0, 220, 90
STYLE DS_SETFONT | WS_POPUP | WS_CAPTION
CAPTION "Sample application"
FONT 9, "Segoe UI"
BEGIN
    LTEXT "Name:", IDC_STATIC, 7, 12, 40, 8
    CONTROL "Enable &feature", IDC_ENABLE, "Button", BS_AUTOCHECKBOX, 7, 28, 80, 10
    PUSHBUTTON "&Close", IDOK, 165, 68, 48, 14
END

IDR_MAIN MENU
BEGIN
    POPUP "&File"
    BEGIN
        MENUITEM "&Open...\\tCtrl+O", IDM_OPEN
        MENUITEM SEPARATOR
        MENUITEM "E&xit", IDM_EXIT
    END
END

STRINGTABLE
BEGIN
    IDS_GREETING "Hello, world!"
END

VS_VERSION_INFO VERSIONINFO
BEGIN
    BLOCK "StringFileInfo"
    BEGIN
        BLOCK "040904b0"
        BEGIN
            VALUE "FileDescription", "Sample application"
        END
    END
END
`;

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "resources.rc", {
		type: "text/x-windows-rc",
	});
	const result = await importWindowsRcFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected RC segments");
	return {
		result,
		project: makeUserData({
			type: "windows-rc",
			name: "resources.rc",
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

describe("Windows RC workflow", () => {
	it("extracts user-facing dialog, menu, string-table, and version values only", async () => {
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual([
			"Sample application",
			"Name:",
			"Enable &feature",
			"&Close",
			"&File",
			"&Open...\tCtrl+O",
			"E&xit",
			"Hello, world!",
			"Sample application",
		]);
		expect(result.segments).not.toContain("Segoe UI");
		expect(result.segments).not.toContain("Button");
		expect(result.segments).not.toContain("app.ico");
		expect(result.segments).not.toContain("Internal build");
		project.translationData.seg2 = result.segments.map(
			(value) => `DE ${value}`,
		);
		const output = buildWindowsRcTranslation(project);
		expect(output).toContain('CAPTION "DE Sample application"');
		expect(output).toContain(
			'CONTROL "DE Enable &feature", IDC_ENABLE, "Button"',
		);
		expect(output).toContain('FONT 9, "Segoe UI"');
		expect(output).toContain('IDI_APP ICON "app.ico"');
		expect(output).toContain('#define BUILD_LABEL "Internal build"');
	});

	it("offers explicit directive, VERSIONINFO, and preprocessor filters", async () => {
		const result = await importWindowsRcFile(
			new File([source], "resources.rc"),
			{
				translatableDirectives: "CAPTION",
				includeVersionInfo: false,
				includePreprocessor: true,
			},
		);
		if (result.kind !== "segments") throw new Error("Expected RC segments");
		expect(result.segments).toEqual([
			"Internal build",
			"Sample application",
			"Hello, world!",
		]);
	});

	it("decodes C escapes and exports quotes, controls, Unicode, and accelerators safely", async () => {
		expect(decodeRcString('Caf\\u00E9\\t&Open\\n\\"quoted\\"')).toBe(
			'Café\t&Open\n"quoted"',
		);
		expect(encodeRcString('Line\n"quoted" \\')).toBe(
			'Line\\n\\"quoted\\" \\\\',
		);
		const { project } = await importProject(
			'STRINGTABLE\nBEGIN\n IDS_TEXT "Text"\nEND\n',
		);
		project.translationData.seg2 = ['Café &Datei "neu"'];
		const output = buildWindowsRcTranslation(project);
		expect(parseWindowsRcDocument(output).strings.at(-1)?.value).toBe(
			'Café &Datei "neu"',
		);
	});

	it("rejects unterminated strings/comments and unbalanced resource blocks", async () => {
		const invalid = [
			'STRINGTABLE\nBEGIN\n IDS_TEXT "unterminated\nEND',
			"STRINGTABLE\nBEGIN\n /* unterminated",
			'STRINGTABLE\nBEGIN\n IDS_TEXT "Text"',
			"STRINGTABLE\nEND",
			'plain text "value"',
		];
		for (const content of invalid)
			await expect(
				validateWindowsRcFile(new File([content], "bad.rc")),
			).resolves.toMatchObject({ valid: false });
	});

	it("preserves UTF-16 identity bytes and reparses translated output", async () => {
		const bytes = encodeTextBytes(
			'STRINGTABLE\nBEGIN\n IDS_TEXT "Café"\nEND\n',
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(
				await buildWindowsRcTranslationBlob(project).arrayBuffer(),
			),
		).toEqual(bytes);
		project.translationData.seg2 = ["Kaffee"];
		const decoded = decodeTextBytes(
			new Uint8Array(
				await buildWindowsRcTranslationBlob(project).arrayBuffer(),
			),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain('IDS_TEXT "Kaffee"');
	});

	it("round-trips sentence segmentation and blocks stale structural edits", async () => {
		const { result, project } = await importProject(
			'STRINGTABLE\nBEGIN\n IDS_TEXT "First sentence. Second sentence."\nEND',
			{ segmentationMode: "sentences" },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = buildWindowsRcTranslation(project);
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		expect(() => buildWindowsRcTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 STRINGTABLE entries deterministically", async () => {
		const large = `STRINGTABLE\nBEGIN\n${Array.from(
			{ length: 1_000 },
			(_, index) => ` IDS_${index} "Message ${index}"`,
		).join("\n")}\nEND\n`;
		const first = await importWindowsRcFile(new File([large], "large.rc"));
		const second = await importWindowsRcFile(new File([large], "large.rc"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected RC segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it.skipIf(!process.env.OPENTLC_RUN_WINDRES)(
		"compiles translated resources with GNU windres when explicitly enabled",
		async () => {
			const executable = ["windres", "x86_64-w64-mingw32-windres"].find(
				(candidate) =>
					spawnSync(candidate, ["--version"], { encoding: "utf8" }).status ===
					0,
			);
			expect(executable).toBeTruthy();
			const { project } = await importProject(source);
			const directory = mkdtempSync(join(tmpdir(), "opentlc-rc-"));
			try {
				const rcPath = join(directory, "translated.rc");
				const headerPath = join(directory, "resource.h");
				writeFileSync(rcPath, buildWindowsRcTranslation(project));
				writeFileSync(
					headerPath,
					"#define IDI_APP 1\n#define IDD_MAIN 2\n#define IDC_STATIC -1\n#define IDC_ENABLE 3\n#define IDOK 1\n#define IDR_MAIN 4\n#define IDM_OPEN 5\n#define IDM_EXIT 6\n#define IDS_GREETING 7\n",
				);
				const outputPath = join(directory, "resources.res");
				const compiled = spawnSync(
					executable!,
					["-I", directory, "-i", rcPath, "-o", outputPath],
					{ encoding: "utf8" },
				);
				expect(compiled.stderr).toBe("");
				expect(compiled.status).toBe(0);
				expect(existsSync(outputPath)).toBe(true);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
