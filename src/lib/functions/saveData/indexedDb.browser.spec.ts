import { describe, expect, it } from "vitest";
import { get } from "svelte/store";

import { makeUserData } from "../../../test/fixtures";
import {
	assertLocalStorageCapacity,
	deleteTbFromIndexedDB,
	deleteTmFromIndexedDB,
	deleteTranslationFromIndexedDB,
	loadTbDataFromIndexedDB,
	loadTmDataFromIndexedDB,
	loadTranslationsUserDataFromIndexedDB,
	saveNewTbToIndexedDB,
	saveNewTmToIndexedDB,
	updateTbOnIndexedDB,
	updateTmOnIndexedDB,
	updateTranslationOnIndexedDB,
} from "./indexedDb";
import { tbData, tmData } from "./stores.svelte";

describe("transaction-complete browser persistence", () => {
	it("reports an actionable error before an import exceeds browser quota", async () => {
		const original = navigator.storage.estimate;
		Object.defineProperty(navigator.storage, "estimate", {
			configurable: true,
			value: async () => ({ quota: 10_000_000, usage: 9_500_000 }),
		});
		try {
			await expect(assertLocalStorageCapacity(2_000_000)).rejects.toThrow(
				/local storage.*available/,
			);
		} finally {
			Object.defineProperty(navigator.storage, "estimate", {
				configurable: true,
				value: original,
			});
		}
	});

	it("makes awaited writes immediately readable and repairs deleted TM/TB references", async () => {
		const seed = Date.now();
		const projectId = seed;
		const tmId = seed + 1;
		const tbId = seed + 2;
		const project = makeUserData({
			name: `persistence-${seed}`,
			tm: { id: tmId, name: "Audit memory", active: true },
			tb: { id: tbId, name: "Audit terminology", active: true },
		});
		project.id = projectId;

		try {
			await saveNewTmToIndexedDB({
				id: tmId,
				name: "Audit memory",
				terms: [
					{
						source: { lang: "en", segment: "Hello" },
						target: [{ lang: "de", segment: "Hallo" }],
					},
				],
			});
			await saveNewTbToIndexedDB({
				id: tbId,
				name: "Audit terminology",
				entries: [
					{
						terms: [
							{ lang: "en", term: "browser", notes: [] },
							{ lang: "de", term: "Browser", notes: [] },
						],
					},
				],
			});
			await updateTranslationOnIndexedDB(project);

			expect(
				(await loadTmDataFromIndexedDB()).some(({ id }) => id === tmId),
			).toBe(true);
			expect(
				(await loadTbDataFromIndexedDB()).some(({ id }) => id === tbId),
			).toBe(true);
			expect(
				(await loadTranslationsUserDataFromIndexedDB()).some(
					({ id }) => id === projectId,
				),
			).toBe(true);

			await deleteTmFromIndexedDB(tmId);
			await deleteTbFromIndexedDB(tbId);
			const repaired = (await loadTranslationsUserDataFromIndexedDB()).find(
				({ id }) => id === projectId,
			);
			expect(repaired?.translationData.tm).toEqual({
				id: null,
				name: null,
				active: false,
			});
			expect(repaired?.translationData.tb).toEqual({
				id: null,
				name: null,
				active: false,
			});
		} finally {
			await deleteTranslationFromIndexedDB(projectId);
			if ((await loadTmDataFromIndexedDB()).some(({ id }) => id === tmId))
				await deleteTmFromIndexedDB(tmId);
			if ((await loadTbDataFromIndexedDB()).some(({ id }) => id === tbId))
				await deleteTbFromIndexedDB(tbId);
		}
	});

	it("refreshes collection stores after TM and TB updates", async () => {
		const seed = Date.now();
		const tmId = seed + 10;
		const tbId = seed + 11;
		try {
			await saveNewTmToIndexedDB({
				id: tmId,
				name: "Live memory",
				terms: [],
			});
			await saveNewTbToIndexedDB({
				id: tbId,
				name: "Live terminology",
				entries: [],
			});
			await updateTmOnIndexedDB({
				id: tmId,
				name: "Live memory",
				terms: [
					{
						source: { lang: "en", segment: "New source" },
						target: [{ lang: "de", segment: "Neues Ziel" }],
					},
				],
			});
			await updateTbOnIndexedDB({
				id: tbId,
				name: "Live terminology",
				entries: [
					{
						terms: [{ lang: "en", term: "new term", notes: [] }],
					},
				],
			});

			expect(
				get(tmData).find(({ id }) => id === tmId)?.terms[0].source.segment,
			).toBe("New source");
			expect(
				get(tbData).find(({ id }) => id === tbId)?.entries[0].terms[0].term,
			).toBe("new term");
		} finally {
			await deleteTmFromIndexedDB(tmId);
			await deleteTbFromIndexedDB(tbId);
		}
	});
});
