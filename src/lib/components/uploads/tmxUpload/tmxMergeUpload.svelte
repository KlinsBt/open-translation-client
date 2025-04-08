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
	} from "$lib/functions/saveData/indexedDb";

	let isDragging = $state(false);

	let extractedTmxData: TmData | null = $state(null);
	let combinedTmxData: TmData = { name: "Merged TMX", terms: [] };

	function handleTmxFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

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
						// console.log("tmxFile: ", tmxFile);
						if (!validateTmxFile(tmxFile)) throw Error;

						extractedTmxData = extractTmxData(tmxFile);
						// console.log("tmxData: ", extractedTmxData);
						if (!extractedTmxData) throw Error;
						return showLoading.set(false);
					}
				} catch (error) {
					alert("Invalid TMX file or has not at least two language pairs");
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
							// console.log("tmxData: ", extractedTmxData);
							if (!extractedTmxData) return;
							return showLoading.set(false);
						}
					} catch (error) {
						alert("Invalid TMX file or has not at least two language pairs");
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

	async function mergeTmxFiles() {
		let part1 = JSON.parse(JSON.stringify($singleTmData));
		let part2 = JSON.parse(JSON.stringify(extractedTmxData));
		combinedTmxData.terms.push(...part1.terms, ...part2.terms);
		console.log("Merged data: ", combinedTmxData);
	}

	async function createNewProjectWithTmxFile() {
		await mergeTmxFiles();
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
		Upload another TMX file to merge with this current Translation Memory
		crreating a new file with all Translation Units from the uploaded TMX file
		and this selected TMX file.
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
