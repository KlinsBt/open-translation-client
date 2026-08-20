<script lang="ts">
	import Modal from "../modal.svelte";
	import TmxUpload from "../uploads/tmxUpload/tmxUpload.svelte";
	import TmxMergeUpload from "../uploads/tmxUpload/tmxMergeUpload.svelte";
	import {
		deleteTmFromIndexedDB,
		loadTmDataFromIndexedDB,
		updateTmOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb.js";
	import type { TmData } from "$lib/types/types";
	import { onMount } from "svelte";
	import {
		editTm,
		showLoading,
		showTmxModal,
		singleTmData,
		tmData,
		tmIdSelected,
	} from "$lib/functions/saveData/stores.svelte";
	import {
		generateTmxSaveFile,
		generateRandomTmxFile,
	} from "$lib/functions/saveFileGeneration/generateTmxSaveFile1_4";
	import TmEditing from "./tmEditing/tmEditing.svelte";
	import { goto } from "$app/navigation";
	import Delete from "$lib/components/svg/delete2.svelte";
	import Export from "$lib/components/svg/export2.svelte";
	import Edit from "$lib/components/svg/edit.svelte";
	import { setLoadingAndRender, withLoading } from "$lib/functions/uiHelpers";
	import {
		notifySuccess,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";
	import "$lib/components/resources/resourceLibrary.css";

	let showTmUploadModal: boolean = $state(false);
	let showSelectModal: boolean = $state(false);
	let showDeletionConfirmationModal: boolean = $state(false);
	let mergeTmModal: boolean = $state(false);

	let renameFileWindow: boolean = $state(false);

	let newFileName: string = $state("");
	let selectedFileName: string = $state("");
	let tmSelected: TmData = $state({} as TmData);

	onMount(async () => {
		try {
			await withLoading(() => loadTmDataFromIndexedDB());
		} catch (error) {
			notifyError(
				error instanceof Error
					? `Translation memories could not be loaded: ${error.message}`
					: "Translation memories could not be loaded from this browser.",
			);
		}
	});

	let searchQuery: string = $state("");
	let filteredData = $derived(
		$tmData.filter((tm) =>
			(tm.name !== undefined ? tm.name : "")
				.toLowerCase()
				.includes(searchQuery.toLowerCase()),
		),
	);

	function getFileName(id: number) {
		tmIdSelected.set(id);
		selectedFileName = $tmData.find((tm) => tm.id === id)?.name!;
	}

	function handleTmUploadModal() {
		mergeTmModal = false;
		renameFileWindow = false;
		showDeletionConfirmationModal = false;
		showSelectModal = false;
		showTmUploadModal = true;
		showTmxModal.set(true);
	}

	function handleTmSelectionModal(id: number) {
		if (id === undefined) return;
		tmIdSelected.set(id);
		getFileName(id);
		showDeletionConfirmationModal = false;
		showTmUploadModal = false;
		mergeTmModal = false;
		renameFileWindow = false;
		showSelectModal = true;
		showTmxModal.set(true);
	}

	function handleTmMergeModal(id: number) {
		if (id === undefined) return;
		tmSelected = $tmData.find((tm) => tm.id === id) as TmData;
		tmIdSelected.set(id);
		singleTmData.set(tmSelected);
		getFileName(id);
		showDeletionConfirmationModal = false;
		showTmUploadModal = false;
		showSelectModal = false;
		mergeTmModal = true;
		showTmxModal.set(true);
	}

	function handleOpenDeletionConfirmationModal(id: number) {
		if (id === undefined) return;
		tmIdSelected.set(id);
		getFileName(id);
		showDeletionConfirmationModal = true;
		showTmUploadModal = false;
		showSelectModal = false;
		mergeTmModal = false;
		showTmxModal.set(true);
	}

	async function handleTmDeletion() {
		if ($tmIdSelected === undefined) return;
		await setLoadingAndRender();
		try {
			await deleteTmFromIndexedDB($tmIdSelected);
			showDeletionConfirmationModal = false;
			showTmxModal.set(false);
			notifyInfo("Translation Memory deleted");
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not delete this memory.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	async function downloadTmx(id: number) {
		if (id === undefined) return;
		await setLoadingAndRender();
		try {
			const tm = $tmData.find((candidate) => candidate.id === id);
			if (!tm) throw new Error("Translation memory not found.");
			if (tm.terms.length === 0)
				throw new Error("Add at least one translation unit before exporting.");
			await generateTmxSaveFile(tm.terms[0].source.lang, tm);
			notifySuccess("Translation Memory downloaded");
		} catch (error) {
			notifyError(
				error instanceof Error ? error.message : "TMX export failed.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	async function selectTmToEdit(id: number) {
		if (id === undefined) return;
		try {
			await withLoading(async () => {
				const selected = $tmData.find((tm) => tm.id === id);
				if (!selected)
					throw new Error("That translation memory is no longer available.");
				tmSelected = selected;
				tmIdSelected.set(id);
				singleTmData.set(selected);
				showDeletionConfirmationModal = false;
				showTmUploadModal = false;
				showSelectModal = false;
				mergeTmModal = false;
				showTmxModal.set(false);
				editTm.set(true);
			});
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "The memory could not be opened.",
			);
		}
	}

	async function updateFileName(newName: string) {
		if ($tmIdSelected === undefined || $tmData === undefined) return;
		await setLoadingAndRender();
		let tempTm = { ...$tmData.find((tm) => tm.id === $tmIdSelected)! };
		tempTm.name = newName;
		try {
			await updateTmOnIndexedDB(tempTm);
			await loadTmDataFromIndexedDB();
			newFileName = "";
			renameFileWindow = false;
			showSelectModal = false;
			mergeTmModal = false;
			showTmxModal.set(false);
			notifyInfo("Translation Memory name updated");
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not rename this memory.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	function getUniqueTargetLanguages(tm: TmData) {
		return [
			...new Set(
				tm.terms.flatMap((term) => term.target.map((trg) => trg.lang)),
			),
		];
	}

	function getSourceLanguage(tm: TmData) {
		return tm.terms[0]?.source.lang ?? "—";
	}

	function closeTmModal() {
		showTmxModal.set(false);
		showTmUploadModal = false;
		showSelectModal = false;
		showDeletionConfirmationModal = false;
		mergeTmModal = false;
		renameFileWindow = false;
	}

	function openTmRename() {
		newFileName = selectedFileName;
		renameFileWindow = true;
	}
</script>

<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
<!-- ################################ Snippets ############################################################### -->
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
{#snippet tmUpload()}
	<div class="save-file-upload-container">
		<div
			style="display: flex; flex-direction:column; justify-content: center; gap: 25px 0px;"
		>
			<TmxUpload />
		</div>
	</div>
{/snippet}

{#snippet tmMergeUpload()}
	<div class="save-file-upload-container">
		<div
			style="display: flex; flex-direction:column; justify-content: center; gap: 25px 0px;"
		>
			<TmxMergeUpload />
		</div>
	</div>
{/snippet}

{#snippet selectMenu()}
	<div class="modal-stack">
		{#if !renameFileWindow}
			<div class="modal-actions">
				<button
					class="modal-action-card primary"
					onclick={() => selectTmToEdit($tmIdSelected)}
				>
					<span class="modal-action-icon" aria-hidden="true">TM</span>
					<span class="modal-action-text"
						><strong>Open memory editor</strong><small
							>Review and edit translation units</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
				<button class="modal-action-card" onclick={openTmRename}>
					<span class="modal-action-icon" aria-hidden="true">Aa</span>
					<span class="modal-action-text"
						><strong>Rename memory</strong><small
							>Change its library display name</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
				<button
					class="modal-action-card"
					onclick={() => handleTmMergeModal($tmIdSelected)}
				>
					<span class="modal-action-icon" aria-hidden="true">+</span>
					<span class="modal-action-text"
						><strong>Merge another TMX</strong><small
							>Create a combined translation memory</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
			</div>
		{:else}
			<div class="modal-form">
				<label class="modal-field">
					<span>Translation-memory name</span>
					<input
						type="text"
						bind:value={newFileName}
						placeholder="Memory name"
					/>
				</label>
				<div class="modal-actions inline">
					<button
						class="modal-button secondary"
						onclick={() => (renameFileWindow = false)}>Back</button
					>
					<button
						class="modal-button primary"
						disabled={!newFileName.trim()}
						onclick={() => updateFileName(newFileName)}>Save name</button
					>
				</div>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet deletionConfirmation()}
	<div class="modal-confirmation">
		<span class="modal-confirmation-icon" aria-hidden="true">!</span>
		<h3>Delete this translation memory?</h3>
		<p>
			<strong>{selectedFileName}</strong> and all of its translation units will be
			removed from this browser.
		</p>
		<div class="modal-actions inline">
			<button class="modal-button secondary" onclick={closeTmModal}
				>Keep memory</button
			>
			<button class="modal-button danger" onclick={handleTmDeletion}
				>Delete memory</button
			>
		</div>
	</div>
{/snippet}
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="presentation"
	class="modal-element-global {$showTmxModal ? '' : 'close-modal-global'}"
	onclick={closeTmModal}
>
	{#if showTmUploadModal}
		<Modal
			title="Import translation memory"
			description="Add a TMX file or create an empty reusable memory."
			content={tmUpload}
			wide
			onClose={closeTmModal}
		/>
	{/if}
	{#if showDeletionConfirmationModal}
		<Modal
			title="Delete translation memory"
			description={selectedFileName}
			content={deletionConfirmation}
			onClose={closeTmModal}
		/>
	{/if}
	{#if mergeTmModal}
		<Modal
			title="Merge translation memories"
			description={selectedFileName}
			content={tmMergeUpload}
			wide
			onClose={closeTmModal}
		/>
	{/if}
	{#if showSelectModal}
		<Modal
			title={renameFileWindow
				? "Rename translation memory"
				: "Translation memory"}
			description={selectedFileName}
			content={selectMenu}
			onClose={closeTmModal}
		/>
	{/if}
</div>

{#if !$editTm}
	<div class="resource-workspace">
		<header class="resource-page-header">
			<div>
				<p class="resource-eyebrow">Linguistic assets</p>
				<h1>Translation Memory</h1>
				<p class="resource-description">
					Manage reusable bilingual segments, import TMX files and export
					memories for use in other CAT tools.
				</p>
			</div>
			<div class="resource-header-actions">
				<button class="resource-secondary-action" onclick={() => goto("/app")}>
					← Projects
				</button>
				<button class="resource-primary-action" onclick={handleTmUploadModal}>
					+ Import TMX
				</button>
			</div>
		</header>

		<section class="resource-library-panel" aria-labelledby="tm-library-title">
			<div class="resource-panel-heading">
				<div>
					<h2 id="tm-library-title">Memory library</h2>
					<p>
						{filteredData.length === $tmData.length
							? `${$tmData.length} ${$tmData.length === 1 ? "memory" : "memories"}`
							: `${filteredData.length} of ${$tmData.length} memories`}
					</p>
				</div>
				<label class="resource-search">
					<span class="resource-visually-hidden"
						>Search translation memories</span
					>
					<span class="resource-search-icon" aria-hidden="true"></span>
					<input
						type="search"
						placeholder="Search translation memories"
						bind:value={searchQuery}
					/>
				</label>
			</div>

			{#if $tmData.length === 0}
				<div class="resource-empty">
					<h3>No translation memories yet</h3>
					<p>Import a TMX file to start reusing approved translations.</p>
					<button class="resource-primary-action" onclick={handleTmUploadModal}>
						Import TMX
					</button>
				</div>
			{:else if filteredData.length === 0}
				<div class="resource-empty">
					<h3>No matching memories</h3>
					<p>Try a different translation-memory name.</p>
					<button
						class="resource-secondary-action"
						onclick={() => (searchQuery = "")}>Clear search</button
					>
				</div>
			{:else}
				<div class="resource-table-wrapper">
					<div class="resource-table">
						<div class="resource-table-head" aria-hidden="true">
							<span>Name</span>
							<span>Languages</span>
							<span>Entries</span>
							<span>Actions</span>
						</div>
						{#each filteredData as tm (tm.id)}
							<div class="resource-table-row">
								<div class="resource-name">
									<strong>{tm.name}</strong>
									<small>TMX translation memory</small>
								</div>
								<div class="resource-languages">
									<span class="resource-language-tag"
										>{getSourceLanguage(tm)}</span
									>
									{#each getUniqueTargetLanguages(tm) as uniqueLang}
										<span class="resource-language-tag">{uniqueLang}</span>
									{/each}
								</div>
								<div class="resource-count">
									{tm.terms.length.toLocaleString()}
								</div>
								<div class="resource-row-actions">
									<button
										title="Manage memory"
										aria-label={`Manage ${tm.name}`}
										onclick={() => handleTmSelectionModal(tm.id!)}
									>
										<Edit marginBottom="0px" />
									</button>
									<button
										class="resource-delete"
										title="Delete memory"
										aria-label={`Delete ${tm.name}`}
										onclick={() => handleOpenDeletionConfirmationModal(tm.id!)}
									>
										<Delete marginBottom="0px" />
									</button>
									<button
										title="Export TMX"
										aria-label={`Export ${tm.name}`}
										onclick={() => downloadTmx(tm.id!)}
									>
										<Export marginBottom="0px" />
									</button>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	</div>
{:else}
	<div class="resource-editor-shell">
		<div class="resource-editor-toolbar">
			<button
				class="resource-secondary-action"
				onclick={() => editTm.set(false)}
			>
				← Back to memories
			</button>
		</div>
		<TmEditing />
	</div>
{/if}
