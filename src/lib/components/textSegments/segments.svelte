<script lang="ts">
	import Segment from "./segment.svelte";
	import AutoFill from "../svg/autoFill.svelte";
	import DocLock from "../svg/docLock.svelte";
	import SaveFile from "../svg/saveFile.svelte";
	import RightArrow from "../svg/rightArrow.svelte";
	import Export from "../svg/export.svelte";
	import {
		singleUserData,
		openMenu,
		seg1WordCount,
		seg2WordCount,
	} from "$lib/functions/saveData/stores.svelte";
	import { functionCreateExportFile } from "$lib/functions/outputGeneration/handleTranslationExport";

	import { generateJsonSaveFile } from "$lib/functions/saveFileGeneration/generateJsonSaveFile";
	import { generateXliffSaveFile2_0 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
	import { generateXliffSaveFile1_2 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile1_2";
	import { updateTranslationOnIndexedDB } from "$lib/functions/saveData/indexedDb";
	import Modal from "../modal.svelte";
	import {
		calcPercentageOfTotalSegmentsChecked,
		getTotalWordCount,
	} from "$lib/functions/statistics";

	const AMOUNT_OF_SEGMENTS_TO_LOAD = 150;
	let visibleSegmentsCount = $state(150); // Initial number of segments to display when loading the page
	let segmentsContainer: HTMLElement | null = null;

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

	let showSaveFileModal: boolean = $state(false);
	let percentage: number = $derived(
		calcPercentageOfTotalSegmentsChecked(
			$singleUserData.translationData.checked,
		),
	);

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

	async function toggleSaveFileModal() {
		showSaveFileModal = true;
	}

	async function toggleMenu() {
		openMenu.set(!$openMenu);
	}
</script>

{#snippet buttons()}
	<div
		style="display: grid; justify-items: center; width: 100%; gap: 10px 0px;"
	>
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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	class="modal-element-global {showSaveFileModal ? '' : 'close-modal-global'}"
	onclick={() => (showSaveFileModal = false)}
>
	<!-- message="Export a save file of this translation project in one of the following formats
to have it stored locally and be able to import it later." -->
	<Modal title="Export Save File" content={buttons} />
</div>

<div class="toolbar">
	<button class="toolbar-button back" onclick={() => toggleMenu()}>
		<RightArrow />
		Back
	</button>
	<button class="toolbar-button save" onclick={() => toggleSaveFileModal()}>
		<SaveFile />
		Export Save File
	</button>
	<button
		class="toolbar-button export"
		onclick={() => functionCreateExportFile($singleUserData)}
	>
		<Export />
		Export Translation File
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
		<div>
			<button onclick={() => lockAllUnlockedSegments()}>
				Lock Segments
				<DocLock />
			</button>
			<button onclick={() => fillAllEmptySegments()}>
				Fill Segments
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

<style>
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
		z-index: 1;
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
		max-height: 700px;
		max-height: 65vh;
		overflow-y: auto;
		min-width: 95%;
	}

	@media (max-width: 997px) {
		.words-container {
			justify-content: space-evenly;
		}

		.words-container > .middle-container {
			margin: 0%;
		}
	}
</style>
