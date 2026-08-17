import { describe, expect, it } from "vitest";
import { makeUserData } from "../../../test/fixtures";
import {
	contentToPlainText,
	createNeutralDocument,
} from "$lib/formats/documentModel";
import { ensureProjectModels } from "./indexedDb";

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
});
