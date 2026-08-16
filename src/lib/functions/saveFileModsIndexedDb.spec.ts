import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNeutralDocument } from "$lib/formats/documentModel";
import { createSkeletonFromLegacy } from "$lib/formats/skeleton";

const mocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock("./saveData/indexedDb", () => ({
	updateTranslationOnIndexedDB: mocks.update,
}));

import {
	saveNewTranslationToUserDataFromArrayOfStrings,
	saveNewTranslationToUserDataFromText,
} from "./saveFileModsIndexedDb";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.update.mockResolvedValue(undefined);
});

describe("new-project neutral model persistence", () => {
	it("creates an aligned model for legacy text creation calls", async () => {
		const projects: any[] = [];
		await saveNewTranslationToUserDataFromText(
			projects,
			"Notes",
			"en",
			"de",
			"123",
			"Hello world.",
			"text",
		);

		const saved = mocks.update.mock.calls[0][0];
		expect(saved.translationData.documentModel).toMatchObject({
			id: "project-123",
			format: "text",
			sourceLanguage: "en",
			targetLanguage: "de",
		});
		expect(saved.translationData.documentModel.units).toHaveLength(
			saved.translationData.seg1.length,
		);
	});

	it("retains importer unit locations and gives the document a project ID", async () => {
		const imported = createNeutralDocument({
			format: "json",
			sourceSegments: ["Hello"],
			sourceLocations: [{ part: "messages.json", path: ["hello"] }],
		});
		const skeleton = createSkeletonFromLegacy({
			format: "json",
			name: "messages.json",
			typeRef: { data: { hello: "Hello" } },
			segments: ["Hello"],
			segmentsMeta: [{ path: ["hello"] }],
		});
		await saveNewTranslationToUserDataFromArrayOfStrings(
			[],
			"Messages",
			"en",
			"de",
			"456",
			["Hello"],
			"json",
			{},
			[{ path: ["hello"] }],
			imported,
			skeleton,
			{ pathSelectors: "messages.*", includeNonStringValues: false },
		);

		const document =
			mocks.update.mock.calls[0][0].translationData.documentModel;
		expect(document.id).toBe("project-456");
		expect(document.units[0].sourceLocation).toEqual({
			part: "messages.json",
			path: ["hello"],
		});
		expect(document.units[0].source.language).toBe("en");
		expect(document.units[0].target.language).toBe("de");
		expect(mocks.update.mock.calls[0][0].translationData.skeleton).toBe(
			skeleton,
		);
		expect(mocks.update.mock.calls[0][0].translationData.filterOptions).toEqual(
			{
				pathSelectors: "messages.*",
				includeNonStringValues: false,
			},
		);
	});
});
