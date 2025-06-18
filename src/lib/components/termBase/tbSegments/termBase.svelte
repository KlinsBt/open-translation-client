<script lang="ts">
	import { updateTranslationOnIndexedDB } from "$lib/functions/saveData/indexedDb";
	import {
		seg2WordCount,
		selectedSegmentId,
		singleUserData,
		tbMatches,
	} from "$lib/functions/saveData/stores.svelte";
	import { getTotalWordCount } from "$lib/functions/statistics";

	function fillTargetText(term: string) {
		if (!$singleUserData) return console.log("Data not found");
		let newUserData = $singleUserData;
		if (newUserData.translationData.seg2[$selectedSegmentId] === "") {
			newUserData.translationData.seg2[$selectedSegmentId] += term;
		} else {
			newUserData.translationData.seg2[$selectedSegmentId] += " " + term;
		}

		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		seg2WordCount.set(getTotalWordCount($singleUserData.translationData.seg2));
	}

	type RawNote = string | { type: string; text: string };

	function renderNote(n: RawNote): string {
		if (typeof n === "string") return n.trim() || "(empty note)";

		const { type, text } = n;
		if (type && text) return `${type}: ${text}`;
		if (text) return text;
		if (type) return type;
		return "(empty note)";
	}
</script>

<div class="tb-container">
	<h1 class="svelte-6il5dx">Terms</h1>
	<div class="header">
		<p class="header-id">ID</p>
		<p class="header-target">Term</p>
	</div>

	<div class="tb-segments">
		{#each $tbMatches as match, i}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="tb-sub-container"
				onclick={() => fillTargetText(match.foundEntry)}
			>
				<p class="id">{i + 1}</p>
				<div class="term">
					<p>{match.searchEntry}</p>
					<p>{match.foundEntry}</p>
					{#if match.notes.length > 0 && match.notes[0] !== ""}
						<div class="notes-container">
							{#each match.notes as note}
								<p class="note">{renderNote(note)}</p>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.tb-container {
		display: flex;
		flex-direction: column;
		background-color: var(--color-theme-7);
		width: 100%;
		/* max-height: 100px; */
		min-height: 100%;
	}

	.tb-container > h1 {
		font-size: 0.8rem;
		font-weight: 700;
		color: var(--color-theme-4);
		text-align: left;
		margin: 0px;
		padding: 3px 5px;
		background-color: var(--color-theme-7);
	}

	.header {
		display: flex;
		justify-content: center;
		background-color: #f4f4f4;
		background-color: var(--color-theme-5);
		padding: 0px;
		margin: 0px;
		max-height: 30px;
	}

	.header-id,
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
		width: 20%;
	}

	.header-target {
		width: 80%;
	}

	.tb-segments {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		max-height: 27vh;
		max-height: 27dvh;
		overflow-y: scroll;
	}

	.tb-sub-container {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0px;
		width: 100%;
		/* height: 100%; */
		border-top: 2px solid var(--color-theme-3);
		cursor: pointer;
	}

	.tb-sub-container:hover {
		background-color: #eaf2ff;
	}

	.tb-sub-container:nth-child(1) {
		border-top: none;
	}

	.id {
		font-size: 0.8rem;
		padding: 5px;
		font-weight: 600;
		text-align: center;
		width: 20%;
	}

	.term {
		display: grid;
		justify-items: center;
		width: 80%;
		/* padding-left: 50px; */
	}

	.term > p {
		font-size: 0.8rem;
		margin: 0;
		padding: 5px;
		font-weight: 600;
		text-align: left;
		justify-items: left;
		width: 60%;
		color: var(--color-theme-5);
	}

	.term > p:nth-child(2) {
		color: rgb(0, 194, 0);
		/* margin: 0px 0px 0px 10px; */
		border-top: 1px solid var(--color-theme-5);
	}

	.notes-container {
		display: grid;
		justify-items: left;
		/* max-width: 115px; */
		width: 60%;
		padding: 0px 5px;
		border-top: 1px solid var(--color-theme-5);
	}

	.note {
		font-size: 0.6rem;
		padding: 0px;
		margin: 5px 0px;
		font-weight: 600;
		text-align: left;
		color: var(--color-theme-5);
	}

	@media (max-width: 548px) {
		.tb-container > h1 {
			font-size: 0.55rem;
		}
		.header-id,
		.header-target {
			font-size: 0.55rem;
		}

		.id {
			font-size: 0.55rem;
		}

		.term > p {
			font-size: 0.55rem;
		}

		.term > p:nth-child(2) {
			font-size: 0.55rem;
		}

		.notes-container {
			font-size: 0.5rem;
		}

		.note {
			font-size: 0.5rem;
		}
	}
</style>
