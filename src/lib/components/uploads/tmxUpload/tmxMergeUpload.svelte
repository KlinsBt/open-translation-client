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
	import "$lib/components/uploads/uploadDialog.css";

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
		showLoading.set(true);
		try {
			mergeTmxFiles();
			if (combinedTmxData.terms.length === 0)
				throw new Error(
					"The merged translation memory has no translation units.",
				);
			await saveNewTmToIndexedDB(combinedTmxData);
			const updatedTmData = await loadTmDataFromIndexedDB();
			const newTm = updatedTmData[updatedTmData.length - 1];
			if (!newTm)
				throw new Error("The merged translation memory could not be reopened.");
			singleTmData.set(newTm);
			tmIdSelected.set(newTm.id!);
			editTm.set(true);
			showTmxModal.set(false);
			notifySuccess("TMX files merged successfully");
		} catch (error) {
			notifyError(safeInputMessage(error));
		} finally {
			showLoading.set(false);
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="upload-surface"
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	class:is-dragging={isDragging}
>
	<div class="upload-guidance">
		<strong>Add another TMX memory</strong>
		<span
			>Choose how duplicate source segments are handled. The result is saved as
			a new translation memory.</span
		>
	</div>
	<DragAndDropHere />
	{#if extractedTmxData === null || extractedTmxData === undefined}
		<button class="upload-file-button">
			Choose TMX file
			<input
				id="fileInputExcel"
				type="file"
				accept="application/xml, .tmx"
				oninput={handleTmxFileUpload}
			/>
		</button>
	{:else}
		<label class="upload-choice">
			<span>Duplicate policy</span>
			<select class="upload-select" bind:value={mergePolicy}>
				<option value="merge-targets">Merge unique targets</option>
				<option value="keep-first">Keep first unit</option>
				<option value="keep-last">Keep last unit</option>
				<option value="keep-all">Keep every unit</option>
			</select>
		</label>
		<button
			class="upload-file-button"
			onclick={() => createNewProjectWithTmxFile()}
		>
			Create merged memory
		</button>
	{/if}
</div>
