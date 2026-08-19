import { writePsdUint8Array } from "ag-psd";
import { describe, expect, it } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { makeUserData } from "../../test/fixtures";
import { buildPsdTranslationBlob, importPsdFile } from "./psd";
import { buildQuarkTranslationBlob, importQuarkFile } from "./quark";

function project(
	type: "quark" | "psd",
	name: string,
	result: Awaited<ReturnType<typeof importQuarkFile | typeof importPsdFile>>,
	target: string,
) {
	if (result.kind !== "segments") throw new Error("Expected segments");
	return makeUserData({
		type,
		name,
		seg1: result.segments,
		seg2: result.segments.map(() => target),
		checked: result.segments.map(() => true),
		typeRef: result.typeRef ?? {},
		segmentsMeta: result.segmentsMeta,
		documentModel: result.document,
		skeleton: result.skeleton,
		filterOptions: result.filterOptions,
	});
}

describe("FF-507 browser persistence", () => {
	it("restores XPress Tags source bytes and translated native output", async () => {
		const name = `ff507-${Date.now()}.xtg`;
		const imported = await importQuarkFile(
			new File(["<v21.00><e9>\nBrowser source مرحبا"], name),
		);
		await updateAllTranslationsOnIndexedDB([
			project("quark", name, imported, "Browser target عالم"),
		]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored?.translationData.type).toBe("quark");
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);
		const output = buildQuarkTranslationBlob(restored!);
		const reopened = await importQuarkFile(
			new File([output], "translated.xtg"),
		);
		expect(reopened.kind === "segments" && reopened.segments).toEqual([
			"Browser target عالم",
		]);
	});

	it("restores the exact original PSD and exports translated SVG locally", async () => {
		const name = `ff507-${Date.now()}.psd`;
		const source = new File(
			[
				writePsdUint8Array({
					width: 320,
					height: 180,
					children: [
						{
							name: "Browser text",
							left: 10,
							top: 20,
							right: 300,
							bottom: 60,
							text: {
								text: "PSD source مرحبا",
								transform: [1, 0, 0, 1, 10, 20],
								style: { fontSize: 20 },
							},
						},
					],
				}),
			],
			name,
			{ type: "image/vnd.adobe.photoshop" },
		);
		const imported = await importPsdFile(source);
		await updateAllTranslationsOnIndexedDB([
			project("psd", name, imported, "PSD target عالم"),
		]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);
		const output = buildPsdTranslationBlob(restored!);
		expect(output.type).toBe("image/svg+xml;charset=utf-8");
		const parsed = new DOMParser().parseFromString(
			await output.text(),
			"image/svg+xml",
		);
		expect(parsed.documentElement.localName).toBe("svg");
		expect(parsed.documentElement.textContent).toContain("PSD target عالم");
	});
});
