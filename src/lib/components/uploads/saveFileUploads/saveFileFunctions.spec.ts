import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../../test/fixtures";
import { buildXliff2_0 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
import {
	extractXliff2_0Data,
	getXliffVersion,
	validateJsonData,
	validateXliff2_0Data,
} from "./saveFileFunctions";

describe("save-file validation", () => {
	it("recognizes and extracts XLIFF 2.0 without swapping languages", () => {
		const doc = new DOMParser().parseFromString(
			buildXliff2_0(makeUserData()),
			"application/xml",
		);
		expect(getXliffVersion(doc)).toBe(2);
		expect(validateXliff2_0Data(doc)).toBe(true);

		const extracted = extractXliff2_0Data(doc, true);
		expect(extracted.translationData.sourceLang).toBe("en");
		expect(extracted.translationData.targetLang).toBe("de");
		expect(extracted.translationData.seg1).toEqual(["Hello & welcome."]);
		expect(extracted.translationData.seg2).toEqual(["Hallo & willkommen."]);
	});

	it("rejects malformed or unsupported JSON save files", () => {
		expect(validateJsonData(null)).toBe(false);
		expect(validateJsonData({ translationData: {} })).toBe(false);
		expect(validateJsonData(makeUserData({ type: "text" }))).toBe(true);
		expect(
			validateJsonData(
				makeUserData({ checked: [], seg1: ["one"], seg2: ["two"] }),
			),
		).toBe(false);
		expect(
			validateJsonData({
				...makeUserData(),
				translationData: { ...makeUserData().translationData, type: "pdf" },
			}),
		).toBe(false);
	});

	it("rejects XLIFF missing required language metadata", () => {
		const doc = new DOMParser().parseFromString(
			'<xliff version="2.0"><file id="1"/></xliff>',
			"application/xml",
		);
		expect(validateXliff2_0Data(doc)).toBe(false);
	});
});
