// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../test/fixtures";
import type { DocxSegmentMeta, HtmlSegmentMeta } from "$lib/types/types";
import {
	reconstructJsonFromValues,
	type JsonMetaEntry,
} from "../outputGeneration/outputGenerationJson";
import { applyTranslationsToDocxXml, segmentDocxXml } from "./parsingDocx";
import {
	applyTranslationsToHtml,
	segmentHtmlContent,
	type HtmlMeta,
} from "./parsingHtml";
import {
	combineSegmentData,
	combineSegmentRangeData,
	findSplitPoint,
	splitSegmentData,
} from "./segmentationLogic";

describe("segment splitting", () => {
	it("splits at a source caret and keeps the existing target in the first half", () => {
		const data = makeUserData({
			seg1: ["Hello world"],
			seg2: ["Hallo Welt"],
			checked: [true],
		}).translationData;
		const result = splitSegmentData(data, 0, 6);

		expect(result.error).toBeUndefined();
		expect(result.data.seg1).toEqual(["Hello ", "world"]);
		expect(result.data.seg2).toEqual(["Hallo Welt", ""]);
		expect(result.data.checked).toEqual([false, false]);
		expect(data.seg1).toEqual(["Hello world"]);
	});

	it.each([0, 11, -1, 1.5])(
		"rejects an invalid split offset of %s without changing data",
		(splitAt) => {
			const data = makeUserData({
				seg1: ["Hello world"],
				seg2: ["Hallo Welt"],
				checked: [false],
			}).translationData;
			const result = splitSegmentData(data, 0, splitAt);

			expect(result.error).toMatch(/caret inside/);
			expect(result.data).toBe(data);
		},
	);

	it("rejects invalid indices and misaligned segment arrays", () => {
		const data = makeUserData().translationData;
		expect(splitSegmentData(data, -1, 1).error).toBe("Invalid segment index.");
		expect(splitSegmentData(data, 2, 1).error).toBe("Invalid segment index.");

		const misaligned = makeUserData({ checked: [] }).translationData;
		const result = splitSegmentData(misaligned, 0, 1);
		expect(result.error).toMatch(/out of sync/);
		expect(result.data).toBe(misaligned);
	});

	it("moves a JSON separator to the final half and preserves output", () => {
		const sourceJson = { message: "Hello. " };
		const data = makeUserData({
			type: "json",
			typeRef: { data: sourceJson } as any,
			seg1: ["Hello. "],
			seg2: ["Hallo. "],
			checked: [true],
			segmentsMeta: [{ path: ["message"], separator: ". " }],
		}).translationData;
		const result = splitSegmentData(data, 0, 5);

		expect(result.error).toBeUndefined();
		expect(result.data.segmentsMeta).toEqual([
			{ path: ["message"], separator: "" },
			{ path: ["message"], separator: ". " },
		]);
		expect(result.data.seg2).toEqual(["Hallo", ""]);
		expect(
			reconstructJsonFromValues(
				sourceJson,
				result.data.seg2,
				result.data.segmentsMeta as JsonMetaEntry[],
			),
		).toEqual({ message: "Hallo. " });

		const joinedAgain = combineSegmentData(result.data, 0);
		expect(joinedAgain.data.seg2).toEqual(["Hallo. "]);
		expect(joinedAgain.data.segmentsMeta).toEqual([
			{ path: ["message"], separator: ". " },
		]);
	});

	it("preserves complete HTML attribute metadata on both halves", () => {
		const entry: HtmlSegmentMeta = {
			kind: "attribute",
			path: [0],
			attribute: "title",
			separator: " ",
		};
		const data = makeUserData({
			type: "html",
			typeRef: '<p title="Hello world ">x</p>',
			seg1: ["Hello world "],
			seg2: ["Hallo Welt "],
			checked: [false],
			segmentsMeta: [entry],
		}).translationData;
		const result = splitSegmentData(data, 0, 6);

		expect(result.error).toBeUndefined();
		expect(result.data.segmentsMeta).toEqual([
			{ ...entry, path: [0], separator: "" },
			{ ...entry, path: [0], separator: " " },
		]);
		const output = applyTranslationsToHtml(
			data.typeRef as string,
			result.data.seg2,
			undefined,
			result.data.segmentsMeta as HtmlMeta[],
		);
		const doc = new DOMParser().parseFromString(output, "text/html");
		expect(doc.querySelector("p")?.getAttribute("title")).toBe("Hallo Welt ");
	});

	it("splits DOCX fragment ranges and keeps the mapped output intact", () => {
		const xml =
			'<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello world</w:t></w:r></w:p></w:body></w:document>';
		const segmented = segmentDocxXml(xml, []);
		const data = makeUserData({
			type: "docx",
			typeRef: { "word/document.xml": xml },
			seg1: ["Hello world"],
			seg2: ["Hallo Welt"],
			checked: [true],
			segmentsMeta: segmented.meta,
		}).translationData;
		const result = splitSegmentData(data, 0, 6);
		const meta = result.data.segmentsMeta as DocxSegmentMeta[];

		expect(result.error).toBeUndefined();
		expect(meta[0].fragments[0]).toMatchObject({ start: 0, end: 6 });
		expect(meta[1].fragments[0]).toMatchObject({ start: 6, end: 11 });
		const output = applyTranslationsToDocxXml(xml, result.data.seg2, [], meta);
		expect(output).toContain("Hallo Welt");
	});

	it("blocks structural editing when metadata is absent", () => {
		const data = makeUserData({
			type: "html",
			typeRef: "<p>Hello</p>",
			seg1: ["Hello"],
			seg2: ["Hallo"],
			checked: [false],
			segmentsMeta: [],
		}).translationData;
		const result = splitSegmentData(data, 0, 2);

		expect(result.error).toMatch(/metadata is missing or out of sync/);
		expect(result.data).toBe(data);
	});
});

