import { afterEach, describe, expect, it } from "vitest";
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
} from "$lib/functions/saveData/indexedDb";
import { makeUserData } from "../test/fixtures";

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
});
