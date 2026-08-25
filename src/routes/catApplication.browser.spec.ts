import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { mount, tick, unmount } from "svelte";
import { get } from "svelte/store";
import AppRoute from "./(app)/app/+page.svelte";
import TmEditing from "$lib/components/translationMemory/tmEditing/tmEditing.svelte";
import TbEditing from "$lib/components/termBase/tbEditing/tbEditing.svelte";
import TmSection from "$lib/components/translationMemory/tmSection.svelte";
import TbSection from "$lib/components/termBase/tbSection.svelte";
import TmxUpload from "$lib/components/uploads/tmxUpload/tmxUpload.svelte";
import TbxUpload from "$lib/components/uploads/tbxUpload/tbxUpload.svelte";
import SaveFileUpload from "$lib/components/uploads/saveFileUploads/saveFileUpload.svelte";
import {
	editTb,
	editTm,
	openMenu,
	selectedSegmentId,
	singleTbData,
	singleTmData,
	singleUserData,
	tbData,
	tmData,
	showLoading,
	userData,
} from "$lib/functions/saveData/stores.svelte";
import {
	closeIndexedDbConnection,
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

async function deleteCurrentProject(id: number): Promise<void> {
	const current = (await loadTranslationsUserDataFromIndexedDB()).find(
		(project) => project.id === id,
	);
	if (current)
		await deleteTranslationFromIndexedDB(id, current.persistenceRevision ?? -1);
}

async function deleteCurrentTm(id: number): Promise<void> {
	const current = await getTmDataById(id);
	if (current)
		await deleteTmFromIndexedDB(id, current.persistenceRevision ?? -1);
}

async function deleteCurrentTb(id: number): Promise<void> {
	const current = await getTbDataById(id);
	if (current)
		await deleteTbFromIndexedDB(id, current.persistenceRevision ?? -1);
}

function button(label: string): HTMLButtonElement {
	const candidate = Array.from(document.querySelectorAll("button")).find(
		(element) =>
			element.textContent?.replace(/\s+/g, " ").trim().includes(label),
	);
	if (!(candidate instanceof HTMLButtonElement))
		throw new Error(`Button ${label} was not found.`);
	return candidate;
}

function expectViewportFilling(selector: string): void {
	const element = document.querySelector<HTMLElement>(selector);
	if (!element) throw new Error(`${selector} was not found.`);
	const bounds = element.getBoundingClientRect();
	const viewportWidth = document.documentElement.clientWidth;
	expect(bounds.width).toBeGreaterThanOrEqual(viewportWidth - 64);
	expect(bounds.left).toBeLessThanOrEqual(32);
	expect(viewportWidth - bounds.right).toBeLessThanOrEqual(32);
}

function expectInlineResourceTitleActions(): void {
	const format = document.querySelector<HTMLElement>(
		".resource-editor-title-actions .resource-editor-format",
	);
	const back = document.querySelector<HTMLElement>(
		".resource-editor-title-actions .resource-editor-back",
	);
	if (!format || !back)
		throw new Error("Resource title actions were not found.");
	const formatBounds = format.getBoundingClientRect();
	const backBounds = back.getBoundingClientRect();
	const formatCenter = formatBounds.top + formatBounds.height / 2;
	const backCenter = backBounds.top + backBounds.height / 2;
	expect(Math.abs(formatCenter - backCenter)).toBeLessThanOrEqual(1);
	expect(formatBounds.right).toBeLessThan(backBounds.left);
}

function enterText(
	element: HTMLInputElement | HTMLTextAreaElement,
	value: string,
) {
	element.value = value;
	element.dispatchEvent(new Event("input", { bubbles: true }));
}

function dispatchEditorShortcut(
	target: EventTarget,
	code: string,
	key: string,
	options: { metaKey?: boolean; altGraph?: boolean } = {},
): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		code,
		key,
		ctrlKey: !options.metaKey,
		metaKey: options.metaKey ?? false,
		altKey: true,
		bubbles: true,
		cancelable: true,
	});
	if (options.altGraph) {
		Object.defineProperty(event, "getModifierState", {
			value: (modifier: string) => modifier === "AltGraph",
		});
	}
	target.dispatchEvent(event);
	return event;
}

function setInputFile(input: HTMLInputElement, file: File) {
	Object.defineProperty(input, "files", {
		configurable: true,
		value: [file],
	});
	input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function slowZipFile(name: string): Promise<{
	file: File;
	started: Promise<void>;
	wasCancelled: () => boolean;
}> {
	const zip = new JSZip();
	zip.file("word/document.xml", '<w:document xmlns:w="urn:test"/>');
	const bytes = await zip.generateAsync({ type: "uint8array" });
	const file = new File([bytes], name, { type: "application/zip" });
	let notifyStarted!: () => void;
	const started = new Promise<void>((resolve) => {
		notifyStarted = resolve;
	});
	let cancelled = false;
	Object.defineProperty(file, "stream", {
		value: () =>
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(bytes.slice(0, 2));
					notifyStarted();
				},
				cancel() {
					cancelled = true;
				},
			}),
	});
	return { file, started, wasCancelled: () => cancelled };
}

async function eventually(assertion: () => void): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 320; attempt++) {
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
	editTm.set(false);
	editTb.set(false);
	document.body.replaceChildren();
	for (const toast of get(toastStore)) toastStore.remove(toast.id);
	vi.restoreAllMocks();
});

