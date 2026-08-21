<script lang="ts">
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { TbData } from "$lib/types/types";
	import {
		showLoading,
		tbData,
		singleTbData,
		editTb,
		showTbxModal,
		tbIdSelected,
	} from "$lib/functions/saveData/stores.svelte";
	import {
		loadTbDataFromIndexedDB,
		saveNewTbToIndexedDB,
		updateTbOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";
	import { safeInputMessage } from "$lib/formats/safeInput";
	import { importTbxStreaming } from "$lib/formats/streamingImporters";
	import "$lib/components/uploads/uploadDialog.css";

	let temporarySaveName: string = $state("");

	let isDragging = $state(false);

	let sameIdTbData: TbData | null = null;
	let extractedTbxData: TbData | null = $state(null);
	let tbxDataIdExists: boolean = $state(false);

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
			if (checkIfIdExists(extractedTbxData.id)) {
				tbxDataIdExists = true;
				return;
			}
			if (await createNewProjectWithTbxFile())
				notifySuccess("Term base imported");
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

	function checkIfIdExists(id: number | undefined): boolean {
		if (!id) return false;
		const singleData: TbData | undefined = $tbData.find((d) => d.id === id);
		sameIdTbData = singleData || null;
		return !!singleData;
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(): void {
		isDragging = false;
	}

	async function handleDropUpload(event: DragEvent): Promise<void> {
		event.preventDefault();
		isDragging = false;
		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;
		await processTbxFile(file);
	}

	async function createNewProjectWithTbxFile(): Promise<boolean> {
		showLoading.set(true);
		try {
			if (!extractedTbxData) throw new Error("Choose a TBX file first.");
			let tb: TbData = structuredClone($state.snapshot(extractedTbxData));
			delete tb.id;
			await saveNewTbToIndexedDB(tb);
			const updatedTbData = await loadTbDataFromIndexedDB();
			const newTb = updatedTbData[updatedTbData.length - 1];
			if (!newTb)
				throw new Error("The imported term base could not be reopened.");
			singleTbData.set(newTb);
			tbIdSelected.set(newTb.id!);
			editTb.set(true);
			showTbxModal.set(false);
			return true;
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not import the TBX file.",
			);
			return false;
		} finally {
			showLoading.set(false);
		}
	}

	async function updateExistingProjectWithTbxFile() {
		showLoading.set(true);
		try {
			if (!extractedTbxData) throw new Error("Choose a TBX file first.");
			const tb = structuredClone($state.snapshot(extractedTbxData));
			const current = $tbData.find((entry) => entry.id === tb.id);
			if (!current) throw new Error("That term base is no longer available.");
			tb.persistenceRevision = current.persistenceRevision;
			await updateTbOnIndexedDB(tb);
			singleTbData.set(tb);
			editTb.set(true);
			showTbxModal.set(false);
			tbxDataIdExists = false;
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not replace this term base.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	function cancelOverwrite() {
		tbxDataIdExists = false;
	}

	async function saveNewTbx() {
		let tempTb: TbData = {
			// id: 1,
			name: temporarySaveName,
			entries: [],
		};

		showLoading.set(true);

		try {
			await saveNewTbToIndexedDB(tempTb);
			const updatedTbData = await loadTbDataFromIndexedDB();
			const newTb = updatedTbData[updatedTbData.length - 1];
			if (!newTb) throw new Error("The new term base could not be reopened.");
			singleTbData.set(newTb);
			tbIdSelected.set(newTb.id!);
			editTb.set(true);
			showTbxModal.set(false);
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not create this term base.",
			);
		} finally {
			showLoading.set(false);
			temporarySaveName = "";
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if !tbxDataIdExists}
	<div
		class="upload-surface"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDropUpload}
		class:is-dragging={isDragging}
	>
		<div class="upload-guidance">
			<strong>Import a TBX file or create an empty term base</strong>
			<span>Multilingual concepts and terminology metadata are retained.</span>
		</div>
		<label class="upload-name-field">
			<span>Name for a new empty term base</span>
			<input
				class="upload-text-input"
				bind:value={temporarySaveName}
				type="text"
				placeholder="e.g. Approved terminology"
			/>
		</label>
		<DragAndDropHere />
		<div class="upload-actions">
			<button class="upload-file-button">
				Choose TBX file
				<input
					id="fileInputExcel"
					type="file"
					accept="application/xml, .tbx"
					oninput={handleTbxFileUpload}
				/>
			</button>
			<button
				class="upload-secondary-button"
				disabled={temporarySaveName.length === 0}
				onclick={saveNewTbx}>Create empty TB</button
			>
		</div>
	</div>
{:else}
	<div class="upload-overwrite">
		<p class="upload-overwrite-message">
			A term base with the same identifier already exists.
		</p>
		<button
			class="upload-danger-button"
			onclick={() => updateExistingProjectWithTbxFile()}
		>
			Replace existing term base
		</button>
		<button class="upload-secondary-button" onclick={() => cancelOverwrite()}>
			Cancel
		</button>
	</div>
{/if}
