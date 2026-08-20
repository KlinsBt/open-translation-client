import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import { get } from "svelte/store";
import AppRoute from "./(app)/app/+page.svelte";
import TmEditing from "$lib/components/translationMemory/tmEditing/tmEditing.svelte";
import TbEditing from "$lib/components/termBase/tbEditing/tbEditing.svelte";
import {
	openMenu,
	selectedSegmentId,
	singleTbData,
	singleTmData,
	singleUserData,
	tbData,
	tmData,
} from "$lib/functions/saveData/stores.svelte";
import {
	deleteTbFromIndexedDB,
	deleteTmFromIndexedDB,
	deleteTranslationFromIndexedDB,
	getTbDataById,
	getTmDataById,
	loadTranslationsUserDataFromIndexedDB,
	saveNewTbToIndexedDB,
	saveNewTmToIndexedDB,
	updateTranslationOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { makeUserData } from "../test/fixtures";
import { toastStore } from "$lib/components/notifications/toastStore";

let mounted: ReturnType<typeof mount> | null = null;

function button(label: string): HTMLButtonElement {
	const candidate = Array.from(document.querySelectorAll("button")).find(
		(element) =>
			element.textContent?.replace(/\s+/g, " ").trim().includes(label),
	);
	if (!(candidate instanceof HTMLButtonElement))
		throw new Error(`Button ${label} was not found.`);
	return candidate;
}

function enterText(
	element: HTMLInputElement | HTMLTextAreaElement,
	value: string,
) {
	element.value = value;
	element.dispatchEvent(new Event("input", { bubbles: true }));
}

async function eventually(assertion: () => void): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => {
				setTimeout(resolve, 25);
			});
		}
	}
	throw lastError;
}

async function eventuallyAsync(assertion: () => Promise<void>): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 40; attempt++) {
		try {
			await assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => {
				setTimeout(resolve, 25);
			});
		}
	}
	throw lastError;
}

afterEach(async () => {
	if (mounted) await unmount(mounted);
	mounted = null;
	document.body.replaceChildren();
	for (const toast of get(toastStore)) toastStore.remove(toast.id);
});

