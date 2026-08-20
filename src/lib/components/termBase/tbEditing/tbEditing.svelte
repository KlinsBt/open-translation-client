<script lang="ts">
	import { LANGUAGES } from "$lib/components/data/languages";
	import { updateTbOnIndexedDB } from "$lib/functions/saveData/indexedDb.js";
	import { singleTbData } from "$lib/functions/saveData/stores.svelte";
	import SaveFile from "$lib/components/svg/saveFile.svelte";
	import Edit from "$lib/components/svg/edit.svelte";
	import Delete from "$lib/components/svg/delete2.svelte";
	import Modal from "$lib/components/modal.svelte";
	import "$lib/components/resources/resourceEditor.css";
	import {
		notifySuccess,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";
	import { filterWithSourceIndexes } from "$lib/components/resources/resourceFiltering";
	import { persistedSnapshot } from "$lib/functions/saveData/persistenceContract";

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
	let lastPersistedTb = $state(persistedSnapshot($singleTbData));
	let localTbData = $state(persistedSnapshot($singleTbData));

	let showModal: boolean = $state(false);
	let selectedTbId: number = $state(0);
	let selectedTbTargetId: number = $state(0);

	let searchQuery: string = $state("");
	let filteredData = $derived(
		filterWithSourceIndexes(localTbData.entries, (t) => {
			// Check if searchQuery matches source.segment
			for (let i = 0; i < t.terms.length; i++) {
				const sourceMatch = t.terms[i].term
					.toLowerCase()
					.includes(searchQuery.toLowerCase());
				// Return true if searchQuery matches
				if (sourceMatch) return true;
			}
			return false;
		}),
	);

	async function toggleEditMode(key: string) {
		if (!editMode.get(key)) {
			editMode.set(key, true);
			editMode = new Map(editMode);
			return;
		}
		if (await persistTb("Entry saved", "info")) {
			editMode.set(key, false);
			editMode = new Map(editMode);
		}
	}

	function getLangByCode(code: string) {
		let lang = LANGUAGES.find((lang) => lang.code === code);
		return lang ? `${lang.name} (${lang.code})` : "";
	}

	async function persistTb(
		message: string,
		tone: "success" | "info" = "success",
	): Promise<boolean> {
		const snapshot = $state.snapshot(localTbData);
		try {
			await updateTbOnIndexedDB(snapshot);
			lastPersistedTb = persistedSnapshot(snapshot);
			singleTbData.set(persistedSnapshot(snapshot));
			if (tone === "info") notifyInfo(message);
			else notifySuccess(message);
			return true;
		} catch (error) {
			localTbData = persistedSnapshot($state.snapshot(lastPersistedTb));
			notifyError(
				error instanceof Error
					? error.message
					: "Could not save the term base.",
			);
			return false;
		}
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
		await persistTb("Entry added");
	}

	async function addNewTerm(termId: number) {
		localTbData.entries[termId].terms.push({
			lang: "",
			term: "",
			notes: [],
		});
		await persistTb("Term added");
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

		await persistTb("Note added");
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

		await persistTb("Note deleted", "info");
	}

	async function deleteTermUnit(unitId: number) {
		localTbData.entries.splice(unitId, 1);
		if (await persistTb("Term unit deleted", "info")) showModal = false;
	}

	async function deleteEntry(unitId: number, termId: number) {
		localTbData.entries[unitId].terms.splice(termId, 1);
		if (localTbData.entries[unitId].terms.length === 0) {
			return deleteTermUnit(unitId);
		}
		if (await persistTb("Entry deleted", "info")) showModal = false;
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
	<div class="modal-confirmation">
		<span class="modal-confirmation-icon">!</span>
		<h3>Delete this term?</h3>
		<p>
			The selected term and its metadata will be removed from this term base.
		</p>
		<div class="modal-actions inline">
			<button class="modal-button secondary" onclick={() => (showModal = false)}
				>Keep term</button
			>
			<button
				class="modal-button danger"
				onclick={() => deleteEntry(selectedTbId, selectedTbTargetId)}
				>Delete term</button
			>
		</div>
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
{#if showModal}
	<div
		role="presentation"
		class="modal-element-global"
		onclick={() => (showModal = false)}
	>
		<Modal
			title="Delete term"
			content={deletionConfirmation}
			onClose={() => (showModal = false)}
		/>
	</div>
{/if}

<section class="resource-editor-content">
	<header class="resource-editor-titlebar">
		<div>
			<p class="resource-editor-eyebrow">Terminology editor</p>
			<h2 class="tb-name">{localTbData.name}</h2>
			<p class="resource-editor-summary">
				{localTbData.entries.length} term {localTbData.entries.length === 1
					? "unit"
					: "units"}
			</p>
		</div>
		<span class="resource-editor-format">TBX</span>
	</header>

	<div class="tb-editing-container resource-editor-panel">
		<div class="table-header">
			<span class="search-icon" aria-hidden="true">⌕</span>
			<input
				type="text"
				placeholder="Search terms and notes"
				bind:value={searchQuery}
				class="search-input"
			/>
			<span class="search-count">{filteredData.length} shown</span>
		</div>

		<div
			class="translation-units"
			bind:this={segmentsContainer}
			onscroll={handleScroll}
		>
			{#each filteredData.slice(0, visibleSegmentsCount) as filteredUnit, unitId (filteredUnit.sourceIndex)}
				{@const unit = filteredUnit.item}
				{@const sourceIndex = filteredUnit.sourceIndex}
				<article class="resource-unit-card">
					<div class="tu-header">
						<h3>
							Term unit <span class="unit-number">{unitId + 1}</span>
						</h3>
						<button
							class="editor-action primary"
							onclick={() => addNewTerm(sourceIndex)}
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
										disabled={!editMode.get(`target-${sourceIndex}-${termId}`)}
										bind:value={term.lang}
									>
										<option disabled selected value=""
											>{getLangByCode(term.lang)}</option
										>
										{#each LANGUAGES as lang}
											<option value={lang.code}
												>{lang.name} ({lang.code})</option
											>
										{/each}
									</select>
									<button
										class="editor-action {editMode.get(
											`target-${sourceIndex}-${termId}`,
										)
											? 'save'
											: 'secondary'}"
										onclick={() =>
											toggleEditMode(`target-${sourceIndex}-${termId}`)}
									>
										{#if editMode.get(`target-${sourceIndex}-${termId}`)}
											Save <SaveFile marginBottom="-2px" />
										{:else}
											Edit <Edit marginBottom="-2px" />
										{/if}
									</button>
									<button
										class="editor-action danger"
										onclick={() => ShowModal(sourceIndex, termId)}
									>
										Delete <Delete marginBottom="-2px" />
									</button>
								</div>
								<div class="term-field">
									{#if !editMode.get(`target-${sourceIndex}-${termId}`)}
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
											{:else if !editMode.get(`target-${sourceIndex}-${termId}`)}
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
													<input
														class="field"
														type="text"
														bind:value={note.type}
													/>
													<textarea
														class="field unlocked"
														bind:value={note.text}
														use:useAutoHeight
														placeholder="Add Note"
													></textarea>
													<button
														class="delete-note-btn editor-action danger icon-only"
														onclick={() => deleteNote(sourceIndex, termId, j)}
														><Delete marginBottom="-2px" /></button
													>
												</div>
											{/if}
										{/each}
									{:else if !editMode.get(`target-${sourceIndex}-${termId}`)}
										<p>No notes available</p>
									{:else}
										<p>No notes available</p>
									{/if}
									{#if editMode.get(`target-${sourceIndex}-${termId}`)}
										<button
											class="editor-action secondary"
											onclick={() => addNewNote(sourceIndex, termId)}
										>
											Add Note +
										</button>
									{/if}
								</div>
							</div>
							<!-- <hr class="seperator-inside" /> -->
						{/each}
					</div>
				</article>
			{/each}
			{#if filteredData.length === 0}
				<div class="resource-editor-empty">
					<strong>No term units found</strong>
					<span>Try a different search term.</span>
				</div>
			{/if}
		</div>

		<button class="editor-add-main" onclick={addNewEntry}>
			Add New Term Unit +
		</button>
	</div>
</section>
