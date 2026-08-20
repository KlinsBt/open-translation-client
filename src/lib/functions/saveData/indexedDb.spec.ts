import { afterEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../../test/fixtures";
import {
	contentToPlainText,
	createNeutralDocument,
} from "$lib/formats/documentModel";
import { assertLocalStorageCapacity, ensureProjectModels } from "./indexedDb";

afterEach(() => vi.unstubAllGlobals());

describe("neutral document persistence compatibility", () => {
	it("backfills old projects with an aligned, deterministic document model", () => {
		const userData = makeUserData({
			creationDate: "123",
			seg1: ["One", "Two"],
			seg2: ["Eins", ""],
			checked: [true, false],
			typeRef: "OneTwo",
		});

		ensureProjectModels(userData);
		const document = userData.translationData.documentModel!;
		expect(userData.schemaVersion).toBe(1);
		expect(document.id).toBe("project-123");
		expect(document.units.map((unit) => unit.id)).toEqual(["unit-1", "unit-2"]);
		expect(
			document.units.map((unit) => contentToPlainText(unit.target)),
		).toEqual(["Eins", ""]);
		expect(userData.translationData.skeleton).toMatchObject({
			schemaVersion: 1,
			format: "text",
			payload: { kind: "text", content: "OneTwo" },
		});
		expect(userData.translationData.filterOptions).toEqual({
			segmentationMode: "preferences",
			outputEncoding: "source",
			byteOrderMark: "preserve",
			unicodeNormalization: "preserve",
		});
	});

	it("keeps existing unit IDs while synchronizing edited target text", () => {
		const document = createNeutralDocument({
			format: "text",
			sourceSegments: ["Hello"],
			targetSegments: [""],
			unitIds: ["source-message-id"],
		});
		const userData = makeUserData({
			seg1: ["Hello"],
			seg2: ["Hallo"],
			checked: [true],
			documentModel: document,
		});

		ensureProjectModels(userData);
		expect(userData.translationData.documentModel?.units[0].id).toBe(
			"source-message-id",
		);
		expect(
			contentToPlainText(
				userData.translationData.documentModel!.units[0].target,
			),
		).toBe("Hallo");
		expect(userData.translationData.documentModel?.units[0].state).toBe(
			"reviewed",
		);
	});

	it("retains ODF package replacement mappings during persistence normalization", () => {
		const userData = makeUserData({
			type: "odf",
			seg1: ["Template"],
			seg2: ["Vorlage"],
			checked: [true],
			typeRef: {
				profile: "ott",
				mimeType: "application/vnd.oasis.opendocument.text-template",
			},
			segmentsMeta: [
				{
					profile: "odf-ott",
					part: "content.xml",
					path: ["office:document-content[1]", "text:p[1]", "#text"],
					location: "text",
					start: 16,
					end: 24,
					originalValue: "Template",
				},
			],
			skeleton: {
				schemaVersion: 1,
				format: "odf",
				source: { name: "template.ott", mimeType: "application/zip" },
				payload: {
					kind: "package",
					parts: { "content.xml": "<text:p>Template</text:p>" },
				},
				replacements: [
					{
						kind: "package-xml-value",
						unitIndex: 0,
						profile: "ott-1.2/1.3",
						part: "content.xml",
						path: ["text:p[1]", "#text"],
						location: "text",
						start: 8,
						end: 16,
						originalValue: "Template",
					},
				],
			},
		});

		ensureProjectModels(userData);
		expect(userData.translationData.skeleton?.replacements).toHaveLength(1);
		expect(userData.translationData.skeleton?.replacements[0]).toMatchObject({
			kind: "package-xml-value",
			profile: "ott-1.2/1.3",
			part: "content.xml",
			originalValue: "Template",
		});
	});

	it("preflights browser quota with a helpful large-import error", async () => {
		vi.stubGlobal("navigator", {
			storage: {
				estimate: async () => ({ quota: 10_000_000, usage: 9_500_000 }),
			},
		});
		await expect(assertLocalStorageCapacity(1_000_000)).rejects.toThrow(
			/about 8 MB.*only 0 MB is available/i,
		);
	});
});
