<script lang="ts">
	import Modal from "../modal.svelte";
	import TbxUpload from "../uploads/tbxUpload/tbxUpload.svelte";
	import TbxMergeUpload from "../uploads/tbxUpload/tbxMergeUpload.svelte";
	import {
		deleteTbFromIndexedDB,
		loadTbDataFromIndexedDB,
		updateTbOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb.js";
	import type { TbData } from "$lib/types/types";
	import { onMount } from "svelte";
	import {
		editTb,
		showLoading,
		showTbxModal,
		singleTbData,
		tbData,
		tbIdSelected,
	} from "$lib/functions/saveData/stores.svelte";
	import { generateTbxSaveFile } from "$lib/functions/saveFileGeneration/generateTbx3SaveFile";
	import TbEditing from "./tbEditing/tbEditing.svelte";
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

	let showTbUploadModal: boolean = $state(false);
	let showSelectModal: boolean = $state(false);
	let showDeletionConfirmationModal: boolean = $state(false);
	let mergeTbModal: boolean = $state(false);

	let renameFileWindow: boolean = $state(false);

	let newFileName: string = $state("");
	let selectedFileName: string = $state("");
	let tbSelected: TbData = $state({} as TbData);
	let tbToMerge: TbData | null = $state(null);

	onMount(async () => {
		try {
			if ($tbData.length === 0) {
				await setLoadingAndRender();
			}
			await loadTbDataFromIndexedDB();
			console.log("Loaded TB Data:", $tbData);
			showLoading.set(false);
		} catch (error) {
			console.error("Error loading TB Data:", error);
		}
	});

	let searchQuery: string = $state("");
	let filteredData = $derived(
		$tbData.filter((tb) =>
			(tb.name !== undefined ? tb.name : "")
				.toLowerCase()
				.includes(searchQuery.toLowerCase()),
		),
	);

	function getFileName(id: number) {
		tbIdSelected.set(id);
		selectedFileName = $tbData.find((tb) => tb.id === id)?.name!;
	}

	function handleTbUploadModal() {
		mergeTbModal = false;
		renameFileWindow = false;
		showDeletionConfirmationModal = false;
		showSelectModal = false;
		showTbUploadModal = true;
		showTbxModal.set(true);
	}

	function handleTbSelectionModal(id: number) {
		if (id === undefined) return;
		tbIdSelected.set(id);
		getFileName(id);
		showDeletionConfirmationModal = false;
		showTbUploadModal = false;
		mergeTbModal = false;
		renameFileWindow = false;
		showSelectModal = true;
		showTbxModal.set(true);
	}

	function handleTbMergeModal(id: number) {
		if (id === undefined) return;
		tbSelected = $tbData.find((tb) => tb.id === id) as TbData;
		tbIdSelected.set(id);
		singleTbData.set(tbSelected);
		getFileName(id);
		showDeletionConfirmationModal = false;
		showTbUploadModal = false;
		showSelectModal = false;
		mergeTbModal = true;
		showTbxModal.set(true);
	}

	function handleOpenDeletionConfirmationModal(id: number) {
		if (id === undefined) return;
		console.log("Deleting TB with ID:", id);
		tbIdSelected.set(id);
		getFileName(id);
		showDeletionConfirmationModal = true;
		showTbUploadModal = false;
		showSelectModal = false;
		mergeTbModal = false;
		showTbxModal.set(true);
	}

	async function handleTbDeletion() {
		if ($tbIdSelected === undefined) return;
		await setLoadingAndRender();
		await deleteTbFromIndexedDB($tbIdSelected);
		showDeletionConfirmationModal = false;
		showTbxModal.set(false);
		showLoading.set(false);
		notifyError("Term Base deleted");
	}

	async function downloadTbx(id: number) {
		if (id === undefined) return;
		await setLoadingAndRender();
		console.log("Downloading TBX File for ID:", id);
		let tb = $tbData.find((tb) => tb.id === id) as TbData;
		console.log("TB Data:", tb);
		generateTbxSaveFile(tb.entries[0].terms[0].lang, tb);
		showLoading.set(false);
		notifySuccess("Term Base downloaded");
	}

	async function selectTbToEdit(id: number) {
		if (id === undefined) return;
		await setLoadingAndRender();
		tbSelected = $tbData.find((tb) => tb.id === id) as TbData;
		tbIdSelected.set(id);
		singleTbData.set(tbSelected);
		showDeletionConfirmationModal = false;
		showTbUploadModal = false;
		showSelectModal = false;
		mergeTbModal = false;
		showTbxModal.set(false);
		editTb.set(true);
		showLoading.set(false);
	}

	async function updateFileName(newName: string) {
		if ($tbIdSelected === undefined || $tbData === undefined) return;
		await setLoadingAndRender();
		console.log("Updating File Name to:", newName);
		let tempTb = { ...$tbData.find((tb) => tb.id === $tbIdSelected)! };
		tempTb.name = newName;
		await updateTbOnIndexedDB(tempTb).then(() => {
			showLoading.update((v) => false);
		});
		newFileName = "";
		renameFileWindow = false;
		showSelectModal = false;
		mergeTbModal = false;
		showTbxModal.set(false);
		notifyInfo("Term Base name updated");
	}

	function getUniqueTargetLanguages(tb: TbData) {
		const sourceLanguage = getSourceLanguage(tb);
		return [
			...new Set(
				tb.entries.flatMap((entry) => entry.terms.map((term) => term.lang)),
			),
		].filter((language) => language !== sourceLanguage);
	}

	function getSourceLanguage(tb: TbData) {
		return tb.entries[0]?.terms[0]?.lang ?? "—";
	}

	function getTermCount(tb: TbData) {
		return tb.entries.reduce((count, entry) => count + entry.terms.length, 0);
	}
</script>

<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
<!-- ################################ Snippets ############################################################### -->
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
{#snippet tbUpload()}
	<div class="save-file-upload-container">
		<div
			style="display: flex; flex-direction:column; justify-content: center; gap: 25px 0px;"
		>
			<TbxUpload />
		</div>
	</div>
{/snippet}

{#snippet tbMergeUpload()}
	<div class="save-file-upload-container">
		<div
			style="display: flex; flex-direction:column; justify-content: center; gap: 25px 0px;"
		>
			<TbxMergeUpload />
		</div>
		{#if tbToMerge !== undefined && tbToMerge !== null}
			<div class="deletion-confirmation-container">
				<p class="deletion-confirmation">
					Are you sure you want to merge <span
						style="color: var(--color-theme-4);">{selectedFileName}?</span
					>
				</p>
				<button class="btn delete" onclick={() => handleTbDeletion()}>
					Delete
				</button>
				<button
					class="btn update"
					onclick={() => ((mergeTbModal = false), (showSelectModal = true))}
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
			<button class="btn save" onclick={() => selectTbToEdit($tbIdSelected)}>
				Edit
			</button>
			<button class="btn option" onclick={() => (renameFileWindow = true)}>
				Rename
			</button>
			<button
				class="btn option"
				onclick={() => handleTbMergeModal($tbIdSelected)}
			>
				Merge TBX
			</button>
			<button class="btn update" onclick={() => showTbxModal.set(false)}>
				Cancel
			</button>
		{:else}
			<div style="display: grid; justify-content: center;">
				<input
					class="rename"
					type="text"
					bind:value={newFileName}
					placeholder="New TB Name"
				/>
				<button class="btn" onclick={() => updateFileName(newFileName)}>
					Confirm New TB Name
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
		<button class="btn delete" onclick={() => handleTbDeletion()}>
			Delete
		</button>
		<button class="btn update" onclick={() => showTbxModal.set(false)}>
			Cancel
		</button>
	</div>
{/snippet}
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->
<!-- ################################ Snippets End ########################################################### -->
<!-- ######################################################################################################### -->
<!-- ######################################################################################################### -->

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	tabindex="-1"
	class="modal-element-global {$showTbxModal ? '' : 'close-modal-global'}"
	onclick={() => showTbxModal.set(false)}
>
	{#if showTbUploadModal}
		<Modal title="Term Base" content={tbUpload} />
	{/if}
	{#if showDeletionConfirmationModal}
		<Modal title="Confirm" content={deletionConfirmation} />
	{/if}
	{#if mergeTbModal}
		<Modal title="Merge TB" content={tbMergeUpload} />
	{/if}
	{#if showSelectModal}
		<Modal title={selectedFileName} content={selectMenu} />
	{/if}
</div>

{#if !$editTb}
	<div class="resource-workspace">
		<header class="resource-page-header">
			<div>
				<p class="resource-eyebrow">Linguistic assets</p>
				<h1>Term Base</h1>
				<p class="resource-description">
					Manage approved terminology, multilingual concepts and TBX files used
					throughout translation projects.
				</p>
			</div>
			<div class="resource-header-actions">
				<button class="resource-secondary-action" onclick={() => goto("/app")}>
					← Projects
				</button>
				<button class="resource-primary-action" onclick={handleTbUploadModal}>
					+ Import TBX
				</button>
			</div>
		</header>

		<section class="resource-library-panel" aria-labelledby="tb-library-title">
			<div class="resource-panel-heading">
				<div>
					<h2 id="tb-library-title">Term-base library</h2>
					<p>
						{filteredData.length === $tbData.length
							? `${$tbData.length} ${$tbData.length === 1 ? "term base" : "term bases"}`
							: `${filteredData.length} of ${$tbData.length} term bases`}
					</p>
				</div>
				<label class="resource-search">
					<span class="resource-visually-hidden">Search term bases</span>
					<span class="resource-search-icon" aria-hidden="true"></span>
					<input
						type="search"
						placeholder="Search term bases"
						bind:value={searchQuery}
					/>
				</label>
			</div>

			{#if $tbData.length === 0}
				<div class="resource-empty">
					<h3>No term bases yet</h3>
					<p>Import a TBX file to start managing approved terminology.</p>
					<button class="resource-primary-action" onclick={handleTbUploadModal}>
						Import TBX
					</button>
				</div>
			{:else if filteredData.length === 0}
				<div class="resource-empty">
					<h3>No matching term bases</h3>
					<p>Try a different term-base name.</p>
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
							<span>Terms</span>
							<span>Actions</span>
						</div>
						{#each filteredData as tb (tb.id)}
							<div class="resource-table-row">
								<div class="resource-name">
									<strong>{tb.name}</strong>
									<small>TBX terminology collection</small>
								</div>
								<div class="resource-languages">
									<span class="resource-language-tag"
										>{getSourceLanguage(tb)}</span
									>
									{#each getUniqueTargetLanguages(tb).slice(0, 5) as uniqueLang}
										<span class="resource-language-tag">{uniqueLang}</span>
									{/each}
								</div>
								<div class="resource-count">
									{getTermCount(tb).toLocaleString()}
								</div>
								<div class="resource-row-actions">
									<button
										title="Manage term base"
										aria-label={`Manage ${tb.name}`}
										onclick={() => handleTbSelectionModal(tb.id!)}
									>
										<Edit marginBottom="0px" />
									</button>
									<button
										class="resource-delete"
										title="Delete term base"
										aria-label={`Delete ${tb.name}`}
										onclick={() => handleOpenDeletionConfirmationModal(tb.id!)}
									>
										<Delete marginBottom="0px" />
									</button>
									<button
										title="Export TBX"
										aria-label={`Export ${tb.name}`}
										onclick={() => downloadTbx(tb.id!)}
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
				onclick={() => editTb.set(false)}
			>
				← Back to term bases
			</button>
		</div>
		<TbEditing />
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
