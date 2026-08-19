import { describe, expect, it } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { makeUserData } from "../../test/fixtures";
import {
	buildSpecialistXmlTranslationBlob,
	importSpecialistXmlFile,
} from "./specialistXml";

describe("FF-508 browser persistence", () => {
	it("restores MULIX structure and exports a translated native file", async () => {
		const name = `ff508-${Date.now()}.mulix`;
		const source = `<mulix source-language="en" target-language="de"><entry id="one"><source>Browser <b>source مرحبا</b></source><target>Browser <b>target Hallo</b></target><note>Keep this metadata</note></entry></mulix>`;
		const imported = await importSpecialistXmlFile(new File([source], name));
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const project = makeUserData({
			type: "specialist-xml",
			name,
			seg1: imported.segments,
			seg2: ["Navigateur", "cible عالم"],
			checked: imported.segments.map(() => true),
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
		expect(restored?.translationData.typeRef).toMatchObject({
			profile: "mulix",
			sourceExtension: "mulix",
		});
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);

		const output = buildSpecialistXmlTranslationBlob(restored!);
		const reopened = await importSpecialistXmlFile(
			new File([output], "translated.mulix"),
		);
		expect(reopened.kind).toBe("segments");
		if (reopened.kind !== "segments") throw new Error("Expected segments");
		expect(reopened.segments).toEqual(["Browser", "source مرحبا"]);
		expect(reopened.targetSegments).toEqual(["Navigateur", "cible عالم"]);
		expect(await output.text()).toContain("Keep this metadata");
	});
});