describe("real CAT application route", () => {
	it("fills the viewport in project, TM, and TB library and editor states", async () => {
		openMenu.set(true);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector(".dashboard")).not.toBeNull(),
		);
		expectViewportFilling(".overview-inner");
		expectViewportFilling(".dashboard");
		await unmount(mounted);
		mounted = null;
		document.body.replaceChildren();

		editTm.set(false);
		mounted = mount(TmSection, { target: document.body });
		await eventually(() =>
			expect(document.querySelector(".resource-workspace")).not.toBeNull(),
		);
		expectViewportFilling(".resource-workspace");
		await unmount(mounted);
		mounted = null;
		document.body.replaceChildren();

		singleTmData.set({
			id: Date.now(),
			name: "Full-width memory",
			terms: [
				{
					source: { lang: "en", segment: "Wide source" },
					target: [{ lang: "de", segment: "Breites Ziel" }],
				},
			],
		});
		editTm.set(true);
		mounted = mount(TmSection, { target: document.body });
		await eventually(() =>
			expect(document.querySelector(".resource-editor-content")).not.toBeNull(),
		);
		expectViewportFilling(".resource-editor-shell");
		expectViewportFilling(".resource-editor-content");
		const tmBackButton = document.querySelector<HTMLButtonElement>(
			".resource-editor-titlebar .resource-editor-title-actions .resource-editor-back",
		);
		expect(tmBackButton?.textContent).toContain("Back to memories");
		expectInlineResourceTitleActions();
		tmBackButton?.click();
		await eventually(() =>
			expect(document.querySelector(".resource-workspace")).not.toBeNull(),
		);
		await unmount(mounted);
		mounted = null;
		document.body.replaceChildren();

		editTb.set(false);
		mounted = mount(TbSection, { target: document.body });
		await eventually(() =>
			expect(document.querySelector(".resource-workspace")).not.toBeNull(),
		);
		expectViewportFilling(".resource-workspace");
		await unmount(mounted);
		mounted = null;
		document.body.replaceChildren();

		singleTbData.set({
			id: Date.now() + 1,
			name: "Full-width terminology",
			entries: [
				{
					terms: [
						{ lang: "en", term: "wide", notes: [] },
						{ lang: "de", term: "breit", notes: [] },
					],
				},
			],
		});
		editTb.set(true);
		mounted = mount(TbSection, { target: document.body });
		await eventually(() =>
			expect(document.querySelector(".resource-editor-content")).not.toBeNull(),
		);
		expectViewportFilling(".resource-editor-shell");
		expectViewportFilling(".resource-editor-content");
		const tbBackButton = document.querySelector<HTMLButtonElement>(
			".resource-editor-titlebar .resource-editor-title-actions .resource-editor-back",
		);
		expect(tbBackButton?.textContent).toContain("Back to term bases");
		expectInlineResourceTitleActions();
		tbBackButton?.click();
		await eventually(() =>
			expect(document.querySelector(".resource-workspace")).not.toBeNull(),
		);
	});

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
		const download = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined);
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
		expect(firstSegment.classList.contains("segment-locked")).toBe(true);
		const lockedTarget =
			firstSegment.querySelector<HTMLElement>(".target-field")!;
		const sourceField =
			firstSegment.querySelector<HTMLElement>(".source-text")!;
		expect(getComputedStyle(sourceField).backgroundColor).toBe(
			"rgb(220, 236, 240)",
		);
		expect(getComputedStyle(lockedTarget).backgroundColor).toBe(
			getComputedStyle(sourceField).backgroundColor,
		);
		expect(document.body.textContent).toContain("0% complete");
		expect(firstSegment.textContent).toContain("Confirm");
		expect(
			Array.from(document.querySelectorAll(".segment-actions button")).some(
				(action) => action.textContent?.trim() === "Confirm translated",
			),
		).toBe(false);
		expect(
			Array.from(document.querySelectorAll(".segment-actions button")).some(
				(action) => action.textContent?.trim() === "Split selected",
			),
		).toBe(false);
		expect(
			Array.from(firstSegment.querySelectorAll("button")).some(
				(action) => action.textContent?.trim() === "Split",
			),
		).toBe(true);
		const confirm = firstSegment.querySelector<HTMLElement>(
			'[data-segment-action="confirm"]',
		)!;
		const segmentBounds = firstSegment.getBoundingClientRect();
		const confirmBounds = confirm.getBoundingClientRect();
		const sourceActionsBounds = firstSegment
			.querySelector<HTMLElement>(".left-buttons-container")!
			.getBoundingClientRect();
		if (document.documentElement.clientWidth > 760) {
			expect(
				Math.abs(
					confirmBounds.left +
						confirmBounds.width / 2 -
						(segmentBounds.left + segmentBounds.width / 2),
				),
			).toBeLessThanOrEqual(1);
		} else {
			expect(segmentBounds.right - confirmBounds.right).toBeGreaterThan(0);
			expect(segmentBounds.right - confirmBounds.right).toBeLessThanOrEqual(16);
		}
		expect(
			Math.abs(
				confirmBounds.top + confirmBounds.height / 2 - segmentBounds.top,
			),
		).toBeLessThanOrEqual(1);
		expect(
			confirmBounds.left - sourceActionsBounds.right,
		).toBeGreaterThanOrEqual(4);
		for (const actionName of ["Lock all", "Fill empty"]) {
			const action = button(actionName);
			const icon = action.querySelector<SVGElement>("svg")!;
			expect(icon).not.toBeNull();
			expect(getComputedStyle(icon).fill).toBe(getComputedStyle(action).color);
			expect(icon.getBoundingClientRect().width).toBeGreaterThan(0);
		}

		const textarea = document.querySelector("textarea")!;
		expect(getComputedStyle(textarea).backgroundColor).not.toBe(
			getComputedStyle(lockedTarget).backgroundColor,
		);
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
		expect(document.body.textContent?.replace(/\s+/g, " ")).toContain(
			"151 segments are not confirmed",
		);
		expect(get(singleUserData).translationData.locked[0]).toBe(true);
		expect(get(singleUserData).translationData.checked[0]).toBe(false);

		button("Export anyway").click();
		await eventually(() => expect(download).toHaveBeenCalledTimes(1));
		await eventually(() =>
			expect(document.body.textContent).not.toContain("Export files"),
		);
	});

	it("runs every advertised editor shortcut from the focused target field without stealing AltGr or modal input", async () => {
		const project = makeUserData({
			name: "Keyboard shortcuts",
			seg1: ["Alpha one", "Beta two", "Gamma three"],
			seg2: ["", "Zwei", "Drei"],
			checked: [false, false, false],
			locked: [false, false, false],
		});
		project.id = Date.now();
		await updateTranslationOnIndexedDB(project);
		singleUserData.set(project);
		tmData.set([]);
		tbData.set([]);
		selectedSegmentId.set(0);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);

		let firstTarget = document.querySelector<HTMLTextAreaElement>(
			'[data-segment-id="0"] textarea',
		)!;
		firstTarget.focus();
		const altGraph = dispatchEditorShortcut(firstTarget, "KeyE", "€", {
			altGraph: true,
		});
		expect(altGraph.defaultPrevented).toBe(false);
		expect(get(singleUserData).translationData.seg1).toHaveLength(3);

		const fill = dispatchEditorShortcut(firstTarget, "KeyF", "f");
		expect(fill.defaultPrevented).toBe(true);
		await eventually(() =>
			expect(get(singleUserData).translationData.seg2[0]).toBe("Alpha one"),
		);

		const lock = dispatchEditorShortcut(firstTarget, "KeyL", "l");
		expect(lock.defaultPrevented).toBe(true);
		await eventually(() =>
			expect(get(singleUserData).translationData.locked[0]).toBe(true),
		);
		const firstSegment = document.querySelector<HTMLElement>(
			'[data-segment-id="0"]',
		)!;
		const unlock = dispatchEditorShortcut(firstSegment, "KeyL", "l");
		expect(unlock.defaultPrevented).toBe(true);
		await eventually(() =>
			expect(get(singleUserData).translationData.locked[0]).toBe(false),
		);
		firstSegment
			.querySelector<HTMLButtonElement>('[data-segment-action="confirm"]')!
			.click();
		await eventually(() => {
			expect(get(singleUserData).translationData.checked[0]).toBe(true);
			expect(get(singleUserData).translationData.locked[0]).toBe(true);
		});
		const unlockConfirmed = dispatchEditorShortcut(firstSegment, "KeyL", "l");
		expect(unlockConfirmed.defaultPrevented).toBe(true);
		await eventually(() => {
			expect(get(singleUserData).translationData.checked[0]).toBe(false);
			expect(get(singleUserData).translationData.locked[0]).toBe(false);
		});

		firstTarget = document.querySelector<HTMLTextAreaElement>(
			'[data-segment-id="0"] textarea',
		)!;
		firstTarget.focus();
		const next = dispatchEditorShortcut(firstTarget, "ArrowDown", "ArrowDown");
		expect(next.defaultPrevented).toBe(true);
		await eventually(() => expect(get(selectedSegmentId)).toBe(1));
		let secondTarget = document.querySelector<HTMLTextAreaElement>(
			'[data-segment-id="1"] textarea',
		)!;
		secondTarget.focus();
		expect(document.activeElement).toBe(secondTarget);

		const previous = dispatchEditorShortcut(
			secondTarget,
			"ArrowUp",
			"ArrowUp",
			{ metaKey: true },
		);
		expect(previous.defaultPrevented).toBe(true);
		await eventually(() => expect(get(selectedSegmentId)).toBe(0));
		firstTarget = document.querySelector<HTMLTextAreaElement>(
			'[data-segment-id="0"] textarea',
		)!;
		dispatchEditorShortcut(firstTarget, "ArrowDown", "ArrowDown");
		await eventually(() => expect(get(selectedSegmentId)).toBe(1));
		secondTarget = document.querySelector<HTMLTextAreaElement>(
			'[data-segment-id="1"] textarea',
		)!;

		const joinButton = button("Join selected");
		expect(joinButton.disabled).toBe(true);
		const secondCheckbox = document.querySelector<HTMLInputElement>(
			'[data-segment-id="1"] .combine-toggle-checkbox',
		)!;
		secondCheckbox.click();
		await tick();
		expect(joinButton.disabled).toBe(true);

		const rejectedJoin = dispatchEditorShortcut(secondTarget, "KeyJ", "j");
		expect(rejectedJoin.defaultPrevented).toBe(true);
		await tick();
		expect(get(singleUserData).translationData.seg1).toHaveLength(3);

		const thirdCheckbox = document.querySelector<HTMLInputElement>(
			'[data-segment-id="2"] .combine-toggle-checkbox',
		)!;
		thirdCheckbox.click();
		await eventually(() => expect(joinButton.disabled).toBe(false));
		secondTarget = document.querySelector<HTMLTextAreaElement>(
			'[data-segment-id="1"] textarea',
		)!;
		const join = dispatchEditorShortcut(secondTarget, "KeyJ", "j");
		expect(join.defaultPrevented).toBe(true);
		await eventually(() =>
			expect(get(singleUserData).translationData.seg1).toHaveLength(2),
		);
		await eventually(() => expect(button("Join selected").disabled).toBe(true));
		const boundary = document.querySelector<HTMLElement>(
			'[data-segment-id="1"] .join-boundary-marker',
		)!;
		expect(boundary).not.toBeNull();
		boundary.click();
		const split = dispatchEditorShortcut(boundary, "KeyE", "e");
		expect(split.defaultPrevented).toBe(true);
		await eventually(() =>
			expect(get(singleUserData).translationData.seg1).toEqual([
				"Alpha one",
				"Beta two",
				"Gamma three",
			]),
		);

		const resources = dispatchEditorShortcut(window, "KeyM", "m");
		expect(resources.defaultPrevented).toBe(true);
		await eventually(() =>
			expect(document.body.textContent).toContain("Language resources"),
		);
		const beforeModalShortcut = get(singleUserData).translationData.seg2[2];
		const blockedBehindModal = dispatchEditorShortcut(window, "KeyF", "f");
		expect(blockedBehindModal.defaultPrevented).toBe(false);
		expect(get(singleUserData).translationData.seg2[2]).toBe(
			beforeModalShortcut,
		);
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		await eventually(() =>
			expect(document.body.textContent).not.toContain("Language resources"),
		);

		await deleteCurrentProject(project.id);
	});

	it("keeps the editor DOM bounded while navigating a very large project", async () => {
		const count = 10_000;
		const project = makeUserData({
			seg1: Array.from({ length: count }, (_, index) => `Source ${index + 1}`),
			seg2: Array.from({ length: count }, () => ""),
			checked: Array.from({ length: count }, () => false),
			locked: Array.from({ length: count }, () => false),
		});
		project.id = 9402;
		singleUserData.set(project);
		tmData.set([]);
		tbData.set([]);
		selectedSegmentId.set(0);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);
		expect(document.querySelectorAll("[data-segment-id]").length).toBeLessThan(
			100,
		);

		const container = document.querySelector<HTMLElement>(
			".segments-container",
		)!;
		container.scrollTop = container.scrollHeight;
		container.dispatchEvent(new Event("scroll"));
		await eventually(() =>
			expect(
				document.querySelector(`[data-segment-id="${count - 1}"]`),
			).not.toBeNull(),
		);
		expect(
			document.querySelectorAll("[data-segment-id]").length,
		).toBeLessThanOrEqual(160);
		expect(document.querySelector('[data-segment-id="0"]')).toBeNull();
	});

	it("keeps confirmation, editing, and locking as independent persisted segment states", async () => {
		const project = makeUserData({
			name: "Segment state transitions",
			seg1: ["Source segment"],
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

		const segment = document.querySelector<HTMLElement>(
			'[data-segment-id="0"]',
		)!;
		const segmentButton = (label: string) => {
			const candidate = Array.from(segment.querySelectorAll("button")).find(
				(element) => element.textContent?.trim() === label,
			);
			if (!(candidate instanceof HTMLButtonElement))
				throw new Error(`Segment button ${label} was not found.`);
			return candidate;
		};
		const fill = segment.querySelector<HTMLButtonElement>(
			'[data-segment-action="fill"]',
		)!;
		const emptyConfirm = segmentButton("Confirm");
		expect(fill.disabled).toBe(false);
		expect(emptyConfirm.disabled).toBe(true);
		expect(emptyConfirm.title).toBe(
			"Add a target translation before confirming this segment",
		);
		expect(get(singleUserData).translationData.checked).toEqual([false]);

		for (const value of ["T", "Tar", "Target"]) {
			enterText(segment.querySelector<HTMLTextAreaElement>("textarea")!, value);
		}
		await eventually(() => expect(fill.disabled).toBe(true));
		expect(fill.title).toBe("The target already contains text");
		await eventually(() =>
			expect(segmentButton("Confirm").disabled).toBe(false),
		);
		segmentButton("Confirm").click();
		await eventuallyAsync(async () => {
			expect(get(singleUserData).translationData.checked).toEqual([true]);
			expect(get(singleUserData).translationData.locked).toEqual([true]);
			const saved = (await loadTranslationsUserDataFromIndexedDB()).find(
				(candidate) => candidate.id === project.id,
			);
			expect(saved?.translationData.seg2).toEqual(["Target"]);
			expect(saved?.translationData.checked).toEqual([true]);
			expect(saved?.translationData.locked).toEqual([true]);
		});
		const confirmedButton = segmentButton("Confirmed");
		expect(confirmedButton).not.toBeDisabled();
		expect(confirmedButton.classList.contains("confirmed")).toBe(true);
		await eventually(() =>
			expect(getComputedStyle(confirmedButton).backgroundColor).toBe(
				"rgb(234, 246, 239)",
			),
		);
		expect(getComputedStyle(confirmedButton, "::before").content).toContain(
			"✓",
		);
		expect(segment.querySelector("textarea")).toBeNull();

		segment
			.querySelector<HTMLButtonElement>('[aria-label="Unlock segment"]')!
			.click();
		await eventually(() => {
			expect(get(singleUserData).translationData.locked).toEqual([false]);
			expect(get(singleUserData).translationData.checked).toEqual([false]);
		});
		expect(segment.querySelector("textarea")).not.toBeNull();

		segmentButton("Confirm").click();
		await eventually(() => {
			expect(get(singleUserData).translationData.checked).toEqual([true]);
			expect(get(singleUserData).translationData.locked).toEqual([true]);
		});
		segmentButton("Confirmed").click();
		await eventually(() => {
			expect(get(singleUserData).translationData.checked).toEqual([false]);
			expect(get(singleUserData).translationData.locked).toEqual([true]);
		});
		segment
			.querySelector<HTMLButtonElement>('[aria-label="Unlock segment"]')!
			.click();
		await eventually(() =>
			expect(get(singleUserData).translationData.locked).toEqual([false]),
		);

		segmentButton("Confirm").click();
		await eventually(() => {
			expect(get(singleUserData).translationData.checked).toEqual([true]);
			expect(get(singleUserData).translationData.locked).toEqual([true]);
		});
		button("Unlock all").click();
		await eventually(() => {
			expect(get(singleUserData).translationData.checked).toEqual([false]);
			expect(get(singleUserData).translationData.locked).toEqual([false]);
		});
		enterText(
			segment.querySelector<HTMLTextAreaElement>("textarea")!,
			"Edited target",
		);
		await eventuallyAsync(async () => {
			const saved = (await loadTranslationsUserDataFromIndexedDB()).find(
				(candidate) => candidate.id === project.id,
			);
			expect(saved?.translationData.seg2).toEqual(["Edited target"]);
			expect(saved?.translationData.checked).toEqual([false]);
		});

		await deleteCurrentProject(project.id);
	});

	it("marks source and target text with independent language directions", async () => {
		const project = makeUserData({
			name: "RTL semantics",
			sourceLang: "English (en)",
			targetLang: "Arabic (ar)",
			seg1: ["Source text"],
			seg2: ["نص الهدف"],
			checked: [true],
			locked: [true],
		});
		singleUserData.set(project);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);
		const segment = document.querySelector<HTMLElement>(
			'[data-segment-id="0"]',
		)!;
		const source = segment.querySelector<HTMLElement>(".source-select")!;
		const target = segment.querySelector<HTMLElement>(".target-field")!;
		expect(segment.hasAttribute("lang")).toBe(false);
		expect(source.getAttribute("lang")).toBe("en");
		expect(source.getAttribute("dir")).toBe("ltr");
		expect(target.getAttribute("lang")).toBe("ar");
		expect(target.getAttribute("dir")).toBe("rtl");
	});

	it("invalidates confirmation after applying TM and TB content", async () => {
		const resourceId = Date.now();
		const project = makeUserData({
			name: "Review invalidation",
			sourceLang: "English (en)",
			targetLang: "German (de)",
			seg1: ["Save file"],
			seg2: ["Altes Ziel"],
			checked: [true],
			locked: [false],
			tm: { id: resourceId, name: "Editor memory", active: true },
			tb: { id: resourceId, name: "Editor terms", active: true },
		});
		project.id = resourceId + 1;
		const memory = {
			id: resourceId,
			name: "Editor memory",
			terms: [
				{
					source: { lang: "en", segment: "Save file" },
					target: [{ lang: "de", segment: "Datei speichern" }],
				},
			],
		};
		const termBase = {
			id: resourceId,
			name: "Editor terms",
			entries: [
				{
					terms: [
						{ lang: "en", term: "file", notes: [] },
						{ lang: "de", term: "Datei", notes: [] },
					],
				},
			],
		};
		await updateTranslationOnIndexedDB(project);
		singleUserData.set(project);
		tmData.set([memory]);
		tbData.set([termBase]);
		selectedSegmentId.set(0);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector("textarea")).not.toBeNull(),
		);
		document.querySelector<HTMLTextAreaElement>("textarea")!.focus();
		await eventually(() =>
			expect(
				document.querySelector(".segment-memory-container"),
			).not.toBeNull(),
		);

		document
			.querySelector<HTMLButtonElement>(".segment-memory-container")!
			.click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Replace the current target"),
		);
		button("Use TM match").click();
		await eventuallyAsync(async () => {
			const saved = (await loadTranslationsUserDataFromIndexedDB()).find(
				(candidate) => candidate.id === project.id,
			);
			expect(saved?.translationData.seg2).toEqual(["Datei speichern"]);
			expect(saved?.translationData.checked).toEqual([false]);
		});

		const segment = document.querySelector<HTMLElement>(
			'[data-segment-id="0"]',
		)!;
		const confirm = Array.from(segment.querySelectorAll("button")).find(
			(candidate) => candidate.textContent?.trim() === "Confirm",
		) as HTMLButtonElement;
		confirm.click();
		await eventually(() => {
			expect(get(singleUserData).translationData.checked).toEqual([true]);
			expect(get(singleUserData).translationData.locked).toEqual([true]);
		});
		segment
			.querySelector<HTMLButtonElement>('[aria-label="Unlock segment"]')!
			.click();
		await eventually(() => {
			expect(get(singleUserData).translationData.checked).toEqual([false]);
			expect(get(singleUserData).translationData.locked).toEqual([false]);
		});
		document.querySelector<HTMLButtonElement>(".tb-sub-container")!.click();
		await eventuallyAsync(async () => {
			const saved = (await loadTranslationsUserDataFromIndexedDB()).find(
				(candidate) => candidate.id === project.id,
			);
			expect(saved?.translationData.seg2).toEqual(["Datei speichern Datei"]);
			expect(saved?.translationData.checked).toEqual([false]);
		});

		await deleteCurrentProject(project.id);
	});

	it("enables TM+ only for complete bilingual units", async () => {
		const resourceId = Date.now();
		const project = makeUserData({
			sourceLang: "English (en)",
			targetLang: "German (de)",
			seg1: ["Complete source"],
			seg2: [""],
			checked: [false],
			locked: [false],
			tm: { id: resourceId, name: "Validated memory", active: true },
		});
		project.id = resourceId + 1;
		singleUserData.set(project);
		tmData.set([{ id: resourceId, name: "Validated memory", terms: [] }]);
		tbData.set([]);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);
		const tmAdd = Array.from(
			document.querySelectorAll<HTMLButtonElement>(
				'[data-segment-id="0"] button',
			),
		).find(
			(candidate) => candidate.textContent?.replace(/\s+/g, "") === "TM+",
		)!;
		expect(tmAdd.disabled).toBe(true);

		enterText(document.querySelector<HTMLTextAreaElement>("textarea")!, "Ziel");
		await tick();
		expect(tmAdd.disabled).toBe(false);
	});

	it("does not announce TMX or TBX import success when persistence fails", async () => {
		const tmx = `<?xml version="1.0"?><tmx version="1.4"><header creationtool="OpenTLC" creationtoolversion="1" segtype="sentence" o-tmf="OpenTLC" adminlang="en" srclang="en" datatype="plaintext"><prop type="name">Failure test</prop></header><body><tu tuid="1"><tuv xml:lang="en"><seg>Hello</seg></tuv><tuv xml:lang="de"><seg>Hallo</seg></tuv></tu></body></tmx>`;
		const tbx = `<?xml version="1.0"?><tbx style="dca" type="TBX-Min" xml:lang="en" xmlns="urn:iso:std:iso:30042:ed-2"><tbxHeader><fileDesc><title>Failure test</title><sourceDesc>Browser persistence test</sourceDesc></fileDesc></tbxHeader><text><body><conceptEntry id="c1"><langSec xml:lang="en"><termSec><term>Hello</term></termSec></langSec><langSec xml:lang="de"><termSec><term>Hallo</term></termSec></langSec></conceptEntry></body></text></tbx>`;
		tmData.set([]);
		tbData.set([]);
		const failedAdd = vi
			.spyOn(IDBObjectStore.prototype, "add")
			.mockImplementationOnce(() => {
				throw new DOMException("Quota reached", "QuotaExceededError");
			});
		mounted = mount(TmxUpload, { target: document.body });
		const tmxInput =
			document.querySelector<HTMLInputElement>('input[type="file"]')!;
		Object.defineProperty(tmxInput, "files", {
			configurable: true,
			value: [new File([tmx], "memory.tmx", { type: "application/xml" })],
		});
		tmxInput.dispatchEvent(new Event("input", { bubbles: true }));
		await eventually(() =>
			expect(get(toastStore).some((toast) => toast.type === "error")).toBe(
				true,
			),
		);
		expect(get(toastStore).some((toast) => toast.type === "success")).toBe(
			false,
		);

		await unmount(mounted);
		mounted = null;
		document.body.replaceChildren();
		for (const toast of get(toastStore)) toastStore.remove(toast.id);
		failedAdd.mockImplementationOnce(() => {
			throw new DOMException("Quota reached", "QuotaExceededError");
		});
		mounted = mount(TbxUpload, { target: document.body });
		const tbxInput =
			document.querySelector<HTMLInputElement>('input[type="file"]')!;
		Object.defineProperty(tbxInput, "files", {
			configurable: true,
			value: [new File([tbx], "terms.tbx", { type: "application/xml" })],
		});
		tbxInput.dispatchEvent(new Event("input", { bubbles: true }));
		await eventually(() =>
			expect(get(toastStore).some((toast) => toast.type === "error")).toBe(
				true,
			),
		);
		expect(get(toastStore).some((toast) => toast.type === "success")).toBe(
			false,
		);
		expect(failedAdd).toHaveBeenCalledTimes(2);
	});

	it("does not announce portable-project import success before persistence", async () => {
		userData.set([]);
		const project = makeUserData({
			name: "Portable failure",
			seg1: ["Source"],
			seg2: ["Target"],
			checked: [true],
		});
		const failedAdd = vi
			.spyOn(IDBObjectStore.prototype, "add")
			.mockImplementationOnce(() => {
				throw new DOMException("Quota reached", "QuotaExceededError");
			});
		mounted = mount(SaveFileUpload, { target: document.body });
		const input =
			document.querySelector<HTMLInputElement>('input[type="file"]')!;
		Object.defineProperty(input, "files", {
			configurable: true,
			value: [
				new File([JSON.stringify(project)], "portable.json", {
					type: "application/json",
				}),
			],
		});
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await eventually(() =>
			expect(get(toastStore).some((toast) => toast.type === "error")).toBe(
				true,
			),
		);
		expect(get(toastStore).some((toast) => toast.type === "success")).toBe(
			false,
		);
		expect(failedAdd).toHaveBeenCalled();
	});

	it("replaces a matching project from an older portable backup after confirmation", async () => {
		const current = makeUserData({
			name: "Current local project",
			seg1: ["Source"],
			seg2: ["Original backup target"],
			checked: [true],
		});
		current.id = Date.now() + 87_000;
		await updateTranslationOnIndexedDB(current);
		const oldBackup = structuredClone(current);
		current.translationData.seg2[0] = "Newer local target";
		await updateTranslationOnIndexedDB(current);
		await loadTranslationsUserDataFromIndexedDB();

		mounted = mount(SaveFileUpload, { target: document.body });
		const input =
			document.querySelector<HTMLInputElement>('input[type="file"]')!;
		Object.defineProperty(input, "files", {
			configurable: true,
			value: [
				new File([JSON.stringify(oldBackup)], "older-backup.json", {
					type: "application/json",
				}),
			],
		});
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await eventually(() =>
			expect(document.body.textContent).toContain("Replace existing project"),
		);
		button("Replace existing project").click();
		await eventuallyAsync(async () => {
			const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
				({ id }) => id === current.id,
			);
			expect(restored?.translationData.seg2[0]).toBe("Original backup target");
		});
		expect(
			get(toastStore).some((toast) =>
				toast.message.includes("replaced from the portable backup"),
			),
		).toBe(true);
		await deleteCurrentProject(current.id);
	});

	it("reports a failed confirmed replacement and leaves local data unchanged", async () => {
		const current = makeUserData({
			name: "Replacement failure",
			seg1: ["Source"],
			seg2: ["Keep this local target"],
			checked: [true],
		});
		current.id = Date.now() + 88_000;
		await updateTranslationOnIndexedDB(current);
		const backup = structuredClone(current);
		backup.translationData.seg2[0] = "Do not persist this backup";
		await loadTranslationsUserDataFromIndexedDB();

		mounted = mount(SaveFileUpload, { target: document.body });
		const input =
			document.querySelector<HTMLInputElement>('input[type="file"]')!;
		Object.defineProperty(input, "files", {
			configurable: true,
			value: [
				new File([JSON.stringify(backup)], "failed-replacement.json", {
					type: "application/json",
				}),
			],
		});
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await eventually(() =>
			expect(document.body.textContent).toContain("Replace existing project"),
		);
		const failedPut = vi
			.spyOn(IDBObjectStore.prototype, "put")
			.mockImplementationOnce(() => {
				throw new DOMException("Quota reached", "QuotaExceededError");
			});
		button("Replace existing project").click();
		await eventually(() =>
			expect(
				get(toastStore).some(
					(toast) =>
						toast.type === "error" && toast.message.includes("local storage"),
				),
			).toBe(true),
		);
		const unchanged = (await loadTranslationsUserDataFromIndexedDB()).find(
			({ id }) => id === current.id,
		);
		expect(unchanged?.translationData.seg2[0]).toBe("Keep this local target");
		expect(
			get(toastStore).some((toast) =>
				toast.message.includes("replaced from the portable backup"),
			),
		).toBe(false);
		failedPut.mockRestore();
		await deleteCurrentProject(current.id);
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
		if (saved?.id !== undefined) await deleteCurrentProject(saved.id);
	});

	it("cancels stale upload detection on replacement and modal close", async () => {
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
		const first = await slowZipFile("obsolete.docx");
		setInputFile(input, first.file);
		await first.started;
		expect(document.body.textContent).toContain("CHECKING");
		expect(document.querySelector("#project-name")).toBeNull();

		const replacementInput = document.querySelector<HTMLInputElement>(
			"#replacement-file-input",
		)!;
		setInputFile(
			replacementInput,
			new File(["Replacement text"], "replacement.txt", {
				type: "text/plain",
			}),
		);
		await eventually(() => expect(first.wasCancelled()).toBe(true));
		await eventually(() =>
			expect(document.body.textContent?.replace(/\s+/g, " ")).toContain(
				"Detected: TXT",
			),
		);
		expect(document.body.textContent).not.toContain("obsolete.docx");

		const second = await slowZipFile("closed.docx");
		setInputFile(
			document.querySelector<HTMLInputElement>("#replacement-file-input")!,
			second.file,
		);
		await second.started;
		const close = document.querySelector<HTMLButtonElement>(
			'button[aria-label="Close dialog"]',
		)!;
		close.click();
		await eventually(() => expect(second.wasCancelled()).toBe(true));
		await eventually(() =>
			expect(document.querySelector('[role="dialog"]')).toBeNull(),
		);
		expect(get(toastStore).some((toast) => /cancel/i.test(toast.message))).toBe(
			false,
		);
	});

	it("never exposes malformed PDF input as importable while validating", async () => {
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
		const forged = new File(["%PDF-1.7\nforged body"], "forged.pdf", {
			type: "application/pdf",
		});
		const originalSlice = forged.slice.bind(forged);
		let notifySliceStarted!: () => void;
		const sliceStarted = new Promise<void>((resolve) => {
			notifySliceStarted = resolve;
		});
		let releaseSlice!: () => void;
		const sliceReleased = new Promise<void>((resolve) => {
			releaseSlice = resolve;
		});
		Object.defineProperty(forged, "slice", {
			value: (start?: number, end?: number, contentType?: string) => {
				const blob = originalSlice(start, end, contentType);
				const read = blob.arrayBuffer.bind(blob);
				Object.defineProperty(blob, "arrayBuffer", {
					value: async () => {
						notifySliceStarted();
						await sliceReleased;
						return read();
					},
				});
				return blob;
			},
		});
		setInputFile(input, forged);
		await sliceStarted;
		await tick();
		try {
			expect(document.body.textContent).toContain("CHECKING");
			expect(document.querySelector("#project-name")).toBeNull();
		} finally {
			releaseSlice();
		}
		await eventually(() =>
			expect(document.body.textContent).toContain("Invalid PDF document"),
		);
		expect(document.querySelector("#project-name")).toBeNull();
		expect(
			Array.from(document.querySelectorAll("button")).some(
				(candidate) => candidate.textContent?.trim() === "Create Project",
			),
		).toBe(false);
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

	it("shows the actual CAT return-package artifact in the export modal", async () => {
		const project = makeUserData({
			name: "handoff.mqout",
			seg1: ["Source"],
			seg2: ["Target"],
			checked: [true],
			locked: [false],
			type: "cat-package",
			typeRef: { returnExtension: "mqback" },
		});
		project.id = 9403;
		singleUserData.set(project);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);

		button("Export translation").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Export files"),
		);
		const primary = document.querySelector<HTMLElement>(
			".modal-action-card.primary",
		);
		expect(primary?.textContent).toContain("MQBACK return package");
		expect(primary?.textContent).toContain(".mqback");
		expect(primary?.textContent).not.toMatch(/original source format/i);
	});

	it("does not export after the latest edit fails to persist", async () => {
		const project = makeUserData({
			name: "blocked-stale-export",
			seg1: ["Source"],
			seg2: ["Persisted target"],
			checked: [true],
			locked: [false],
			type: "text",
			typeRef: "Source",
		});
		project.id = Date.now() + 93_000;
		await updateTranslationOnIndexedDB(project);
		singleUserData.set(project);
		openMenu.set(false);
		const download = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined);
		const failedPut = vi
			.spyOn(IDBObjectStore.prototype, "put")
			.mockImplementationOnce(() => {
				throw new DOMException("Quota reached", "QuotaExceededError");
			});
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector("textarea")).not.toBeNull(),
		);
		enterText(
			document.querySelector<HTMLTextAreaElement>("textarea")!,
			"Unsaved target",
		);
		await eventually(() =>
			expect(
				get(toastStore).some(
					(toast) =>
						toast.type === "error" && toast.message.includes("local storage"),
				),
			).toBe(true),
		);

		button("Export translation").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Export files"),
		);
		const plainText = Array.from(
			document.querySelectorAll<HTMLElement>(".modal-action-card strong"),
		).find((element) => element.textContent?.trim() === "Plain text")!;
		(plainText.closest("button") as HTMLButtonElement).click();
		await eventually(() =>
			expect(document.body.textContent).toContain(
				"latest edit was not saved, so export was cancelled",
			),
		);
		expect(download).not.toHaveBeenCalled();

		failedPut.mockRestore();
		download.mockRestore();
		await deleteCurrentProject(project.id);
	});

	it("shows a user-visible warning for formula-like native CSV targets", async () => {
		const project = makeUserData({
			name: "formula-warning.csv",
			seg1: ["Safe source"],
			seg2: ['=HYPERLINK("https://example.invalid")'],
			checked: [true],
			locked: [false],
			type: "csv",
			typeRef: "Source",
		});
		project.id = Date.now() + 94_000;
		singleUserData.set(project);
		openMenu.set(false);
		const download = vi
			.spyOn(HTMLAnchorElement.prototype, "click")
			.mockImplementation(() => undefined);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.querySelector('[data-segment-id="0"]')).not.toBeNull(),
		);

		button("Export translation").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Export files"),
		);
		document
			.querySelector<HTMLButtonElement>(".modal-action-card.primary")!
			.click();
		await eventually(() =>
			expect(
				get(toastStore).some(
					(toast) =>
						toast.type === "warning" &&
						toast.message.includes("formula-like target"),
				),
			).toBe(true),
		);
		expect(download).toHaveBeenCalled();
		download.mockRestore();
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
		await deleteCurrentTm(seed);
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
		await deleteCurrentTb(seed);
	});

	it("keeps new TM units as local drafts until the complete unit is saved", async () => {
		const seed = Date.now();
		const memory = { id: seed, name: "Draft-safe memory", terms: [] };
		await saveNewTmToIndexedDB(memory);
		singleTmData.set(memory);
		mounted = mount(TmEditing, { target: document.body });
		button("Add Translation Unit").click();
		await tick();

		expect((await getTmDataById(seed))?.terms).toEqual([]);
		const drafts = document.querySelectorAll<HTMLTextAreaElement>("textarea");
		expect(drafts).toHaveLength(2);
		enterText(drafts[0], "Hello 🌍");
		button("Save").click();
		await eventually(() =>
			expect(
				get(toastStore).some((toast) => /translated text/i.test(toast.message)),
			).toBe(true),
		);
		expect((await getTmDataById(seed))?.terms).toEqual([]);

		enterText(drafts[1], "مرحبا بالعالم");
		button("Save").click();
		await eventuallyAsync(async () => {
			expect((await getTmDataById(seed))?.terms[0]).toMatchObject({
				source: { lang: "en", segment: "Hello 🌍" },
				target: [{ lang: "de", segment: "مرحبا بالعالم" }],
			});
		});
		await deleteCurrentTm(seed);
	});

	it("keeps new TB terms as local drafts until language and value are complete", async () => {
		const seed = Date.now();
		const termBase = { id: seed, name: "Draft-safe terminology", entries: [] };
		await saveNewTbToIndexedDB(termBase);
		singleTbData.set(termBase);
		mounted = mount(TbEditing, { target: document.body });
		button("Add New Term Unit").click();
		await tick();

		expect((await getTbDataById(seed))?.entries).toEqual([]);
		const select = document.querySelector<HTMLSelectElement>("select")!;
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
		enterText(textarea, "مصطلح");
		button("Save").click();
		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					/needs a language/i.test(toast.message),
				),
			).toBe(true),
		);
		expect((await getTbDataById(seed))?.entries).toEqual([]);

		select.value = "ar";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		button("Save").click();
		await eventuallyAsync(async () => {
			expect((await getTbDataById(seed))?.entries[0].terms[0]).toMatchObject({
				lang: "ar",
				term: "مصطلح",
			});
		});
		await deleteCurrentTb(seed);
	});

	it("does not persist a new TM target early and protects the final target", async () => {
		const seed = Date.now();
		const memory = {
			id: seed,
			name: "Target-safe memory",
			terms: [
				{
					source: { lang: "en", segment: "Source" },
					target: [{ lang: "de", segment: "Ziel" }],
				},
			],
		};
		await saveNewTmToIndexedDB(memory);
		singleTmData.set(memory);
		mounted = mount(TmEditing, { target: document.body });
		const onlyDelete = document.querySelector<HTMLButtonElement>(
			".segment-group.target .editor-action.danger",
		)!;
		expect(onlyDelete.disabled).toBe(true);
		expect(onlyDelete.title).toMatch(/at least one target/i);

		button("Add Segment").click();
		await tick();
		expect((await getTmDataById(seed))?.terms[0].target).toHaveLength(1);
		const targetGroups = document.querySelectorAll<HTMLElement>(
			".segment-group.target",
		);
		const draft = targetGroups[targetGroups.length - 1];
		const select = draft.querySelector<HTMLSelectElement>("select")!;
		const textarea = draft.querySelector<HTMLTextAreaElement>("textarea")!;
		select.value = "fr";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		enterText(textarea, "Cible — مرحبا");
		draft.querySelector<HTMLButtonElement>("button.save")!.click();
		await eventuallyAsync(async () => {
			expect((await getTmDataById(seed))?.terms[0].target).toEqual([
				{ lang: "de", segment: "Ziel" },
				{ lang: "fr", segment: "Cible — مرحبا" },
			]);
		});
		await deleteCurrentTm(seed);
	});

	it("keeps new TB notes local and refuses an empty note on save", async () => {
		const seed = Date.now();
		const termBase = {
			id: seed,
			name: "Note-safe terminology",
			entries: [
				{ terms: [{ lang: "en", term: "file", notes: [] as string[] }] },
			],
		};
		await saveNewTbToIndexedDB(termBase);
		singleTbData.set(termBase);
		mounted = mount(TbEditing, { target: document.body });
		button("Edit").click();
		await tick();
		button("Add Note").click();
		await tick();
		expect((await getTbDataById(seed))?.entries[0].terms[0].notes).toEqual([]);

		button("Save").click();
		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					/note text or remove/i.test(toast.message),
				),
			).toBe(true),
		);
		expect((await getTbDataById(seed))?.entries[0].terms[0].notes).toEqual([]);

		enterText(
			document.querySelector<HTMLTextAreaElement>(
				".note-with-attr-container-open textarea",
			)!,
			"Approved ✓",
		);
		button("Save").click();
		await eventuallyAsync(async () => {
			expect((await getTbDataById(seed))?.entries[0].terms[0].notes).toEqual([
				{ type: "", text: "Approved ✓" },
			]);
		});
		await deleteCurrentTb(seed);
	});

	it("keeps the project rename modal and snapshots unchanged after a quota failure", async () => {
		const project = makeUserData({ name: "Persisted project" });
		project.id = Date.now();
		await updateTranslationOnIndexedDB(project);
		userData.set([project]);
		singleUserData.set(project);
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
		await deleteCurrentProject(project.id);
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
		await deleteCurrentProject(project.id);
	});

	it("persists the final queued edit through blur, page exit, route destruction, and project switching", async () => {
		const first = makeUserData({
			name: "Lifecycle source project",
			seg1: ["Source"],
			seg2: ["Old target"],
			checked: [true],
			locked: [false],
		});
		first.id = Date.now();
		const second = makeUserData({ name: "Switched project" });
		second.id = first.id + 1;
		await updateTranslationOnIndexedDB(first);
		await updateTranslationOnIndexedDB(second);
		singleUserData.set(first);
		selectedSegmentId.set(0);
		openMenu.set(false);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(
				document.querySelector<HTMLTextAreaElement>("textarea"),
			).not.toBeNull(),
		);
		const textarea = document.querySelector<HTMLTextAreaElement>("textarea")!;
		for (const value of ["F", "Final", "Final queued target — العربية"]) {
			enterText(textarea, value);
		}
		textarea.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "hidden",
		});
		document.dispatchEvent(new Event("visibilitychange"));
		window.dispatchEvent(new PageTransitionEvent("pagehide"));
		singleUserData.set(second);
		await unmount(mounted);
		mounted = null;

		await eventuallyAsync(async () => {
			const saved = (await loadTranslationsUserDataFromIndexedDB()).find(
				(candidate) => candidate.id === first.id,
			);
			expect(saved?.translationData.seg2).toEqual([
				"Final queued target — العربية",
			]);
			expect(saved?.translationData.checked).toEqual([false]);
		});
		Object.defineProperty(document, "visibilityState", {
			configurable: true,
			value: "visible",
		});
		await deleteCurrentProject(first.id);
		await deleteCurrentProject(second.id);
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
		await deleteCurrentTm(seed);
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
		await deleteCurrentTb(seed);
	});

	it("clears loading and remains navigable after an IndexedDB open failure", async () => {
		closeIndexedDbConnection();
		userData.set([]);
		openMenu.set(true);
		const failedOpen = vi
			.spyOn(IDBFactory.prototype, "open")
			.mockImplementationOnce(() => {
				throw new DOMException("Database blocked", "InvalidStateError");
			});
		mounted = mount(AppRoute, { target: document.body });

		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					toast.message.includes("Projects could not be loaded"),
				),
			).toBe(true),
		);
		expect(get(showLoading)).toBe(false);
		expect(get(openMenu)).toBe(true);
		expect(document.body.textContent).toContain("Your projects");
		failedOpen.mockRestore();
		await expect(
			loadTranslationsUserDataFromIndexedDB(),
		).resolves.toBeDefined();
	});

	it("reports a blocked IndexedDB upgrade instead of loading forever", async () => {
		closeIndexedDbConnection();
		userData.set([]);
		openMenu.set(true);
		const diagnostic = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const request = {} as IDBOpenDBRequest;
		const blockedOpen = vi
			.spyOn(IDBFactory.prototype, "open")
			.mockImplementationOnce(() => {
				queueMicrotask(() =>
					request.onblocked?.(
						new IDBVersionChangeEvent("blocked", {
							oldVersion: 2,
							newVersion: 3,
						}),
					),
				);
				return request;
			});
		mounted = mount(AppRoute, { target: document.body });

		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					toast.message.includes("Close other Open TLC tabs"),
				),
			).toBe(true),
		);
		expect(get(showLoading)).toBe(false);
		expect(document.body.textContent).toContain("Your projects");
		expect(diagnostic).toHaveBeenCalledWith(
			"[Open TLC] IndexedDB upgrade blocked (Error)",
		);
		blockedOpen.mockRestore();
		diagnostic.mockRestore();
		await expect(
			loadTranslationsUserDataFromIndexedDB(),
		).resolves.toBeDefined();
	});

	it("clears loading after project read and migration failures", async () => {
		await loadTranslationsUserDataFromIndexedDB();
		userData.set([]);
		openMenu.set(true);
		const failedRead = vi
			.spyOn(IDBDatabase.prototype, "transaction")
			.mockImplementationOnce(() => {
				throw new DOMException("Read transaction failed", "InvalidStateError");
			});
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					toast.message.includes("Projects could not be loaded"),
				),
			).toBe(true),
		);
		expect(get(showLoading)).toBe(false);
		expect(get(openMenu)).toBe(true);
		failedRead.mockRestore();
		await unmount(mounted);
		mounted = null;
		for (const toast of get(toastStore)) toastStore.remove(toast.id);

		const rawId = Date.now();
		const request = indexedDB.open("OPEN_TLC_5432_DB", 3);
		const database = await new Promise<IDBDatabase>((resolve, reject) => {
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const transaction = database.transaction("UserData", "readwrite");
		transaction.objectStore("UserData").put({
			id: rawId,
			schemaVersion: 999,
			translationData: {},
		});
		await new Promise<void>((resolve, reject) => {
			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
		});
		database.close();
		userData.set([]);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					toast.message.includes("schema version 999"),
				),
			).toBe(true),
		);
		expect(get(showLoading)).toBe(false);
		expect(get(openMenu)).toBe(true);
		const cleanupRequest = indexedDB.open("OPEN_TLC_5432_DB", 3);
		const cleanupDatabase = await new Promise<IDBDatabase>(
			(resolve, reject) => {
				cleanupRequest.onsuccess = () => resolve(cleanupRequest.result);
				cleanupRequest.onerror = () => reject(cleanupRequest.error);
			},
		);
		const cleanup = cleanupDatabase.transaction("UserData", "readwrite");
		cleanup.objectStore("UserData").delete(rawId);
		await new Promise<void>((resolve, reject) => {
			cleanup.oncomplete = () => resolve();
			cleanup.onerror = () => reject(cleanup.error);
		});
		cleanupDatabase.close();
	});

	it("keeps the project library open when an active TM resource is missing", async () => {
		const project = makeUserData({ name: "Missing resource project" });
		project.id = Date.now();
		project.translationData.tm = {
			id: project.id + 50_000,
			name: "Removed memory",
			active: true,
		};
		await updateTranslationOnIndexedDB(project);
		tmData.set([]);
		userData.set([]);
		openMenu.set(true);
		mounted = mount(AppRoute, { target: document.body });
		await eventually(() =>
			expect(document.body.textContent).toContain("Missing resource project"),
		);
		const projectCard = document.querySelector<HTMLButtonElement>(
			'[aria-label="Open options for Missing resource project"]',
		);
		if (!projectCard)
			throw new Error("Missing-resource project card not found");
		projectCard.click();
		await eventually(() =>
			expect(document.body.textContent).toContain("Continue translating"),
		);
		button("Open project").click();
		await eventually(() =>
			expect(document.body.textContent).toContain("no longer available"),
		);
		expect(get(showLoading)).toBe(false);
		expect(get(openMenu)).toBe(true);
		expect(document.body.textContent).toContain("Your projects");
		await deleteCurrentProject(project.id);
	});

	it("clears loading when TM and TB library reads fail", async () => {
		await loadTranslationsUserDataFromIndexedDB();
		tmData.set([]);
		let failedRead = vi
			.spyOn(IDBDatabase.prototype, "transaction")
			.mockImplementationOnce(() => {
				throw new DOMException("TM read failed", "InvalidStateError");
			});
		mounted = mount(TmSection, { target: document.body });
		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					toast.message.includes("Translation memories could not be loaded"),
				),
			).toBe(true),
		);
		expect(get(showLoading)).toBe(false);
		failedRead.mockRestore();
		await unmount(mounted);
		mounted = null;
		for (const toast of get(toastStore)) toastStore.remove(toast.id);

		tbData.set([]);
		failedRead = vi
			.spyOn(IDBDatabase.prototype, "transaction")
			.mockImplementationOnce(() => {
				throw new DOMException("TB read failed", "InvalidStateError");
			});
		mounted = mount(TbSection, { target: document.body });
		await eventually(() =>
			expect(
				get(toastStore).some((toast) =>
					toast.message.includes("Term bases could not be loaded"),
				),
			).toBe(true),
		);
		expect(get(showLoading)).toBe(false);
		failedRead.mockRestore();
	});
});