describe("real CAT application route", () => {
	it("opens the project modal with focus containment and closes it with Escape", async () => {
		openMenu.set(true);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.body.textContent).toContain("Your projects"),
		);
		const opener = button("New project");
		opener.focus();
		opener.click();
		await eventually(() =>
			expect(document.querySelector('[role="dialog"]')).not.toBeNull(),
		);
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
		await eventually(() =>
			expect(dialog.contains(document.activeElement)).toBe(true),
		);
		expect(document.querySelectorAll("[inert]").length).toBeGreaterThan(0);
		const dropZone = dialog.querySelector<HTMLElement>('[role="button"]')!;
		const activateDropZone = new KeyboardEvent("keydown", {
			key: "Enter",
			bubbles: true,
			cancelable: true,
		});
		dropZone.dispatchEvent(activateDropZone);
		expect(activateDropZone.defaultPrevented).toBe(true);
		const focusable = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
			),
		).filter((element) => element.offsetParent !== null);
		focusable.at(-1)?.focus();
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "Tab",
				bubbles: true,
				cancelable: true,
			}),
		);
		expect(document.activeElement).toBe(focusable[0]);
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await tick();
		expect(document.querySelector('[role="dialog"]')).toBeNull();
		await eventually(() => expect(document.activeElement).toBe(opener));
	});

	it("preserves text-editing shortcuts, expands navigation, enforces locks, and warns on incomplete export", async () => {
		const count = 151;
		const project = makeUserData({
			seg1: Array.from({ length: count }, (_, index) => `Source ${index + 1}`),
			seg2: Array.from({ length: count }, () => ""),
			checked: Array.from({ length: count }, () => false),
			locked: Array.from({ length: count }, (_, index) => index === 0),
		});
		project.id = 9401;
		singleUserData.set(project);
		tmData.set([]);
		tbData.set([]);
		selectedSegmentId.set(0);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);
		const firstSegment = document.querySelector<HTMLElement>(
			'[data-segment-id="0"]',
		)!;
		const fill = Array.from(firstSegment.querySelectorAll("button")).find(
			(element) => element.textContent?.trim().startsWith("Fill"),
		) as HTMLButtonElement;
		expect(fill.disabled).toBe(true);
		expect(document.body.textContent).toContain("0% complete");
		expect(firstSegment.textContent).toContain("Confirm");

		const textarea = document.querySelector("textarea")!;
		const browserFind = new KeyboardEvent("keydown", {
			key: "f",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		});
		textarea.dispatchEvent(browserFind);
		expect(browserFind.defaultPrevented).toBe(false);

		selectedSegmentId.set(149);
		window.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowDown",
				ctrlKey: true,
				altKey: true,
				bubbles: true,
				cancelable: true,
			}),
		);
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="150"]')).not.toBeNull(),
		);
		expect(get(selectedSegmentId)).toBe(150);

		button("Export translation").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Export files"),
		);
		const original = document.querySelector<HTMLButtonElement>(
			".modal-action-card.primary",
		)!;
		original.click();
		await eventually(() =>
			expect(document.body.textContent).toContain(
				"Export an incomplete translation?",
			),
		);
		expect(document.body.textContent?.replace(/\s+/g, " ")).toContain(
			"151 target segments are empty",
		);
	});

	it("creates a validated text project through the real upload modal", async () => {
		const projectName = `browser-project-${Date.now()}`;
		openMenu.set(true);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.body.textContent).toContain("Your projects"),
		);
		button("New project").click();
		await eventually(() =>
			expect(document.querySelector("#file-input")).not.toBeNull(),
		);
		const input = document.querySelector<HTMLInputElement>("#file-input")!;
		Object.defineProperty(input, "files", {
			configurable: true,
			value: [
				new File(["Hello browser"], "browser-audit.txt", {
					type: "text/plain",
				}),
			],
		});
		input.dispatchEvent(new Event("change", { bubbles: true }));
		await eventually(() =>
			expect(document.body.textContent?.replace(/\s+/g, " ")).toContain(
				"Detected: TXT",
			),
		);
		enterText(
			document.querySelector<HTMLInputElement>("#project-name")!,
			projectName,
		);
		const [source, target] = Array.from(
			document.querySelectorAll<HTMLSelectElement>(
				".language-selection select",
			),
		);
		source.value = "English (en)";
		source.dispatchEvent(new Event("change", { bubbles: true }));
		target.value = "English (en)";
		target.dispatchEvent(new Event("change", { bubbles: true }));
		await tick();
		expect(button("Create Project").disabled).toBe(true);
		expect(document.body.textContent).toContain(
			"Choose different source and target languages.",
		);
		target.value = "German (de)";
		target.dispatchEvent(new Event("change", { bubbles: true }));
		await tick();
		expect(button("Create Project").disabled).toBe(false);
		button("Create Project").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Translation workspace"),
		);
		const saved = (await loadTranslationsUserDataFromIndexedDB()).find(
			(project) => project.translationData.name === projectName,
		);
		expect(saved?.translationData.seg1).toEqual(["Hello browser"]);
		if (saved?.id !== undefined) await deleteTranslationFromIndexedDB(saved.id);
	});

	it("keeps every delivery option retryable after download or cancellation failure", async () => {
		const project = makeUserData({
			name: "retryable-export",
			seg1: ["Source"],
			seg2: ["Target"],
			checked: [true],
			locked: [false],
			type: "text",
			typeRef: "Source",
		});
		project.id = 9402;
		singleUserData.set(project);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);

		const clickFailure = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => {
				throw new Error("Download permission was denied.");
			});
		button("Export translation").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Export files"),
		);

		const exportCard = (label: string) => {
			const heading = Array.from(
				document.querySelectorAll<HTMLElement>(".modal-action-card strong"),
			).find((element) => element.textContent?.trim() === label);
			const card = heading?.closest("button");
			if (!(card instanceof HTMLButtonElement))
				throw new Error(`Export card ${label} was not found.`);
			return card;
		};

		for (const label of [
			"PDF document",
			"Word document",
			"Rich Text Format",
			"Web page",
			"Plain text",
			"Bilingual CSV",
			"XLIFF 1.2",
			"XLIFF 2.0",
			"XLIFF 2.1",
		]) {
			const card = exportCard(label);
			card.click();
			await new Promise((resolve) => {
				setTimeout(resolve, 75);
			});
			await eventually(() =>
				expect(document.body.textContent).toContain(
					"Download permission was denied",
				),
			);
			await eventually(() => expect(card.disabled).toBe(false));
			expect(document.body.textContent).toContain("Export files");
		}

		const primary = document.querySelector<HTMLButtonElement>(
			".modal-action-card.primary",
		)!;
		primary.click();
		await new Promise((resolve) => {
			setTimeout(resolve, 75);
		});
		await eventually(() =>
			expect(document.body.textContent).toContain(
				"Download permission was denied",
			),
		);
		await eventually(() => expect(primary.disabled).toBe(false));
		expect(document.body.textContent).toContain("Export files");

		clickFailure.mockImplementation(() => {
			throw new DOMException("The operation was aborted.", "AbortError");
		});
		exportCard("Plain text").click();
		await new Promise((resolve) => {
			setTimeout(resolve, 75);
		});
		await eventually(() =>
			expect(document.body.textContent).toContain("Export was cancelled"),
		);

		clickFailure.mockImplementation(() => undefined);
		exportCard("Plain text").click();
		await eventually(() =>
			expect(document.body.textContent).not.toContain("Export files"),
		);
	});

	it("edits the displayed TM record after filtering without corrupting another record", async () => {
		const seed = Date.now();
		const memory = {
			id: seed,
			name: "Filtered memory",
			terms: [
				{
					source: { lang: "en", segment: "First source" },
					target: [{ lang: "de", segment: "Erstes Ziel" }],
				},
				{
					source: { lang: "en", segment: "Needle source" },
					target: [{ lang: "de", segment: "Needle target" }],
				},
			],
		};
		await saveNewTmToIndexedDB(memory);
		singleTmData.set(memory);
		mounted = mount(TmEditing, { target: document.body });
		const tmSearch = document.querySelector<HTMLInputElement>(".search-input")!;
		enterText(tmSearch, "Needle source");
		await tick();
		expect(document.querySelectorAll(".resource-unit-card")).toHaveLength(1);
		button("Edit").click();
		await tick();
		enterText(
			document.querySelector<HTMLTextAreaElement>("textarea")!,
			"Edited needle",
		);
		button("Save").click();
		await eventuallyAsync(async () => {
			expect((await getTmDataById(seed))?.terms[1].source.segment).toBe(
				"Edited needle",
			);
		});
		await eventually(() =>
			expect(document.querySelector("textarea")).toBeNull(),
		);
		expect(get(singleTmData).terms[0].source.segment).toBe("First source");
		await deleteTmFromIndexedDB(seed);
	});

	it("edits the displayed TB record after filtering without corrupting another record", async () => {
		const seed = Date.now();
		const termBase = {
			id: seed,
			name: "Filtered terminology",
			entries: [
				{ terms: [{ lang: "en", term: "First term", notes: [] }] },
				{ terms: [{ lang: "en", term: "Needle term", notes: [] }] },
			],
		};
		await saveNewTbToIndexedDB(termBase);
		singleTbData.set(termBase);
		mounted = mount(TbEditing, { target: document.body });
		const tbSearch = document.querySelector<HTMLInputElement>(".search-input")!;
		enterText(tbSearch, "Needle term");
		await tick();
		expect(document.querySelectorAll(".resource-unit-card")).toHaveLength(1);
		button("Edit").click();
		await tick();
		enterText(
			document.querySelector<HTMLTextAreaElement>("textarea")!,
			"Edited term",
		);
		button("Save").click();
		await eventuallyAsync(async () => {
			expect((await getTbDataById(seed))?.entries[1].terms[0].term).toBe(
				"Edited term",
			);
		});
		await eventually(() =>
			expect(document.querySelector("textarea")).toBeNull(),
		);
		expect(get(singleTbData).entries[0].terms[0].term).toBe("First term");
		await deleteTbFromIndexedDB(seed);
	});

	it("keeps the project rename modal and snapshots unchanged after a quota failure", async () => {
		const project = makeUserData({ name: "Persisted project" });
		project.id = Date.now();
		await updateTranslationOnIndexedDB(project);
		openMenu.set(true);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.body.textContent).toContain("Persisted project"),
		);

		button("Project options").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Continue translating"),
		);
		button("Project settings").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Rename project"),
		);
		button("Rename project").click();
		await eventually(() =>
			expect(
				document.querySelector('.modal-field input[type="text"]'),
			).not.toBeNull(),
		);
		const nameInput = document.querySelector<HTMLInputElement>(
			'.modal-field input[type="text"]',
		)!;
		enterText(nameInput, "Unsaved project name");
		const failedPut = vi
			.spyOn(IDBObjectStore.prototype, "put")
			.mockImplementationOnce(() => {
				throw new DOMException("Quota reached", "QuotaExceededError");
			});
		button("Save name").click();

		await eventually(() =>
			expect(document.body.textContent).toContain("available local storage"),
		);
		expect(document.body.textContent).toContain("Rename project");
		expect(get(singleUserData).translationData.name).toBe("Persisted project");
		expect(
			(await loadTranslationsUserDataFromIndexedDB()).find(
				(candidate) => candidate.id === project.id,
			)?.translationData.name,
		).toBe("Persisted project");
		expect(
			get(toastStore).some((toast) => toast.message.includes("updated")),
		).toBe(false);
		failedPut.mockRestore();
		await deleteTranslationFromIndexedDB(project.id);
	});

	it("does not publish a segment fill when its transaction aborts", async () => {
		const project = makeUserData({
			name: "Abort-safe segment",
			seg1: ["Source remains"],
			seg2: [""],
			checked: [false],
			locked: [false],
		});
		project.id = Date.now();
		await updateTranslationOnIndexedDB(project);
		singleUserData.set(project);
		selectedSegmentId.set(0);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);
		const failedPut = vi
			.spyOn(IDBObjectStore.prototype, "put")
			.mockImplementationOnce(() => {
				throw new DOMException("Injected abort", "AbortError");
			});
		const segment = document.querySelector<HTMLElement>(
			'[data-segment-id="0"]',
		)!;
		const fill = Array.from(segment.querySelectorAll("button")).find(
			(element) => element.textContent?.trim().startsWith("Fill"),
		) as HTMLButtonElement;
		fill.click();

		await eventually(() =>
			expect(document.body.textContent).toContain("previous data is unchanged"),
		);
		expect(get(singleUserData).translationData.seg2).toEqual([""]);
		expect(
			(await loadTranslationsUserDataFromIndexedDB()).find(
				(candidate) => candidate.id === project.id,
			)?.translationData.seg2,
		).toEqual([""]);
		expect(
			get(toastStore).some((toast) => toast.message.includes("Filled")),
		).toBe(false);
		failedPut.mockRestore();
		await deleteTranslationFromIndexedDB(project.id);
	});

	it("rolls back a failed TM edit and keeps the editor open", async () => {
		const seed = Date.now();
		const memory = {
			id: seed,
			name: "Failure-safe memory",
			terms: [
				{
					source: { lang: "en", segment: "Persisted source" },
					target: [{ lang: "de", segment: "Persisted target" }],
				},
			],
		};
		await saveNewTmToIndexedDB(memory);
		singleTmData.set(memory);
		mounted = mount(TmEditing, { target: document.body });
		button("Edit").click();
		await tick();
		enterText(
			document.querySelector<HTMLTextAreaElement>("textarea")!,
			"Lost edit",
		);
		const failedPut = vi
			.spyOn(IDBObjectStore.prototype, "put")
			.mockImplementationOnce(() => {
				throw new DOMException("Quota reached", "QuotaExceededError");
			});
		button("Save").click();

		await eventually(() =>
			expect(get(toastStore).some((toast) => toast.type === "error")).toBe(
				true,
			),
		);
		await eventually(() =>
			expect(
				document.querySelector<HTMLTextAreaElement>("textarea")?.value,
			).toBe("Persisted source"),
		);
		expect(get(singleTmData).terms[0].source.segment).toBe("Persisted source");
		expect((await getTmDataById(seed))?.terms[0].source.segment).toBe(
			"Persisted source",
		);
		expect(
			get(toastStore).some((toast) => toast.message === "Entry saved"),
		).toBe(false);
		failedPut.mockRestore();
		await deleteTmFromIndexedDB(seed);
	});

	it("rolls back a failed TB edit and keeps the editor open", async () => {
		const seed = Date.now();
		const termBase = {
			id: seed,
			name: "Failure-safe terminology",
			entries: [{ terms: [{ lang: "en", term: "Persisted term", notes: [] }] }],
		};
		await saveNewTbToIndexedDB(termBase);
		singleTbData.set(termBase);
		mounted = mount(TbEditing, { target: document.body });
		button("Edit").click();
		await tick();
		enterText(
			document.querySelector<HTMLTextAreaElement>("textarea")!,
			"Lost term",
		);
		const failedPut = vi
			.spyOn(IDBObjectStore.prototype, "put")
			.mockImplementationOnce(() => {
				throw new DOMException("Injected abort", "AbortError");
			});
		button("Save").click();

		await eventually(() =>
			expect(get(toastStore).some((toast) => toast.type === "error")).toBe(
				true,
			),
		);
		await eventually(() =>
			expect(
				document.querySelector<HTMLTextAreaElement>("textarea")?.value,
			).toBe("Persisted term"),
		);
		expect(get(singleTbData).entries[0].terms[0].term).toBe("Persisted term");
		expect((await getTbDataById(seed))?.entries[0].terms[0].term).toBe(
			"Persisted term",
		);
		expect(
			get(toastStore).some((toast) => toast.message === "Entry saved"),
		).toBe(false);
		failedPut.mockRestore();
		await deleteTbFromIndexedDB(seed);
	});
});
