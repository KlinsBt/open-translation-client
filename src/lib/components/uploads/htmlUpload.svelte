<script lang="ts">
	// For local storage use
	// import { saveAndOpenNewFileWithStringArray } from "$lib/functions/createNewTranslationOnLocalStorage";

	// For indexedDB use
	import { saveAndOpenNewFileWithStringArray } from "$lib/functions/createNewTranslationOnIndexedDb";
	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";

	import { createHtmlFromModifiedText } from "$lib/functions/outputGeneration/outputGenerationHtml";
	import {
		userData,
		translationIdSelected,
		showLoading,
	} from "$lib/functions/saveData/stores.svelte";

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
			extractedText = extractTextFromHtml(originalHtmlContent);
			console.log("Extracted Text:", extractedText);
		}
	}

	// Extract text nodes and attribute values from the HTML content
	function extractTextFromHtml(htmlContent: string): string[] {
		const parser = new DOMParser();
		const doc = parser.parseFromString(htmlContent, "text/html");
		const textArray: string[] = [];

		// Recursive function to extract text content and relevant attributes
		function extractTextNodes(element: Node) {
			if (element.nodeType === Node.TEXT_NODE) {
				const text = element.textContent?.trim();
				if (text) {
					textArray.push(text);
				}
			} else if (element.nodeType === Node.ELEMENT_NODE) {
				const el = element as HTMLElement;
				const attributesToCheck = ["placeholder", "value", "alt", "title"];
				attributesToCheck.forEach((attr) => {
					const attrValue = el.getAttribute(attr);
					if (attrValue && attrValue.trim()) {
						textArray.push(attrValue.trim());
					}
				});
				element.childNodes.forEach((child) => extractTextNodes(child));
			}
		}

		extractTextNodes(doc.body);
		return textArray;
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
				extractedText = extractTextFromHtml(originalHtmlContent);
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
</style>
