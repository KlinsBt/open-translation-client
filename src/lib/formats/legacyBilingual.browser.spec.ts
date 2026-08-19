import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { PROJECT_SCHEMA_VERSION } from "./persistenceMigrations";
import {
	buildLegacyBilingualTranslation,
	generateLegacyBilingualTranslation,
	importLegacyBilingualFile,
} from "./legacyBilingual";
import type { FormatImportResult } from "./types";
import type { UserData } from "$lib/types/types";

afterEach(() => vi.restoreAllMocks());

function project(imported: FormatImportResult, name: string): UserData {
	if (imported.kind !== "segments") throw new Error("Expected segment import.");
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		translationData: {
			name,
			sourceLang: "en",
			targetLang: "ar",
			creationDate: "0",
			seg1: imported.segments,
			seg2: ["مرحبا 👩🏽‍💻"],
			checked: imported.segments.map(() => false),
			type: "legacy-bilingual",
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

describe("FF-504 browser-native legacy bilingual workflows", () => {
	it("persists a TXML skeleton in IndexedDB and reopens translated same-family output", async () => {
		const input = new File(
			[
				'<txml localeSource="en" localeTarget="ar"><body><segment segmentId="u1"><source>Hello</source><target>Old target</target></segment></body></txml>',
			],
			"browser.txml",
			{ type: "application/xml" },
		);
		const imported = await importLegacyBilingualFile(input);
		const name = `ff504-browser-${Date.now()}`;
		await updateAllTranslationsOnIndexedDB([project(imported, name)]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored).toBeDefined();
		const output = await buildLegacyBilingualTranslation(restored!);
		expect(output.extension).toBe("txml");
		const reopened = await importLegacyBilingualFile(
			new File([output.blob], "reopened.txml", { type: "application/xml" }),
		);
		expect(reopened.kind === "segments" && reopened.targetSegments).toEqual([
			"مرحبا 👩🏽‍💻",
		]);
	});

	it("downloads a same-family TTX file without evaluating imported markup", async () => {
		(globalThis as Record<string, unknown>).__ff504Executed = false;
		const input = new File(
			[
				'<TRADOStag><Body><Tu id="u1"><Tuv><ut>&lt;script&gt;globalThis.__ff504Executed=true&lt;/script&gt;</ut>Hello</Tuv><Tuv><ut>&lt;script&gt;globalThis.__ff504Executed=true&lt;/script&gt;</ut>Target</Tuv></Tu></Body></TRADOStag>',
			],
			"browser.ttx",
			{ type: "application/xml" },
		);
		const imported = await importLegacyBilingualFile(input);
		if (imported.kind !== "segments") throw new Error("Expected segments.");
		const target = imported.targetSegments?.[0] ?? "";
		const data = project(imported, "browser-download");
		data.translationData.seg2[0] = target.replace("Target", "Translated");
		let downloadName = "";
		let downloaded: Blob | undefined;
		vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
			downloaded = value as Blob;
			return "blob:ff504";
		});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloadName = this.download;
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		await generateLegacyBilingualTranslation(data);
		expect(downloadName).toBe("browser.translated.ttx");
		expect(downloaded).toBeInstanceOf(Blob);
		expect((globalThis as Record<string, unknown>).__ff504Executed).toBe(false);
		const parsed = new DOMParser().parseFromString(
			await downloaded!.text(),
			"application/xml",
		);
		expect(parsed.querySelector("parsererror")).toBeNull();
	});
});
