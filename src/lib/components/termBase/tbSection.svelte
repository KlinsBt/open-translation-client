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
	import { setLoadingAndRender, withLoading } from "$lib/functions/uiHelpers";
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

	onMount(async () => {
		try {
			await withLoading(() => loadTbDataFromIndexedDB());
		} catch (error) {
			notifyError(
				error instanceof Error
					? `Term bases could not be loaded: ${error.message}`
					: "Term bases could not be loaded from this browser.",
			);
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
		try {
			await deleteTbFromIndexedDB($tbIdSelected);
			showDeletionConfirmationModal = false;
			showTbxModal.set(false);
			notifyInfo("Term Base deleted");
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not delete this term base.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	async function downloadTbx(id: number) {
		if (id === undefined) return;
		await setLoadingAndRender();
		try {
			const tb = $tbData.find((candidate) => candidate.id === id);
			if (!tb) throw new Error("Term base not found.");
			const sourceLanguage = tb.entries[0]?.terms[0]?.lang;
			if (!sourceLanguage)
				throw new Error("Add at least one term before exporting.");
			await generateTbxSaveFile(sourceLanguage, tb);
			notifySuccess("Term Base downloaded");
		} catch (error) {
			notifyError(
				error instanceof Error ? error.message : "TBX export failed.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	async function selectTbToEdit(id: number) {
		if (id === undefined) return;
		try {
			await withLoading(async () => {
				const selected = $tbData.find((tb) => tb.id === id);
				if (!selected)
					throw new Error("That term base is no longer available.");
				tbSelected = selected;
				tbIdSelected.set(id);
				singleTbData.set(selected);
				showDeletionConfirmationModal = false;
				showTbUploadModal = false;
				showSelectModal = false;
				mergeTbModal = false;
				showTbxModal.set(false);
				editTb.set(true);
			});
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "The term base could not be opened.",
			);
		}
	}

	async function updateFileName(newName: string) {
		if ($tbIdSelected === undefined || $tbData === undefined) return;
		await setLoadingAndRender();
		let tempTb = { ...$tbData.find((tb) => tb.id === $tbIdSelected)! };
		tempTb.name = newName;
		try {
			await updateTbOnIndexedDB(tempTb);
			await loadTbDataFromIndexedDB();
			newFileName = "";
			renameFileWindow = false;
			showSelectModal = false;
			mergeTbModal = false;
			showTbxModal.set(false);
			notifyInfo("Term Base name updated");
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not rename this term base.",
			);
		} finally {
			showLoading.set(false);
		}
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

	function closeTbModal() {
		showTbxModal.set(false);
		showTbUploadModal = false;
		showSelectModal = false;
		showDeletionConfirmationModal = false;
		mergeTbModal = false;
		renameFileWindow = false;
	}

	function openTbRename() {
		newFileName = selectedFileName;
		renameFileWindow = true;
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
	</div>
{/snippet}

{#snippet selectMenu()}
	<div class="modal-stack">
		{#if !renameFileWindow}
			<div class="modal-actions">
				<button
					class="modal-action-card primary"
					onclick={() => selectTbToEdit($tbIdSelected)}
				>
					<span class="modal-action-icon" aria-hidden="true">TB</span>
					<span class="modal-action-text"
						><strong>Open term-base editor</strong><small
							>Review and edit terminology entries</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
				<button class="modal-action-card" onclick={openTbRename}>
					<span class="modal-action-icon" aria-hidden="true">Aa</span>
					<span class="modal-action-text"
						><strong>Rename term base</strong><small
							>Change its library display name</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
				<button
					class="modal-action-card"
					onclick={() => handleTbMergeModal($tbIdSelected)}
				>
					<span class="modal-action-icon" aria-hidden="true">+</span>
					<span class="modal-action-text"
						><strong>Merge another TBX</strong><small
							>Create a combined terminology collection</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
			</div>
		{:else}
			<div class="modal-form">
				<label class="modal-field">
					<span>Term-base name</span>
					<input
						type="text"
						bind:value={newFileName}
						placeholder="Term-base name"
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
		<h3>Delete this term base?</h3>
		<p>
			<strong>{selectedFileName}</strong> and all of its terminology entries will
			be removed from this browser.
		</p>
		<div class="modal-actions inline">
			<button class="modal-button secondary" onclick={closeTbModal}
				>Keep term base</button
			>
			<button class="modal-button danger" onclick={handleTbDeletion}
				>Delete term base</button
			>
		</div>
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
	role="presentation"
	class="modal-element-global {$showTbxModal ? '' : 'close-modal-global'}"
	onclick={closeTbModal}
>
	{#if showTbUploadModal}
		<Modal
			title="Import term base"
			description="Add a TBX file or create an empty terminology collection."
			content={tbUpload}
			wide
			onClose={closeTbModal}
		/>
	{/if}
	{#if showDeletionConfirmationModal}
		<Modal
			title="Delete term base"
			description={selectedFileName}
			content={deletionConfirmation}
			onClose={closeTbModal}
		/>
	{/if}
	{#if mergeTbModal}
		<Modal
			title="Merge term bases"
			description={selectedFileName}
			content={tbMergeUpload}
			wide
			onClose={closeTbModal}
		/>
	{/if}
	{#if showSelectModal}
		<Modal
			title={renameFileWindow ? "Rename term base" : "Term base"}
			description={selectedFileName}
			content={selectMenu}
			onClose={closeTbModal}
		/>
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
