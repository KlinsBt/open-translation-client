// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildIniTranslation,
	buildIniTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationIni";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import { importIniFile, parseIni, validateIniFile } from "./iniFamily";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name: string,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "text/plain" });
	const result = await importIniFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected INI segments");
	return {
		result,
		project: makeUserData({
			type: "ini",
			name,
			seg1: result.segments,
			seg2: targets ?? result.targetSegments ?? [...result.segments],
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

describe("INI, desktop, and lang resource workflow", () => {
	it("requires explicit selectors for generic INI", async () => {
		await expect(
			importIniFile(new File(["title=Hello"], "messages.ini")),
		).rejects.toMatchObject({ code: "INI_SELECTION_REQUIRED" });
		await expect(
			validateIniFile(new File(["title=Hello"], "messages.ini")),
		).resolves.toMatchObject({ valid: true });
	});

	it("selects generic keys by section/key glob and preserves syntax and comments", async () => {
		const source = `# header
[ui]
; Window title
title : Hello
message_one=First
locked=Keep
[other]
title=Other`;
		const { result, project } = await importProject(
			source,
			"messages.ini",
			{ keySelectors: "ui.title, ui.message_*" },
			["Hallo", "Erste"],
		);
		expect(result.segments).toEqual(["Hello", "First"]);
		expect(result.document.units[0].notes[0]?.text).toBe("Window title");
		const output = buildIniTranslation(project);
		expect(output).toContain("title : Hallo");
		expect(output).toContain("locked=Keep");
		expect(output).toContain("[other]\ntitle=Other");
	});

	it("pairs existing desktop locale suffixes bilingually", async () => {
		const source = `[Desktop Entry]
Type=Application
Name=Editor
Name[de]=Editor DE
Comment=Edit files
Comment[de]=Dateien bearbeiten
Exec=editor %F`;
		const { result, project } = await importProject(source, "app.desktop", {
			targetLocale: "de",
		});
		expect(result.segments).toEqual(["Editor", "Edit files"]);
		expect(result.targetSegments).toEqual(["Editor DE", "Dateien bearbeiten"]);
		project.translationData.seg2[1] = "Dokumente bearbeiten";
		const output = buildIniTranslation(project);
		expect(output).toContain("Comment[de]=Dokumente bearbeiten");
		expect(output).toContain("Exec=editor %F");
	});

	it("inserts missing desktop locales beside their base keys", async () => {
		const source = "[Desktop Entry]\r\nName=Editor\r\nComment=Edit files\r\n";
		const { project } = await importProject(
			source,
			"app.desktop",
			{ targetLocale: "fr" },
			["Éditeur", "Modifier des fichiers"],
		);
		const output = buildIniTranslation(project);
		expect(output).toContain("Name=Editor\r\nName[fr]=Éditeur\r\n");
		expect(output).toContain(
			"Comment=Edit files\r\nComment[fr]=Modifier des fichiers\r\n",
		);
		const reimported = await importIniFile(new File([output], "app.desktop"), {
			targetLocale: "fr",
		});
		if (reimported.kind !== "segments") throw new Error("Expected segments");
		expect(reimported.targetSegments).toEqual([
			"Éditeur",
			"Modifier des fichiers",
		]);
	});

	it("handles desktop escapes and all-value lang profiles", async () => {
		const desktop = await importProject(
			"[Desktop Entry]\nKeywords=one\\;two\\;\nName=Leading\\sname",
			"app.desktop",
		);
		expect(desktop.result.segments).toEqual(["one;two;", "Leading name"]);
		const lang = await importProject(
			"hello=Hello\\nworld\nbye=Goodbye",
			"messages.lang",
		);
		expect(lang.result.segments).toEqual(["Hello\nworld", "Goodbye"]);
	});

	it("preserves duplicate keys as ordered values and records warnings", async () => {
		const { result } = await importProject(
			"[ui]\ntitle=One\ntitle=Two",
			"messages.ini",
			{ keySelectors: "ui.title" },
		);
		expect(result.segments).toEqual(["One", "Two"]);
		expect(result.document.metadata?.warnings).toContain(
			"Duplicate INI key ui.title.",
		);
	});

	it("preserves UTF-16 identity bytes and encodes changed escapes", async () => {
		const source = encodeTextBytes("[ui]\r\ntitle=Café\r\n", "utf-16be", true);
		const { project } = await importProject(
			source,
			"messages.ini",
			{ keySelectors: "ui.title" },
			["Café"],
		);
		expect(
			new Uint8Array(await buildIniTranslationBlob(project).arrayBuffer()),
		).toEqual(source);
		project.translationData.seg2 = ["Ligne\nDeux"];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildIniTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16be", hasBom: true });
		expect(decoded.text).toContain("title=Ligne\\nDeux");
	});

	it("blocks placeholders, malformed syntax, structural edits, and stale mappings", async () => {
		const { project } = await importProject(
			"message=Hello {name} %1$s",
			"messages.ini",
			{ keySelectors: "message" },
			["Hallo"],
		);
		expect(() => buildIniTranslation(project)).toThrow(/Export blocked/);
		for (const source of ["[missing", "=empty", "line without delimiter"])
			await expect(
				validateIniFile(new File([source], "bad.ini")),
			).resolves.toMatchObject({ valid: false, errorCode: "INI_MALFORMED" });
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		const stale = await importProject(
			"message=Hello",
			"messages.ini",
			{ keySelectors: "message" },
			["Hallo"],
		);
		if (!stale.project.translationData.skeleton)
			throw new Error("Expected skeleton");
		stale.project.translationData.skeleton.replacements[0].unitIndex = 9;
		expect(() => buildIniTranslation(stale.project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 selected values deterministically", async () => {
		const source = `[messages]\n${Array.from(
			{ length: 1_000 },
			(_, index) => `message_${index}=Message ${index}`,
		).join("\n")}`;
		const options = { keySelectors: "messages.message_*" };
		const first = await importIniFile(
			new File([source], "messages.ini"),
			options,
		);
		const second = await importIniFile(
			new File([source], "messages.ini"),
			options,
		);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
