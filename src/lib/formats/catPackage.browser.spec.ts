import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import type { UserData } from "$lib/types/types";
import { PROJECT_SCHEMA_VERSION } from "./persistenceMigrations";
import {
	buildCatReturnPackage,
	generateCatReturnPackage,
	importCatPackageFile,
} from "./catPackage";
import type { FormatImportResult } from "./types";

afterEach(() => vi.restoreAllMocks());

function xliff(): string {
	return '<?xml version="1.0"?><xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2"><file original="a.txt" source-language="en" target-language="ar" datatype="plaintext"><body><trans-unit id="1"><source>Hello</source><target>Old</target></trans-unit></body></file></xliff>';
}

async function tipp(): Promise<File> {
	const resources = new JSZip();
	resources.file("job.xlf", xliff());
	resources.file("keep.bin", new Uint8Array([4, 2, 0]));
	const outer = new JSZip();
	outer.file(
		"manifest.xml",
		'<manifest xmlns="http://schema.interoperability-now.org/tipp/v1.5" packageId="browser" />',
	);
	outer.file(
		"resources.zip",
		await resources.generateAsync({ type: "uint8array" }),
	);
	return new File(
		[await outer.generateAsync({ type: "uint8array" })],
		"job.tipp",
	);
}

function project(imported: FormatImportResult, name: string): UserData {
	if (imported.kind !== "segments") throw new Error("Expected segments.");
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		translationData: {
			name,
			sourceLang: "en",
			targetLang: "ar",
			creationDate: "0",
			seg1: imported.segments,
			seg2: ["مرحبا 👩🏽‍💻"],
			checked: [true],
			type: "cat-package",
			typeRef: imported.typeRef ?? {},
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

describe("FF-505 browser CAT package workflows", () => {
	it("persists a nested TIPP skeleton in IndexedDB and reopens its response", async () => {
		const imported = await importCatPackageFile(await tipp());
		const name = `ff505-browser-${Date.now()}`;
		await updateAllTranslationsOnIndexedDB([project(imported, name)]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored?.translationData.typeRef).toMatchObject({
			packageProfile: "tipp",
			returnExtension: "tipp",
		});
		const output = await buildCatReturnPackage(restored!);
		const reopened = await importCatPackageFile(
			new File([output.blob], "response.tipp"),
		);
		expect(reopened.kind === "segments" ? reopened.targetSegments : []).toEqual(
			["مرحبا 👩🏽‍💻"],
		);
	});

	it("downloads the expected Transit return extension without executing package text", async () => {
		(globalThis as Record<string, unknown>).__ff505Executed = false;
		const zip = new JSZip();
		zip.file(
			"project.prj",
			'<Project SourceLanguage="ENG" TargetLanguage="DEU" />',
		);
		zip.file(
			"a.ENG",
			'<Transit><Seg SegID="1">&lt;script&gt;globalThis.__ff505Executed=true&lt;/script&gt;</Seg></Transit>',
		);
		zip.file("a.DEU", '<Transit><Seg SegID="1">Alt</Seg></Transit>');
		const input = new File(
			[await zip.generateAsync({ type: "uint8array" })],
			"browser.ppf",
		);
		const imported = await importCatPackageFile(input);
		let downloadName = "";
		vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:ff505");
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloadName = this.download;
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		const data = project(imported, "browser.ppf");
		if (imported.kind !== "segments") throw new Error("Expected segments.");
		data.translationData.seg2[0] = imported.segments[0];
		await generateCatReturnPackage(data);
		expect(downloadName).toBe("browser.translated.tpf");
		expect((globalThis as Record<string, unknown>).__ff505Executed).toBe(false);
	});
});
