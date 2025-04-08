<script lang="ts">
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { TbData } from "$lib/types/types";
	import { extractTbxData, validateTbxFile } from "./tbxFileFunctions";
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

	let temporarySaveName: string = $state("");

	let isDragging = $state(false);

	let sameIdTbData: TbData | null = null;
	let extractedTbxData: TbData | null = $state(null);
	let tbxDataIdExists: boolean = $state(false);

	function handleTbxFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		showLoading.update((v) => true);

		if (file && file.name.includes(".tbx")) {
			const reader = new FileReader();

			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						const parser = new DOMParser();
						const tbxFile = parser.parseFromString(
							e.target.result as string,
							"application/xml",
						);
						console.log("tbxFile: ", tbxFile);
						if (!validateTbxFile(tbxFile)) throw Error;

						extractedTbxData = extractTbxData(tbxFile);
						console.log("tbxData: ", extractedTbxData);
						if (!extractedTbxData) throw Error;

						if (extractedTbxData) {
							if (checkIfIdExists(extractedTbxData.id)) {
								console.log("ID is already defined.");
								tbxDataIdExists = true;
								return showLoading.set(false);
							} else {
								alert("New TBX file created");
								createNewProjectWithTbxFile().then(() => {
									showLoading.set(false);
								});
							}
						}
					}
				} catch (error) {
					alert("Invalid TBX file");
					console.error("Invalid TBX file", error);
					showLoading.set(false);
				}
			};
			reader.readAsText(file);
		} else {
			alert("Please upload a valid TBX file");
			console.error("Please upload a valid TBX file");
			showLoading.set(false);
		}
	}

	function checkIfIdExists(id: number | undefined): boolean {
		if (!id) return false;
		const singleData: TbData | undefined = $tbData.find((d) => d.id === id);
		console.log("singleData: ", singleData);
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

	async function handleDrop(event: DragEvent): Promise<void> {
		event.preventDefault();
		isDragging = false;
		showLoading.update((v) => true);

		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;

		if (file) {
			const fileName = file.name.toLowerCase();
			if (fileName.endsWith(".tbx")) {
				const reader = new FileReader();
				reader.onload = (e: ProgressEvent<FileReader>) => {
					try {
						if (e.target?.result) {
							const parser = new DOMParser();
							const tbxFile = parser.parseFromString(
								e.target.result as string,
								"application/xml",
							);
							if (!validateTbxFile(tbxFile)) throw Error;

							extractedTbxData = extractTbxData(tbxFile);
							if (!extractedTbxData) throw Error;
							console.log("tbxData: ", extractedTbxData);
							// if (!extractedTbxData) return showLoading.set(false);

							if (extractedTbxData) {
								if (checkIfIdExists(extractedTbxData.id)) {
									console.log("ID is already defined.");
									tbxDataIdExists = true;
									return showLoading.set(false);
								} else {
									alert("New TBX file created");
									createNewProjectWithTbxFile().then(() => {
										showLoading.set(false);
									});
								}
							}
						}
					} catch (error) {
						alert("Invalid TBX file");
						console.error("Invalid TBX file", error);
						showLoading.set(false);
					}
				};
				reader.readAsText(file);
			} else {
				alert("Please drop a valid TBX file");
				console.error("Please drop a valid TBX file");
				showLoading.set(false);
			}
		} else {
			console.error("No file dropped");
			showLoading.set(false);
		}
	}

	async function createNewProjectWithTbxFile() {
		showLoading.set(true);
		if (!extractedTbxData) return;
		let tb: TbData = JSON.parse(JSON.stringify(extractedTbxData));
		console.log("New TB: ", tb);
		delete tb.id;
		await saveNewTbToIndexedDB(tb);
		const updatedTbData = await loadTbDataFromIndexedDB();
		const newTb = updatedTbData[updatedTbData.length - 1];
		console.log("Newly saved TB:", newTb);
		singleTbData.set(newTb);
		tbIdSelected.set(newTb.id!);
		editTb.set(true);
		showTbxModal.set(false);
		// showLoading.set(false);
	}

	function updateExistingProjectWithTbxFile() {
		showLoading.set(true);
		if (!extractedTbxData) return;
		updateTbOnIndexedDB(extractedTbxData);
		singleTbData.set(extractedTbxData);
		editTb.set(true);
		showTbxModal.set(false);
		tbxDataIdExists = false;
		showLoading.set(false);
	}

	function cancelOverwrite() {
		tbxDataIdExists = false;
	}

	async function saveNewTbx() {
		let tempTb: TbData = {
			// id: 1,
			name: temporarySaveName,
			entries: [
				{
					// id: 1,
					terms: [
						{
							lang: "",
							term: "",
							notes: [""],
						},
					],
				},
			],
		};

		showLoading.set(true);

		try {
			await saveNewTbToIndexedDB(tempTb);
			const updatedTbData = await loadTbDataFromIndexedDB();
			const newTb = updatedTbData[updatedTbData.length - 1];
			singleTbData.set(newTb);
			console.log("Newly saved TB:", newTb);
			tbIdSelected.set(newTb.id!);
			editTb.set(true);
			showTbxModal.set(false);
		} catch (error) {
			console.error("Error saving TB:", error);
		} finally {
			showLoading.set(false);
			temporarySaveName = "";
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if !tbxDataIdExists}
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
				placeholder="TBX File Name"
			/>
		</div>
		<DragAndDropHere />
		<button class="input-button-container">
			Upload TBX File
			<input
				id="fileInputExcel"
				type="file"
				accept="application/xml, .tbx"
				oninput={handleTbxFileUpload}
			/>
		</button>
		{#if temporarySaveName.length === 0}
			<button class="create-button-container" disabled>Create New TB +</button>
		{:else}
			<button class="create-button-container" onclick={saveNewTbx}
				>Create New TB +</button
			>
		{/if}
	</div>
{:else}
	<div class="container-2">
		<p>A TBX file with the same id was found!</p>
		<button
			class="input-button-container"
			onclick={() => updateExistingProjectWithTbxFile()}
		>
			Overwrite TBX File
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
