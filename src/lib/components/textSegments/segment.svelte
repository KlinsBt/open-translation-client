<script lang="ts">
	import {
		updateTmOnIndexedDB,
		updateTranslationOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	// import { getTranslationMemoryMatches } from "$lib/components/translationMemory/tmFunctions";
	import {
		singleUserData,
		seg2WordCount,
		singleTmData,
		tmData,
		tbData,
		singleTbData,
		selectedSegmentId,
	} from "$lib/functions/saveData/stores.svelte";
	import { getTotalWordCount } from "$lib/functions/statistics";
	import { searchForMatches } from "$lib/components/translationMemory/tmFunctions";
	import { getTermMatches } from "$lib/components/termBase/tbFunctions";
	import type { TbData, TmData } from "$lib/types/types";
	import { notifySuccess } from "$lib/components/notifications/toastStore";

	let {
		id,
		textSegment1,
		textSegment2,
		checked,
	}: {
		id: number;
		textSegment1: string;
		textSegment2: string;
		checked: boolean;
	} = $props();

	let tmMatchesFound: { segment: string; match: string; percentage: string }[] =
		$state([]);
	let tbMatchesFound: {
		searchEntry: string;
		foundEntry: string;
		notes: string[];
	}[] = $state([]);
	let sourceLang: string = $derived(
		getLanguageCode($singleUserData.translationData.sourceLang),
	);
	let targetLang: string = $derived(
		getLanguageCode($singleUserData.translationData.targetLang),
	);
	let rightToLeftTargetLang: boolean = $derived(
		["ar", "he", "dv", "fa", "ur"].includes(targetLang),
	);
	let tmActive: boolean = $derived(
		$singleUserData.translationData.tm?.active ?? false,
	);

	function toggleLockSegment() {
		if (checked) {
			checked = false;
			return updateSegmentLock();
		} else {
			checked = true;
			return updateSegmentLock();
		}
	}

	function updateSegmentLock() {
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		newUserData.translationData.checked[id] = checked;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		seg2WordCount.set(getTotalWordCount($singleUserData.translationData.seg2));
	}

	function updateSegmentText() {
		selectedSegmentId.set(id);
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		newUserData.translationData.seg2[id] = textSegment2;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		seg2WordCount.set(getTotalWordCount($singleUserData.translationData.seg2));
	}

	function fillTargetSegmentText() {
		if (!$singleUserData) return console.log("Data not found");
		if (textSegment1 === "") return console.log("No text to add");
		if (textSegment2 !== "") return console.log("Target segment is not empty");
		let newUserData = $singleUserData;
		newUserData.translationData.seg2[id] = textSegment1;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		seg2WordCount.set(getTotalWordCount($singleUserData.translationData.seg2));
	}

	// function fillAllEmptySegments() {
	// 	if (!$singleUserData) return console.log("Data not found");
	// 	let newUserData = $singleUserData;
	// 	newUserData.translationData.seg2 = newUserData.translationData.seg2.map(
	// 		(segment, i) => {
	// 			if (segment === "") return newUserData.translationData.seg1[i];
	// 			return segment;
	// 		},
	// 	);
	// 	console.log(newUserData.translationData.seg2);
	// 	singleUserData.set(newUserData);
	// 	updateTranslationOnIndexedDB($singleUserData);
	// 	seg2WordCount.set(getTotalWordCount($singleUserData.translationData.seg2));
	// }

	function useAutoHeight(node: HTMLTextAreaElement) {
		function adjustHeight() {
			// Reset the height so the scrollHeight can be recalculated properly
			node.style.height = "auto";
			// Set the height based on scrollHeight (the actual content height)
			node.style.height = `${node.scrollHeight}px`;
		}

		// Run the adjustment on initialization
		adjustHeight();

		// Add event listeners to adjust height when content changes
		node.addEventListener("input", adjustHeight);

		return {
			destroy() {
				// Remove the event listener when the component is destroyed
				node.removeEventListener("input", adjustHeight);
			},
		};
	}

	function updateTmMatches(textSegment1: string) {
		// console.log("TM Data: ", $tmData);
		let id = $singleUserData.translationData.tm?.id;
		// console.log("ID: ", id);
		singleTmData.set($tmData.find((data) => data.id === id) as TmData);
		// console.log("Single TM Data: ", $singleTmData);
		tmMatchesFound = searchForMatches(
			$singleTmData,
			textSegment1,
			sourceLang,
			targetLang,
		);
	}

	function updateTbMatches(textSegment1: string) {
		// console.log("TB Data: ", $tbData);
		let id = $singleUserData.translationData.tb?.id;
		// console.log("ID: ", id);
		singleTbData.set($tbData.find((data) => data.id === id) as TbData);
		// console.log("Single TB Data: ", $singleTbData);
		tbMatchesFound = getTermMatches(
			$singleTbData,
			textSegment1,
			sourceLang,
			targetLang,
		);
		// console.log("TB Matches: ", tbMatchesFound);
	}

	function getLanguageCode(lang?: string): string {
		// Extract language code from full name like "English (en)" or return as-is
		if (!lang) return "";
		const match = lang.match(/\(([^)]+)\)/);
		return match?.[1] ?? lang;
	}

	async function tmIdExists(id: number | null): Promise<boolean> {
		if (id === null) return false;
		return !!$tmData.find((data) => data.id === id);
	}

	async function tbIdExists(id: number | null): Promise<boolean> {
		if (id === null) return false;
		return !!$tbData.find((data) => data.id === id);
	}

	async function checkIfElligibleForTmOrTbSearch(textSegment1: string) {
		selectedSegmentId.set(id);
		if (
			$singleUserData.translationData.tm?.active &&
			$singleUserData.translationData.tm?.id !== null &&
			(await tmIdExists($singleUserData.translationData.tm?.id))
		) {
			updateTmMatches(textSegment1);
		}
		if (
			$singleUserData.translationData.tb?.active &&
			$singleUserData.translationData.tb?.id !== null &&
			(await tbIdExists($singleUserData.translationData.tb?.id))
		) {
			updateTbMatches(textSegment1);
		}
	}

	async function addTranslationUnit(
		sourceSentence: string,
		targetSentence: string,
	) {
		if (!$singleTmData) return console.log("TM Data not found");
		let localTmData = $singleTmData;
		console.log("Local TM Data: ", localTmData);
		console.log("sourceLang: ", sourceLang);
		console.log("targetLang: ", targetLang);

		localTmData.terms.push({
			// id: localTmData.terms.length + 1,
			source: {
				lang: sourceLang,
				segment: sourceSentence,
			},
			target: [
				{
					lang: targetLang,
					segment: targetSentence,
				},
			],
		});
		singleTmData.set(localTmData);
		console.log("SingleTmData: ", $singleTmData);
		await updateTmOnIndexedDB($singleTmData);
		notifySuccess("Translation unit added to TM successfully!");
	}
