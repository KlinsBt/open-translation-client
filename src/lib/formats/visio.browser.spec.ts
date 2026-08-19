import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { makeUserData } from "../../test/fixtures";
import { createVisioPackage } from "../../test/visioFixtures";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import {
	buildVisioTranslation,
	generateVisioTranslation,
	importVisioFile,
	validateVisioFile,
} from "./visio";

describe("FF-506 Visio browser workflow", () => {
	it("persists, restores, exports, and independently reopens a macro-enabled drawing", async () => {
		const source = await createVisioPackage({
			extension: "vsdm",
			shapeText: "Browser source مرحبا",
			includeMacro: true,
		});
		const imported = await importVisioFile(source, {
			includeMetadata: false,
			includePageNames: false,
			includeMasterNames: false,
			includeShapeData: false,
		});
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const targets = imported.segments.map((entry) => `Translated ${entry}`);
		const project = makeUserData({
			type: "visio",
			name: `ff506-${Date.now()}.vsdm`,
			typeRef: imported.typeRef!,
			seg1: imported.segments,
			seg2: targets,
			checked: targets.map(() => true),
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === project.translationData.name,
		);
		expect(restored?.translationData.type).toBe("visio");
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);
		const output = await buildVisioTranslation(restored!);
		expect(output.extension).toBe("vsdm");
		const translated = new File([output.blob], "translated.vsdm", {
			type: "application/vnd.visio",
		});
		expect(await validateVisioFile(translated)).toEqual({ valid: true });
		const reopened = await importVisioFile(translated, imported.filterOptions);
		expect(reopened.kind === "segments" && reopened.segments).toEqual(targets);
		const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
		expect(await zip.file("visio/vbaProject.bin")?.async("uint8array")).toEqual(
			new Uint8Array([86, 66, 65, 0, 1, 2]),
		);

		let downloadedBlob: Blob | undefined;
		let downloadedName = "";
		vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
			if (value instanceof Blob) downloadedBlob = value;
			return "blob:ff506";
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloadedName = this.download;
		});
		await generateVisioTranslation(restored!);
		expect(downloadedName).toMatch(/\.translated\.vsdm$/);
		expect(downloadedBlob?.type).toBe("application/vnd.visio");
		vi.restoreAllMocks();
	});
});
