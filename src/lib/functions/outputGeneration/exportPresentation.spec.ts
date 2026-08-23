import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../test/fixtures";
import {
	constrainedExportPresentation,
	formatChangingExportPresentation,
} from "./exportPresentation";

describe("constrained export presentation", () => {
	it.each([
		["pdf", "Translated PDF", "flattened PDF"],
		["image-ocr", "Bilingual HTML OCR review", "HTML review"],
		["media-transcription", "Translated WebVTT transcript", "WebVTT"],
	] as const)(
		"describes the actual %s delivery instead of claiming an original-format round trip",
		(type, label, detail) => {
			const project = makeUserData({ type });
			const presentation = constrainedExportPresentation(
				project.translationData,
			);
			expect(presentation).toMatchObject({ label });
			expect(presentation?.description).toContain(detail);
			expect(presentation?.description).not.toMatch(/original source format/i);
		},
	);

	it("leaves native round-trip formats to their adapter presentation", () => {
		const project = makeUserData({ type: "text" });
		expect(constrainedExportPresentation(project.translationData)).toBeNull();
	});
});

describe("format-changing primary export presentation", () => {
	it.each([
		["sdlrpx", "SDLRPX return package"],
		["mqback", "MQBACK return package"],
		["txf", "TXF return package"],
		["tpf", "TPF return package"],
	] as const)("names the actual %s CAT delivery", (returnExtension, label) => {
		const data = makeUserData({
			type: "cat-package",
			typeRef: { returnExtension },
		}).translationData;
		expect(formatChangingExportPresentation(data)).toMatchObject({ label });
		expect(formatChangingExportPresentation(data)?.description).not.toMatch(
			/original source format/i,
		);
	});

	it("describes a changed binary Workbench DOC as an RTF conversion", () => {
		const data = makeUserData({
			type: "legacy-bilingual",
			typeRef: { profile: "workbench-ole", sourceExtension: "doc" },
			seg1: ["Source"],
			seg2: ["Übersetzt"],
			segmentsMeta: [
				{
					profile: "workbench-ole",
					unitId: "u1",
					originalSource: "Source",
					originalTarget: "Target",
					locked: false,
					status: "100",
				},
			],
		}).translationData;
		expect(formatChangingExportPresentation(data)).toMatchObject({
			label: "RTF conversion",
		});
	});

	it("does not relabel an unchanged binary Workbench identity export", () => {
		const data = makeUserData({
			type: "legacy-bilingual",
			typeRef: { profile: "workbench-ole", sourceExtension: "doc" },
			seg1: ["Source"],
			seg2: ["Target"],
			segmentsMeta: [
				{
					profile: "workbench-ole",
					unitId: "u1",
					originalSource: "Source",
					originalTarget: "Target",
					locked: false,
					status: "100",
				},
			],
		}).translationData;
		expect(formatChangingExportPresentation(data)).toBeNull();
	});
});
