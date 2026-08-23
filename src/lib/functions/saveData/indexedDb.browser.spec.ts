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
	replaceTranslationOnIndexedDB,
	updateTbOnIndexedDB,
	updateTmOnIndexedDB,
	updateTranslationOnIndexedDB,
} from "./indexedDb";
import { tbData, tmData } from "./stores.svelte";

async function deleteCurrentProject(id: number): Promise<void> {
	const current = (await loadTranslationsUserDataFromIndexedDB()).find(
		(project) => project.id === id,
	);
	if (current)
		await deleteTranslationFromIndexedDB(id, current.persistenceRevision ?? -1);
}

async function deleteCurrentTm(id: number): Promise<void> {
	const current = (await loadTmDataFromIndexedDB()).find(
		(memory) => memory.id === id,
	);
	if (current)
		await deleteTmFromIndexedDB(id, current.persistenceRevision ?? -1);
}

async function deleteCurrentTb(id: number): Promise<void> {
	const current = (await loadTbDataFromIndexedDB()).find(
		(termBase) => termBase.id === id,
	);
	if (current)
		await deleteTbFromIndexedDB(id, current.persistenceRevision ?? -1);
}

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

			await deleteCurrentTm(tmId);
			await deleteCurrentTb(tbId);
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
			await deleteCurrentProject(projectId);
			if ((await loadTmDataFromIndexedDB()).some(({ id }) => id === tmId))
				await deleteCurrentTm(tmId);
			if ((await loadTbDataFromIndexedDB()).some(({ id }) => id === tbId))
				await deleteCurrentTb(tbId);
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
			const savedTm = (await loadTmDataFromIndexedDB()).find(
				({ id }) => id === tmId,
			)!;
			savedTm.terms = [
				{
					source: { lang: "en", segment: "New source" },
					target: [{ lang: "de", segment: "Neues Ziel" }],
				},
			];
			await updateTmOnIndexedDB(savedTm);
			const savedTb = (await loadTbDataFromIndexedDB()).find(
				({ id }) => id === tbId,
			)!;
			savedTb.entries = [
				{
					terms: [{ lang: "en", term: "new term", notes: [] }],
				},
			];
			await updateTbOnIndexedDB(savedTb);

			expect(
				get(tmData).find(({ id }) => id === tmId)?.terms[0].source.segment,
			).toBe("New source");
			expect(
				get(tbData).find(({ id }) => id === tbId)?.entries[0].terms[0].term,
			).toBe("new term");
		} finally {
			await deleteCurrentTm(tmId);
			await deleteCurrentTb(tbId);
		}
	});

	it("rejects incomplete TM and TB records at the IndexedDB boundary", async () => {
		const seed = Date.now();
		await expect(
			saveNewTmToIndexedDB({
				id: seed,
				name: "Invalid memory",
				terms: [
					{
						source: { lang: "en", segment: "Source" },
						target: [{ lang: "de", segment: " " }],
					},
				],
			}),
		).rejects.toThrow(/translated text/i);
		await expect(
			saveNewTbToIndexedDB({
				id: seed + 1,
				name: "Invalid terminology",
				entries: [{ terms: [{ lang: "", term: "مصطلح", notes: [] }] }],
			}),
		).rejects.toThrow(/needs a language/i);
		expect(
			(await loadTmDataFromIndexedDB()).some(({ id }) => id === seed),
		).toBe(false);
		expect(
			(await loadTbDataFromIndexedDB()).some(({ id }) => id === seed + 1),
		).toBe(false);
	});

	it("rejects a stale project save instead of overwriting another tab", async () => {
		const project = makeUserData({ name: `conflict-${Date.now()}` });
		project.id = Date.now() + 50_000;
		try {
			await updateTranslationOnIndexedDB(project);
			const current = (await loadTranslationsUserDataFromIndexedDB()).find(
				({ id }) => id === project.id,
			)!;
			const firstTab = structuredClone(current);
			const staleTab = structuredClone(current);
			firstTab.translationData.seg2[0] = "Saved in the first tab";
			await updateTranslationOnIndexedDB(firstTab);
			staleTab.translationData.seg2[0] = "Stale second-tab edit";

			await expect(updateTranslationOnIndexedDB(staleTab)).rejects.toThrow(
				/changed in another tab/i,
			);
			const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
				({ id }) => id === project.id,
			);
			expect(restored?.translationData.seg2[0]).toBe("Saved in the first tab");
		} finally {
			await deleteCurrentProject(project.id);
		}
	});

	it("rebases an explicitly confirmed backup replacement without weakening stale-save protection", async () => {
		const project = makeUserData({ name: `replacement-${Date.now()}` });
		project.id = Date.now() + 65_000;
		try {
			await updateTranslationOnIndexedDB(project);
			const oldBackup = structuredClone(project);
			const newerLocal = structuredClone(project);
			newerLocal.translationData.seg2[0] = "Newer local value";
			await updateTranslationOnIndexedDB(newerLocal);

			oldBackup.translationData.seg2[0] = "Restored backup value";
			await replaceTranslationOnIndexedDB(oldBackup);
			const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
				({ id }) => id === project.id,
			)!;
			expect(restored.translationData.seg2[0]).toBe("Restored backup value");
			expect(restored.persistenceRevision).toBe(
				(newerLocal.persistenceRevision ?? 0) + 1,
			);

			newerLocal.translationData.seg2[0] = "Now stale again";
			await expect(updateTranslationOnIndexedDB(newerLocal)).rejects.toThrow(
				/changed in another tab/i,
			);
		} finally {
			await deleteCurrentProject(project.id);
		}
	});

	it("rejects stale project, TM, and TB deletions", async () => {
		const seed = Date.now() + 72_000;
		const project = makeUserData({ name: "Stale deletion" });
		project.id = seed;
		const tmId = seed + 1;
		const tbId = seed + 2;
		try {
			await updateTranslationOnIndexedDB(project);
			await saveNewTmToIndexedDB({
				id: tmId,
				name: "Delete-safe TM",
				terms: [],
			});
			await saveNewTbToIndexedDB({
				id: tbId,
				name: "Delete-safe TB",
				entries: [],
			});
			const staleProjectRevision = project.persistenceRevision!;
			const staleTmRevision = (await loadTmDataFromIndexedDB()).find(
				({ id }) => id === tmId,
			)!.persistenceRevision!;
			const staleTbRevision = (await loadTbDataFromIndexedDB()).find(
				({ id }) => id === tbId,
			)!.persistenceRevision!;

			project.translationData.name = "Changed project";
			await updateTranslationOnIndexedDB(project);
			const changedTm = (await loadTmDataFromIndexedDB()).find(
				({ id }) => id === tmId,
			)!;
			changedTm.name = "Changed TM";
			await updateTmOnIndexedDB(changedTm);
			const changedTb = (await loadTbDataFromIndexedDB()).find(
				({ id }) => id === tbId,
			)!;
			changedTb.name = "Changed TB";
			await updateTbOnIndexedDB(changedTb);

			await expect(
				deleteTranslationFromIndexedDB(project.id, staleProjectRevision),
			).rejects.toThrow(/changed in another tab/i);
			await expect(
				deleteTmFromIndexedDB(tmId, staleTmRevision),
			).rejects.toThrow(/translation memory.*another tab/i);
			await expect(
				deleteTbFromIndexedDB(tbId, staleTbRevision),
			).rejects.toThrow(/term base.*another tab/i);

			expect(
				(await loadTranslationsUserDataFromIndexedDB()).some(
					({ id }) => id === project.id,
				),
			).toBe(true);
			expect(
				(await loadTmDataFromIndexedDB()).some(({ id }) => id === tmId),
			).toBe(true);
			expect(
				(await loadTbDataFromIndexedDB()).some(({ id }) => id === tbId),
			).toBe(true);
		} finally {
			await deleteCurrentProject(project.id);
			await deleteCurrentTm(tmId);
			await deleteCurrentTb(tbId);
		}
	});

	it("rejects stale TM and TB saves instead of using last-write-wins", async () => {
		const seed = Date.now() + 80_000;
		const tmId = seed;
		const tbId = seed + 1;
		try {
			await saveNewTmToIndexedDB({
				id: tmId,
				name: "Concurrent TM",
				terms: [],
			});
			await saveNewTbToIndexedDB({
				id: tbId,
				name: "Concurrent TB",
				entries: [],
			});
			const currentTm = (await loadTmDataFromIndexedDB()).find(
				({ id }) => id === tmId,
			)!;
			const firstTmTab = structuredClone(currentTm);
			const staleTmTab = structuredClone(currentTm);
			firstTmTab.name = "First TM tab";
			await updateTmOnIndexedDB(firstTmTab);
			staleTmTab.name = "Stale TM tab";
			await expect(updateTmOnIndexedDB(staleTmTab)).rejects.toThrow(
				/translation memory.*another tab/i,
			);

			const currentTb = (await loadTbDataFromIndexedDB()).find(
				({ id }) => id === tbId,
			)!;
			const firstTbTab = structuredClone(currentTb);
			const staleTbTab = structuredClone(currentTb);
			firstTbTab.name = "First TB tab";
			await updateTbOnIndexedDB(firstTbTab);
			staleTbTab.name = "Stale TB tab";
			await expect(updateTbOnIndexedDB(staleTbTab)).rejects.toThrow(
				/term base.*another tab/i,
			);

			expect(
				(await loadTmDataFromIndexedDB()).find(({ id }) => id === tmId)?.name,
			).toBe("First TM tab");
			expect(
				(await loadTbDataFromIndexedDB()).find(({ id }) => id === tbId)?.name,
			).toBe("First TB tab");
		} finally {
			if ((await loadTmDataFromIndexedDB()).some(({ id }) => id === tmId))
				await deleteCurrentTm(tmId);
			if ((await loadTbDataFromIndexedDB()).some(({ id }) => id === tbId))
				await deleteCurrentTb(tbId);
		}
	});

	it("advances project revisions when resources are deleted and blocks stale reference restoration", async () => {
		const seed = Date.now() + 100_000;
		const projectId = seed;
		const tmId = seed + 1;
		const tbId = seed + 2;
		const project = makeUserData({
			name: "Deletion conflict",
			tm: { id: tmId, name: "Deleted TM", active: true },
			tb: { id: tbId, name: "Deleted TB", active: true },
		});
		project.id = projectId;
		try {
			await saveNewTmToIndexedDB({ id: tmId, name: "Deleted TM", terms: [] });
			await saveNewTbToIndexedDB({ id: tbId, name: "Deleted TB", entries: [] });
			await updateTranslationOnIndexedDB(project);
			const staleProject = structuredClone(project);
			const staleTm = (await loadTmDataFromIndexedDB()).find(
				({ id }) => id === tmId,
			)!;
			const staleTb = (await loadTbDataFromIndexedDB()).find(
				({ id }) => id === tbId,
			)!;

			await deleteCurrentTm(tmId);
			await deleteCurrentTb(tbId);

			await expect(updateTranslationOnIndexedDB(staleProject)).rejects.toThrow(
				/changed in another tab or was deleted/i,
			);
			await expect(updateTmOnIndexedDB(staleTm)).rejects.toThrow(
				/changed in another tab or was deleted/i,
			);
			await expect(updateTbOnIndexedDB(staleTb)).rejects.toThrow(
				/changed in another tab or was deleted/i,
			);
			const repaired = (await loadTranslationsUserDataFromIndexedDB()).find(
				({ id }) => id === projectId,
			);
			expect(repaired?.persistenceRevision).toBe(3);
			expect(repaired?.translationData.tm?.id).toBeNull();
			expect(repaired?.translationData.tb?.id).toBeNull();
		} finally {
			await deleteCurrentProject(projectId);
		}
	});
});
