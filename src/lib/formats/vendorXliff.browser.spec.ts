import { afterEach, describe, expect, it, vi } from "vitest";
import memoqFixture from "../../test/fixtures/xliff-profiles/sample.mqxliff?raw";
import wpmlFixture from "../../test/fixtures/xliff-profiles/wpml.xliff?raw";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { importXliffProjectStreaming } from "./streamingImporters";
import { buildVendorXliff, downloadVendorXliff } from "./vendorXliff";

afterEach(() => vi.restoreAllMocks());

function xliffFile(xml: string, name: string): File {
	return new File([xml], name, { type: "application/xliff+xml" });
}

describe("FF-503 browser-native vendor XLIFF workflows", () => {
	it("persists, restores, exports, and reopens memoQ XLIFF in the same profile", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(memoqFixture, "browser.mqxlf"),
		);
		imported.data.translationData.name = `ff503-browser-${Date.now()}`;
		imported.data.translationData.seg2[0] = "שלום 👩🏽‍💻";
		await updateAllTranslationsOnIndexedDB([imported.data]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) =>
				entry.translationData.name === imported.data.translationData.name,
		);
		expect(restored).toBeDefined();
		const output = buildVendorXliff(restored!);
		expect(output.extension).toBe("mqxlf");
		expect(output.contents).toContain('xmlns:mq="MQXliff"');
		const reopened = await importXliffProjectStreaming(
			xliffFile(output.contents, output.fileName),
		);
		expect(reopened.data.translationData.seg2[0]).toBe("שלום 👩🏽‍💻");
	});

	it("downloads WPML with its original alias and never executes embedded markup", async () => {
		(globalThis as Record<string, unknown>).__ff503Executed = false;
		const imported = await importXliffProjectStreaming(
			xliffFile(
				wpmlFixture.replace(
					"Today.",
					`Today.&lt;script&gt;globalThis.__ff503Executed=true&lt;/script&gt;`,
				),
				"wordpress.xlif",
			),
		);
		let downloaded: Blob | undefined;
		let downloadName = "";
		vi.spyOn(URL, "createObjectURL").mockImplementation((value) => {
			downloaded = value as Blob;
			return "blob:ff503";
		});
		vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
			this: HTMLAnchorElement,
		) {
			downloadName = this.download;
		});
		vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		const output = downloadVendorXliff(imported.data);
		expect(output.extension).toBe("xlif");
		expect(downloadName).toMatch(/\.xlif$/);
		expect(downloaded?.type).toBe("application/xliff+xml");
		expect((globalThis as Record<string, unknown>).__ff503Executed).toBe(false);
		const reparsed = new DOMParser().parseFromString(
			await downloaded!.text(),
			"application/xml",
		);
		expect(reparsed.querySelector("parsererror")).toBeNull();
		expect(reparsed.documentElement.localName).toBe("xliff");
	});
});
