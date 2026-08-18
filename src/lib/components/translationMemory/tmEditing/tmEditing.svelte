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
			// console.log(`Loaded ${visibleSegmentsCount} segments`);
		}
	}

	let editMode = $state(new Map());
	let localTmData = $state({ ...$singleTmData });

	let showModal: boolean = $state(false);
	let showTuDeletionModal: boolean = $state(false);
	let showSegmentDeletionModal: boolean = $state(false);
	let selectedTmId: number = $state(0);
	let selectedTmTargetId: number = $state(0);

	let searchQuery: string = $state("");
	let filteredData = $derived(
		localTmData.terms.filter((term) => {
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
		editMode.set(key, !editMode.get(key));

		if (!editMode.get(key)) {
			singleTmData.set(localTmData);
			await updateTmOnIndexedDB(localTmData);
			notifyInfo("Entry saved");
		}

		editMode = new Map(editMode);
	}

	function getLangByCode(code: string) {
		let lang = LANGUAGES.find((lang) => lang.code === code);
		return lang ? `${lang.name} (${lang.code})` : "";
	}

	function addTranslationSegment(termId: number) {
		// let srcLang = localTmData.terms[termId].source.lang;
		localTmData.terms[termId].target.push({ lang: "en", segment: "" });
		notifySuccess("Segment added");
	}

	function addTranslationUnit() {
		let targetLanguages = localTmData.terms[0].target.map((target) => ({
			lang: target.lang,
			segment: "",
		}));

		localTmData.terms.push({
			// id: localTmData.terms.length + 1,
			source: {
				lang: localTmData.terms[0].source.lang,
				segment: "",
			},
			target: targetLanguages,
		});
		notifySuccess("Translation unit added");
	}

	async function deleteTu(tuId: number) {
		localTmData.terms.splice(tuId, 1);
		showSegmentDeletionModal = false;
		showModal = false;
		await updateTmOnIndexedDB(localTmData);
		notifyError("Translation unit deleted");
	}

	async function deleteSegment(termId: number, segId: number) {
		localTmData.terms[termId].target.splice(segId, 1);
		showSegmentDeletionModal = false;
		showModal = false;
		await updateTmOnIndexedDB(localTmData);
		notifyError("Segment deleted");
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
			{#each filteredData.slice(0, visibleSegmentsCount) as unit, unitIndex}
				<article class="resource-unit-card">
					<div class="tu-header">
						<h3>
							Translation unit <span class="unit-number">{unitIndex + 1}</span>
						</h3>
						<div class="unit-actions">
							<button
								class="editor-action danger"
								onclick={() => showTuDelModal(unitIndex)}
							>
								Delete <Delete marginBottom="-2px" />
							</button>
							<button
								class="editor-action primary"
								onclick={() => addTranslationSegment(unitIndex)}
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
									disabled={!editMode.get(`source-${unitIndex}`)}
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
									class="editor-action {editMode.get(`source-${unitIndex}`)
										? 'save'
										: 'secondary'}"
									onclick={() => toggleEditMode(`source-${unitIndex}`)}
								>
									{#if editMode.get(`source-${unitIndex}`)}
										Save <SaveFile marginBottom="-2px" />
									{:else}
										Edit <Edit marginBottom="-2px" />
									{/if}
								</button>
							</div>

							<div class="segment-field">
								{#if !editMode.get(`source-${unitIndex}`)}
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
										disabled={!editMode.get(`target-${unitIndex}-${trgIndex}`)}
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
											`target-${unitIndex}-${trgIndex}`,
										)
											? 'save'
											: 'secondary'}"
										onclick={() =>
											toggleEditMode(`target-${unitIndex}-${trgIndex}`)}
									>
										{#if editMode.get(`target-${unitIndex}-${trgIndex}`)}
											Save <SaveFile marginBottom="-2px" />
										{:else}
											Edit <Edit marginBottom="-2px" />
										{/if}
									</button>
									<button
										class="editor-action danger"
										onclick={() => showSegDelModal(unitIndex, trgIndex)}
									>
										Delete <Delete marginBottom="-2px" />
									</button>
								</div>
								<div class="segment-field">
									{#if !editMode.get(`target-${unitIndex}-${trgIndex}`)}
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
