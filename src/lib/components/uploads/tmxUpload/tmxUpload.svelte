<script lang="ts">
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { TmData } from "$lib/types/types";
	import {
		showLoading,
		tmData,
		singleTmData,
		editTm,
		showTmxModal,
		tmIdSelected,
	} from "$lib/functions/saveData/stores.svelte";
	import {
		loadTmDataFromIndexedDB,
		saveNewTmToIndexedDB,
		updateTmOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";
	import { safeInputMessage } from "$lib/formats/safeInput";
	import { importTmxStreaming } from "$lib/formats/streamingImporters";
	import "$lib/components/uploads/uploadDialog.css";

	let temporarySaveName: string = $state("");

	let isDragging = $state(false);

	let sameIdTmData: TmData | null = null;
	let extractedTmxData: TmData | null = $state(null);
	let tmxDataIdExists: boolean = $state(false);

	async function processTmxFile(file: File | null): Promise<void> {
		showLoading.set(true);
		if (!file || !file.name.toLowerCase().endsWith(".tmx")) {
			notifyError("Please upload a valid TMX file");
			showLoading.set(false);
			return;
		}
		try {
			extractedTmxData = (await importTmxStreaming(file)).data;
			if (!extractedTmxData) throw new Error("No TMX data was found.");
			if (
				extractedTmxData.id !== undefined &&
				checkIfIdExists(extractedTmxData.id)
			) {
				tmxDataIdExists = true;
				return;
			}
			notifySuccess("New TMX file created");
			await createNewProjectWithTmxFile();
		} catch (error) {
			notifyError(safeInputMessage(error));
		} finally {
			showLoading.set(false);
		}
	}

	function handleTmxFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		void processTmxFile(file);
	}

	function checkIfIdExists(id: number | undefined): boolean {
		if (id === undefined) return false;
		const singleData: TmData | undefined = $tmData.find((d) => d.id === id);
		sameIdTmData = singleData || null;
		return !!singleData;
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

	async function createNewProjectWithTmxFile() {
		showLoading.set(true);
		try {
			if (!extractedTmxData) throw new Error("Choose a TMX file first.");
			let tm: TmData = structuredClone(extractedTmxData);
			delete tm.id;
			await saveNewTmToIndexedDB(tm);
			const updatedTmData = await loadTmDataFromIndexedDB();
			const newTm = updatedTmData[updatedTmData.length - 1];
			singleTmData.set(newTm);
			tmIdSelected.set(newTm.id!);
			editTm.set(true);
			showTmxModal.set(false);
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not import the TMX file.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	async function updateExistingProjectWithTmxFile() {
		showLoading.set(true);
		try {
			if (!extractedTmxData) throw new Error("Choose a TMX file first.");
			await updateTmOnIndexedDB(extractedTmxData);
			singleTmData.set(structuredClone(extractedTmxData));
			editTm.set(true);
			showTmxModal.set(false);
			tmxDataIdExists = false;
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not replace this memory.",
			);
		} finally {
			showLoading.set(false);
		}
	}

	function cancelOverwrite() {
		tmxDataIdExists = false;
	}

	async function saveNewTmx() {
		let tempTm: TmData = {
			// id: 1,
			name: temporarySaveName,
			terms: [
				{
					// id: 1,
					source: {
						lang: "en",
						segment: "",
					},
					target: [
						{
							lang: "de",
							segment: "",
						},
					],
				},
			],
		};

		showLoading.set(true);

		try {
			await saveNewTmToIndexedDB(tempTm);
			const updatedTmData = await loadTmDataFromIndexedDB();
			const newTm = updatedTmData[updatedTmData.length - 1];
			singleTmData.set(newTm);
			tmIdSelected.set(newTm.id!);
			editTm.set(true);
			showTmxModal.set(false);
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not create this memory.",
			);
		} finally {
			showLoading.set(false);
			temporarySaveName = "";
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if !tmxDataIdExists}
	<div
		class="upload-surface"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		class:is-dragging={isDragging}
	>
		<div class="upload-guidance">
			<strong>Import a TMX file or create an empty memory</strong>
			<span>Existing language pairs and metadata are retained.</span>
		</div>
		<label class="upload-name-field">
			<span>Name for a new empty memory</span>
			<input
				class="upload-text-input"
				bind:value={temporarySaveName}
				type="text"
				placeholder="e.g. Product translations"
			/>
		</label>
		<DragAndDropHere />
		<div class="upload-actions">
			<button class="upload-file-button">
				Choose TMX file
				<input
					id="fileInputExcel"
					type="file"
					accept="application/xml, .tmx"
					oninput={handleTmxFileUpload}
				/>
			</button>
			<button
				class="upload-secondary-button"
				disabled={temporarySaveName.length === 0}
				onclick={saveNewTmx}>Create empty TM</button
			>
		</div>
	</div>
{:else}
	<div class="upload-overwrite">
		<p class="upload-overwrite-message">
			A translation memory with the same identifier already exists.
		</p>
		<button
			class="upload-danger-button"
			onclick={() => updateExistingProjectWithTmxFile()}
		>
			Replace existing memory
		</button>
		<button class="upload-secondary-button" onclick={() => cancelOverwrite()}>
			Cancel
		</button>
	</div>
{/if}
