<script lang="ts">
	import {
		saveAndOpenNewFileWithStringArray,
		saveAndOpenNewFileWithStringArrayFromSaveFile,
		updateAndOpenNewFileWithStringArray,
	} from "$lib/functions/saveTranslationOnIndexedDb.js";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { UserData } from "$lib/types/types.js";
	import { userData, showLoading } from "$lib/functions/saveData/stores.svelte";
	import {
		validateJsonData,
		validateXliff2_0Data,
		extractXliff2_0Data,
		validateXliff1_2Data,
		extractXliff1_2Data,
		getXliffVersion,
	} from "./saveFileFunctions.js";
	import { setLoadingAndRender } from "$lib/functions/uiHelpers";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";

	let isDragging = $state(false);

	let sameIdProject: UserData | null = null;
	let saveData: UserData | null = null;
	let saveFileIdExists: boolean = $state(false);

	async function handleTranslationFileUpload(event: Event): Promise<void> {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

		if (file && file.type === "application/json") {
			const reader = new FileReader();
			await setLoadingAndRender();

			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						const parsedData = JSON.parse(e.target.result as string);
						if (validateJsonData(parsedData)) {
							saveData = parsedData;
							console.log("saveData: ", saveData);
							if (checkIfUniqueId(parsedData.id)) {
								console.log("ID is already defined.");
								showLoading.set(false);
								return (saveFileIdExists = true);
							} else {
								notifySuccess("New project created");
								createNewProjectWithSaveFile();
							}
						} else {
							notifyError("Invalid JSON file");
							console.error("Invalid JSON structure");
							showLoading.set(false);
						}
					}
				} catch (error) {
					notifyError("Invalid JSON file");
					console.error("Invalid JSON file", error);
					showLoading.set(false);
				}
			};
			reader.readAsText(file);
		} else if (file && file.name.includes(".xliff")) {
			const reader = new FileReader();

			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						const parser = new DOMParser();
						const xliffDocument = parser.parseFromString(
							e.target.result as string,
							"application/xml",
						);
						let version = getXliffVersion(xliffDocument);
						if (version === 1.2) {
							let withMetaData = validateXliff1_2Data(xliffDocument);
							saveData = extractXliff1_2Data(xliffDocument, withMetaData);
							console.log("xliffData: ", saveData);
							if (!saveData) return;
							if (checkIfUniqueId(saveData.id!)) {
								console.log("ID is already defined.");
								showLoading.set(false);
								return (saveFileIdExists = true);
							} else {
								notifySuccess("New project created");
								createNewProjectWithSaveFile();
							}
							showLoading.set(false);
						} else if (version >= 2.0) {
							let withMetaData = validateXliff2_0Data(xliffDocument);
							saveData = extractXliff2_0Data(xliffDocument, withMetaData);
							console.log("xliffData: ", saveData);
							if (!saveData) return;
							if (checkIfUniqueId(saveData.id!)) {
								console.log("ID is already defined.");
								showLoading.set(false);
								return (saveFileIdExists = true);
							} else {
								notifySuccess("New project created");
								createNewProjectWithSaveFile();
							}
							showLoading.set(false);
						}
					}
				} catch (error) {
					notifyError("Invalid XLIFF file");
					console.error("Invalid XLIFF file", error);
					showLoading.set(false);
				}
			};
			reader.readAsText(file);
		} else {
			notifyError("Please upload a valid JSON or XLIFF file");
			console.error("Please upload a valid JSON or XLIFF file");
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
		await setLoadingAndRender();

		if (file) {
			const fileName = file.name.toLowerCase();
			if (fileName.endsWith(".json")) {
				// Handle JSON
				const reader = new FileReader();
				reader.onload = (e: ProgressEvent<FileReader>) => {
					try {
						if (e.target?.result) {
							const parsedData = JSON.parse(e.target.result as string);
							if (validateJsonData(parsedData)) {
								saveData = parsedData;
								console.log("data: ", saveData);
								if (checkIfUniqueId(parsedData.id)) {
									console.log("ID is already defined.");
									showLoading.set(false);
									return (saveFileIdExists = true);
								} else {
									notifySuccess("New project created");
									createNewProjectWithSaveFile();
								}
								showLoading.set(false);
							} else {
								notifyError("Invalid JSON file");
								console.error("Invalid JSON structure");
								showLoading.set(false);
							}
						}
					} catch (error) {
						console.error("Invalid JSON file", error);
						showLoading.set(false);
					}
				};
				reader.readAsText(file);
			} else if (fileName.endsWith(".xlf") || fileName.endsWith(".xliff")) {
				// Handle XLIFF
				const reader = new FileReader();
				reader.onload = (e: ProgressEvent<FileReader>) => {
					try {
						if (e.target?.result) {
							const parser = new DOMParser();
							const xliffDocument = parser.parseFromString(
								e.target.result as string,
								"application/xml",
							);
							let version = getXliffVersion(xliffDocument);
							if (version === 1.2) {
								let withMetaData = validateXliff1_2Data(xliffDocument);
								saveData = extractXliff1_2Data(xliffDocument, withMetaData);
								console.log("xliffData: ", saveData);
								if (!saveData) return;
								if (checkIfUniqueId(saveData.id!)) {
									console.log("ID is already defined.");
									showLoading.set(false);
									return (saveFileIdExists = true);
								} else {
									notifySuccess("New project created");
									createNewProjectWithSaveFile();
								}
								showLoading.set(false);
							} else if (version >= 2.0) {
								let withMetaData = validateXliff2_0Data(xliffDocument);
								saveData = extractXliff2_0Data(xliffDocument, withMetaData);
								console.log("xliffData: ", saveData);
								if (!saveData) return;
								if (checkIfUniqueId(saveData.id!)) {
									console.log("ID is already defined.");
									showLoading.set(false);
									return (saveFileIdExists = true);
								} else {
									notifySuccess("New project created");
									createNewProjectWithSaveFile();
								}
								showLoading.set(false);
							}
						}
					} catch (error) {
						notifyError("Invalid XLIFF file");
						console.error("Invalid XLIFF file", error);
						showLoading.set(false);
					}
				};
				reader.readAsText(file);
			} else {
				notifyError("Please drop a valid JSON or XLIFF file");
				console.error("Please drop a valid JSON or XLIFF file");
				showLoading.set(false);
			}
		} else {
			console.error("No file dropped");
			showLoading.set(false);
		}
	}

	function createNewProjectWithSaveFile() {
		if (!saveData) return;
		let data: UserData = JSON.parse(JSON.stringify(saveData));
		delete data.id;
		saveAndOpenNewFileWithStringArrayFromSaveFile($userData, data);
		showLoading.set(false);
	}

	function updateExistingProjectWithSaveFile() {
		const timestamp = new Date().valueOf().toString();
		if (!saveData) return;
		saveData.translationData.creationDate = timestamp;
		updateAndOpenNewFileWithStringArray(saveData);
		showLoading.set(false);
	}

	function checkIfUniqueId(id: number): boolean {
		let singleData: UserData = $userData.find((d) => d.id === id) as UserData;
		sameIdProject = singleData;
		if (singleData) {
			return true;
		} else {
			return false;
		}
	}

	function cancelOverwrite() {
		saveFileIdExists = false;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
{#if !saveFileIdExists}
	<div
		class="container"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		class:is-dragging={isDragging}
	>
		<p>
			Formats:
			<br />
			<span>JSON</span>
			<br />
			<span>XLIFF 1.2</span>
			<br />
			<span>XLIFF 2.0</span>
		</p>
		<DragAndDropHere />
		<button class="input-button-container">
			Upload Save File
			<input
				id="fileInput"
				type="file"
				accept="application/json, application/xml, .json, .xliff"
				oninput={handleTranslationFileUpload}
			/>
		</button>
	</div>
{:else}
	<div class="container-2">
		<p>A save file with the same id was found!</p>
		<button
			class="input-button-container"
			onclick={() => updateExistingProjectWithSaveFile()}
		>
			Overwrite Save File
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

	.container > p {
		font-size: 15px;
		max-width: 250px;
		text-align: left;
	}

	.container > p > span {
		color: var(--color-theme-4);
	}

	.container.is-dragging {
		background-color: rgba(0, 0, 0, 0.05);
		border-color: var(--color-theme-3);
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
		min-width: 250px;
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
