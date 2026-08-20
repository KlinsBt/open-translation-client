<script lang="ts">
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { TbData } from "$lib/types/types";
	import {
		showLoading,
		singleTbData,
		editTb,
		showTbxModal,
		tbIdSelected,
	} from "$lib/functions/saveData/stores.svelte";
	import {
		loadTbDataFromIndexedDB,
		saveNewTbToIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";
	import { safeInputMessage } from "$lib/formats/safeInput";
	import { importTbxStreaming } from "$lib/formats/streamingImporters";
	import "$lib/components/uploads/uploadDialog.css";

	let isDragging = $state(false);

	let extractedTbxData: TbData | null = $state(null);
	let combinedTbxData: TbData = { name: "Merged TBX", entries: [] };

	async function processTbxFile(file: File | null): Promise<void> {
		showLoading.set(true);
		if (!file || !file.name.toLowerCase().endsWith(".tbx")) {
			notifyError("Please upload a valid TBX file");
			showLoading.set(false);
			return;
		}
		try {
			extractedTbxData = (await importTbxStreaming(file)).data;
			if (!extractedTbxData) throw new Error("No TBX data was found.");
		} catch (error) {
			notifyError(safeInputMessage(error));
		} finally {
			showLoading.set(false);
		}
	}

	function handleTbxFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		void processTbxFile(file);
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

		await processTbxFile(file);
	}

	function mergeTbxFiles() {
		if (!extractedTbxData) return;
		const part1 = structuredClone($singleTbData);
		const part2 = structuredClone(extractedTbxData);
		combinedTbxData = {
			name: "Merged TBX",
			entries: [...part1.entries, ...part2.entries],
		};
	}

	async function createNewProjectWithTbxFile() {
		showLoading.set(true);
		try {
			mergeTbxFiles();
			if (combinedTbxData.entries.length === 0)
				throw new Error("The merged term base has no terminology entries.");
			await saveNewTbToIndexedDB(combinedTbxData);
			const updatedTbData = await loadTbDataFromIndexedDB();
			const newTb = updatedTbData[updatedTbData.length - 1];
			if (!newTb)
				throw new Error("The merged term base could not be reopened.");
			singleTbData.set(newTb);
			tbIdSelected.set(newTb.id!);
			editTb.set(true);
			showTbxModal.set(false);
			notifySuccess("Term base merged successfully");
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
		<strong>Add another TBX term base</strong>
		<span
			>The imported concepts will be combined with the selected term base and
			saved as a new collection.</span
		>
	</div>
	<DragAndDropHere />
	{#if extractedTbxData === null || extractedTbxData === undefined}
		<button class="upload-file-button">
			Choose TBX file
			<input
				id="fileInputExcel"
				type="file"
				accept="application/xml, .tbx"
				oninput={handleTbxFileUpload}
			/>
		</button>
	{:else}
		<button
			class="upload-file-button"
			onclick={() => createNewProjectWithTbxFile()}
		>
			Create merged term base
		</button>
	{/if}
</div>
