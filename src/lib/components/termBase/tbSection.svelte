<script lang="ts">
	import Modal from "../modal.svelte";
	import RightArrow from "../svg/rightArrow.svelte";
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
		return [
			...new Set(
				tb.entries.flatMap((entry) => entry.terms.map((term) => term.lang)),
			),
		];
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
	<h1 class="section-title">Term Base</h1>

	<div class="table-container">
		<div class="table-header">
			<input
				type="text"
				placeholder="Search TB Name..."
				bind:value={searchQuery}
				class="search-input"
			/>
		</div>
		{#each filteredData as tb}
			<div class="table-row">
				<div class="languages">
					<span class="language-tag">{tb.entries[0].terms[0].lang}</span>
					{#each getUniqueTargetLanguages(tb).slice(0, 5) as uniqueLang}
						<span class="language-tag">{uniqueLang}</span>
					{/each}
				</div>
				<div class="tb-name">{tb.name}</div>
				<div class="icon-edits-container">
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="icon edi" onclick={() => handleTbSelectionModal(tb.id!)}>
						<Edit marginBottom="0px" />
					</div>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="icon del"
						onclick={() => handleOpenDeletionConfirmationModal(tb.id!)}
					>
						<Delete marginBottom="0px" />
					</div>
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="icon exp" onclick={() => downloadTbx(tb.id!)}>
						<Export marginBottom="0px" />
					</div>
				</div>
			</div>
		{/each}
		<button
			class="add-tb-btn save"
			onclick={() => {
				handleTbUploadModal();
			}}
		>
			Add TB +
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
	<TbEditing />

	<button
		class="back-btn back"
		onclick={() => {
			editTb.set(false);
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

	.tb-name {
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

	.add-tb-btn {
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

	.add-tb-btn:hover {
		filter: brightness(1.1);
	}

	.add-tb-btn:active {
		filter: brightness(0.98);
	}
</style>
