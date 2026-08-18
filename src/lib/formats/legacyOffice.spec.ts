import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { UserData } from "$lib/types/types";
import {
	buildLegacyOfficeTranslation,
	collectLegacyParagraphs,
	importLegacyOfficeFile,
	validateLegacyOfficeFile,
} from "./legacyOffice";

function projectFromImport(
	result: Awaited<ReturnType<typeof importLegacyOfficeFile>>,
	targets: string[],
): UserData {
	if (result.kind !== "segments") throw new Error("Expected segments");
	return {
		translationData: {
			name: "legacy.xls",
			targetLang: "de",
			sourceLang: "en",
			creationDate: "0",
			seg1: result.segments,
			seg2: targets,
			checked: result.segments.map(() => true),
			type: "legacy-office",
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

describe("browser-native legacy Office support", () => {
	it("finds and mutates paragraph runs without flattening their container", () => {
		const flow = {
			children: [
				{ paragraph: { runs: [{ text: "Hello " }, { text: "world" }] } },
				{ unrelated: true },
			],
		};
		const paragraphs = collectLegacyParagraphs(flow);
		expect(paragraphs.map(({ text }) => text)).toEqual(["Hello world"]);
		paragraphs[0].runs[0].text = "Hallo Welt";
		paragraphs[0].runs[1].text = "";
		expect(flow.children[0]).toMatchObject({
			paragraph: { runs: [{ text: "Hallo Welt" }, { text: "" }] },
		});
	});

	it("rejects an extension-only spoof without an OLE signature", async () => {
		const file = new File(["not an OLE document"], "fake.doc", {
			type: "application/msword",
		});
		expect((await validateLegacyOfficeFile(file)).valid).toBe(false);
		await expect(importLegacyOfficeFile(file)).rejects.toMatchObject({
			code: "LEGACY_OFFICE_INVALID",
		});
	});

	it("imports, writes, and reopens a real binary XLS workbook", async () => {
		const fixture = await readFile(
			resolve("Test files/xls_test_file_100_rows.xls"),
		);
		const source = new File([fixture], "legacy.xls", {
			type: "application/vnd.ms-excel",
		});
		expect(await validateLegacyOfficeFile(source)).toEqual({ valid: true });
		const imported = await importLegacyOfficeFile(source);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments.length).toBeGreaterThan(20);
		const translated = `Translated: ${imported.segments[0]}`;
		const targets = imported.segments.map((value, index) =>
			index === 0 ? translated : value,
		);
		const output = await buildLegacyOfficeTranslation(
			projectFromImport(imported, targets),
		);
		expect(output.extension).toBe("xls");
		const reopened = await importLegacyOfficeFile(
			new File([output.blob], "translated.xls", {
				type: "application/vnd.ms-excel",
			}),
		);
		expect(reopened.kind).toBe("segments");
		if (reopened.kind === "segments")
			expect(reopened.segments[0]).toBe(translated);
	});
});
