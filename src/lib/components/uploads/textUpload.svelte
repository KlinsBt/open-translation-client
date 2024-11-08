<script lang="ts">
	// For local storage use
	// import { saveAndOpenNewFileWithTextString } from "$lib/functions/createNewTranslationOnLocalStorage";

	// For indexedDB use
	import { saveAndOpenNewFileWithTextString } from "$lib/functions/createNewTranslationOnIndexedDb";

	import { generateTextTranslation } from "$lib/functions/outputGeneration/outputGenerationText";
	import { translationIdSelected } from "$lib/functions/saveData/stores.svelte";
	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";

	let outputTextFormat1: boolean = true;

	let temporarySaveName: string = "";
	let fullInputText: string = "";
	let fullText: string = "";
	let isDragging = false;
	let sourceLanguage = "";
	let targetLanguage = "";

	export function handleTextFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

		if (file && file.type === "text/plain") {
			readFileContent(file);
			fullInputText = "";
		} else {
			console.error("Please upload a valid text file");
		}
	}

	function readFileContent(file: File): void {
		const reader = new FileReader();

		reader.onload = (e: ProgressEvent<FileReader>) => {
			try {
				if (e.target?.result) {
					fullText = e.target.result as string;
				}
			} catch (error) {
				console.error("Error reading text file", error);
			}
		};

		reader.readAsText(file);
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(): void {
		isDragging = false;
	}

	function handleDrop(event: DragEvent): void {
		event.preventDefault();
		isDragging = false;

		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;

		if (file && file.type === "text/plain") {
			readFileContent(file);
			fullInputText = "";
		} else {
			console.error("Please drop a valid text file");
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
		if (fullInputText.length > 0 && fullText.length > 0) {
			alert("Please only use one input method");
			return;
		}
		let timestamp = new Date().valueOf().toString();
		saveAndOpenNewFileWithTextString(
			temporarySaveName,
			sourceLanguage,
			targetLanguage,
			timestamp,
			fullInputText.length > 0 ? fullInputText : fullText,
			"text",
		);
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

	{#if fullText.length === 0}
		<textarea
			class="input-text"
			bind:value={fullInputText}
			placeholder="Enter text here or upload a text file"
		></textarea>
	{/if}

	{#if (fullInputText.length === 0 && fullText.length === 0) || temporarySaveName.length === 0 || sourceLanguage.length === 0 || targetLanguage.length === 0}
		<DragAndDropHere />
		<button class="input-button-container">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				xmlns:xlink="http://www.w3.org/1999/xlink"
				version="1.1"
				id="Capa_1"
				viewBox="10 0 80 90"
				xml:space="preserve"
			>
				<g>
					<g>
						<path
							d="M58.596,0H12.255v90.604h66.094v-63.73L54.868,10.66L58.596,0z M35.35,38.153h-6.011v17.835h-4.998V38.153h-5.913v-4.181    
	H35.35V38.153z M57.132,33.972h16.922v4.181h-6.012v17.835h-4.997V38.153h-5.913V33.972z M55.6,33.972l-6.206,10.747l6.533,11.269    
	h-5.75l-1.993-3.984c-0.815-1.536-1.339-2.68-1.959-3.951H46.16c-0.458,1.271-1.014,2.416-1.699,3.951l-1.829,3.984h-5.684    
	l6.369-11.139l-6.141-10.877h5.717l1.928,4.017c0.652,1.34,1.143,2.418,1.665,3.66h0.065c0.522-1.404,0.946-2.385,1.503-3.66    
	l1.861-4.017H55.6z"
						/>
						<polygon points="63.235,0.097 60.216,8.734 78.348,21.254   " />
					</g>
				</g>
			</svg>
			Upload TXT File
			<input
				id="fileInputText"
				type="file"
				accept="text/plain"
				oninput={handleTextFileUpload}
			/>
		</button>
	{:else}
		<button class="create-button-container" onclick={createNewProject}>
			Create Project +
		</button>
	{/if}

	<!-- <button
		onclick={() =>
			generateTextTranslation($translationIdSelected, outputTextFormat1)}
	>
		Download Current Translation
	</button> -->
</div>

<style>
</style>
