<script lang="ts">
	import Modal from "../modal.svelte";
	import RightArrow from "../svg/rightArrow.svelte";
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
	}

	async function downloadTmx(id: number) {
		if (id === undefined) return;
		await setLoadingAndRender();
		console.log("Downloading TMX File for ID:", id);
		let tm = $tmData.find((tm) => tm.id === id) as TmData;
		console.log("TM Data:", tm);
		generateTmxSaveFile(tm.terms[0].source.lang, tm);
		showLoading.set(false);
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
	}

	function getUniqueTargetLanguages(tm: TmData) {
		return [
			...new Set(
				tm.terms.flatMap((term) => term.target.map((trg) => trg.lang)),
			),
		];
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
	<h1 class="section-title">Translation Memory</h1>

	<div class="table-container">
		<div class="table-header">
			<input
				type="text"
				placeholder="Search TM Name..."
				bind:value={searchQuery}
				class="search-input"
			/>
		</div>
		{#each filteredData as tm, i}
			<div class="table-row">
				<div class="languages">
					<span class="language-tag">{tm.terms[0].source.lang}</span>
					{#each getUniqueTargetLanguages(tm) as uniqueLang}
						<span class="language-tag">{uniqueLang}</span>
					{/each}
				</div>
				<div class="tm-name">{tm.name}</div>
				<div class="icon-edits-container">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="icon edi" onclick={() => handleTmSelectionModal(tm.id!)}>
						<Edit marginBottom="0px" />
					</div>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="icon del"
						onclick={() => handleOpenDeletionConfirmationModal(tm.id!)}
					>
						<Delete marginBottom="0px" />
					</div>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="icon exp" onclick={() => downloadTmx(tm.id!)}>
						<Export marginBottom="0px" />
					</div>
				</div>
			</div>
		{/each}
		<button
			class="add-tm-btn save"
			onclick={() => {
				handleTmUploadModal();
			}}
		>
			Add TM +
		</button>
	</div>

	<button
		class="back-btn back"
		onclick={() => {
			goto("/app");
		}}
	>
		<RightArrow />
		Go Back
	</button>
{:else}
	<TmEditing />

	<button
		class="back-btn back"
		onclick={() => {
			editTm.set(false);
		}}
	>
		<RightArrow />
		Go Back
	</button>
{/if}

<style>
	.section-title {
		text-align: center;
		font-size: 2rem;
		font-weight: 600;
		color: var(--color-theme-3);
	}

	.table-container {
		width: 100%;
		max-width: 1100px;
		background-color: var(--color-theme-7);
		border-radius: 5px;
		overflow: hidden;
		font-family: Arial, sans-serif;
	}

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

	.table-header,
	.table-row {
		display: flex;
		align-items: center;
		padding: 0px;
	}

	.table-header {
		background-color: var(--color-theme-4);
		font-weight: bold;
		color: var(--color-theme-4);
		display: flex;
		padding: 10px;
		background-color: var(--color-theme-7);
	}

	.search-input {
		flex: 1;
		padding: 12px;
		font-size: 1em;
		border: 1px solid var(--color-theme-3);
		border-radius: 5px;
		outline: none;
	}

	.search-input::placeholder {
		color: #999;
	}

	.rename {
		padding: 10px;
		margin: 5px 0px;
		border: 1px solid var(--color-theme-4);
		border-radius: 5px;
	}

	.table-row {
		display: flex;
		align-items: center;
		padding: 12px 16px;
		background-color: #fff;
		border-top: 1px solid #eee;
		margin: 0px;
		/* border-radius: 5px; */
		/* cursor: pointer; */
	}

	.table-row:hover {
		background-color: var(--color-theme-1);
		background-color: #d9f2ff;
	}

	.table-row div {
		flex: 1;
		text-align: center;
	}

	.languages {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		max-width: 200px;
	}

	.language-tag {
		background-color: #e0e7ff;
		color: #3b82f6;
		padding: 5px 10px;
		border-radius: 4px;
		font-size: 0.8em;
		border: 1px solid #a8aec3;
	}

	.language-tag:nth-child(1) {
		background-color: var(--color-theme-7);
		/* border: 1px solid #e0e7ff; */
		border: 1px solid #a8aec3;
	}

	.tm-name {
		font-weight: 500;
		color: #333;
	}

	.table-row div {
		flex: 1;
		text-align: center;
	}

	.languages {
		display: flex;
		gap: 8px;
	}

	.icon-edits-container {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		padding: 12px 16px;
		margin: 0px;
		gap: 10px;
		/* border-radius: 5px; */
		/* cursor: pointer; */
	}

	.icon.edi,
	.icon.del,
	.icon.exp {
		min-width: 100px;
		background-color: #f1f5ff;
		margin: 0px 5px;
		border: 1px solid #a8aec3;
	}

	.icon {
		cursor: pointer;
		padding: 4px;
		border-radius: 4px;
		transition: background-color 0.2s ease;
	}

	.icon.edi:hover {
		background-color: #e0f7fa;
	}

	.icon.del:hover {
		background-color: #ffebee;
	}

	.icon.exp:hover {
		background-color: #e8f5e9;
	}

	.add-tm-btn {
		width: 100%;
		min-width: 100px;
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
	}

	.add-tm-btn:hover {
		filter: brightness(1.1);
	}

	.add-tm-btn:active {
		filter: brightness(0.98);
	}
</style>
