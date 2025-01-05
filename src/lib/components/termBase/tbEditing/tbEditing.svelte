<script lang="ts">
	import { LANGUAGES } from "$lib/components/data/languages";
	import { updateTbOnIndexedDB } from "$lib/functions/saveData/indexedDb.js";
	import { singleTbData } from "$lib/functions/saveData/stores.svelte";
	import SaveFile from "$lib/components/svg/saveFile.svelte";
	import Edit from "$lib/components/svg/edit.svelte";
	import Delete from "$lib/components/svg/delete2.svelte";
	import Modal from "$lib/components/modal.svelte";

	const AMOUNT_OF_SEGMENTS_TO_LOAD = 150;
	let visibleSegmentsCount = $state(150); // Initial number of segments to display when loading the page
	let segmentsContainer: HTMLElement | null = null;

	function handleScroll() {
		if (!segmentsContainer) return;

		const isBottom =
			segmentsContainer.scrollTop + segmentsContainer.clientHeight >=
			segmentsContainer.scrollHeight - 5; // Small buffer

		// Load more if scrolled to bottom and more segments are available
		if (isBottom && visibleSegmentsCount < $singleTbData.entries.length) {
			visibleSegmentsCount = Math.min(
				visibleSegmentsCount + AMOUNT_OF_SEGMENTS_TO_LOAD,
				$singleTbData.entries.length,
			);
			console.log(`Loaded ${visibleSegmentsCount} segments`);
		}
	}

	let editMode = $state(new Map());
	let localTbData = $state({ ...$singleTbData });

	let showModal: boolean = $state(false);
	let selectedTbId: number = $state(0);
	let selectedTbTargetId: number = $state(0);

	let searchQuery: string = $state("");
	let filteredData = $derived(
		localTbData.entries.filter((t) => {
			// Check if searchQuery matches source.segment
			for (let i = 0; i < t.terms.length; i++) {
				const sourceMatch = t.terms[i].term
					.toLowerCase()
					.includes(searchQuery.toLowerCase());
				// Return true if searchQuery matches
				if (sourceMatch) return true;
			}
		}),
	);

	async function toggleEditMode(key: string) {
		editMode.set(key, !editMode.get(key));

		if (!editMode.get(key)) {
			singleTbData.set(localTbData);
			await updateTbOnIndexedDB(localTbData);
		}

		editMode = new Map(editMode);
	}

	function getLangByCode(code: string) {
		let lang = LANGUAGES.find((lang) => lang.code === code);
		return lang ? `${lang.name} (${lang.code})` : "";
	}

	async function addNewEntry() {
		localTbData.entries.push({
			id: localTbData.entries.length + 1,
			terms: [
				{
					lang: "",
					term: "",
					notes: [""],
				},
			],
		});
		await updateTbOnIndexedDB(localTbData);
	}

	async function addNewTerm(termId: number) {
		localTbData.entries[termId].terms.push({
			lang: "",
			term: "",
			notes: [""],
		});
		await updateTbOnIndexedDB(localTbData);
	}

	async function deleteTermUnit(unitId: number) {
		localTbData.entries.splice(unitId, 1);
		showModal = false;
		await updateTbOnIndexedDB(localTbData);
	}
	async function deleteEntry(unitId: number, termId: number) {
		localTbData.entries[unitId].terms.splice(termId, 1);
		showModal = false;
		await updateTbOnIndexedDB(localTbData);
	}

	function ShowModal(termId: number, trgId: number) {
		selectedTbId = termId;
		selectedTbTargetId = trgId;
		showModal = true;
	}

	// Auto height adjustment for textareas
	function useAutoHeight(node: HTMLTextAreaElement) {
		function adjustHeight() {
			node.style.height = "auto";
			node.style.height = `${node.scrollHeight}px`;
		}
		adjustHeight();
		node.addEventListener("input", adjustHeight);
		return {
			destroy() {
				node.removeEventListener("input", adjustHeight);
			},
		};
	}
</script>

