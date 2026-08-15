import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../test/fixtures";
import { validateTbxFile } from "$lib/components/uploads/tbxUpload/tbxFileFunctions";
import { validateTmxFile } from "$lib/components/uploads/tmxUpload/tmxFileFunctions";
import {
	extractXliff2_0Data,
	validateXliff2_0Data,
} from "$lib/components/uploads/saveFileUploads/saveFileFunctions";
import { buildTextTranslation } from "../outputGeneration/outputGenerationText";
import { buildTbx } from "./generateTbx3SaveFile";
import { buildTmx } from "./generateTmxSaveFile1_4";
import { buildXliff1_2 } from "./generateXliffSaveFile1_2";
import { buildXliff2_0 } from "./generateXliffSaveFile2_0";

describe("translation output builders", () => {
	it("builds plain text without JSON quoting", () => {
		expect(buildTextTranslation(["Hallo", "Welt"])).toBe("Hallo Welt");
	});

	it("builds XLIFF 1.2 with escaped metadata and segments", () => {
		const output = buildXliff1_2(makeUserData({ name: 'A & "B"' }));
		expect(output).toContain("<sup:Name>A &amp; &quot;B&quot;</sup:Name>");
		expect(output).toContain("Hallo &amp; willkommen.");
	});

	it("builds namespace-valid XLIFF 2.0 accepted by the importer", () => {
		const output = buildXliff2_0(makeUserData());
		const doc = new DOMParser().parseFromString(output, "application/xml");
		const metadata = doc.getElementsByTagName("mda:metadata")[0];

		expect(metadata.namespaceURI).toBe("urn:oasis:names:tc:xliff:metadata:2.0");
		expect(validateXliff2_0Data(doc)).toBe(true);
	});

	it("round-trips segment metadata and reversible join boundaries in XLIFF", () => {
		const userData = makeUserData({
			type: "json",
			seg1: ["One. Two!"],
			seg2: ["Eins. Zwei!"],
			checked: [true],
			segmentsMeta: [{ path: ["message"], separator: "!" }],
			segmentJoinStates: [
				{
					targetSnapshot: "Eins. Zwei!",
					boundaries: [{ sourceOffset: 5, targetOffset: 6 }],
				},
			],
			parsingTokens: [".", "!"],
		});
		const output = buildXliff2_0(userData);
		const doc = new DOMParser().parseFromString(output, "application/xml");
		const restored = extractXliff2_0Data(doc, true).translationData;

		expect(restored.segmentsMeta).toEqual(
			userData.translationData.segmentsMeta,
		);
		expect(restored.segmentJoinStates).toEqual(
			userData.translationData.segmentJoinStates,
		);
		expect(restored.parsingTokens).toEqual([".", "!"]);
	});

	it("does not throw when optional XLIFF IDs are absent", () => {
		const userData = makeUserData();
		delete userData.id;
		expect(() => buildXliff1_2(userData)).not.toThrow();
		expect(() => buildXliff2_0(userData)).not.toThrow();
	});

	it("builds valid TMX and escapes names and segment text", () => {
		const output = buildTmx("English (en)", {
			id: 4,
			name: "A & B",
			terms: [
				{
					source: { lang: "en", segment: "one < two" },
					target: [{ lang: "de", segment: "eins & zwei" }],
				},
			],
		});
		const doc = new DOMParser().parseFromString(output, "application/xml");
		expect(validateTmxFile(doc)).toBe(true);
		expect(output).toContain("A &amp; B");
		expect(output).toContain("one &lt; two");
	});

	it("builds valid TBX with string and structured notes", () => {
		const output = buildTbx("English (en)", {
			id: 8,
			name: "Terms & Notes",
			entries: [
				{
					terms: [
						{ lang: "en", term: "file", notes: ["plain & note"] },
						{
							lang: "de",
							term: "Datei",
							notes: [{ type: "usage", text: "IT < term" }],
						},
					],
				},
			],
		});
		const doc = new DOMParser().parseFromString(output, "application/xml");
		expect(validateTbxFile(doc)).toBe(true);
		expect(output).toContain("Terms &amp; Notes");
		expect(output).toContain('<termNote type="usage">IT &lt; term</termNote>');
	});
});
