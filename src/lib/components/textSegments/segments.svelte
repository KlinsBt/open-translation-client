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

	import { generateJsonSaveFile } from "$lib/functions/saveFileGeneration/generateJsonSaveFile";
	import { generateXliffSaveFile2_0 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
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
	import type { TbData, TmData } from "$lib/types/types";
	import {
		notifySuccess,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";

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
	let percentage: number = $derived(
		calcPercentageOfTotalSegmentsChecked(
			$singleUserData.translationData.checked,
		),
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

	function handleXliff1_2SaveFileDownload() {
		if (!$singleUserData) return console.log("Data not found");
		generateXliffSaveFile1_2($singleUserData);
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

	function handleKeydown(event: KeyboardEvent) {
		const target = event.target as HTMLElement | null;
		const tag = target?.tagName?.toLowerCase();

		if (!event.ctrlKey && !event.metaKey) return;

		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				selectSegmentByOffset(1);
				break;
			case "ArrowUp":
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
	<div class="buttons-container">
		<button
			style="width: 100%; margin: 0px"
			class="toolbar-button"
			onclick={handleJsonSaveFileDownload}
		>
			Export as JSON
		</button>
		<button
			style="width: 100%; margin: 0px"
			class="toolbar-button"
			onclick={handleXliff1_2SaveFileDownload}
		>
			Export as XLIFF 1.2
		</button>
		<button
			style="width: 100%; margin: 0px"
			class="toolbar-button"
			onclick={handleXliff2_0SaveFileDownload}
		>
			Export as XLIFF 2.0
		</button>
	</div>
{/snippet}

{#snippet tmTbMenu()}
	<div class="manage-tm-tb-container">
		<div class="manage-tm-container">
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
		</div>

		<div class="manage-tb-container">
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
		</div>
	</div>
{/snippet}

{#if showTmTbModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="dialog"
		class="modal-element-global {showTmTbModal ? '' : 'close-modal-global'}"
		onclick={() => (showTmTbModal = false)}
	>
		<Modal title="TM/TB Setup" content={tmTbMenu} />
	</div>
{:else if showSaveFileModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="dialog"
		class="modal-element-global {showSaveFileModal ? '' : 'close-modal-global'}"
		onclick={() => (showSaveFileModal = false)}
	>
		<Modal title="Export Save File" content={exportMenu} />
	</div>
{/if}

<div class="toolbar">
	<button class="toolbar-button back" onclick={() => toggleMenu()}>
		<RightArrow />
		Back
	</button>
	<button class="toolbar-button export" onclick={() => toggleTmTbModal()}>
		Manage TM/TB
		<TmTb />
	</button>
	<button class="toolbar-button save" onclick={() => toggleSaveFileModal()}>
		Export Save File
		<SaveFile marginBottom="0px" />
	</button>
	<button
		class="toolbar-button export"
		onclick={() => functionCreateExportFile($singleUserData)}
	>
		Export Translation File
		<Export marginBottom="2px" />
	</button>
	<button class="toolbar-help" aria-label="Keyboard shortcuts" tabindex="0">
		<span>i</span>
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
		</div>
	</button>
	<!-- <button class="toolbar-button">Translate</button> -->
</div>

<div class="words-container">
	<div class="words-left">
		<h1>
			{$singleUserData.translationData.sourceLang !== undefined &&
			$singleUserData.translationData.sourceLang !== ""
				? $singleUserData.translationData.sourceLang
				: "Undefined"}
		</h1>
		<p>Words: <span>{$seg1WordCount}</span></p>
	</div>

	<div class="middle-container">
		<div class="top-stats">
			<p>
				Segments: <span>{$singleUserData.translationData.seg1.length}</span>
			</p>
			<p>Progress: <span>{percentage}%</span></p>
		</div>
		<div class="segment-actions">
			<button onclick={() => lockAllUnlockedSegments()}>
				Lock All Segments
				<DocLock />
			</button>
			<button onclick={() => fillAllEmptySegments()}>
				Fill All Segments
				<AutoFill />
			</button>
		</div>
	</div>

	<div class="words-right">
		<h1>
			{$singleUserData.translationData.targetLang !== undefined &&
			$singleUserData.translationData.targetLang !== ""
				? $singleUserData.translationData.targetLang
				: "Undefined"}
		</h1>
		<p>Words: <span>{$seg2WordCount}</span></p>
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
		display: flex;
		flex-direction: column;
		gap: 40px 0px;
		padding: 25px 0px;
		border-radius: 8px;
		width: 100%;
		max-width: 400px;
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
		border-radius: 5px;
		background-color: white;
		font-size: 1rem;
	}

	.buttons-container {
		display: grid;
		justify-items: center;
		width: 100%;
		gap: 10px 0px;
	}

	.toolbar {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		background-color: var(--color-theme-5);
		padding: 10px 0;
		width: 100%;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
		position: sticky;
		top: 0;
		z-index: 70;
	}

	.toolbar-button {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0px 8px;
		background-color: var(--color-theme-4);
		color: white;
		border: none;
		border-radius: 5px;
		padding: 10px 20px;
		margin-right: 15px;
		font-weight: bold;
		cursor: pointer;
		transition: all 0.3s ease;
		font-size: 1rem;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	}

	.toolbar-button.export {
		background-color: dodgerblue;
	}

	.toolbar-button:hover {
		/* background-color: var(--color-theme-3); */
		filter: brightness(1.1);
		box-shadow: 0 6px 10px rgba(0, 0, 0, 0.15);
	}

	.toolbar-button:active {
		transform: scale(0.98);
		box-shadow: 0 3px 5px rgba(0, 0, 0, 0.2);
	}

	.toolbar-help {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		background-color: var(--color-theme-4);
		color: white;
		border: 2px solid white;
		border-radius: 50%;
		width: 35px;
		height: 35px;
		padding: 0;
		margin: 0px;
		top: 3px;
		font-weight: bold;
		font-size: 1.5rem;
		font-style: italic;
		cursor: help;
		transition: all 0.3s ease;
		box-shadow: 0 3px 6px rgba(0, 0, 0, 0.15);
		flex-shrink: 0;
	}

	.toolbar-help span {
		user-select: none;
		line-height: 1;
	}

	.toolbar-help:hover {
		background-color: var(--color-theme-3);
		transform: scale(1.05);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.toolbar-help:active {
		transform: scale(1.05);
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
	}

	.toolbar-help .shortcut-popover {
		position: absolute;
		top: calc(100% + 8px);
		right: -12px;
		min-width: 200px;
		background: white;
		color: var(--color-theme-6);
		border: 2px solid var(--color-theme-4);
		border-radius: 5px;
		padding: 10px;
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
		border-bottom: 8px solid var(--color-theme-4);
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
		display: flex;
		justify-content: center;
		align-items: center;
		background-color: #ecf6f8;
		padding: 0px;
		width: 100%;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
		position: sticky;
		top: 58px;
		z-index: 2;
	}

	.words-container > .middle-container {
		margin: 10px 25%;
		display: grid;
		justify-items: center;
		align-items: center;
	}

	.words-container > .middle-container > .top-stats {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-around;
		align-items: center;
		width: 100%;
	}

	.words-container > .middle-container > .top-stats > p {
		margin: 0px;
	}

	.words-container > .middle-container > .top-stats > p > span {
		font-weight: bold;
		color: var(--color-theme-3);
	}

	.middle-container > div {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin: 0px 0px 5px 0px;
	}

	.middle-container > div > button {
		display: flex;
		justify-content: center;
		align-items: center;
		background-color: var(--color-theme-4);
		color: var(--color-theme-7);
		border: none;
		border-radius: 5px;
		padding: 5px;
		margin: 0px;
		font-weight: bold;
		cursor: pointer;
		transition: all 0.3s ease;
		font-size: 0.8rem;
		gap: 0px 10px;
		box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
	}

	.middle-container > div > button:nth-child(1) {
		padding: 5px 10px;
	}

	.middle-container > div > button:hover {
		background-color: var(--color-theme-3);
		filter: brightness(1.1);
		box-shadow: 0 6px 10px rgba(0, 0, 0, 0.15);
	}

	.middle-container > div > button:active {
		filter: brightness(0.95);
		box-shadow: 0 3px 5px rgba(0, 0, 0, 0.2);
	}

	.words-left > h1,
	.words-right > h1 {
		font-size: 1.3rem;
		margin: 10px 0px 0px 0px;
		text-transform: uppercase;
	}

	.words-left > h1 {
		color: var(--color-theme-4);
	}

	.words-right > h1 {
		color: var(--color-theme-4);
	}

	.words-left > p,
	.words-right > p {
		margin: 0px 0px 5px 0px;
	}

	.words-right > p > span,
	.words-left > p > span {
		font-weight: bold;
		color: var(--color-theme-3);
	}

	.segments-container {
		display: grid;
		grid-template-columns: 1fr;
		padding: 20px 25px;
		/* max-height: 700px; */
		overflow-y: auto;
		min-width: 95%;
		/* min-width: 97%; */
	}

	@media (max-width: 1228px) {
		.words-container {
			justify-content: space-evenly;
		}

		.words-container > .middle-container {
			margin: 0%;
		}
	}

	@media (max-width: 990px) {
		.segments-container {
			min-width: 90%;
		}
	}

	@media (max-width: 515px) {
		.segments-container {
			min-width: auto;
		}
	}

	@media (max-width: 690px) {
		.toolbar {
			display: flex;
			flex-wrap: wrap;
			justify-content: center;
			align-items: center;
			padding: 15px 0;
			gap: 15px 0px;
		}

		.words-container > .middle-container > .top-stats {
			display: grid;
			justify-items: center;
			align-items: center;
			grid-template-columns: auto;
			padding: 0px;
			margin: 0px;
			gap: 0px;
		}

		.words-container > .middle-container > .segment-actions {
			display: grid;
			justify-items: center;
			align-items: center;
			grid-template-columns: auto;
			padding: 0px;
			margin: 10px 0px;
			gap: 10px 0px;
		}
	}

	@media (max-width: 545px) {
		.words-left > h1,
		.words-right > h1 {
			font-size: 1rem;
		}

		.words-left > p,
		.words-right > p {
			text-align: center;
		}
	}

	@media (min-width: 800px) and (max-width: 1500px) {
		.segments-container {
			gap: 15px 0px;
		}
	}

	@media (min-width: 750px) and (max-width: 1100px) {
		.segments-container {
			gap: 20px 0px;
		}
	}

	@media (min-width: 400px) and (max-width: 750px) {
		.segments-container {
			gap: 20px 0px;
		}
	}

	@media (max-width: 400px) {
		.segments-container {
			gap: 30px 0px;
		}

		.words-left > h1,
		.words-right > h1 {
			font-size: 0.8rem;
		}

		.words-container > .middle-container > .top-stats {
			font-size: 0.7rem;
		}

		.words-container > .middle-container > .top-stats > p {
			font-size: 0.8rem;
		}

		.words-container > .middle-container > .top-stats > p > span {
			font-size: 0.7rem;
		}

		.words-left > p,
		.words-right > p {
			text-align: center;
			font-size: 0.7rem;
		}

		.words-container > .middle-container > .segment-actions > button {
			font-size: 0.6rem;
		}
	}
</style>
