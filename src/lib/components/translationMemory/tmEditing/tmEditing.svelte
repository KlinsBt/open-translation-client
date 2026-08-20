<script lang="ts">
	import { LANGUAGES } from "$lib/components/data/languages";
	import { updateTmOnIndexedDB } from "$lib/functions/saveData/indexedDb.js";
	import { singleTmData } from "$lib/functions/saveData/stores.svelte";
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
		if (isBottom && visibleSegmentsCount < $singleTmData.terms.length) {
			visibleSegmentsCount = Math.min(
				visibleSegmentsCount + AMOUNT_OF_SEGMENTS_TO_LOAD,
				$singleTmData.terms.length,
			);
		}
	}

	let editMode = $state(new Map());
	let lastPersistedTm = $state(persistedSnapshot($singleTmData));
	let localTmData = $state(persistedSnapshot($singleTmData));

	let showModal: boolean = $state(false);
	let showTuDeletionModal: boolean = $state(false);
	let showSegmentDeletionModal: boolean = $state(false);
	let selectedTmId: number = $state(0);
	let selectedTmTargetId: number = $state(0);

	let searchQuery: string = $state("");
	let filteredData = $derived(
		filterWithSourceIndexes(localTmData.terms, (term) => {
			// Check if searchQuery matches source.segment
			const sourceMatch = term.source.segment
				.toLowerCase()
				.includes(searchQuery.toLowerCase());

			// Check if searchQuery matches any target.segment
			const targetMatch = term.target.some((target) =>
				target.segment.toLowerCase().includes(searchQuery.toLowerCase()),
			);

			// Return true if searchQuery matches either source or any target
			return sourceMatch || targetMatch;
		}),
	);

	async function toggleEditMode(key: string) {
		if (!editMode.get(key)) {
			editMode.set(key, true);
			editMode = new Map(editMode);
			return;
		}
		if (await persistTm("Entry saved", "info")) {
			editMode.set(key, false);
			editMode = new Map(editMode);
		}
	}

	function getLangByCode(code: string) {
		let lang = LANGUAGES.find((lang) => lang.code === code);
		return lang ? `${lang.name} (${lang.code})` : "";
	}

	async function persistTm(
		message: string,
		tone: "success" | "info" = "success",
	): Promise<boolean> {
		const snapshot = $state.snapshot(localTmData);
		try {
			await updateTmOnIndexedDB(snapshot);
			lastPersistedTm = persistedSnapshot(snapshot);
			singleTmData.set(persistedSnapshot(snapshot));
			if (tone === "info") notifyInfo(message);
			else notifySuccess(message);
			return true;
		} catch (error) {
			localTmData = persistedSnapshot($state.snapshot(lastPersistedTm));
			notifyError(
				error instanceof Error
					? error.message
					: "Could not save the translation memory.",
			);
			return false;
		}
	}

	async function addTranslationSegment(termId: number) {
		localTmData.terms[termId].target.push({ lang: "en", segment: "" });
		await persistTm("Segment added");
	}

	async function addTranslationUnit() {
		const template = localTmData.terms[0];
		const targetLanguages = (template?.target ?? [{ lang: "de" }]).map(
			(target) => ({
				lang: target.lang,
				segment: "",
			}),
		);

		localTmData.terms.push({
			// id: localTmData.terms.length + 1,
			source: {
				lang: template?.source.lang ?? "en",
				segment: "",
			},
			target: targetLanguages,
		});
		await persistTm("Translation unit added");
	}

	async function deleteTu(tuId: number) {
		localTmData.terms.splice(tuId, 1);
		if (await persistTm("Translation unit deleted", "info")) {
			showSegmentDeletionModal = false;
			showModal = false;
		}
	}

	async function deleteSegment(termId: number, segId: number) {
		localTmData.terms[termId].target.splice(segId, 1);
		if (await persistTm("Segment deleted", "info")) {
			showSegmentDeletionModal = false;
			showModal = false;
		}
	}

	function showTuDelModal(tuId: number) {
		selectedTmId = tuId;
		showSegmentDeletionModal = false;
		showTuDeletionModal = true;
		showModal = true;
	}

	function showSegDelModal(termId: number, trgId: number) {
		selectedTmId = termId;
		selectedTmTargetId = trgId;
		showTuDeletionModal = false;
		showSegmentDeletionModal = true;
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

{#snippet deletionConfirmationTu()}
	<div class="modal-confirmation">
		<span class="modal-confirmation-icon">!</span>
		<h3>Delete this translation unit?</h3>
		<p>
			The source and every target-language segment in this unit will be removed.
		</p>
		<div class="modal-actions inline">
			<button class="modal-button secondary" onclick={() => (showModal = false)}
				>Keep unit</button
			>
			<button class="modal-button danger" onclick={() => deleteTu(selectedTmId)}
				>Delete unit</button
			>
		</div>
	</div>
{/snippet}

{#snippet deletionConfirmationSegment()}
	<div class="modal-confirmation">
		<span class="modal-confirmation-icon">!</span>
		<h3>Delete this target segment?</h3>
		<p>
			This removes only the selected target-language segment from the
			translation unit.
		</p>
		<div class="modal-actions inline">
			<button class="modal-button secondary" onclick={() => (showModal = false)}
				>Keep segment</button
			>
			<button
				class="modal-button danger"
				onclick={() => deleteSegment(selectedTmId, selectedTmTargetId)}
				>Delete segment</button
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
		{#if showTuDeletionModal}
			<Modal
				title="Delete translation unit"
				content={deletionConfirmationTu}
				onClose={() => (showModal = false)}
			/>
		{/if}
		{#if showSegmentDeletionModal}
			<Modal
				title="Delete target segment"
				content={deletionConfirmationSegment}
				onClose={() => (showModal = false)}
			/>
		{/if}
	</div>
{/if}

<section class="resource-editor-content">
	<header class="resource-editor-titlebar">
		<div>
			<p class="resource-editor-eyebrow">Translation memory editor</p>
			<h2 class="tm-name">{localTmData.name}</h2>
			<p class="resource-editor-summary">
				{localTmData.terms.length} translation {localTmData.terms.length === 1
					? "unit"
					: "units"}
			</p>
		</div>
		<span class="resource-editor-format">TMX</span>
	</header>

	<div class="tm-editing-container resource-editor-panel">
		<div class="table-header">
			<span class="search-icon" aria-hidden="true">⌕</span>
			<input
				type="text"
				placeholder="Search source and target segments"
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
			{#each filteredData.slice(0, visibleSegmentsCount) as filteredUnit, unitIndex (filteredUnit.sourceIndex)}
				{@const unit = filteredUnit.item}
				{@const sourceIndex = filteredUnit.sourceIndex}
				<article class="resource-unit-card">
					<div class="tu-header">
						<h3>
							Translation unit <span class="unit-number">{unitIndex + 1}</span>
						</h3>
						<div class="unit-actions">
							<button
								class="editor-action danger"
								onclick={() => showTuDelModal(sourceIndex)}
							>
								Delete <Delete marginBottom="-2px" />
							</button>
							<button
								class="editor-action primary"
								onclick={() => addTranslationSegment(sourceIndex)}
							>
								Add Segment +
							</button>
						</div>
					</div>
					<div class="translation-unit">
						<div class="segment-group source">
							<div class="language-selection">
								<select
									class="lang-select"
									disabled={!editMode.get(`source-${sourceIndex}`)}
									bind:value={unit.source.lang}
								>
									<option disabled selected value=""
										>{getLangByCode(unit.source.lang)}</option
									>
									{#each LANGUAGES as lang}
										<option value={lang.code}>{lang.name} ({lang.code})</option>
									{/each}
								</select>
								<button
									class="editor-action {editMode.get(`source-${sourceIndex}`)
										? 'save'
										: 'secondary'}"
									onclick={() => toggleEditMode(`source-${sourceIndex}`)}
								>
									{#if editMode.get(`source-${sourceIndex}`)}
										Save <SaveFile marginBottom="-2px" />
									{:else}
										Edit <Edit marginBottom="-2px" />
									{/if}
								</button>
							</div>

							<div class="segment-field">
								{#if !editMode.get(`source-${sourceIndex}`)}
									<p class="field locked">{unit.source.segment}</p>
								{:else}
									<textarea
										class="field unlocked"
										bind:value={unit.source.segment}
										use:useAutoHeight
										placeholder="Edit source segment"
									></textarea>
								{/if}
							</div>
						</div>

						<!-- Targets -->
						{#each unit.target as trg, trgIndex}
							<div class="segment-group target">
								<div class="language-selection">
									<select
										class="lang-select"
										disabled={!editMode.get(
											`target-${sourceIndex}-${trgIndex}`,
										)}
										bind:value={trg.lang}
									>
										<option disabled selected value=""
											>{getLangByCode(trg.lang)}</option
										>
										{#each LANGUAGES as lang}
											<option value={lang.code}
												>{lang.name} ({lang.code})</option
											>
										{/each}
									</select>
									<button
										class="editor-action {editMode.get(
											`target-${sourceIndex}-${trgIndex}`,
										)
											? 'save'
											: 'secondary'}"
										onclick={() =>
											toggleEditMode(`target-${sourceIndex}-${trgIndex}`)}
									>
										{#if editMode.get(`target-${sourceIndex}-${trgIndex}`)}
											Save <SaveFile marginBottom="-2px" />
										{:else}
											Edit <Edit marginBottom="-2px" />
										{/if}
									</button>
									<button
										class="editor-action danger"
										onclick={() => showSegDelModal(sourceIndex, trgIndex)}
									>
										Delete <Delete marginBottom="-2px" />
									</button>
								</div>
								<div class="segment-field">
									{#if !editMode.get(`target-${sourceIndex}-${trgIndex}`)}
										<p class="field locked">{trg.segment}</p>
									{:else}
										<textarea
											class="field unlocked"
											bind:value={trg.segment}
											use:useAutoHeight
											placeholder="Edit target segment"
										></textarea>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</article>
			{/each}
			{#if filteredData.length === 0}
				<div class="resource-editor-empty">
					<strong>No translation units found</strong>
					<span>Try a different search term.</span>
				</div>
			{/if}
		</div>

		<button class="editor-add-main" onclick={addTranslationUnit}>
			Add Translation Unit +
		</button>
	</div>
</section>
