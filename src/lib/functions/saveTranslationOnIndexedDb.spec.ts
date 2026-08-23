import { beforeEach, describe, expect, it, vi } from "vitest";
import { get } from "svelte/store";
import { makeUserData } from "../../test/fixtures";
import type { UserData } from "$lib/types/types";

const mocks = vi.hoisted(() => ({
	load: vi.fn(),
	update: vi.fn(),
	replace: vi.fn(),
	saveText: vi.fn(),
	saveArray: vi.fn(),
	saveFile: vi.fn(),
}));

vi.mock("./saveData/indexedDb", () => ({
	loadTranslationsUserDataFromIndexedDB: mocks.load,
	updateTranslationOnIndexedDB: mocks.update,
	replaceTranslationOnIndexedDB: mocks.replace,
}));

vi.mock("./saveFileModsIndexedDb", () => ({
	saveNewTranslationToUserDataFromText: mocks.saveText,
	saveNewTranslationToUserDataFromArrayOfStrings: mocks.saveArray,
	saveNewTranslationToUserDataFromSaveFile: mocks.saveFile,
}));

import {
	saveAndOpenNewFileWithStringArray,
	saveAndOpenNewFileWithStringArrayFromSaveFile,
	saveAndOpenNewFileWithTextString,
	replaceAndOpenProjectFromSaveFile,
	updateAndOpenNewFileWithStringArray,
} from "./saveTranslationOnIndexedDb";
import {
	singleUserData,
	translationIdSelected,
} from "./saveData/stores.svelte";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("save and open workflows", () => {
	it("waits for persistence before reloading and resolving", async () => {
		const saved = makeUserData();
		let release!: () => void;
		const pendingSave = new Promise<UserData>((resolve) => {
			release = () => resolve(saved);
		});
		mocks.load.mockResolvedValueOnce([]);
		mocks.saveArray.mockReturnValue(pendingSave);

		let settled = false;
		const operation = saveAndOpenNewFileWithStringArray(
			"Example",
			"en",
			"de",
			"1",
			["Hello"],
			"text",
		).then(() => {
			settled = true;
		});

		await Promise.resolve();
		expect(mocks.load).toHaveBeenCalledTimes(1);
		expect(settled).toBe(false);

		release();
		await operation;
		expect(mocks.load).toHaveBeenCalledTimes(1);
		expect(settled).toBe(true);
	});

	it("opens the exact persisted project even if another record is inserted concurrently", async () => {
		const created = makeUserData({ name: "Created here" });
		created.id = 41;
		const concurrent = makeUserData({ name: "Created elsewhere" });
		concurrent.id = 42;
		mocks.load.mockResolvedValueOnce([concurrent]);
		mocks.saveArray.mockResolvedValue(created);

		await saveAndOpenNewFileWithStringArray(
			"Created here",
			"en",
			"de",
			"1",
			["Hello"],
			"text",
		);

		expect(get(singleUserData).id).toBe(41);
		expect(get(translationIdSelected)).toBe(41);
		expect(mocks.load).toHaveBeenCalledTimes(1);
	});

	it("uses exact identities returned by text and portable-project creation helpers", async () => {
		const textProject = makeUserData({ name: "Exact text" });
		textProject.id = 51;
		mocks.load.mockResolvedValueOnce([]);
		mocks.saveText.mockResolvedValueOnce(textProject);
		await saveAndOpenNewFileWithTextString(
			"Exact text",
			"en",
			"de",
			"1",
			"Hello",
			"text",
		);
		expect(get(translationIdSelected)).toBe(51);

		const portableProject = makeUserData({ name: "Exact portable" });
		portableProject.id = 52;
		mocks.saveFile.mockResolvedValueOnce(portableProject);
		await saveAndOpenNewFileWithStringArrayFromSaveFile([], portableProject);
		expect(get(singleUserData).translationData.name).toBe("Exact portable");
		expect(get(translationIdSelected)).toBe(52);
	});

	it("waits for updates before resolving", async () => {
		const userData = makeUserData();
		let release!: () => void;
		mocks.update.mockReturnValue(
			new Promise<void>((resolve) => {
				release = resolve;
			}),
		);
		let settled = false;
		const operation = updateAndOpenNewFileWithStringArray(userData).then(() => {
			settled = true;
		});

		await Promise.resolve();
		expect(settled).toBe(false);
		release();
		await operation;
		expect(settled).toBe(true);
	});

	it("waits for an explicit replacement before opening the imported project", async () => {
		const backup = makeUserData({ name: "Older backup" });
		backup.id = 77;
		mocks.replace.mockResolvedValue(undefined);

		await replaceAndOpenProjectFromSaveFile(backup);

		expect(mocks.replace).toHaveBeenCalledWith(backup);
		expect(get(singleUserData)).toBe(backup);
		expect(get(translationIdSelected)).toBe(77);
	});
});
