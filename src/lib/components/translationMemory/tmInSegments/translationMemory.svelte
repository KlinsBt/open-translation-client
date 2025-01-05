<script lang="ts">
	import Modal from "$lib/components/modal.svelte";
	import { updateTranslationOnIndexedDB } from "$lib/functions/saveData/indexedDb";
	import {
		tmMatches,
		seg2WordCount,
		selectedSegmentId,
		singleUserData,
	} from "$lib/functions/saveData/stores.svelte";
	import { getTotalWordCount } from "$lib/functions/statistics";

	let showConfirmationModal: boolean = false;
	let tempTargetText: string = "";

	function fillTargetText(tm: string) {
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		newUserData.translationData.seg2[$selectedSegmentId] = tm;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		seg2WordCount.set(getTotalWordCount($singleUserData.translationData.seg2));
		showConfirmationModal = false;
	}

	function checkIfConfirmationIsNeeded(tm: string) {
		tempTargetText = tm;
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		if (newUserData.translationData.seg2[$selectedSegmentId] === "") {
			newUserData.translationData.seg2[$selectedSegmentId] = tm;
			singleUserData.set(newUserData);
			updateTranslationOnIndexedDB($singleUserData);
			seg2WordCount.set(
				getTotalWordCount($singleUserData.translationData.seg2),
			);
		} else {
			showConfirmationModal = true;
		}
	}
</script>

{#snippet confirmationMenu()}
	<div class="options-container">
		<div class="buttons-container">
			<p class="deletion-confirmation">
				The text segment will be replaced with the selected text.
			</p>
			<button class="btn save" onclick={() => fillTargetText(tempTargetText)}>
				Confirm
			</button>
			<button
				class="btn update"
				onclick={() => (showConfirmationModal = false)}
			>
				Cancel
			</button>
		</div>
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	class="modal-element-global {showConfirmationModal
		? ''
		: 'close-modal-global'}"
	onclick={() => (showConfirmationModal = false)}
>
	<Modal title="TM/TB Setup" content={confirmationMenu} />
</div>

<div class="translation-memory-container">
	<h1>Treanslation Memory</h1>
	<div class="header">
		<p class="header-id">ID</p>
		<p class="header-source">Source</p>
		<p class="header-match">Match</p>
		<p class="header-target">Target</p>
	</div>

	<div class="tm-segments">
		{#each $tmMatches as match, i}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="segment-memory-container"
				onclick={() => checkIfConfirmationIsNeeded(match.match)}
			>
				<p class="id">{i + 1}</p>
				<p class="source-segment">{match.segment}</p>
				<p
					class="matches"
					class:exact-match={parseFloat(match.percentage) === 100}
					class:very-high-match={parseFloat(match.percentage) >= 90 &&
						parseFloat(match.percentage) < 100}
					class:high-match={parseFloat(match.percentage) >= 76 &&
						parseFloat(match.percentage) < 90}
					class:medium-match={parseFloat(match.percentage) >= 65 &&
						parseFloat(match.percentage) < 76}
					class:low-match={parseFloat(match.percentage) >= 20 &&
						parseFloat(match.percentage) < 65}
				>
					{match.percentage}
				</p>
				<p class="target-segment">{match.match}</p>
			</div>
		{/each}
	</div>
</div>

<style>
	.modal-element-global {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
	}

	.options-container {
		display: flex;
		justify-content: center;
		align-items: start;
		flex-wrap: wrap;
		padding: 0px;
	}

	.deletion-confirmation {
		font-size: 1.2rem;
		font-weight: 600;
		margin: 0px 0px 10px 0px;
		color: var(--color-theme-4);
		color: #c02b2b;
		text-align: center;
		max-width: 280px;
	}

	.buttons-container {
		display: grid;
		justify-items: center;
		width: 100%;
		gap: 10px 0px;
	}

	.buttons-container > .btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-theme-4);
		color: white;
		border: none;
		font-size: 1.3rem;
		border-radius: 5px;
		padding: 10px;
		margin: 5px 0px;
		cursor: pointer;
		width: 100%;
		min-width: 250px;
		transition: filter 0.2s linear;
		position: relative;
	}

	.buttons-container > .btn:hover {
		filter: brightness(1.1);
	}

	.translation-memory-container {
		display: flex;
		flex-direction: column;
		background-color: #ffffff;
		width: 100%;
		/* max-height: 100px; */
		min-height: 100%;
	}

	.translation-memory-container > h1 {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-theme-4);
		text-align: left;
		margin: 0px;
		padding: 3px 5px;
		background-color: var(--color-theme-7);
		/* max-height: 0px; */
	}

	.header {
		display: flex;
		background-color: #f4f4f4;
		background-color: var(--color-theme-5);
		padding: 0px;
		margin: 0px;
		max-height: 30px;
	}

	.header-id,
	.header-source,
	.header-match,
	.header-target {
		font-size: 0.9rem;
		font-weight: 700;
		justify-content: center;
		color: var(--color-theme-7);
		margin: 0px;
		padding: 5px;
		text-align: center;
	}

	.header-id {
		width: calc(10% - 5px);
		max-width: 50px;
	}

	.header-target,
	.header-source {
		width: calc(40% - 5px);
	}

	.header-match {
		width: calc(10% - 5px);
		max-width: 50px;
		/* background-color: #00b600; */
	}

	.tm-segments {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		overflow-y: scroll;
	}

	.segment-memory-container {
		display: flex;
		align-items: center;
		padding: 0px;
		width: 100%;
		height: 100%;
		cursor: pointer;
	}

	.segment-memory-container > p {
		margin: 5px 0px;
		text-align: center;
	}

	.id {
		font-size: 0.8rem;
		padding: 5px;
		font-weight: 600;
		text-align: center;
		width: 10%;
		max-width: 50px;
	}

	.target-segment,
	.source-segment {
		font-size: 0.8rem;
		margin: 0;
		padding: 5px;
		font-weight: 600;
		width: 40%;
		color: var(--color-theme-5);
	}

	.matches {
		text-align: center;
		font-size: 0.8rem;
		padding: 5px;
		font-weight: 600;
		width: 10%;
		max-width: 50px;
		color: #ffffff;
		border-radius: 4px;
	}

	/* Background color-coded match percentages */

	.exact-match {
		background-color: #00b600; /* 100% */
	}

	.very-high-match {
		background-color: #00ff00; /* 90% - 99% */
	}

	.high-match {
		background-color: #6de06d; /* 76% - 89% */
	}

	.medium-match {
		background-color: #ff8c00; /* 65% - 75% */
	}

	.low-match {
		background-color: #ff0000; /* 20% - 64% */
	}

	.segment-memory-container:hover {
		background-color: #eaf2ff;
	}
</style>