{#snippet deletionConfirmation()}
	<div class="deletion-confirmation-container">
		<p class="deletion-confirmation">
			Are you sure you want to delete this term?
		</p>
		<button
			class="btn delete"
			onclick={() => deleteEntry(selectedTbId, selectedTbTargetId)}
		>
			Delete
		</button>
		<button class="btn update" onclick={() => (showModal = false)}>
			Cancel
		</button>
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	class="modal-element-global {showModal ? '' : 'close-modal-global'}"
	onclick={() => (showModal = false)}
>
	{#if showModal}
		<Modal title="Confirm" content={deletionConfirmation} />
	{/if}
</div>

<h2 class="tb-name">{localTbData.name}</h2>

<div class="tb-editing-container">
	<div class="table-header">
		<input
			type="text"
			placeholder="Search Term Units ..."
			bind:value={searchQuery}
			class="search-input"
		/>
	</div>

	<div
		class="translation-units"
		bind:this={segmentsContainer}
		onscroll={handleScroll}
	>
		{#each filteredData.slice(0, visibleSegmentsCount) as unit, i}
			<div class="tu-header">
				<h3>
					Term Unit <span
						style="
							color: white; 
							border: 2px solid var(--color-theme-5); 
							padding: 1px 5px 1px 4px; 
							border-radius: 5px; 
							background-color: var(--color-theme-5);">{unit.id}</span
					>
				</h3>
				<button
					class="edit-btn"
					style="background-color: limegreen;"
					onclick={() => addNewTerm(unit.id - 1)}
				>
					Add Entry +
				</button>
			</div>
			<div class="translation-unit">
				{#each unit.terms as term, i}
					<div class="segment-group">
						<div class="language-selection">
							<select
								class="lang-select"
								disabled={!editMode.get(`target-${unit.id - 1}-${i}`)}
								style="background-color: {editMode.get(
									`target-${unit.id - 1}-${i}`,
								)
									? 'white'
									: 'var(--color-theme-8)'}"
								bind:value={term.lang}
							>
								<option disabled selected value=""
									>{getLangByCode(term.lang)}</option
								>
								{#each LANGUAGES as lang}
									<option value={lang.code}>{lang.name} ({lang.code})</option>
								{/each}
							</select>
							<button
								class="edit-btn"
								style="background-color: {editMode.get(
									`target-${unit.id - 1}-${i}`,
								)
									? 'limegreen'
									: '#2c5e82'}"
								onclick={() => toggleEditMode(`target-${unit.id - 1}-${i}`)}
							>
								{#if editMode.get(`target-${unit.id - 1}-${i}`)}
									Save <SaveFile marginBottom="-2px" />
								{:else}
									Edit <Edit marginBottom="-2px" />
								{/if}
							</button>
							<button
								class="edit-btn delete"
								onclick={() => ShowModal(unit.id - 1, i)}
							>
								Delete <Delete marginBottom="-2px" />
							</button>
						</div>
						<div class="term-field">
							{#if !editMode.get(`target-${unit.id - 1}-${i}`)}
								<p class="field locked">{term.term}</p>
							{:else}
								<textarea
									class="field unlocked"
									bind:value={term.term}
									use:useAutoHeight
									placeholder="Add Term Entry"
								></textarea>
							{/if}
						</div>
						<div class="notes-field">
							<p>Note:</p>
							{#if term.notes.length > 0}
								{#each term.notes as note, j}
									{#if !editMode.get(`target-${unit.id - 1}-${i}`)}
										<p class="field locked">{note}</p>
									{:else}
										<textarea
											class="field unlocked"
											bind:value={term.notes[j]}
											use:useAutoHeight
											placeholder="Add Note"
										></textarea>
									{/if}
								{/each}
							{:else if !editMode.get(`target-${unit.id - 1}-${i}`)}
								<p class="field locked"></p>
							{:else}
								<textarea
									class="field unlocked"
									bind:value={term.notes[0]}
									use:useAutoHeight
									placeholder="Add Note"
								></textarea>
							{/if}
						</div>
					</div>
					<!-- <hr class="seperator-inside" /> -->
				{/each}
			</div>
			<hr class="seperator" />
		{/each}
	</div>

	<button class="btn add-btn save" onclick={addNewEntry}>
		Add New Term Unit +
	</button>
</div>

<style>
	.deletion-confirmation {
		font-size: 1.2rem;
		font-weight: 600;
		margin: 0px 0px 10px 0px;
		color: var(--color-theme-4);
		color: #c02b2b;
		text-align: center;
		max-width: 280px;
	}

	.btn {
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

	.btn:hover {
		filter: brightness(1.1);
	}

	.tb-name {
		text-align: center;
		font-size: 2rem;
		font-weight: 600;
		margin-bottom: 0px;
		color: var(--color-theme-3);
	}

	.table-header {
		background-color: var(--color-theme-4);
		font-weight: bold;
		color: var(--color-theme-4);
		display: flex;
		padding: 10px;
		border-radius: 5px 5px 0px 0px;
		background-color: var(--color-theme-7);
	}

	.search-input {
		flex: 1;
		padding: 12px;
		font-size: 1em;
		border: 1px solid var(--color-theme-3);
		border-radius: 5px 5px 0px 0px;
		outline: none;
	}

	.search-input::placeholder {
		color: #999;
	}

	.tb-editing-container {
		width: 100%;
		max-width: 800px;
		margin: 0 auto;
		padding: 20px 5px;
		/* border-radius: 5px; */
	}

	.translation-units {
		margin: 0px;
		max-height: 400px;
		overflow-y: scroll;
	}

	.translation-unit {
		padding: 15px 15px 0px 15px;
		border: 1px solid #e0e0e0;
		/* border-radius: 0px 0px 5px 5px; */
		margin-bottom: 15px;
		background-color: #fff;
	}

	.tu-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background-color: var(--color-theme-7);
		padding: 10px;
		/* border-radius: 5px 5px 0px 0px; */
		margin-bottom: 0px;
		border-top: 1px solid #e0e0e0;
		border-left: 1px solid #e0e0e0;
		border-right: 1px solid #e0e0e0;
	}

	.tu-header h3 {
		margin: 0;
		color: var(--color-theme-5);
		font-size: 1.1rem;
	}

	.segment-group {
		display: grid;
		grid-template-columns: auto;
		align-items: center;
		gap: 10px;
		margin-bottom: 15px;
	}

	.language-selection {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.lang-select {
		padding: 8px;
		/* background-color: var(--color-theme-8); */
		border: 2px solid var(--color-theme-1);
		color: var(--color-theme-12);
		border-radius: 5px;
	}

	.lang-select:focus {
		outline: none;
		border: 2px solid var(--color-theme-3);
	}

	.field {
		background-color: var(--color-theme-7);
		padding: 10px;
		border-radius: 5px;
		border: 1px solid #ccc;
		margin-top: 5px;
	}

	.field:last-child {
		margin-bottom: 0px;
	}

	.notes-field {
		display: grid;
		gap: 0px;
	}

	.notes-field > p:nth-child(1) {
		margin: 0px 0px 0px 0px;
		padding: 0px 0px 0px 5px;
		font-weight: 600;
		font-size: 0.6rem;
		color: var(--color-theme-5);
	}

	.notes-field > p {
		margin: 0px 0px 0px 0px;
		padding: 5px 0px 5px 5px;
		font-weight: 500;
		font-size: 0.7rem;
		color: var(--color-theme-5);
	}

	.locked {
		background-color: var(--color-theme-8);
		border: 2px solid var(--color-theme-1);
		color: var(--color-theme-12);
		max-width: 97.2%;
	}

	.unlocked {
		border: 2px solid var(--color-theme-1);
		background-color: white;
		color: black;
		resize: none;
		min-width: 97.2%;
	}

	textarea:focus {
		outline: none;
		border: 2px solid var(--color-theme-3);
	}

	.edit-btn {
		color: white;
		padding: 7px 20px;
		border: none;
		border-radius: 5px;
		cursor: pointer;
		font-size: 1rem;
	}

	.edit-btn:hover {
		filter: brightness(1.1);
	}

	.add-btn {
		color: white;
		border: none;
		border-radius: 0px 0px 5px 5px;
		padding: 10px 20px;
		cursor: pointer;
		font-weight: 600;
		font-size: 1.3rem;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0px 5px;
		margin: 0px;
		width: 100%;
	}

	.add-btn:hover {
		filter: brightness(1.1);
	}

	/* .seperator-inside {
		display: flex;
		margin: 15px 0px;
		border-radius: 0px;
		border: 0.5px solid var(--color-theme-4);
		width: 95%;
		justify-self: center;
	} */

	.seperator {
		display: flex;
		margin: 15px 0px;
		border-radius: 0px;
		border: 1px solid var(--color-theme-5);
		width: 95%;
		justify-self: center;
	}

	.seperator:last-child {
		display: none;
	}

	@media (max-width: 700px) {
		.tb-editing-container {
			padding: 20px 0px;
		}

		.locked {
			max-width: 95%;
		}

		.unlocked {
			min-width: 93%;
		}
	}
</style>
