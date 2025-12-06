<script lang="ts">
	// For local storage use
	// import { saveAndOpenNewFileWithStringArray } from "$lib/functions/createNewTranslationOnLocalStorage";

	// For indexedDB use
	import { saveAndOpenNewFileWithStringArray } from "$lib/functions/saveTranslationOnIndexedDb";

	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import JSZip from "jszip";
	import { segmentWorkbookStrings } from "$lib/functions/parsing/parsingXlsx";
	import { notifySuccess } from "$lib/components/notifications/toastStore";

	// let excelFile: File | null = null;

	let temporarySaveName: string = "";
	let extractedStrings: string[] = [];
	let isDragging = false;
	let sourceLanguage = "";
	let targetLanguage = "";
	let extractedXmlContent: { [key: string]: string | Blob } = {};

	// Handle file upload and extract the XML structure
	async function handleFileUpload(event: Event) {
		event.preventDefault();
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		if (file) {
			try {
				console.log("File Type: ", file.type);
				// showLoading.set(true);
				const arrayBuffer = await file.arrayBuffer();
				await extractXmlStructure(arrayBuffer);
				// showLoading.set(false);
			} catch (error) {
				console.log(error);
			}
		}
	}

	// Extract the XML files from the .xlsx file and save them as strings
	async function extractXmlStructure(arrayBuffer: ArrayBuffer): Promise<void> {
		const zip = new JSZip();
		const content = await zip.loadAsync(arrayBuffer);

		// Iterate through all files and store relevant XML or media files in extractedXmlContent
		for (const filePath in content.files) {
			const zipEntry = content.files[filePath];

			if (filePath.startsWith("xl/media")) {
				const fileContent = await zipEntry.async("blob");
				extractedXmlContent[filePath] = fileContent;
				continue;
			}

			const fileContent = await zipEntry.async("string");
			extractedXmlContent[filePath] = fileContent;
		}

		// Log the presence of critical relationship files
		if (extractedXmlContent["_rels/.rels"]) {
			console.log(
				"Included _rels/.rels file:",
				extractedXmlContent["_rels/.rels"],
			);
		} else {
			console.warn("_rels/.rels file not found!");
		}

		if (extractedXmlContent["xl/_rels/workbook.xml.rels"]) {
			console.log(
				"Included xl/_rels/workbook.xml.rels file:",
				extractedXmlContent["xl/_rels/workbook.xml.rels"],
			);
		} else {
			console.warn("xl/_rels/workbook.xml.rels file not found!");
		}

		// Build combined segments from shared strings + inline strings across all sheets
		const { allSegments } = segmentWorkbookStrings(extractedXmlContent);
		extractedStrings = allSegments;
		console.log("All extracted strings:", extractedStrings);
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(): void {
		isDragging = false;
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		// Access the file directly from the drag event's dataTransfer object
		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;
		if (file) {
			try {
				console.log("File Type: ", file.type);
				// showLoading.set(true);
				const arrayBuffer = await file.arrayBuffer();
				await extractXmlStructure(arrayBuffer);
				// showLoading.set(false);
			} catch (error) {
				console.log(error);
			}
		}
		console.log(extractedStrings);
		console.log(temporarySaveName);
		console.log(sourceLanguage);
		console.log(targetLanguage);
	}

	function check(opt: number, lang: string) {
		if (opt === 1) {
			console.log("source");
			sourceLanguage = lang;
			console.log(sourceLanguage);
		} else {
			console.log("target");
			targetLanguage = lang;
			console.log(targetLanguage);
		}
	}

	function createNewProject() {
		let timestamp = new Date().valueOf().toString();
		saveAndOpenNewFileWithStringArray(
			temporarySaveName,
			sourceLanguage,
			targetLanguage,
			timestamp,
			extractedStrings,
			"xlsx",
			extractedXmlContent,
		);
		notifySuccess("Project created");
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
	<div class="name-container">
		<input
			class="input-text"
			bind:value={temporarySaveName}
			type="text"
			placeholder="Project Name"
		/>
	</div>

	<div class="language-selection">
		<select onchange={(e) => check(1, (e.target as HTMLSelectElement).value)}>
			<option disabled selected value="">Source Language ▼</option>
			{#each LANGUAGES as lang}
				<option value={lang.name + " (" + lang.code + ")"}
					>{lang.name} ({lang.code})</option
				>
			{/each}
		</select>

		<select onchange={(e) => check(2, (e.target as HTMLSelectElement).value)}>
			<option disabled selected value="">Target Language ▼</option>
			{#each LANGUAGES as lang}
				<option value={lang.name + " (" + lang.code + ")"}
					>{lang.name} ({lang.code})</option
				>
			{/each}
		</select>
	</div>

	{#if extractedStrings.length === 0 || temporarySaveName.length === 0 || sourceLanguage.length === 0 || targetLanguage.length === 0}
		<DragAndDropHere />
		<button class="input-button-container">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				xmlns:xlink="http://www.w3.org/1999/xlink"
				version="1.1"
				id="Capa_1"
				viewBox="0 0 26 26"
				xml:space="preserve"
			>
				<g>
					<path
						d="M25.162,3H16v2.984h3.031v2.031H16V10h3v2h-3v2h3v2h-3v2h3v2h-3v3h9.162   C25.623,23,26,22.609,26,22.13V3.87C26,3.391,25.623,3,25.162,3z M24,20h-4v-2h4V20z M24,16h-4v-2h4V16z M24,12h-4v-2h4V12z M24,8   h-4V6h4V8z"
					/>
					<path
						d="M0,2.889v20.223L15,26V0L0,2.889z M9.488,18.08l-1.745-3.299c-0.066-0.123-0.134-0.349-0.205-0.678   H7.511C7.478,14.258,7.4,14.494,7.277,14.81l-1.751,3.27H2.807l3.228-5.064L3.082,7.951h2.776l1.448,3.037   c0.113,0.24,0.214,0.525,0.304,0.854h0.028c0.057-0.198,0.163-0.492,0.318-0.883l1.61-3.009h2.542l-3.037,5.022l3.122,5.107   L9.488,18.08L9.488,18.08z"
					/>
				</g>
			</svg>
			Upload XLSX File
			<input
				id="fileInputExcel"
				type="file"
				accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				oninput={handleFileUpload}
			/>
		</button>
	{:else}
		<button class="create-button-container" onclick={createNewProject}>
			Create Project +
		</button>
	{/if}

	<!-- <button
		onclick={() =>
			createXlsxFromModifiedXmlText(
				$userData[$translationIdSelected].typeRef,
				$userData[$translationIdSelected].seg2,
				$userData[$translationIdSelected].name,
			)}
	>
		Download Translation in Xlsx Format
	</button> -->
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

	.name-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		margin: 10px 0px 25px 0px;
	}

	.name-container > .input-text {
		width: 250px;
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

	.language-selection {
		display: flex;
		justify-content: space-evenly;
		gap: 0px 10px;
		margin: 0px 0px 10px 0px;
		width: 100%;
	}

	select {
		position: relative;
		width: 100%;
		padding: 5px;
		border-radius: 5px;
		border: 1px solid var(--color-theme-1);
		color: var(--color-theme-5);
		font-size: 0.8rem;
		appearance: none;
		cursor: pointer;
		transition:
			border-color 0.3s,
			background-color 0.3s;
	}

	select:focus {
		border-color: var(--color-theme-3);
		outline: none;
	}

	option {
		width: 100px;
		padding: 10px 0px;
		background-color: var(--color-theme-8);
		color: var(--color-theme-5);
	}

	option:hover {
		background-color: var(--color-theme-2);
		color: white;
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

	.input-button-container > svg {
		max-width: 30px;
		max-height: 30px;
		margin-right: 10px;
	}

	.input-button-container > svg path {
		fill: white;
	}
</style>
