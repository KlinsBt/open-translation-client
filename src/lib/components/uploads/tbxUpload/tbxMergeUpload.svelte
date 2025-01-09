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
	} from "$lib/functions/saveData/indexedDb";

	let isDragging = $state(false);

	let extractedTbxData: TbData | null = $state(null);
	let combinedTbxData: TbData = { name: "Merged TBX", entries: [] };

	function handleTbxFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

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
						// console.log("tbxFile: ", tbxFile);
						if (!validateTbxFile(tbxFile)) throw Error;

						extractedTbxData = extractTbxData(tbxFile);
						// console.log("tbxData: ", extractedTbxData);
						if (!extractedTbxData) throw Error;
						return showLoading.set(false);
					}
				} catch (error) {
					alert("Invalid TBX file");
					console.error("Invalid TBX file", error);
					return showLoading.set(false);
				}
			};
			reader.readAsText(file);
		} else {
			alert("Please upload a valid TBX file");
			console.error("Please upload a valid TBX file");
			return showLoading.set(false);
		}
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
							// console.log("tbxData: ", extractedTbxData);
							if (!extractedTbxData) return;
							return showLoading.set(false);
						}
					} catch (error) {
						alert("Invalid TBX file");
						console.error("Invalid TBX file", error);
						return showLoading.set(false);
					}
				};
				reader.readAsText(file);
			} else {
				alert("Please drop a valid TBX file");
				console.error("Please drop a valid TBX file");
				return showLoading.set(false);
			}
		} else {
			console.error("No file dropped");
			return showLoading.set(false);
		}
	}

	async function mergeTbxFiles() {
		let part1 = JSON.parse(JSON.stringify($singleTbData));
		let part2 = JSON.parse(JSON.stringify(extractedTbxData));
		combinedTbxData.entries.push(...part1.entries, ...part2.entries);
		console.log("Merged data: ", combinedTbxData);
	}

	async function createNewProjectWithTbxFile() {
		await mergeTbxFiles();
		showLoading.set(true);
		if (combinedTbxData.entries.length === 0) return;
		// console.log("new tb: ", combinedTbxData);
		await saveNewTbToIndexedDB(combinedTbxData);
		const updatedTbData = await loadTbDataFromIndexedDB();
		const newTb = updatedTbData[updatedTbData.length - 1];
		// console.log("Newly saved TB:", newTb);
		singleTbData.set(newTb);
		tbIdSelected.set(newTb.id!);
		editTb.set(true);
		showTbxModal.set(false);
		showLoading.set(false);
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
		Upload another TBX file to merge with this current Terminology Database.
		crreating a new file with all Term Units from the uploaded TBX file and this
		selected TBX file.
	</p>
	<DragAndDropHere />
	{#if extractedTbxData === null || extractedTbxData === undefined}
		<button class="input-button-container">
			Upload TBX File To Merge
			<input
				id="fileInputExcel"
				type="file"
				accept="application/xml, .tbx"
				oninput={handleTbxFileUpload}
			/>
		</button>
	{:else}
		<button
			class="input-button-container save"
			onclick={() => createNewProjectWithTbxFile()}
		>
			Merge TBX Files
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
