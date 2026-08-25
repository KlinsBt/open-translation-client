<script lang="ts">
	import Modal from "$lib/components/modal.svelte";
	import {
		tmMatches,
		seg2WordCount,
		selectedSegmentId,
		singleUserData,
	} from "$lib/functions/saveData/stores.svelte";
	import { getTotalWordCount } from "$lib/functions/statistics";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";
	import type { UserData } from "$lib/types/types";

	let {
		onPersistProjectMutation,
	}: {
		onPersistProjectMutation: (
			mutate: (project: UserData) => void,
		) => Promise<UserData | undefined>;
	} = $props();

	let showConfirmationModal: boolean = $state(false);
	let tempTargetText: string = $state("");

	async function fillTargetText(tm: string) {
		if (!$singleUserData) return;
		if ($singleUserData.translationData.locked[$selectedSegmentId])
			return notifyError("Unlock this segment before applying a TM match.");
		try {
			const updated = await onPersistProjectMutation((project) => {
				project.translationData.seg2[$selectedSegmentId] = tm;
				project.translationData.checked[$selectedSegmentId] = false;
			});
			if (!updated) return;
			seg2WordCount.set(getTotalWordCount(updated.translationData.seg2));
			showConfirmationModal = false;
			notifySuccess("Segment filled from TM");
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not apply this TM match.",
			);
		}
	}

	async function checkIfConfirmationIsNeeded(tm: string) {
		tempTargetText = tm;
		if (!$singleUserData) return;
		if ($singleUserData.translationData.locked[$selectedSegmentId])
			return notifyError("Unlock this segment before applying a TM match.");
		if ($singleUserData.translationData.seg2[$selectedSegmentId] === "") {
			try {
				const updated = await onPersistProjectMutation((project) => {
					project.translationData.seg2[$selectedSegmentId] = tm;
					project.translationData.checked[$selectedSegmentId] = false;
				});
				if (!updated) return;
				seg2WordCount.set(getTotalWordCount(updated.translationData.seg2));
				notifySuccess("Segment filled from TM");
			} catch (error) {
				notifyError(
					error instanceof Error
						? error.message
						: "Could not apply this TM match.",
				);
			}
		} else {
			showConfirmationModal = true;
		}
	}
</script>

{#snippet confirmationMenu()}
	<div class="modal-confirmation">
		<span class="modal-confirmation-icon neutral">TM</span>
		<h3>Replace the current target text?</h3>
		<p>
			The selected translation-memory match will overwrite the target segment.
		</p>
		<div class="modal-actions inline">
			<button
				class="modal-button secondary"
				onclick={() => (showConfirmationModal = false)}
				>Keep current text</button
			>
			<button
				class="modal-button primary"
				onclick={() => fillTargetText(tempTargetText)}>Use TM match</button
			>
		</div>
	</div>
{/snippet}

{#if showConfirmationModal}
	<div role="presentation" class="modal-element-global">
		<Modal
			title="Replace target segment"
			content={confirmationMenu}
			onClose={() => (showConfirmationModal = false)}
		/>
	</div>
{/if}

<div class="translation-memory-container">
	<h1>Translation Memory</h1>
	<div class="header">
		<p class="header-id">ID</p>
		<p class="header-source">Source</p>
		<p class="header-match">Match</p>
		<p class="header-target">Target</p>
	</div>

	<div class="tm-segments">
		{#each $tmMatches as match, i}
			<button
				type="button"
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
			</button>
		{/each}
	</div>
</div>

<style>
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
		max-height: 27vh;
		max-height: 27dvh;
		overflow-y: scroll;
	}

	.segment-memory-container {
		border: 0;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
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

	@media (max-width: 548px) {
		.translation-memory-container > h1 {
			font-size: 0.55rem;
		}

		.header-id,
		.header-source,
		.header-match,
		.header-target {
			font-size: 0.55rem;
		}

		.id {
			font-size: 0.55rem;
		}

		.target-segment,
		.source-segment {
			font-size: 0.55rem;
		}

		.matches {
			font-size: 0.55rem;
		}
	}
</style>
