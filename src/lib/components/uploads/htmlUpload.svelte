<script lang="ts">
	// For local storage use
	// import { saveAndOpenNewFileWithStringArray } from "$lib/functions/createNewTranslationOnLocalStorage";

	// For indexedDB use
	import { saveAndOpenNewFileWithStringArray } from "$lib/functions/saveTranslationOnIndexedDb";
	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";

	import { createHtmlFromModifiedText } from "$lib/functions/outputGeneration/outputGenerationHtml";
	import { segmentHtmlContent } from "$lib/functions/parsing/parsingHtml";
	import {
		userData,
		translationIdSelected,
		showLoading,
	} from "$lib/functions/saveData/stores.svelte";
	import { notifySuccess } from "$lib/components/notifications/toastStore";

	let htmlFile: File | null = null;
	let temporarySaveName: string = "";
	let isDragging = false;
	let sourceLanguage = "";
	let targetLanguage = "";
	let extractedText: string[] = [];
	let originalHtmlContent: string = "";

	// Handle file upload and extract the HTML content
	async function handleFileUpload(event: Event) {
		const input = event.target as HTMLInputElement;
		if (input.files && input.files[0]) {
			htmlFile = input.files[0];
			originalHtmlContent = await htmlFile.text();
			const { allSegments } = segmentHtmlContent(originalHtmlContent);
			extractedText = allSegments;
			console.log("Extracted Text:", extractedText);
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

		// Access the file directly from the drag event's dataTransfer object
		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;

		if (file && file.type === "text/html") {
			try {
				// Read the HTML file content
				const fileContent = await file.text();
				originalHtmlContent = fileContent;
				const { allSegments } = segmentHtmlContent(originalHtmlContent);
				extractedText = allSegments;
				console.log("Extracted Text:", extractedText);
			} catch (error) {
				console.error("Error reading the HTML file", error);
			}
		} else {
			console.error("Please drop a valid HTML file");
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
			extractedText,
			"html",
			originalHtmlContent,
		);
		showLoading.set(false);
		notifySuccess("Project created");
	}

	// // Function to trigger the HTML download with the updated content
	// async function handleDownloadHtml() {
	// 	if (
	// 		$userData[$translationIdSelected].typeRef &&
	// 		$userData[$translationIdSelected].seg2
	// 	) {
	// 		await createHtmlFromModifiedText(
	// 			$userData[$translationIdSelected].typeRef.toString(),
	// 			$userData[$translationIdSelected].seg2,
	// 			$userData[$translationIdSelected].name,
	// 		);
	// 	} else {
	// 		console.error("No text extracted to generate HTML.");
	// 	}
	// }
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

	{#if extractedText.length === 0 || temporarySaveName.length === 0 || sourceLanguage.length === 0 || targetLanguage.length === 0}
		<DragAndDropHere />
		<button class="input-button-container">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22"
				><path
					d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2 5 5h-5V4zM8.531 18h-.76v-1.411H6.515V18h-.767v-3.373h.767v1.296h1.257v-1.296h.76V18zm3-2.732h-.921V18h-.766v-2.732h-.905v-.641h2.592v.641zM14.818 18l-.05-1.291c-.017-.405-.03-.896-.03-1.387h-.016c-.104.431-.245.911-.375 1.307l-.41 1.316h-.597l-.359-1.307a15.154 15.154 0 0 1-.306-1.316h-.011c-.021.456-.034.976-.059 1.396L12.545 18h-.705l.216-3.373h1.015l.331 1.126c.104.391.21.811.284 1.206h.017c.095-.391.209-.836.32-1.211l.359-1.121h.996L15.563 18h-.745zm3.434 0h-2.108v-3.373h.767v2.732h1.342V18z"
				/></svg
			>
			Upload HTML File
			<input
				id="fileInputHtml"
				type="file"
				accept=".html,text/html"
				oninput={handleFileUpload}
			/>
		</button>
	{:else}
		<button class="create-button-container" onclick={createNewProject}>
			Create Project +
		</button>
	{/if}

	<!-- <button onclick={handleDownloadHtml}> Download Updated HTML File </button> -->
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
