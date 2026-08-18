import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../../test/fixtures";
import { buildXliff2_0 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
import { buildXliff1_2 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile1_2";
import {
	extractXliff1_2Data,
	extractXliff2_0Data,
	getXliffVersion,
	validateJsonData,
	validateXliff1_2Data,
	validateXliff2_0Data,
} from "./saveFileFunctions";

describe("save-file validation", () => {
	it("recognizes strict XLIFF 1.2 and its standard OpenTLC metadata note", () => {
		const doc = new DOMParser().parseFromString(
			buildXliff1_2(makeUserData()),
			"application/xml",
		);
		expect(getXliffVersion(doc)).toBe(1.2);
		expect(validateXliff1_2Data(doc)).toBe(true);

		const extracted = extractXliff1_2Data(doc, true);
		expect(extracted).toMatchObject({
			id: 7,
			translationData: {
				name: "Example",
				sourceLang: "en",
				targetLang: "de",
				seg1: ["Hello & welcome."],
				seg2: ["Hallo & willkommen."],
				checked: [true],
			},
		});
	});

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
				translationData: {
					...makeUserData().translationData,
					type: "unsupported-format",
				},
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
