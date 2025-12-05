<script lang="ts">
	// For local storage use
	// import { saveAndOpenNewFileWithStringArray } from "$lib/functions/createNewTranslationOnLocalStorage";

	// For indexedDB use
	import { saveAndOpenNewFileWithStringArray } from "$lib/functions/saveTranslationOnIndexedDb";

	import { createDocxFromModifiedXmlText } from "$lib/functions/outputGeneration/outputGenerationDocx";
	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";

	import { showLoading } from "$lib/functions/saveData/stores.svelte";
	import JSZip from "jszip";
	import { segmentDocxXml } from "$lib/functions/parsing/parsingDocx";

	let wordFile: File | null = null;
	let temporarySaveName: string = "";

	let parsedStringArray: string[] = [];
	let isDragging = false;
	let sourceLanguage = "";
	let targetLanguage = "";
	let extractedXmlContent: { [key: string]: string | Blob } = {};

	// Handle file upload and extract the XML structure
	async function handleFileUpload(event: Event) {
		const inputElement = event.target as HTMLInputElement;
		const wordFile = inputElement.files ? inputElement.files[0] : null;
		if (wordFile) {
			try {
				console.log("File Type: ", wordFile.type);
				const arrayBuffer = await wordFile.arrayBuffer();
				// let xmlFiles = await extractDocxContent(wordFile);
				await extractXmlStructure(arrayBuffer);
			} catch (error) {
				console.log(error);
			}
		}
	}

	// Extract the XML files from the .docx file and save them as strings
	async function extractXmlStructure(arrayBuffer: ArrayBuffer): Promise<void> {
		const zip = new JSZip();
		const content = await zip.loadAsync(arrayBuffer);

		// Iterate through all files and store them in extractedXmlContent
		for (const filePath in content.files) {
			// Get file content as string if it's an XML file or relevant rels file
			// if (
			// 	filePath.endsWith(".xml") ||
			// 	filePath === "_rels/.rels" ||
			// 	filePath === "word/_rels/document.xml.rels"
			// ) {
			if (filePath.startsWith("word/media")) {
				// If the file is an image in the media folder, save it as a blob
				console.log(content.files[filePath]);
				const fileContent = await content.files[filePath].async("blob");
				extractedXmlContent[filePath] = fileContent;
				// console.log(`Saved ${filePath} to IndexedDB as blob`);
				continue;
			}
			const fileContent = await content.files[filePath].async("string");
			extractedXmlContent[filePath] = fileContent;
			// }
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

		if (extractedXmlContent["word/_rels/document.xml.rels"]) {
			console.log(
				"Included word/_rels/document.xml.rels file:",
				extractedXmlContent["word/_rels/document.xml.rels"],
			);
		} else {
			console.warn("word/_rels/document.xml.rels file not found!");
		}

		// Parse text strings from the document.xml file
		const documentXml = extractedXmlContent["word/document.xml"];

		if (documentXml) {
			parsedStringArray = parseTextStringsFromXML(documentXml as string);
		}
	}

	// Parse text strings from the XML string generated from a .docx file
	function parseTextStringsFromXML(xmlDocument: string): string[] {
		const { segments } = segmentDocxXml(xmlDocument);
		const parsedSegments = segments.map(
			(segment) => `${segment.text}${segment.separator ?? ""}`,
		);
		console.log("Extracted text strings:", parsedSegments);
		return parsedSegments;
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
		showLoading.set(true);
		saveAndOpenNewFileWithStringArray(
			temporarySaveName,
			sourceLanguage,
			targetLanguage,
			timestamp,
			parsedStringArray,
			"docx",
			extractedXmlContent,
		);
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

	{#if parsedStringArray.length === 0 || temporarySaveName.length === 0 || sourceLanguage.length === 0 || targetLanguage.length === 0}
		<DragAndDropHere />
		<button class="input-button-container">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 14 13"
				focusable="false"
				aria-hidden="true"
				><path
					d="m 12.999992,2.866331 0,8.273839 c 0,0.0705 -0.025,0.127505 -0.0745,0.173007 -0.0505,0.047 -0.110505,0.069 -0.180008,0.069 l -4.2796751,0 0,-1.147547 3.4911431,0 0,-0.522522 -3.4941432,0 0,-0.639526 3.4911432,0 0,-0.522021 -3.4886431,0 0,-0.645027 3.4901431,0 0,-0.516021 -3.4901431,0 0,-0.646526 3.4901431,0 0,-0.522022 -3.4901431,0 0,-0.639526 3.4901431,0 0,-0.521521 -3.4901431,0 0,-0.652527 3.4901431,0 0,-0.497021 -3.4901431,0 0,-1.296553 4.2811751,0 c 0.0745,0 0.135006,0.024 0.179008,0.0745 0.0525,0.0495 0.075,0.110005 0.0745,0.178008 z m -5.1747123,-1.546064 0,11.361466 -6.82527977,-1.181048 0,-8.967368 6.82527977,-1.21505 0,0.002 z m -1.0300423,3.354138 -0.854535,0.0525 -0.5480225,3.392639 -0.012501,0 C 5.3531783,7.959039 5.2526742,7.397016 5.0726668,6.435977 L 4.7531537,4.80441 3.9511209,4.84441 3.6301077,6.435975 C 3.4426,7.363013 3.3380957,7.902535 3.3105946,8.054041 l -0.0075,0 -0.48752,-3.125128 -0.7350301,0.039 0.7875323,3.941661 0.8170335,0.0525 0.3075126,-1.534063 C 4.1726299,6.527981 4.2776342,6.004959 4.3001352,5.861953 l 0.022501,0 c 0.030501,0.152507 0.1280052,0.687029 0.3075126,1.605066 l 0.3075126,1.579065 0.8850363,0.0525 0.9900406,-4.425181 -0.017501,0 z"
				/></svg
			>
			Upload DOCX File
			<input
				id="fileInputWord"
				type="file"
				accept=".doc,.docx,.xml,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
			createDocxFromModifiedXmlText(
				$userData[$translationIdSelected].typeRef,
				$userData[$translationIdSelected].seg2,
				$userData[$translationIdSelected].name,
			)}
	>
		Download Translation in Docx Format
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
