import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";

const mocks = vi.hoisted(() => ({
	load: vi.fn(),
	update: vi.fn(),
	saveText: vi.fn(),
	saveArray: vi.fn(),
	saveFile: vi.fn(),
}));

vi.mock("./saveData/indexedDb", () => ({
	loadTranslationsUserDataFromIndexedDB: mocks.load,
	updateTranslationOnIndexedDB: mocks.update,
}));

vi.mock("./saveFileModsIndexedDb", () => ({
	saveNewTranslationToUserDataFromText: mocks.saveText,
	saveNewTranslationToUserDataFromArrayOfStrings: mocks.saveArray,
	saveNewTranslationToUserDataFromSaveFile: mocks.saveFile,
}));

import {
	saveAndOpenNewFileWithStringArray,
	updateAndOpenNewFileWithStringArray,
} from "./saveTranslationOnIndexedDb";

beforeEach(() => {
	vi.clearAllMocks();
});

describe("save and open workflows", () => {
	it("waits for persistence before reloading and resolving", async () => {
		const saved = makeUserData();
		let release!: () => void;
		const pendingSave = new Promise<void>((resolve) => {
			release = resolve;
		});
		mocks.load.mockResolvedValueOnce([]).mockResolvedValueOnce([saved]);
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
		expect(mocks.load).toHaveBeenCalledTimes(2);
		expect(settled).toBe(true);
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
});
