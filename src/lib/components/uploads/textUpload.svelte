<script lang="ts">
	// For local storage use
	// import { saveAndOpenNewFileWithTextString } from "$lib/functions/createNewTranslationOnLocalStorage";

	// For indexedDB use
	import { saveAndOpenNewFileWithTextString } from "$lib/functions/saveTranslationOnIndexedDb";

	import { generateTextTranslation } from "$lib/functions/outputGeneration/outputGenerationText";
	import { translationIdSelected } from "$lib/functions/saveData/stores.svelte";
	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";

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
			notifyError("Please only use one input method");
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
		margin: 0px 0px 25px 0px;
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

	textarea {
		height: 70px;
		margin: 0px;
		resize: vertical;
		width: 250px;
		margin: 0px 0px 10px 0px;
		padding: 5px 10px;
		border-radius: 5px;
		color: var(--color-theme-5);
		border: 1px solid var(--color-theme-1);
		font-size: 0.8rem;
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
