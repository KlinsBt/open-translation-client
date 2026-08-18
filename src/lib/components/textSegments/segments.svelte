<script lang="ts">
	import Segment from "./segment.svelte";
	import AutoFill from "../svg/autoFill.svelte";
	import DocLock from "../svg/docLock.svelte";
	import SaveFile from "../svg/saveFile.svelte";
	import RightArrow from "../svg/rightArrow.svelte";
	import Export from "../svg/export2.svelte";
	import TmTb from "../svg/tmTb.svelte";
	import {
		singleUserData,
		openMenu,
		seg1WordCount,
		seg2WordCount,
		showLoading,
		tmData,
		tbData,
		singleTmData,
		selectedSegmentId,
	} from "$lib/functions/saveData/stores.svelte";
	import { functionCreateExportFile } from "$lib/functions/outputGeneration/handleTranslationExport";
	import { getFormatAdapter } from "$lib/formats/registry";

	import { generateJsonSaveFile } from "$lib/functions/saveFileGeneration/generateJsonSaveFile";
	import {
		generateXliffSaveFile2_0,
		generateXliffSaveFile2_1,
	} from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
	import { generateXliffSaveFile1_2 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile1_2";
	import {
		getTbNamesAndIds,
		getTmNamesAndIds,
		loadTbDataFromIndexedDB,
		loadTmDataFromIndexedDB,
		updateTranslationOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import Modal from "../modal.svelte";
	import {
		calcPercentageOfTotalSegmentsChecked,
		getTotalWordCount,
	} from "$lib/functions/statistics";
	import TranslationMemory from "../translationMemory/tmInSegments/translationMemory.svelte";
	import TermBase from "../termBase/tbSegments/termBase.svelte";
	import TmxUpload from "../uploads/tmxUpload/tmxUpload.svelte";
	import TbxUpload from "../uploads/tbxUpload/tbxUpload.svelte";
	import TmEditing from "../translationMemory/tmEditing/tmEditing.svelte";
	import TbEditing from "../termBase/tbEditing/tbEditing.svelte";
	import type { TbData, TmData } from "$lib/types/types";
	import {
		notifySuccess,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";
	import { editTm, editTb } from "$lib/functions/saveData/stores.svelte";
	import {
		splitSegmentData,
		combineSegmentRangeData,
		getSegmentJoinBoundaryOffsets,
	} from "$lib/functions/parsing/segmentationLogic";

	const AMOUNT_OF_SEGMENTS_TO_LOAD = 150;
	let visibleSegmentsCount = $state(150); // Initial number of segments to display when loading the page
	let segmentsContainer: HTMLElement | null = $state(null);
	let tmSelected: null | number = $derived(
		$singleUserData.translationData.tm?.id ?? null,
	);
	let tmActive: boolean = $state(
		$singleUserData.translationData.tm?.active ?? false,
	);

	let tbSelected: number | null = $state(
		$singleUserData.translationData.tb?.id ?? null,
	);
	let tbActive: boolean = $state(
		$singleUserData.translationData.tb?.active ?? false,
	);
	let lastSelectedSegmentId: number = $state(0);

	let showSaveFileModal: boolean = $state(false);
	let showTmTbModal: boolean = $state(false);
	let showTmAddModal: boolean = $state(false);
	let showTbAddModal: boolean = $state(false);
	let combineSelection: Set<number> = $state(new Set());
	let pendingSplitOffsets: Map<number, number> = $state(new Map());
	let percentage: number = $derived(
		calcPercentageOfTotalSegmentsChecked(
			$singleUserData.translationData.checked,
		),
	);
	let translationExportAvailable: boolean = $derived(
		getFormatAdapter($singleUserData.translationData.type).capabilities.export,
	);

	function handleScroll() {
		if (!segmentsContainer) return;

		const isBottom =
			segmentsContainer.scrollTop + segmentsContainer.clientHeight >=
			segmentsContainer.scrollHeight - 5; // Small buffer

		// Load more if scrolled to bottom and more segments are available
		if (
			isBottom &&
			visibleSegmentsCount < $singleUserData.translationData.seg2.length
		) {
			visibleSegmentsCount = Math.min(
				visibleSegmentsCount + AMOUNT_OF_SEGMENTS_TO_LOAD,
				$singleUserData.translationData.seg2.length,
			);
			console.log(`Loaded ${visibleSegmentsCount} segments`);
		}
	}

	function handleJsonSaveFileDownload() {
		if (!$singleUserData) return console.log("Data not found");
		generateJsonSaveFile($singleUserData);
	}

	function handleXliff2_0SaveFileDownload() {
		if (!$singleUserData) return console.log("Data not found");
		generateXliffSaveFile2_0($singleUserData);
	}

	function handleXliff2_1SaveFileDownload() {
		if (!$singleUserData) return console.log("Data not found");
		generateXliffSaveFile2_1($singleUserData);
	}

	function handleXliff1_2SaveFileDownload() {
		if (!$singleUserData) return console.log("Data not found");
		generateXliffSaveFile1_2($singleUserData);
	}

	async function handleTranslationFileExport() {
		try {
			await functionCreateExportFile($singleUserData);
			notifySuccess("Translation file exported");
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "The translation file could not be exported.",
			);
		}
	}

	function lockAllSegments() {
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		newUserData.translationData.checked =
			newUserData.translationData.checked.map(() => true);
		singleUserData.set(newUserData);
	}

	function lockAllUnlockedSegments() {
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		newUserData.translationData.checked =
			newUserData.translationData.checked.map((segment) => {
				if (!segment) return true;
				return segment;
			});
		console.log(newUserData.translationData.checked);
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
	}

	function unlockAllSegments() {
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		newUserData.translationData.checked =
			newUserData.translationData.checked.map(() => false);
		singleUserData.set(newUserData);
	}

	function focusSegment(idx: number) {
		const el = document.querySelector<HTMLElement>(
			`[data-segment-id="${idx}"]`,
		);
		if (!el) return;
		// Prefer the translation textarea inside the segment
		const input =
			el.querySelector<HTMLTextAreaElement>("textarea") ??
			el.querySelector<HTMLElement>("[tabindex]");
		(input ?? el).focus();
		(input ?? el).scrollIntoView({ block: "center", behavior: "smooth" });
	}

	function selectSegmentByOffset(offset: number) {
		const total = $singleUserData.translationData.seg1.length;
		if (total === 0) return;
		let current = $selectedSegmentId;
		if (current === null || current === undefined) {
			current = 0;
			selectedSegmentId.set(0);
		}
		let next = current + offset;
		if (next < 0) next = 0;
		if (next >= total) next = total - 1;
		lastSelectedSegmentId = next;
		selectedSegmentId.set(next);
		focusSegment(next);
	}

	function toggleLockCurrentSegment() {
		const idx = $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		if (!$singleUserData) return;
		const total = $singleUserData.translationData.checked.length;
		if (idx < 0 || idx >= total) return;
		const newUserData = { ...$singleUserData };
		newUserData.translationData.checked = [
			...newUserData.translationData.checked,
		];
		newUserData.translationData.checked[idx] =
			!newUserData.translationData.checked[idx];
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB(newUserData);
		notifyInfo(
			`Segment ${idx + 1} ${newUserData.translationData.checked[idx] ? "locked" : "unlocked"}`,
		);
	}

	function fillCurrentSegment() {
		if (!$singleUserData) return;
		const idx = $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		const total = $singleUserData.translationData.seg1.length;
		if (idx < 0 || idx >= total) return;

		// Only fill if target is empty
		if ($singleUserData.translationData.seg2[idx] !== "") return;

		const newUserData = { ...$singleUserData };
		newUserData.translationData.seg2 = [...newUserData.translationData.seg2];
		newUserData.translationData.seg2[idx] =
			newUserData.translationData.seg1[idx];
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB(newUserData);
		seg2WordCount.set(getTotalWordCount(newUserData.translationData.seg2));
		notifySuccess(`Filled segment ${idx + 1}`);
	}

	function splitCurrentSegment() {
		const idx = $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		const offset = pendingSplitOffsets.get(idx);
		if (offset === undefined) {
			notifyError("Place the caret inside a source segment first.");
			return;
		}
		splitAtOffset(idx, offset);
	}

	function splitAtOffset(customIdx?: number, customOffset?: number) {
		if (!$singleUserData) return;
		const idx = customIdx ?? $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		if (idx < 0 || idx >= $singleUserData.translationData.seg1.length) return;

		const offsetFromStore =
			customOffset ?? pendingSplitOffsets.get(idx) ?? null;
		if (offsetFromStore === null) {
			notifyError("Place the caret inside this source segment first.");
			return;
		}

		const splitAt = offsetFromStore;
		const result = splitSegmentData(
			$singleUserData.translationData,
			idx,
			splitAt,
		);
		if (result.error) {
			notifyError(result.error);
			return;
		}
		const newUserData = { ...$singleUserData, translationData: result.data };
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB(newUserData);
		selectedSegmentId.set(idx + 1);
		seg1WordCount.set(getTotalWordCount(newUserData.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(newUserData.translationData.seg2));
		pendingSplitOffsets = new Map();
		combineSelection = new Set();
		notifySuccess(
			result.restoredJoinBoundary
				? `Restored the original source and target segments at boundary ${idx + 1}.`
				: `Split segment ${idx + 1}; its existing target remains in the first half.`,
		);
	}

	function combineWithNextSegment() {
		if (!$singleUserData) return;

		let selected = Array.from(combineSelection.values()).sort((a, b) => a - b);
		if (selected.length < 2) {
			const current =
				selected[0] ?? $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
			selected = [current, current + 1];
		}

		const result = combineSegmentRangeData(
			$singleUserData.translationData,
			selected,
		);
		if (result.error) {
			notifyError(result.error);
			return;
		}

		const newUserData = { ...$singleUserData, translationData: result.data };
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB(newUserData);
		seg1WordCount.set(getTotalWordCount(newUserData.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(newUserData.translationData.seg2));
		combineSelection = new Set();
		pendingSplitOffsets = new Map();
		selectedSegmentId.set(selected[0]);
		notifySuccess(
			`Joined ${selected.length} consecutive segments. The dashed source marker can restore the boundary.`,
		);
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!event.ctrlKey && !event.metaKey) return;

		switch (event.key.toLowerCase()) {
			case "arrowdown":
				event.preventDefault();
				selectSegmentByOffset(1);
				break;
			case "arrowup":
				event.preventDefault();
				selectSegmentByOffset(-1);
				break;
			case "l":
				event.preventDefault();
				toggleLockCurrentSegment();
				break;
			case "m":
				event.preventDefault();
				toggleTmTbModal();
				break;
			case "f":
				event.preventDefault();
				fillCurrentSegment();
				break;
			case "e":
				event.preventDefault();
				splitCurrentSegment();
				break;
			case "j":
				event.preventDefault();
				combineWithNextSegment();
				break;
		}
	}

	function fillAllEmptySegments() {
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		newUserData.translationData.seg2 = newUserData.translationData.seg2.map(
			(segment, i) => {
				if (segment === "") return newUserData.translationData.seg1[i];
				return segment;
			},
		);
		console.log(newUserData.translationData.seg2);
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		seg2WordCount.set(getTotalWordCount($singleUserData.translationData.seg2));
	}

	function selectTmId(id: number | string, name: string) {
		if (typeof id === "string") {
			id = parseInt(id);
		}
		let newUserData = $singleUserData;
		newUserData.translationData!.tm!.id = id;
		newUserData.translationData!.tm!.name = name;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		singleTmData.set($tmData.find((data) => data.id === id) as TmData);
		console.log(`Selected TM Name: ${name}`);
		console.log(`Selected TM Id: ${id}`);
		notifyInfo(`Translation Memory selected: ${name}`);
	}

	function selectTbId(id: number | string, name: string) {
		if (typeof id === "string") {
			id = parseInt(id);
		}
		tbSelected = id;
		let newUserData = $singleUserData;
		newUserData.translationData!.tb!.id = id;
		newUserData.translationData!.tb!.name = name;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		console.log(`Selected TB Id: ${id}`);
		notifyInfo(`Term Base selected: ${name}`);
	}

	async function getAllTmDataFromIndexedDB() {
		showLoading.set(true);
		if ($tmData.length > 0) {
			showLoading.set(false);
			return;
		} else {
			let data = await loadTmDataFromIndexedDB();
			tmData.set(data as TmData[]);
			showLoading.set(false);
			console.log(tmData);
		}
	}

	async function getAllTbDataFromIndexedDB() {
		showLoading.set(true);
		if ($tbData.length > 0) {
			showLoading.set(false);
			return;
		} else {
			let data = await loadTbDataFromIndexedDB();
			tbData.set(data as TbData[]);
			showLoading.set(false);
			console.log(tmData);
		}
	}

	async function toggleSaveFileModal() {
		showSaveFileModal = true;
	}

	async function toggleTmTbModal() {
		getAllTmDataFromIndexedDB();
		getAllTbDataFromIndexedDB();
		showTmTbModal = true;
	}

	function closeTmAddModal() {
		showTmAddModal = false;
		editTm.set(false);
	}

	function closeTbAddModal() {
		showTbAddModal = false;
		editTb.set(false);
	}

	async function toggleMenu() {
		openMenu.set(!$openMenu);
	}

	$effect(() => {
		if ($selectedSegmentId !== null && $selectedSegmentId !== undefined) {
			lastSelectedSegmentId = $selectedSegmentId;
		}

		if (tmActive !== $singleUserData.translationData.tm?.active) {
			console.log("TM Active changed: ", tmActive);
			let newUserData = { ...$singleUserData };
			newUserData.translationData!.tm!.active = tmActive;
			singleUserData.set(newUserData);
			updateTranslationOnIndexedDB(newUserData);
			if (tmActive) {
				notifySuccess(`Translation Memory activated`);
			} else {
				notifyError(`Translation Memory deactivated`);
			}
		}

		if (tbActive !== $singleUserData.translationData.tb?.active) {
			console.log("TB Active changed: ", tbActive);
			let newUserData = { ...$singleUserData };
			newUserData.translationData!.tb!.active = tbActive;
			singleUserData.set(newUserData);
			updateTranslationOnIndexedDB(newUserData);
			if (tbActive) {
				notifySuccess(`Term Base activated`);
			} else {
				notifyError(`Term Base deactivated`);
			}
		}
	});
</script>

<svelte:window on:keydown={handleKeydown} />

{#snippet exportMenu()}
	<div class="modal-stack">
		<button class="modal-action-card" onclick={handleJsonSaveFileDownload}>
			<span class="modal-action-icon">JSON</span>
			<span class="modal-action-text"
				><strong>Open TLC JSON</strong><small
					>Best for complete project backups and continued editing.</small
				></span
			>
			<span class="modal-action-arrow">→</span>
		</button>
		<button class="modal-action-card" onclick={handleXliff1_2SaveFileDownload}>
			<span class="modal-action-icon">1.2</span>
			<span class="modal-action-text"
				><strong>XLIFF 1.2</strong><small
					>Broad compatibility with established CAT workflows.</small
				></span
			>
			<span class="modal-action-arrow">→</span>
		</button>
		<button class="modal-action-card" onclick={handleXliff2_0SaveFileDownload}>
			<span class="modal-action-icon">2.0</span>
			<span class="modal-action-text"
				><strong>XLIFF 2.0</strong><small
					>Modern standards-based bilingual interchange.</small
				></span
			>
			<span class="modal-action-arrow">→</span>
		</button>
		<button class="modal-action-card" onclick={handleXliff2_1SaveFileDownload}>
			<span class="modal-action-icon">2.1</span>
			<span class="modal-action-text"
				><strong>XLIFF 2.1</strong><small
					>Latest supported XLIFF project interchange.</small
				></span
			>
			<span class="modal-action-arrow">→</span>
		</button>
	</div>
{/snippet}

{#snippet tmTbMenu()}
	<div class="manage-tm-tb-container">
		<div class="manage-tm-container modal-section-card">
			<div class="checkable">
				<p class="header">Translation Memory</p>
				<input
					type="checkbox"
					class="tm-checkbox"
					bind:checked={tmActive}
					title="Enable Translation Memory"
				/>
			</div>
			<div class="tm-tb-selection-container">
				<div
					class="tm-tb-selection-overlay"
					style={tmActive
						? "display: background-color: rgba(230, 230, 230, 0); z-index: -1;"
						: "background-color: rgba(230, 230, 230, 0.5); z-index: 2;"}
				></div>
				<select
					class="tm-select"
					onchange={(e) =>
						selectTmId(
							(e.target as HTMLSelectElement).value,
							(e.target as HTMLSelectElement).selectedOptions[0].text,
						)}
				>
					<option disabled selected value="">
						{tmSelected !== null
							? $singleUserData.translationData.tm?.name
							: "Select Translation Memory"}
					</option>
					{#each $tmData as data}
						<option value={data.id}>
							{data.name}
						</option>
					{/each}
				</select>
			</div>
			<div class="modal-actions inline">
				<button
					class="modal-button secondary"
					onclick={() => {
						editTm.set(false);
						showTmTbModal = false;
						showTmAddModal = true;
					}}
				>
					+ Add TM
				</button>
				<button
					class="modal-button primary"
					disabled={tmSelected === null}
					onclick={() => {
						if (tmSelected === null) return;
						editTm.set(true);
						showTmTbModal = false;
						showTmAddModal = true;
					}}
				>
					Edit TM
				</button>
			</div>
		</div>

		<div class="manage-tb-container modal-section-card">
			<div class="checkable">
				<p class="header">Term Base</p>
				<input
					type="checkbox"
					class="tm-checkbox"
					bind:checked={tbActive}
					title="Enable Term Base"
				/>
			</div>
			<div class="tm-tb-selection-container">
				<div
					class="tm-tb-selection-overlay"
					style={tbActive
						? "display: background-color: rgba(230, 230, 230, 0); z-index: -1;"
						: "background-color: rgba(230, 230, 230, 0.5); z-index: 2;"}
				></div>
				<select
					class="tm-select"
					onchange={(e) =>
						selectTbId(
							(e.target as HTMLSelectElement).value,
							(e.target as HTMLSelectElement).selectedOptions[0].text,
						)}
				>
					<option disabled selected value="">
						{tbSelected !== null
							? $singleUserData.translationData.tb?.name
							: "Select Term Base"}
					</option>
					{#each $tbData as data}
						<option value={data.id}>
							{data.name}
						</option>
					{/each}
				</select>
			</div>
			<div class="modal-actions inline">
				<button
					class="modal-button secondary"
					onclick={() => {
						editTb.set(false);
						showTmTbModal = false;
						showTbAddModal = true;
					}}
				>
					+ Add TB
				</button>
				<button
					class="modal-button primary"
					disabled={tbSelected === null}
					onclick={() => {
						if (tbSelected === null) return;
						editTb.set(true);
						showTmTbModal = false;
						showTbAddModal = true;
					}}
				>
					Edit TB
				</button>
			</div>
		</div>
	</div>
{/snippet}

{#snippet tmAddMenu()}
	<div class="tm-add-container">
		{#if $editTm}
			<TmEditing />
		{:else}
			<TmxUpload />
		{/if}
	</div>
{/snippet}

{#snippet tbAddMenu()}
	<div class="tb-add-container">
		{#if $editTb}
			<TbEditing />
		{:else}
			<TbxUpload />
		{/if}
	</div>
{/snippet}

{#if showTmTbModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="presentation"
		class="modal-element-global {showTmTbModal ? '' : 'close-modal-global'}"
		onclick={() => (showTmTbModal = false)}
	>
		<Modal
			title="Language resources"
			description="Choose the translation memory and term base used by this project."
			content={tmTbMenu}
			large
			onClose={() => (showTmTbModal = false)}
		/>
	</div>
{:else if showSaveFileModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="presentation"
		class="modal-element-global {showSaveFileModal ? '' : 'close-modal-global'}"
		onclick={() => (showSaveFileModal = false)}
	>
		<Modal
			title="Export project"
			description="Choose a portable bilingual project format."
			content={exportMenu}
			wide
			onClose={() => (showSaveFileModal = false)}
		/>
	</div>
{:else if showTmAddModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="presentation"
		class="modal-element-global {showTmAddModal ? '' : 'close-modal-global'}"
		onclick={closeTmAddModal}
	>
		<Modal
			title={$editTm ? "Edit translation memory" : "Add translation memory"}
			content={tmAddMenu}
			large
			onClose={closeTmAddModal}
		/>
	</div>
{:else if showTbAddModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="presentation"
		class="modal-element-global {showTbAddModal ? '' : 'close-modal-global'}"
		onclick={closeTbAddModal}
	>
		<Modal
			title={$editTb ? "Edit term base" : "Add term base"}
			content={tbAddMenu}
			large
			onClose={closeTbAddModal}
		/>
	</div>
{/if}

<div class="toolbar">
	<div class="toolbar-inner">
		<div class="toolbar-project">
			<button
				class="toolbar-back"
				onclick={() => toggleMenu()}
				aria-label="Back to projects"
			>
				<RightArrow />
			</button>
			<div class="toolbar-project-copy">
				<span class="toolbar-eyebrow">Translation workspace</span>
				<strong>{$singleUserData.translationData.name}</strong>
			</div>
		</div>
		<div class="toolbar-actions">
			<button class="toolbar-button resource" onclick={() => toggleTmTbModal()}>
				<TmTb />
				TM &amp; Term Base
			</button>
			<button
				class="toolbar-button secondary"
				onclick={() => toggleSaveFileModal()}
			>
				<SaveFile marginBottom="0px" />
				Save project
			</button>
			<button
				class="toolbar-button primary"
				onclick={handleTranslationFileExport}
				disabled={!translationExportAvailable}
				title={translationExportAvailable
					? "Export the translated source format"
					: "This source format is import-only; use Open TLC JSON or standard XLIFF"}
			>
				<Export marginBottom="2px" />
				{translationExportAvailable
					? "Export translation"
					: "Import-only format"}
			</button>
			<button class="toolbar-help" aria-label="Keyboard shortcuts" tabindex="0">
				<span>?</span>
				<div class="shortcut-popover">
					<p>
						<strong>Ctrl/Cmd + ↓ / ↑:</strong>
						<br />
						<span>Select next/previous segment</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + L:</strong>
						<br />
						<span>Lock/Unlock current segment</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + F:</strong>
						<br />
						<span>Fill current segment (if empty)</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + M:</strong>
						<br />
						<span>Open TM/TB manager</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + E:</strong>
						<br />
						<span>Split current segment</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + J:</strong>
						<br />
						<span>Join selected segments or current + next</span>
					</p>
				</div>
			</button>
		</div>
	</div>
</div>

<div class="words-container">
	<div class="words-left">
		<span class="language-label">Source language</span>
		<h1>
			{$singleUserData.translationData.sourceLang !== undefined &&
			$singleUserData.translationData.sourceLang !== ""
				? $singleUserData.translationData.sourceLang
				: "Undefined"}
		</h1>
		<p><span>{$seg1WordCount}</span> words</p>
	</div>

	<div class="middle-container">
		<div class="top-stats">
			<div class="progress-copy">
				<p><span>{percentage}%</span> complete</p>
				<p>{$singleUserData.translationData.seg1.length} segments</p>
			</div>
			<div class="progress-track" aria-label={`${percentage}% complete`}>
				<span style={`width: ${percentage}%`}></span>
			</div>
		</div>
		<div class="segment-actions">
			<button class="bulk-action" onclick={() => lockAllUnlockedSegments()}>
				<DocLock />
				Lock all
			</button>
			<button
				class="bulk-action"
				onclick={splitCurrentSegment}
				title="Split current segment at source caret (Ctrl/Cmd+E)"
				disabled={!pendingSplitOffsets.has(
					$selectedSegmentId ?? lastSelectedSegmentId ?? 0,
				)}
			>
				Split selected
			</button>
			<button class="bulk-action" onclick={() => fillAllEmptySegments()}>
				<AutoFill />
				Fill empty
			</button>
			<button
				class="bulk-action"
				onclick={combineWithNextSegment}
				title="Join selected segments or current + next (Ctrl/Cmd+J)"
				disabled={$singleUserData.translationData.seg1.length < 2}
			>
				Join selected
			</button>
		</div>
	</div>

	<div class="words-right">
		<span class="language-label">Target language</span>
		<h1>
			{$singleUserData.translationData.targetLang !== undefined &&
			$singleUserData.translationData.targetLang !== ""
				? $singleUserData.translationData.targetLang
				: "Undefined"}
		</h1>
		<p><span>{$seg2WordCount}</span> words</p>
	</div>
</div>

<div
	class="segments-container"
	style={tmActive || tbActive ? "max-height: 50vh;" : "max-height: 741px;"}
	bind:this={segmentsContainer}
	onscroll={handleScroll}
>
	{#each $singleUserData.translationData.seg2.slice(0, visibleSegmentsCount) as _segment, i}
		<Segment
			id={i}
			textSegment1={$singleUserData.translationData.seg1[i]}
			textSegment2={$singleUserData.translationData.seg2[i]}
			checked={$singleUserData.translationData.checked[i]}
			combineSelected={combineSelection.has(i)}
			joinBoundaries={getSegmentJoinBoundaryOffsets(
				$singleUserData.translationData,
				i,
			)}
			splitOffset={pendingSplitOffsets.get(i) ?? null}
			onMarkSplit={(detail) => {
				if (detail.offset === null || detail.offset === undefined) {
					pendingSplitOffsets = new Map();
				} else {
					pendingSplitOffsets = new Map([[detail.index, detail.offset]]);
				}
				selectedSegmentId.set(detail.index);
			}}
			onSplitSegment={(detail) => splitAtOffset(detail.index, detail.offset)}
			onToggleCombine={(detail) => {
				const idx = detail.index;
				pendingSplitOffsets = new Map();
				selectedSegmentId.set(idx);
				const next = new Set(combineSelection);
				if (next.has(idx)) {
					next.delete(idx);
				} else {
					next.add(idx);
				}
				combineSelection = next;
			}}
			onActivateSegment={(detail) => {
				if (!pendingSplitOffsets.has(detail.index)) {
					pendingSplitOffsets = new Map();
				}
				selectedSegmentId.set(detail.index);
			}}
		/>
	{/each}
</div>

<div
	class="tm-tb-container"
	style={tmActive && tbActive
		? "grid-template-columns: 70% 30%;"
		: "display: flex;"}
>
	{#if tmActive}
		<div class="translation-memory">
			<TranslationMemory />
		</div>
	{/if}
	{#if tbActive}
		<div class="term-base">
			<TermBase />
		</div>
	{/if}
</div>

<style>
	.manage-tm-tb-container {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		border-radius: 8px;
		width: 100%;
		margin: 0 auto;
	}

	.manage-tm-container,
	.manage-tb-container {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.checkable {
		display: flex;
		justify-content: space-between;
		align-items: start;
	}

	.header {
		font-size: 1.1rem;
		font-weight: bold;
		color: var(--color-theme-4);
		margin: 0px;
	}

	.tm-checkbox {
		width: 20px;
		height: 20px;
		cursor: pointer;
		accent-color: #007bff; /* Sets the color of the checkbox */
	}

	.tm-tb-selection-container {
		position: relative;
	}

	.tm-tb-selection-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}

	.tm-select {
		position: relative;
		z-index: 1;
		width: 100%;
		padding: 10px;
		border: 1px solid #ccc;
		border-radius: 0.55rem;
		background-color: white;
		font-size: 1rem;
	}

	@media (max-width: 680px) {
		.manage-tm-tb-container {
			grid-template-columns: 1fr;
		}
	}

	.toolbar {
		background: #123f5f;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.7rem 1.5rem;
		width: 100%;
		box-sizing: border-box;
		box-shadow: 0 4px 18px rgba(14, 52, 72, 0.16);
		position: sticky;
		top: 0;
		z-index: 70;
	}

	.toolbar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		margin: 0 auto;
	}

	.toolbar-project,
	.toolbar-actions,
	.toolbar-button,
	.toolbar-back {
		display: flex;
		align-items: center;
	}

	.toolbar-project {
		gap: 0.75rem;
		min-width: 0;
	}

	.toolbar-project-copy {
		display: grid;
		min-width: 0;
		color: white;
	}

	.toolbar-project-copy strong {
		overflow: hidden;
		max-width: 320px;
		font-size: 0.96rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toolbar-eyebrow {
		color: #93cbd9;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.toolbar-actions {
		justify-content: flex-end;
		gap: 0.55rem;
	}

	.toolbar-back,
	.toolbar-button,
	.toolbar-help {
		min-height: 2.45rem;
		border-radius: 0.55rem;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 750;
		cursor: pointer;
		transition: 0.18s ease;
	}

	.toolbar-back {
		justify-content: center;
		width: 2.45rem;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.08);
		color: white;
	}

	.toolbar-button {
		justify-content: center;
		gap: 0.45rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		padding: 0.55rem 0.85rem;
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.toolbar-button.resource {
		border-color: rgba(137, 210, 222, 0.35);
		background: rgba(73, 165, 184, 0.16);
	}

	.toolbar-button.primary {
		border-color: #40a7c3;
		background: #2c91af;
		box-shadow: 0 5px 14px rgba(0, 0, 0, 0.13);
	}

	.toolbar-button:hover:not(:disabled),
	.toolbar-back:hover,
	.toolbar-help:hover {
		transform: translateY(-1px);
		border-color: rgba(255, 255, 255, 0.45);
		filter: brightness(1.08);
	}

	.toolbar-button:disabled {
		cursor: not-allowed;
		opacity: 0.48;
	}

	.toolbar-help {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		width: 2.45rem;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.08);
		color: #d9f1f5;
		padding: 0;
		cursor: help;
		flex-shrink: 0;
	}

	.toolbar-help span {
		user-select: none;
		line-height: 1;
	}

	.toolbar-help .shortcut-popover {
		position: absolute;
		top: calc(100% + 8px);
		right: -12px;
		min-width: 200px;
		background: white;
		color: var(--color-theme-6);
		border: 1px solid #c7dde2;
		border-radius: 0.75rem;
		padding: 0.85rem;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateY(-8px);
		transition: all 0.2s ease;
		z-index: 10;
	}

	.toolbar-help .shortcut-popover::before {
		content: "";
		position: absolute;
		top: -8px;
		right: 20px;
		width: 0;
		height: 0;
		border-left: 8px solid transparent;
		border-right: 8px solid transparent;
		border-bottom: 8px solid #c7dde2;
	}

	.toolbar-help:hover .shortcut-popover,
	.toolbar-help:focus-within .shortcut-popover {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transform: translateY(0);
	}

	.shortcut-popover p {
		margin: 5px 0;
		font-size: 0.95rem;
		line-height: 1.5;
		font-weight: 500;
		text-align: left;
	}

	.shortcut-popover p:first-child {
		margin-top: 0;
	}

	.shortcut-popover p:last-child {
		margin-bottom: 0;
	}

	.shortcut-popover strong {
		display: inline-block;
		min-width: 140px;
		color: var(--color-theme-4);
		font-weight: 700;
	}

	.tm-tb-container {
		display: grid;
		width: 100%;
	}

	.translation-memory {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0px;
		width: 100%;
		height: 100%;
		/* z-index: 2; */
		border-top: 2px solid var(--color-theme-3);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
		/* overflow-y: scroll; */
	}

	.term-base {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0px;
		width: 100%;
		height: 100%;
		/* z-index: 2; */
		border-top: 2px solid var(--color-theme-3);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
		/* overflow-y: scroll; */
	}

	.words-container {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) minmax(420px, 1.6fr) minmax(
				180px,
				1fr
			);
		align-items: center;
		gap: 2rem;
		background: rgba(240, 250, 252, 0.96);
		border-bottom: 1px solid #cce2e7;
		padding: 1rem clamp(1.25rem, 2vw, 2.5rem);
		box-sizing: border-box;
		width: 100%;
		box-shadow: 0 4px 14px rgba(19, 70, 88, 0.06);
		position: sticky;
		top: 62px;
		z-index: 50;
	}

	.words-left,
	.words-right {
		min-width: 0;
	}

	.words-right {
		text-align: right;
	}

	.language-label {
		color: #6c858e;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.words-left h1,
	.words-right h1 {
		margin: 0.12rem 0 0;
		overflow: hidden;
		color: #17495b;
		font-size: 1rem;
		font-weight: 750;
		text-overflow: ellipsis;
		text-transform: none;
		white-space: nowrap;
	}

	.words-left p,
	.words-right p {
		margin: 0.15rem 0 0;
		color: #789099;
		font-size: 0.72rem;
	}

	.words-left p span,
	.words-right p span {
		color: #2b8ea9;
		font-weight: 800;
	}

	.middle-container {
		display: grid;
		gap: 0.75rem;
	}

	.top-stats {
		display: grid;
		gap: 0.4rem;
	}

	.progress-copy {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.progress-copy p {
		margin: 0;
		color: #6c858e;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.progress-copy span {
		color: #218aa6;
	}

	.progress-track {
		height: 0.35rem;
		overflow: hidden;
		border-radius: 999px;
		background: #d8e8ec;
	}

	.progress-track span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: #2fa0bb;
		transition: width 0.25s ease;
	}

	.segment-actions {
		display: flex;
		justify-content: center;
		gap: 0.4rem;
	}

	.bulk-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-height: 2rem;
		border: 1px solid #b9d4da;
		border-radius: 0.45rem;
		padding: 0.4rem 0.6rem;
		background: white;
		color: #28657a;
		font: inherit;
		font-size: 0.68rem;
		font-weight: 750;
		cursor: pointer;
		transition: 0.18s ease;
	}

	.bulk-action:hover:not(:disabled) {
		border-color: #6facba;
		background: #f7fcfd;
		transform: translateY(-1px);
	}

	.bulk-action:disabled {
		background: #edf3f4;
		color: #9babad;
		cursor: not-allowed;
		opacity: 0.7;
	}

	.segments-container {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.65rem;
		padding: 1rem clamp(1.25rem, 2vw, 2.5rem);
		box-sizing: border-box;
		overflow-y: auto;
		width: 100%;
		background: #eaf6f8;
	}

	@media (max-width: 980px) {
		.toolbar-inner {
			align-items: flex-start;
		}

		.toolbar-actions {
			flex-wrap: wrap;
		}

		.words-container {
			grid-template-columns: 1fr 1.5fr 1fr;
			gap: 1rem;
		}

		.segment-actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}
	}

	@media (max-width: 720px) {
		.toolbar {
			padding: 0.65rem 0.75rem;
		}

		.toolbar-inner,
		.toolbar-actions {
			width: 100%;
		}

		.toolbar-inner {
			align-items: stretch;
			flex-direction: column;
		}

		.toolbar-actions {
			display: grid;
			grid-template-columns: repeat(3, 1fr) auto;
		}

		.toolbar-project-copy strong {
			max-width: calc(100vw - 5rem);
		}

		.words-container {
			position: static;
			grid-template-columns: 1fr 1fr;
			padding: 0.85rem 0.75rem;
		}

		.middle-container {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.segments-container {
			padding: 0.75rem;
		}
	}
</style>
