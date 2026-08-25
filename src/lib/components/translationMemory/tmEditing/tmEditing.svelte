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
	import { tmDataValidationError } from "$lib/components/resources/resourceDataValidation";

	let { onBack }: { onBack?: () => void } = $props();

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
	function getFilteredData() {
		return filterWithSourceIndexes(localTmData.terms, (term) => {
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
		});
	}

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
		const validationError = tmDataValidationError(snapshot);
		if (validationError) {
			notifyError(validationError);
			return false;
		}
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

	function addTranslationSegment(termId: number) {
		const targetIndex = localTmData.terms[termId].target.length;
		localTmData.terms[termId].target.push({ lang: "", segment: "" });
		editMode.set(`target-${termId}-${targetIndex}`, true);
		editMode = new Map(editMode);
		notifyInfo("Complete the new target and choose Save to add it.");
	}

	function addTranslationUnit() {
		const template = localTmData.terms[0];
		const targetTemplate = template?.target.length
			? template.target
			: [{ lang: "de" }];
		const targetLanguages = targetTemplate.map((target) => ({
			lang: target.lang.trim() || "de",
			segment: "",
		}));

		const unitIndex = localTmData.terms.length;
		localTmData.terms.push({
			// id: localTmData.terms.length + 1,
			source: {
				lang: template?.source.lang.trim() || "en",
				segment: "",
			},
			target: targetLanguages,
		});
		editMode.set(`source-${unitIndex}`, true);
		for (const targetIndex of targetLanguages.keys())
			editMode.set(`target-${unitIndex}-${targetIndex}`, true);
		editMode = new Map(editMode);
		notifyInfo("Complete the new translation unit and choose Save.");
	}

	async function deleteTu(tuId: number) {
		localTmData.terms.splice(tuId, 1);
		if (await persistTm("Translation unit deleted", "info")) {
			showSegmentDeletionModal = false;
			showModal = false;
		}
	}

	async function deleteSegment(termId: number, segId: number) {
		if (localTmData.terms[termId].target.length <= 1) {
			showSegmentDeletionModal = false;
			showModal = false;
			notifyError(
				"A translation unit needs at least one target. Delete the entire unit instead.",
			);
			return;
		}
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

{#if showModal}
	<div role="presentation" class="modal-element-global">
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
		<div class="resource-editor-title-copy">
			<p class="resource-editor-eyebrow">Translation memory editor</p>
			<h2 class="tm-name">{localTmData.name}</h2>
			<p class="resource-editor-summary">
				{localTmData.terms.length} translation {localTmData.terms.length === 1
					? "unit"
					: "units"}
			</p>
		</div>
		<div class="resource-editor-title-actions">
			<span class="resource-editor-format">TMX</span>
			{#if onBack}
				<button
					class="resource-editor-back resource-secondary-action"
					onclick={onBack}
				>
					← Back to memories
				</button>
			{/if}
		</div>
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
			<span class="search-count">{getFilteredData().length} shown</span>
		</div>

		<div
			class="translation-units"
			bind:this={segmentsContainer}
			onscroll={handleScroll}
		>
			{#each getFilteredData().slice(0, visibleSegmentsCount) as filteredUnit, unitIndex (filteredUnit.sourceIndex)}
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
									value={unit.source.lang}
									onchange={(event) =>
										(unit.source.lang = event.currentTarget.value)}
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
										value={unit.source.segment}
										oninput={(event) =>
											(unit.source.segment = event.currentTarget.value)}
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
										value={trg.lang}
										onchange={(event) => (trg.lang = event.currentTarget.value)}
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
										disabled={unit.target.length <= 1}
										title={unit.target.length <= 1
											? "A translation unit must keep at least one target"
											: "Delete target segment"}
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
											value={trg.segment}
											oninput={(event) =>
												(trg.segment = event.currentTarget.value)}
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
			{#if getFilteredData().length === 0}
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
