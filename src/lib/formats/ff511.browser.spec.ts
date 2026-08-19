import { describe, expect, it } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { makeUserData } from "../../test/fixtures";
import {
	buildAuxiliaryResourceTranslationBlob,
	importAuxiliaryResourceFile,
} from "./auxiliaryResources";

const MAP = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <node ID="ROOT" TEXT="Browser root مرحبا" LINK="https://example.invalid/inert">
    <node ID="CHILD">
      <richcontent TYPE="NODE"><html><head><script>neverRun()</script></head><body><p>Browser rich text</p></body></html></richcontent>
      <arrowlink DESTINATION="ROOT"/>
    </node>
  </node>
</map>`;

describe("FF-511 browser persistence and FreeMind round trip", () => {
	it("persists, restores, exports, and independently reopens a FreeMind map", async () => {
		const name = `ff511-${Date.now()}.mm`;
		const imported = await importAuxiliaryResourceFile(
			new File([MAP], name, { type: "application/x-freemind" }),
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const project = makeUserData({
			type: "auxiliary-resources",
			name,
			seg1: imported.segments,
			seg2: ["Browser-Wurzel שלום", "Browser-Richtext مرحبا"],
			checked: [true, true],
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored?.translationData.type).toBe("auxiliary-resources");
		expect(restored?.translationData.filterOptions).toMatchObject({
			profile: "freemind",
			includeFreeMindNotes: true,
		});
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);

		const output = await buildAuxiliaryResourceTranslationBlob(
			restored!,
		).text();
		const document = new DOMParser().parseFromString(output, "application/xml");
		expect(document.querySelector("parsererror")).toBeNull();
		expect(
			document.querySelector('node[ID="ROOT"]')?.getAttribute("TEXT"),
		).toBe("Browser-Wurzel שלום");
		expect(document.querySelector("p")?.textContent).toBe(
			"Browser-Richtext مرحبا",
		);
		expect(document.querySelector("script")?.textContent).toBe("neverRun()");
		expect(
			document.querySelector("arrowlink")?.getAttribute("DESTINATION"),
		).toBe("ROOT");

		const reopened = await importAuxiliaryResourceFile(
			new File([output], "reopened.mm", {
				type: "application/x-freemind",
			}),
		);
		expect(reopened.kind === "segments" ? reopened.segments : []).toEqual([
			"Browser-Wurzel שלום",
			"Browser-Richtext مرحبا",
		]);
	});
});
