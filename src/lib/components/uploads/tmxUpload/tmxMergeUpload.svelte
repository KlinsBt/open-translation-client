<script lang="ts">
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { TmData } from "$lib/types/types";
	import {
		showLoading,
		singleTmData,
		editTm,
		showTmxModal,
		tmIdSelected,
	} from "$lib/functions/saveData/stores.svelte";
	import {
		loadTmDataFromIndexedDB,
		saveNewTmToIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";
	import { safeInputMessage } from "$lib/formats/safeInput";
	import { importTmxStreaming } from "$lib/formats/streamingImporters";
	import { mergeTmxData, type TmxMergePolicy } from "$lib/formats/tmx14";

	let isDragging = $state(false);

	let extractedTmxData: TmData | null = $state(null);
	let combinedTmxData: TmData = { name: "Merged TMX", terms: [] };
	let mergePolicy: TmxMergePolicy = $state("merge-targets");

	async function processTmxFile(file: File | null): Promise<void> {
		showLoading.set(true);
		if (!file || !file.name.toLowerCase().endsWith(".tmx")) {
			notifyError("Please upload a valid TMX file");
			showLoading.set(false);
			return;
		}
		try {
			extractedTmxData = (await importTmxStreaming(file)).data;
			if (!extractedTmxData)
				throw new Error("The TMX file needs at least two language pairs.");
		} catch (error) {
			notifyError(safeInputMessage(error));
			console.error("Invalid TMX file", error);
		} finally {
			showLoading.set(false);
		}
	}

	function handleTmxFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		void processTmxFile(file);
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(): void {
		isDragging = false;
	}

	async function handleDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		isDragging = false;

		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;

		await processTmxFile(file);
	}

	function mergeTmxFiles() {
		if (!extractedTmxData) return;
		combinedTmxData = mergeTmxData($singleTmData, extractedTmxData, {
			policy: mergePolicy,
		});
	}

	async function createNewProjectWithTmxFile() {
		mergeTmxFiles();
		showLoading.set(true);
		if (combinedTmxData.terms.length === 0) return;
		// console.log("new tm: ", combinedTmxData);
		await saveNewTmToIndexedDB(combinedTmxData);
		const updatedTmData = await loadTmDataFromIndexedDB();
		const newTm = updatedTmData[updatedTmData.length - 1];
		// console.log("Newly saved TM:", newTm);
		singleTmData.set(newTm);
		tmIdSelected.set(newTm.id!);
		editTm.set(true);
		showTmxModal.set(false);
		showLoading.set(false);
		notifySuccess("TMX files merged successfully");
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="container"
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	class:is-dragging={isDragging}
>
	<p class="info">
		Upload another TMX file and choose how duplicate source segments should be
		handled. The result is saved as a new translation memory.
	</p>
	<DragAndDropHere />
	{#if extractedTmxData === null || extractedTmxData === undefined}
		<button class="input-button-container">
			Upload TMX File To Merge
			<input
				id="fileInputExcel"
				type="file"
				accept="application/xml, .tmx"
				oninput={handleTmxFileUpload}
			/>
		</button>
	{:else}
		<label class="merge-policy">
			Duplicate policy
			<select bind:value={mergePolicy}>
				<option value="merge-targets">Merge unique targets</option>
				<option value="keep-first">Keep first unit</option>
				<option value="keep-last">Keep last unit</option>
				<option value="keep-all">Keep every unit</option>
			</select>
		</label>
		<button
			class="input-button-container save"
			onclick={() => createNewProjectWithTmxFile()}
		>
			Merge TMX Files
		</button>
	{/if}
</div>

<style>
	.container {
		display: grid;
		align-items: center;
		justify-items: center;
		gap: 0px;
		border: 2px dashed var(--color-theme-4);
		border-radius: 5px;
		padding: 5px 20px;
		transition: background-color 0.3s;
		max-width: 270px;
	}

	.container.is-dragging {
		background-color: rgba(0, 0, 0, 0.05);
		border-color: var(--color-theme-3);
	}

	.info {
		font-size: 0.8rem;
		font-weight: 600;
		max-width: 250px;
		text-align: justify;
		color: var(--color-theme-4);
	}

	.merge-policy {
		display: grid;
		gap: 4px;
		width: 100%;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-theme-4);
	}

	.merge-policy select {
		width: 100%;
		padding: 7px;
		border: 1px solid var(--color-theme-4);
		border-radius: 4px;
		background: white;
	}

	.input-button-container {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-theme-4);
		color: white;
		border: none;
		font-size: 1.3rem;
		border-radius: 5px;
		padding: 10px;
		margin: 10px 0px;
		cursor: pointer;
		width: 100%;
		transition: filter 0.2s linear;
		position: relative;
	}

	.input-button-container:hover {
		filter: brightness(1.1);
	}

	.input-button-container:active {
		filter: brightness(1);
		transform: scale(0.99);
	}

	.input-button-container > input[type="file"] {
		position: absolute;
		width: 100%;
		height: 100%;
		top: 0;
		left: 0;
		opacity: 0;
		cursor: pointer;
	}
</style>
