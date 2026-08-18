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
	import { setLoadingAndRender } from "$lib/functions/uiHelpers";
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
	let tmToMerge: TmData | null = $state(null);

	onMount(async () => {
		try {
			if ($tmData.length === 0) {
				await setLoadingAndRender();
			}
			await loadTmDataFromIndexedDB();
			console.log("Loaded TM Data:", $tmData);
			showLoading.set(false);
		} catch (error) {
			console.error("Error loading TM Data:", error);
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
		console.log("Deleting TM with ID:", id);
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
		await deleteTmFromIndexedDB($tmIdSelected);
		showDeletionConfirmationModal = false;
		showTmxModal.set(false);
		showLoading.set(false);
		notifyError("Translation Memory deleted");
	}

	async function downloadTmx(id: number) {
		if (id === undefined) return;
		await setLoadingAndRender();
		console.log("Downloading TMX File for ID:", id);
		let tm = $tmData.find((tm) => tm.id === id) as TmData;
		console.log("TM Data:", tm);
		generateTmxSaveFile(tm.terms[0].source.lang, tm);
		showLoading.set(false);
		notifySuccess("Translation Memory downloaded");
	}

	async function selectTmToEdit(id: number) {
		if (id === undefined) return;
		await setLoadingAndRender();
		tmSelected = $tmData.find((tm) => tm.id === id) as TmData;
		tmIdSelected.set(id);
		singleTmData.set(tmSelected);
		showDeletionConfirmationModal = false;
		showTmUploadModal = false;
		showSelectModal = false;
		mergeTmModal = false;
		showTmxModal.set(false);
		editTm.set(true);
		showLoading.set(false);
	}

	async function updateFileName(newName: string) {
		if ($tmIdSelected === undefined || $tmData === undefined) return;
		await setLoadingAndRender();
		console.log("Updating File Name to:", newName);
		let tempTm = { ...$tmData.find((tm) => tm.id === $tmIdSelected)! };
		tempTm.name = newName;
		await updateTmOnIndexedDB(tempTm).then(() => {
			showLoading.update((v) => false);
		});
		newFileName = "";
		renameFileWindow = false;
		showSelectModal = false;
		mergeTmModal = false;
		showTmxModal.set(false);
		notifyInfo("Translation Memory name updated");
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
		{#if tmToMerge !== undefined && tmToMerge !== null}
			<div class="deletion-confirmation-container">
				<p class="deletion-confirmation">
					Are you sure you want to merge <span
						style="color: var(--color-theme-4);">{selectedFileName}?</span
					>
				</p>
				<button class="btn delete" onclick={() => handleTmDeletion()}>
					Delete
				</button>
				<button
					class="btn update"
					onclick={() => ((mergeTmModal = false), (showSelectModal = true))}
				>
					Cancel
				</button>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet selectMenu()}
	<div class="deletion-confirmation-container">
		{#if !renameFileWindow}
			<button class="btn save" onclick={() => selectTmToEdit($tmIdSelected)}>
				Edit
			</button>
			<button class="btn option" onclick={() => (renameFileWindow = true)}>
				Rename
			</button>
			<button
				class="btn option"
				onclick={() => handleTmMergeModal($tmIdSelected)}
			>
				Merge TMX
			</button>
			<button class="btn update" onclick={() => showTmxModal.set(false)}>
				Cancel
			</button>
		{:else}
			<div style="display: grid; justify-content: center;">
				<input
					class="rename"
					type="text"
					bind:value={newFileName}
					placeholder="New TM Name"
				/>
				<button class="btn" onclick={() => updateFileName(newFileName)}>
					Confirm New TM Name
				</button>
				<button class="btn update" onclick={() => (renameFileWindow = false)}>
					Cancel
				</button>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet deletionConfirmation()}
	<div class="deletion-confirmation-container">
		<p class="deletion-confirmation">
			Are you sure you want to delete <span style="color: var(--color-theme-4);"
				>{selectedFileName}?</span
			>
		</p>
		<button class="btn delete" onclick={() => handleTmDeletion()}>
			Delete
		</button>
		<button class="btn update" onclick={() => showTmxModal.set(false)}>
			Cancel
		</button>
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
	role="dialog"
	tabindex="-1"
	class="modal-element-global {$showTmxModal ? '' : 'close-modal-global'}"
	onclick={() => showTmxModal.set(false)}
>
	{#if showTmUploadModal}
		<Modal title="Translation Memory" content={tmUpload} />
	{/if}
	{#if showDeletionConfirmationModal}
		<Modal title="Confirm" content={deletionConfirmation} />
	{/if}
	{#if mergeTmModal}
		<Modal title="Merge TM" content={tmMergeUpload} />
	{/if}
	{#if showSelectModal}
		<Modal title={selectedFileName} content={selectMenu} />
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

	.rename {
		padding: 10px;
		margin: 5px 0px;
		border: 1px solid var(--color-theme-4);
		border-radius: 5px;
	}
</style>