describe("segment joining", () => {
	it("joins adjacent text segments and preserves confirmation semantics", () => {
		const data = makeUserData({
			seg1: ["One ", "two"],
			seg2: ["Eins ", "zwei"],
			checked: [true, false],
		}).translationData;
		const result = combineSegmentData(data, 0);

		expect(result.error).toBeUndefined();
		expect(result.data.seg1).toEqual(["One two"]);
		expect(result.data.seg2).toEqual(["Eins zwei"]);
		expect(result.data.checked).toEqual([false]);
	});

	it("retains the final JSON separator and reconstructs the field", () => {
		const sourceJson = { message: "One. Two!" };
		const data = makeUserData({
			type: "json",
			typeRef: { data: sourceJson } as any,
			seg1: ["One. ", "Two!"],
			seg2: ["Eins. ", "Zwei!"],
			checked: [true, true],
			segmentsMeta: [
				{ path: ["message"], separator: " " },
				{ path: ["message"], separator: "!" },
			],
		}).translationData;
		const result = combineSegmentData(data, 0);

		expect(result.data.segmentsMeta).toEqual([
			{ path: ["message"], separator: "!" },
		]);
		expect(
			reconstructJsonFromValues(
				sourceJson,
				result.data.seg2,
				result.data.segmentsMeta as JsonMetaEntry[],
			),
		).toEqual({ message: "Eins. Zwei!" });
	});

	it("rejects joining different JSON fields without mutating input", () => {
		const data = makeUserData({
			type: "json",
			seg1: ["One", "Two"],
			seg2: ["Eins", "Zwei"],
			checked: [false, false],
			segmentsMeta: [{ path: ["one"] }, { path: ["two"] }],
		}).translationData;
		const snapshot = structuredClone(data);
		const result = combineSegmentData(data, 0);

		expect(result.error).toMatch(/different JSON fields/);
		expect(result.data).toBe(data);
		expect(data).toEqual(snapshot);
	});

	it("round-trips joined HTML text through its original node", () => {
		const html = "<p>Hello. Next!</p>";
		const segmented = segmentHtmlContent(html, [".", "!"]);
		const data = makeUserData({
			type: "html",
			typeRef: html,
			seg1: segmented.allSegments,
			seg2: ["Hallo. ", "Weiter!"],
			checked: [false, false],
			segmentsMeta: segmented.meta,
		}).translationData;
		const result = combineSegmentData(data, 0);

		expect(result.error).toBeUndefined();
		const output = applyTranslationsToHtml(
			html,
			result.data.seg2,
			[".", "!"],
			result.data.segmentsMeta as HtmlMeta[],
		);
		expect(output).toContain("Hallo. Weiter!");
	});

	it("rejects joining different HTML attributes on the same element", () => {
		const data = makeUserData({
			type: "html",
			seg1: ["Title", "Alternative"],
			seg2: ["Titel", "Alternative"],
			checked: [false, false],
			segmentsMeta: [
				{ kind: "attribute", path: [0], attribute: "title" },
				{ kind: "attribute", path: [0], attribute: "alt" },
			],
		}).translationData;
		const result = combineSegmentData(data, 0);

		expect(result.error).toMatch(/different HTML nodes or attributes/);
		expect(result.data).toBe(data);
	});

	it("joins DOCX fragments only within a paragraph", () => {
		const base = {
			textNodeIndex: 0,
			start: 0,
			end: 4,
		};
		const sameParagraph = makeUserData({
			type: "docx",
			seg1: ["One ", "two"],
			seg2: ["Eins ", "zwei"],
			checked: [false, false],
			segmentsMeta: [
				{ fragments: [{ ...base, paragraphIndex: 0 }] },
				{
					separator: "!",
					fragments: [{ ...base, paragraphIndex: 0, start: 4, end: 7 }],
				},
			],
		}).translationData;
		const joined = combineSegmentData(sameParagraph, 0);

		expect(joined.error).toBeUndefined();
		expect(joined.data.segmentsMeta).toEqual([
			{
				separator: "!",
				fragments: [
					{ ...base, paragraphIndex: 0 },
					{ ...base, paragraphIndex: 0, start: 4, end: 7 },
				],
			},
		]);

		const crossParagraph = structuredClone(sameParagraph);
		(
			crossParagraph.segmentsMeta?.[1] as DocxSegmentMeta
		).fragments[0].paragraphIndex = 1;
		const rejected = combineSegmentData(crossParagraph, 0);
		expect(rejected.error).toMatch(/paragraph boundaries/);
		expect(rejected.data).toBe(crossParagraph);
	});

	it("joins a consecutive range atomically", () => {
		const data = makeUserData({
			seg1: ["One ", "two ", "three"],
			seg2: ["Eins ", "zwei ", "drei"],
			checked: [true, true, true],
		}).translationData;
		const result = combineSegmentRangeData(data, [0, 1, 2]);

		expect(result.error).toBeUndefined();
		expect(result.data.seg1).toEqual(["One two three"]);
		expect(result.data.seg2).toEqual(["Eins zwei drei"]);
		expect(result.data.checked).toEqual([true]);
		expect(data.seg1).toHaveLength(3);
	});

	it("returns the original data if a later range pair is incompatible", () => {
		const data = makeUserData({
			type: "json",
			seg1: ["One ", "two ", "three"],
			seg2: ["Eins ", "zwei ", "drei"],
			checked: [false, false, false],
			segmentsMeta: [
				{ path: ["first"] },
				{ path: ["first"] },
				{ path: ["second"] },
			],
		}).translationData;
		const result = combineSegmentRangeData(data, [0, 1, 2]);

		expect(result.error).toMatch(/different JSON fields/);
		expect(result.data).toBe(data);
		expect(data.seg1).toHaveLength(3);
	});

	it("rejects non-consecutive or duplicate range selections", () => {
		const data = makeUserData({
			seg1: ["one", "two", "three"],
			seg2: ["eins", "zwei", "drei"],
			checked: [false, false, false],
		}).translationData;
		expect(combineSegmentRangeData(data, [0, 2]).error).toMatch(/consecutive/);
		expect(combineSegmentRangeData(data, [1, 1]).error).toMatch(/consecutive/);
	});

	it("blocks XLSX edits instead of shifting worksheet translations", () => {
		const data = makeUserData({
			type: "xlsx",
			seg1: ["one", "two"],
			seg2: ["eins", "zwei"],
			checked: [false, false],
		}).translationData;

		expect(splitSegmentData(data, 0, 1).error).toMatch(/cell alignment/);
		expect(combineSegmentData(data, 0).error).toMatch(/cell alignment/);
	});

	it("rejects invalid pair indices", () => {
		const data = makeUserData().translationData;
		expect(combineSegmentData(data, -1).error).toBe("Invalid segment index.");
		expect(combineSegmentData(data, 0).error).toBe("Invalid segment index.");
	});
});

describe("split-point suggestion", () => {
	it("finds a readable midpoint and handles empty text", () => {
		expect(findSplitPoint("alpha beta gamma")).toBe(11);
		expect(findSplitPoint("ab")).toBe(1);
		expect(findSplitPoint("")).toBe(0);
	});
});