</script>

<div class="segment" lang={targetLang}>
	<button
		class="toggle-container {checked ? 'locked' : 'unlocked'}"
		onclick={toggleLockSegment}
	>
		{#if checked}
			<!-- Locked Icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
				<path
					d="M 12 1 C 8.6761905 1 6 3.6761905 6 7 L 6 8 C 4.9 8 4 8.9 4 10 L 4 20 C 4 21.1 4.9 22 6 22 L 18 22 C 19.1 22 20 21.1 20 20 L 20 10 C 20 8.9 19.1 8 18 8 L 18 7 C 18 3.6761905 15.32381 1 12 1 z M 12 3 C 14.27619 3 16 4.7238095 16 7 L 16 8 L 8 8 L 8 7 C 8 4.7238095 9.7238095 3 12 3 z M 12 13 C 13.1 13 14 13.9 14 15 C 14 16.1 13.1 17 12 17 C 10.9 17 10 16.1 10 15 C 10 13.9 10.9 13 12 13 z"
				></path>
			</svg>
		{:else}
			<!-- Unlocked Icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
				<path
					d="M 18 1 C 14.67619 1 12 3.6761905 12 7 L 12 8 L 2.9296875 8 C 1.8656875 8 1 8.897 1 10 L 1 20 C 1 21.103 1.8656875 22 2.9296875 22 L 14.070312 22 C 15.134312 22 16 21.103 16 20 L 16 10 C 16 8.897 15.135266 8 14.072266 8 L 14 8 L 14 7 C 14 4.7238095 15.72381 3 18 3 C 20.27619 3 22 4.7238095 22 7 L 22 9 L 24 9 L 24 7 C 24 3.6761905 21.32381 1 18 1 z M 8.5078125 13 C 9.6078125 13 10.507812 13.9 10.507812 15 C 10.507812 16.1 9.6078125 17 8.5078125 17 C 7.4078125 17 6.5078125 16.1 6.5078125 15 C 6.5078125 13.9 7.4078125 13 8.5078125 13 z"
				></path>
			</svg>
		{/if}
	</button>

	<!-- <span class="segment-number-outer">{id + 1}</span> -->

	<div class="field left source-text">
		<div class="left-buttons-container">
			<button class="translate-btn" onclick={() => fillTargetSegmentText()}>
				Fill
				<span>→</span>
			</button>
			<!-- <button class="translate-btn ml" disabled>
				MT
				<span>→</span>
			</button> -->
			<button
				class="tm-btn save"
				disabled={tmActive ? false : true}
				onclick={() => addTranslationUnit(textSegment1, textSegment2)}
			>
				TM<span>+</span>
			</button>
		</div>
		<span class="segment-number-inner">{id + 1}.</span>
		<p>{textSegment1}</p>
	</div>

	{#if checked}
		<p class="field left">
			{textSegment2}
		</p>
	{:else}
		<textarea
			lang={targetLang}
			spellcheck="false"
			onfocus={async () => {
				checkIfElligibleForTmOrTbSearch(textSegment1);
			}}
			onchange={updateSegmentText}
			class="field right"
			style="
				direction: {rightToLeftTargetLang ? 'rtl' : 'ltr'}; 
				"
			bind:value={textSegment2}
			placeholder="Translate the text here..."
			use:useAutoHeight
			cols="30"
		></textarea>
	{/if}
</div>

<style>
	.segment {
		position: relative;
		display: flex;
		justify-content: center;
		width: 100%;

		display: grid;
		justify-content: center;
		grid-template-columns: 50% 50%;
	}

	.segment > textarea {
		border: 2px solid var(--color-theme-7);
	}

	.segment > textarea:focus {
		outline: none;
		border: 2px solid var(--color-theme-3);
	}

	.field {
		background-color: var(--color-theme-3);
		display: block;
		margin-block-start: 1em;
		margin-block-end: 1em;
		margin-inline-start: 0px;
		margin-inline-end: 0px;
		transition: all 0.1s linear;
		margin: 2% 2%;
		padding: 15px;
		border-radius: 5px;
		border: 1px solid #ccc;
		border: 2px solid #bee5f6;
	}

	/* .middle {
		display: flex;
		flex-direction: column;
		padding: 20px 0px;
		gap: 5px 0px;
	} */

	.left-buttons-container {
		display: flex;
		justify-content: space-between;
	}

	.translate-btn,
	.tm-btn {
		gap: 0px 5px;
		background-color: var(--color-theme-4);
		color: white;
		border: none;
		padding: 5px;
		font-weight: bold;
		font-size: 0.7rem;

		position: absolute;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 60px;
		height: 18px;
		cursor: pointer;
		border-radius: 5px;
		transition: background-color 0.3s ease;
		right: 13px;
		top: -35px;
	}

	.translate-btn > span {
		font-size: 0.8rem;
		height: 17px;
	}

	/* .translate-btn.ml {
		right: 75px;
	} */

	.tm-btn {
		right: 137px;
		right: 75px;
	}

	.translate-btn:hover,
	.tm-btn:hover {
		filter: brightness(1.1);
	}

	.tm-btn > span {
		font-size: 0.85rem;
		height: 14px;
	}

	.left {
		display: flex;
		align-items: baseline;
		background-color: #f0f0f0;
		background-color: var(--color-theme-8);
		background-color: #ecfdff;
		color: var(--color-theme-5);
		/* overflow-y: auto; */
	}

	.source-text {
		position: relative;
	}

	.left-buttons-container {
		position: absolute;
		display: block;
		justify-content: space-between;
		width: 100%;
	}

	.left p {
		margin: 0px 0px 0px 10px;
	}

	.segment-number-inner {
		color: blueviolet;
		color: var(--color-theme-4);
		font-size: 1rem;
		font-weight: 700;
		margin: 0px 2px 0px 0px;
	}

	/* .segment-number-outer {
		position: absolute;
		color: blueviolet;
		color: var(--color-theme-1);
		font-size: 1rem;
		font-weight: 700;
		top: 15px;
		left: 49%;
	} */

	.right {
		background-color: #fff;
		background-color: var(--color-theme-7);
		color: #333;
		resize: none;
		font-size: 1rem;
		font-weight: 500;
		overflow: hidden !important;
		/* min-height: calc(100% - 15px); */
		min-height: -webkit-fill-available;
	}

	/* .right:focus {
		border-color: #007bff;
		box-shadow: 0 0 5px rgba(0, 123, 255, 0.5);
	} */

	.toggle-container {
		position: absolute;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		cursor: pointer;
		border-radius: 5px;
		transition: background-color 0.3s ease;
		right: 0;
		top: 0;
	}

	.locked {
		background-color: #ff6b6b;
		background-color: #c54141;
	}

	.locked:hover {
		background-color: #e35353;
	}

	.unlocked {
		background-color: #4caf50;
	}

	.unlocked:hover {
		background-color: #6ada6e;
	}

	.locked > svg,
	.unlocked > svg {
		width: 100%;
		height: 100%;
		fill: #fff;
		transition: fill 0.3s ease;
	}
</style>
