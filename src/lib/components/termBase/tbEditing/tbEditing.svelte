<script lang="ts">
	import { LANGUAGES } from "$lib/components/data/languages";
	import { updateTbOnIndexedDB } from "$lib/functions/saveData/indexedDb.js";
	import { singleTbData } from "$lib/functions/saveData/stores.svelte";
	import SaveFile from "$lib/components/svg/saveFile.svelte";
	import Edit from "$lib/components/svg/edit.svelte";
	import Delete from "$lib/components/svg/delete2.svelte";
	import Modal from "$lib/components/modal.svelte";
	import {
		notifySuccess,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";

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
			notifyInfo("Entry saved");
		}

		editMode = new Map(editMode);
	}

	function getLangByCode(code: string) {
		let lang = LANGUAGES.find((lang) => lang.code === code);
		return lang ? `${lang.name} (${lang.code})` : "";
	}

	async function addNewEntry() {
		localTbData.entries.push({
			// id: localTbData.entries.length + 1,
			terms: [
				{
					lang: "",
					term: "",
					notes: [],
				},
			],
		});
		await updateTbOnIndexedDB(localTbData);
		notifySuccess("Entry added");
	}

	async function addNewTerm(termId: number) {
		localTbData.entries[termId].terms.push({
			lang: "",
			term: "",
			notes: [],
		});
		await updateTbOnIndexedDB(localTbData);
		notifySuccess("Term added");
	}

	async function addNewNote(unitId: number, termId: number) {
		console.log("Adding new note to unitId:", unitId, "termId:", termId);

		const term = localTbData.entries[unitId].terms[termId];

		// Check if notes is an array of strings (legacy format)
		if (term.notes.length > 0 && typeof term.notes[0] === "string") {
			// Convert string[] to structured format
			const converted: { type: string; text: string }[] = [];
			for (let i = 0; i < term.notes.length; i++) {
				converted.push({ type: "", text: term.notes[i] as string });
			}
			term.notes = converted;
		}

		// Push a new empty note
		(term.notes as { type: string; text: string }[]).push({
			type: "",
			text: "",
		});

		await updateTbOnIndexedDB(localTbData);
		notifySuccess("Note added");
	}

	async function deleteNote(unitId: number, termId: number, noteIndex: number) {
		console.log(
			"Deleting note at unitId:",
			unitId,
			"termId:",
			termId,
			"noteId:",
			noteIndex,
		);

		const term = localTbData.entries[unitId].terms[termId];

		if (term.notes.length > noteIndex) {
			// Simple remove using splice
			term.notes.splice(noteIndex, 1);
		}

		await updateTbOnIndexedDB(localTbData);
		notifyError("Note deleted");
	}

	async function deleteTermUnit(unitId: number) {
		localTbData.entries.splice(unitId, 1);
		showModal = false;
		await updateTbOnIndexedDB(localTbData);
		notifyError("Term unit deleted");
	}

	async function deleteEntry(unitId: number, termId: number) {
		localTbData.entries[unitId].terms.splice(termId, 1);
		if (localTbData.entries[unitId].terms.length === 0) {
			return deleteTermUnit(unitId);
		}
		showModal = false;
		await updateTbOnIndexedDB(localTbData);
		notifyError("Entry deleted");
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
		{#each filteredData.slice(0, visibleSegmentsCount) as unit, unitId}
			<div class="tu-header">
				<h3>
					Term Unit
					<span
						style="
							color: white; 
							border: 2px solid var(--color-theme-5); 
							padding: 1px 5px 1px 4px; 
							border-radius: 5px; 
							background-color: var(--color-theme-5);"
					>
						{unitId + 1}
					</span>
				</h3>
				<button
					class="edit-btn"
					style="background-color: limegreen;"
					onclick={() => addNewTerm(unitId)}
				>
					Add Entry +
				</button>
			</div>
			<div class="translation-unit">
				{#each unit.terms as term, termId}
					<div class="segment-group">
						<div class="language-selection">
							<select
								class="lang-select"
								disabled={!editMode.get(`target-${unitId}-${termId}`)}
								style="background-color: {editMode.get(
									`target-${unitId}-${termId}`,
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
									`target-${unitId}-${termId}`,
								)
									? 'limegreen'
									: '#2c5e82'}"
								onclick={() => toggleEditMode(`target-${unitId}-${termId}`)}
							>
								{#if editMode.get(`target-${unitId}-${termId}`)}
									Save <SaveFile marginBottom="-2px" />
								{:else}
									Edit <Edit marginBottom="-2px" />
								{/if}
							</button>
							<button
								class="edit-btn delete"
								onclick={() => ShowModal(unitId, termId)}
							>
								Delete <Delete marginBottom="-2px" />
							</button>
						</div>
						<div class="term-field">
							{#if !editMode.get(`target-${unitId}-${termId}`)}
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
							<p>Notes:</p>
							{#if term.notes.length > 0}
								{#each term.notes as note, j}
									{#if typeof note === "string"}
										<!-- {#if !editMode.get(`target-${unitId}-${termId}`)}
											<p class="field locked">{note}</p>
										{:else}
											<textarea
												class="field unlocked"
												bind:value={term.notes[j]}
												use:useAutoHeight
												placeholder="Add Note"
											></textarea>
										{/if} -->
									{:else if !editMode.get(`target-${unitId}-${termId}`)}
										{#if note.type === "" && note.text === ""}
											<div class="note-with-attr-container-locked">
												<p
													class="field locked"
													style="height: 17.8px; width: 10%;"
												></p>
											</div>
										{:else if note.type !== "" && note.text === ""}
											<div class="note-with-attr-container-locked">
												<p class="field locked">
													{note.type}
												</p>
											</div>
										{:else if note.type === "" && note.text !== ""}
											<div class="note-with-attr-container-locked">
												<p class="field locked">
													{note.text}
												</p>
											</div>
										{:else}
											<div class="note-with-attr-container-locked">
												<p class="field locked">{note.type}</p>
												<p>:</p>
												<p class="field locked">{note.text}</p>
											</div>
										{/if}
									{:else}
										<div class="note-with-attr-container-open">
											<input class="field" type="text" bind:value={note.type} />
											<textarea
												class="field unlocked"
												bind:value={note.text}
												use:useAutoHeight
												placeholder="Add Note"
											></textarea>
											<button
												class="delete-note-btn delete"
												onclick={() => deleteNote(unitId, termId, j)}
												><Delete marginBottom="-2px" /></button
											>
										</div>
									{/if}
								{/each}
							{:else if !editMode.get(`target-${unitId}-${termId}`)}
								<p>No notes available</p>
							{:else}
								<p>No notes available</p>
							{/if}
							{#if editMode.get(`target-${unitId}-${termId}`)}
								<button
									class="edit-btn"
									style="background-color: {editMode.get(
										`target-${unitId}-${termId}`,
									)
										? 'limegreen'
										: '#2c5e82'}"
									onclick={() => addNewNote(unitId, termId)}
								>
									Add Note +
								</button>
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
		margin-bottom: 25px;
	}

	.notes-field > p:nth-child(1) {
		margin: 0px 0px 5px 0px;
		padding: 5px 0px;
		font-weight: 600;
		font-size: 1rem;
		color: var(--color-theme-5);
	}

	.notes-field > p {
		margin: 0px 0px 0px 0px;
		padding: 5px 0px 5px 5px;
		color: var(--color-theme-5);
	}

	.note-with-attr-container-locked {
		display: flex;
		justify-content: left;
		text-align: left;
		margin: 0px 0px 10px 0px;
		width: 100%;
	}

	.note-with-attr-container-locked > p {
		margin: 0px;
		padding: 5px;
		font-weight: 500;
		font-size: 0.8rem;
		color: var(--color-theme-5);
	}

	.note-with-attr-container-locked > p:nth-child(2) {
		margin: 0px;
	}

	.note-with-attr-container-open {
		position: relative;
		display: grid;
		align-items: center;
		margin: 0px 0px 10px 0px;
	}

	.note-with-attr-container-open > input {
		margin: 0px;
		padding: 5px;
		font-weight: 500;
		font-size: 0.8rem;
		color: var(--color-theme-5);
		background-color: #f3fdff;
		border: 2px solid rgba(255, 255, 255, 0.5);
	}

	.note-with-attr-container-open > input:focus {
		border: 2px solid var(--color-theme-1);
		outline: none;
	}

	.note-with-attr-container-open > textarea {
		margin: 0px;
		padding: 5px;
		font-weight: 500;
		font-size: 0.8rem;
		color: var(--color-theme-5);
	}

	.note-with-attr-container-open:last-child {
		margin: 0px;
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

	.delete-note-btn {
		position: absolute;
		top: 15px;
		right: 0;
		color: white;
		border: none;
		border-radius: 5px;
		padding: 5px 10px;
		cursor: pointer;
		font-size: 0.8rem;
		/* grid-column: 2 / 3; */
		/* grid-row: 1 / 3; */
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
