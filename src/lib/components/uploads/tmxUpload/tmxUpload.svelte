<script lang="ts">
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { TmData } from "$lib/types/types";
	import { extractTmxData, validateTmxFile } from "./tmxFileFunctions";
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

	let temporarySaveName: string = $state("");

	let isDragging = $state(false);

	let sameIdTmData: TmData | null = null;
	let extractedTmxData: TmData | null = $state(null);
	let tmxDataIdExists: boolean = $state(false);

	function handleTmxFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		showLoading.update((v) => true);

		if (file && file.name.includes(".tmx")) {
			const reader = new FileReader();

			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						const parser = new DOMParser();
						const tmxFile = parser.parseFromString(
							e.target.result as string,
							"application/xml",
						);
						console.log("tmxFile: ", tmxFile);
						if (!validateTmxFile(tmxFile)) throw Error;

						extractedTmxData = extractTmxData(tmxFile);
						console.log("tmxData: ", extractedTmxData);
						if (!extractedTmxData) throw Error;

						if (extractedTmxData && extractedTmxData.id !== undefined) {
							if (checkIfIdExists(extractedTmxData.id)) {
								console.log("ID is already defined.");
								tmxDataIdExists = true;
								return showLoading.set(false);
							} else {
								alert("New TMX file created");
								createNewProjectWithTmxFile().then(() => {
									showLoading.set(false);
								});
							}
						}
					}
				} catch (error) {
					alert("Invalid TMX file");
					console.error("Invalid TMX file", error);
					showLoading.set(false);
				}
			};
			reader.readAsText(file);
		} else {
			alert("Please upload a valid TMX file");
			console.error("Please upload a valid TMX file");
			showLoading.set(false);
		}
	}

	function checkIfIdExists(id: number | undefined): boolean {
		if (!id) return false;
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
		showLoading.update((v) => true);

		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;

		if (file) {
			const fileName = file.name.toLowerCase();
			if (fileName.endsWith(".tmx")) {
				const reader = new FileReader();
				reader.onload = (e: ProgressEvent<FileReader>) => {
					try {
						if (e.target?.result) {
							const parser = new DOMParser();
							const tmxFile = parser.parseFromString(
								e.target.result as string,
								"application/xml",
							);
							if (!validateTmxFile(tmxFile)) throw Error;

							extractedTmxData = extractTmxData(tmxFile);
							if (!extractedTmxData) throw Error;
							console.log("tmxData: ", extractedTmxData);
							if (!extractedTmxData) return showLoading.set(false);

							if (extractedTmxData && extractedTmxData.id !== undefined) {
								if (checkIfIdExists(extractedTmxData.id)) {
									console.log("ID is already defined.");
									tmxDataIdExists = true;
									return showLoading.set(false);
								} else {
									alert("New TMX file created");
									createNewProjectWithTmxFile().then(() => {
										showLoading.set(false);
									});
								}
							}
						}
					} catch (error) {
						alert("Invalid TMX file");
						console.error("Invalid TMX file", error);
						showLoading.set(false);
					}
				};
				reader.readAsText(file);
			} else {
				alert("Please drop a valid TMX file");
				console.error("Please drop a valid TMX file");
				showLoading.set(false);
			}
		} else {
			console.error("No file dropped");
			showLoading.set(false);
		}
	}

	async function createNewProjectWithTmxFile() {
		showLoading.set(true);
		if (!extractedTmxData) return;
		let tm: TmData = JSON.parse(JSON.stringify(extractedTmxData));
		console.log("new tm: ", tm);
		delete tm.id;
		await saveNewTmToIndexedDB(tm);
		const updatedTmData = await loadTmDataFromIndexedDB();
		const newTm = updatedTmData[updatedTmData.length - 1];
		console.log("Newly saved TM:", newTm);
		singleTmData.set(newTm);
		tmIdSelected.set(newTm.id!);
		editTm.set(true);
		showTmxModal.set(false);
		// showLoading.set(false);
	}

	function updateExistingProjectWithTmxFile() {
		showLoading.set(true);
		if (!extractedTmxData) return;
		updateTmOnIndexedDB(extractedTmxData);
		singleTmData.set(extractedTmxData);
		editTm.set(true);
		showTmxModal.set(false);
		tmxDataIdExists = false;
		showLoading.set(false);
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
			console.log("Newly saved TM:", newTm);
			tmIdSelected.set(newTm.id!);
			editTm.set(true);
			showTmxModal.set(false);
		} catch (error) {
			console.error("Error saving TM:", error);
		} finally {
			showLoading.set(false);
			temporarySaveName = "";
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if !tmxDataIdExists}
	<div
		class="container"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		class:is-dragging={isDragging}
	>
		<div class="name-container">
			<input
				class="input-text"
				bind:value={temporarySaveName}
				type="text"
				placeholder="TMX File Name"
			/>
		</div>
		<DragAndDropHere />
		<button class="input-button-container">
			Upload TMX File
			<input
				id="fileInputExcel"
				type="file"
				accept="application/xml, .tmx"
				oninput={handleTmxFileUpload}
			/>
		</button>
		{#if temporarySaveName.length === 0}
			<button class="create-button-container" disabled>Create New TM +</button>
		{:else}
			<button class="create-button-container" onclick={saveNewTmx}
				>Create New TM +</button
			>
		{/if}
	</div>
{:else}
	<div class="container-2">
		<p>A TMX file with the same id was found!</p>
		<button
			class="input-button-container"
			onclick={() => updateExistingProjectWithTmxFile()}
		>
			Overwrite TMX File
		</button>
		<button class="input-button-container" onclick={() => cancelOverwrite()}>
			Cancel
		</button>
	</div>
{/if}

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

	.name-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		margin: 10px 0px 25px 0px;
	}

	.name-container > .input-text {
		width: 215px;
		margin: 0px;
		padding: 5px 10px;
		border-radius: 5px;
		color: var(--color-theme-5);
		border: 1px solid var(--color-theme-1);
		font-size: 0.8rem;
	}

	.name-container > .input-text:active {
		border-color: var(--color-theme-1);
	}

	.input-button-container,
	.create-button-container {
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

	.input-button-container:hover,
	.create-button-container:hover {
		filter: brightness(1.1);
	}

	.input-button-container:active,
	.create-button-container:active {
		filter: brightness(1);
		transform: scale(0.99);
	}

	.create-button-container {
		background: var(--color-theme-9);
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

	.container-2 {
		display: grid;
		align-items: center;
		justify-items: center;
		gap: 0px;
		border-radius: 5px;
		padding: 5px 20px;
		transition: background-color 0.3s;
		max-width: 270px;
	}

	.container-2 > p {
		font-size: 1rem;
		font-weight: 600;
		max-width: 250px;
		text-align: center;
		background-color: rgb(255, 218, 95);
		background-color: var(--color-theme-1);
		color: var(--color-theme-5);
		padding: 10px;
		border-radius: 5px;
	}

	.container-2 > button {
		margin: 5px 0px;
	}

	.container-2 > button:nth-child(2) {
		background-color: limegreen;
	}

	.container-2 > button:nth-child(3) {
		background-color: #c02b2b;
	}
</style>
