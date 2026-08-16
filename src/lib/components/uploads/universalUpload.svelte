<script lang="ts">
	import { saveAndOpenNewFileWithStringArray } from "$lib/functions/saveTranslationOnIndexedDb";
	import { saveAndOpenNewFileWithTextString } from "$lib/functions/saveTranslationOnIndexedDb";
	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import { showLoading } from "$lib/functions/saveData/stores.svelte";
	import {
		detectFormat,
		getFormatAcceptValue,
		getFormatAdapter,
		getSupportedFormatLabels,
	} from "$lib/formats/registry";
	import type { FormatId } from "$lib/formats/formatIds";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";

	let {
		show = $bindable(),
	}: {
		show: boolean;
	} = $props();

	let uploadedFile: File | null = $state(null);
	let temporarySaveName: string = $state("");
	let sourceLanguage: string = $state("");
	let targetLanguage: string = $state("");
	let isDragging: boolean = $state(false);
	let detectedFormatId: FormatId | null = $state(null);
	let detectionComplete: boolean = $state(false);
	let isProcessing: boolean = $state(false);
	const acceptedFormats = getFormatAcceptValue();
	const supportedFormatLabels = getSupportedFormatLabels();

	function getDetectedFormatLabel(): string {
		return detectedFormatId
			? getFormatAdapter(detectedFormatId).label
			: "UNSUPPORTED";
	}

	async function selectFile(file: File) {
		uploadedFile = file;
		detectionComplete = false;
		const detected = await detectFormat(file);
		if (uploadedFile !== file) return;
		detectedFormatId = detected?.id ?? null;
		detectionComplete = true;
		temporarySaveName = file.name.replace(/\.[^/.]+$/, "");
	}

	function clearSelectedFile() {
		uploadedFile = null;
		detectedFormatId = null;
		detectionComplete = false;
	}

	async function handleFileSelect(event: Event) {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		if (file) await selectFile(file);
	}

	function handleDragOver(event: DragEvent) {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave() {
		isDragging = false;
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;
		if (file) await selectFile(file);
	}

	function check(opt: number, lang: string) {
		if (opt === 1) {
			sourceLanguage = lang;
		} else {
			targetLanguage = lang;
		}
	}

	async function processAndCreateProject() {
		if (
			!uploadedFile ||
			!detectedFormatId ||
			!sourceLanguage ||
			!targetLanguage
		) {
			notifyError("Please fill all required fields");
			return;
		}

		isProcessing = true;
		showLoading.set(true);

		try {
			const timestamp = new Date().valueOf().toString();
			const adapter = getFormatAdapter(detectedFormatId);
			const validation = await adapter.validate(uploadedFile);
			if (!validation.valid) {
				throw new Error(validation.reason ?? `Invalid ${adapter.label} file.`);
			}

			const imported = await adapter.importFile(uploadedFile);
			if (imported.kind === "text") {
				await saveAndOpenNewFileWithTextString(
					temporarySaveName,
					sourceLanguage,
					targetLanguage,
					timestamp,
					imported.text,
					adapter.id,
					imported.typeRef,
					imported.document,
				);
			} else {
				await saveAndOpenNewFileWithStringArray(
					temporarySaveName,
					sourceLanguage,
					targetLanguage,
					timestamp,
					imported.segments,
					adapter.id,
					imported.typeRef,
					imported.segmentsMeta,
					imported.document,
				);
			}

			notifySuccess("Project created");
			show = false;
			resetForm();
		} catch (error) {
			console.error("Error processing file:", error);
			notifyError("Error processing file. Please try again.");
		} finally {
			isProcessing = false;
			showLoading.set(false);
		}
	}

	function resetForm() {
		uploadedFile = null;
		temporarySaveName = "";
		sourceLanguage = "";
		targetLanguage = "";
		detectedFormatId = null;
		detectionComplete = false;
	}
</script>

{#snippet uploadContent()}
	<div class="universal-upload-container">
		{#if !uploadedFile}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="drop-zone {isDragging ? 'dragging' : ''}"
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
				role="button"
				tabindex="0"
			>
				<DragAndDropHere />
				<label for="file-input" class="btn-select">
					Select File
					<input
						id="file-input"
						type="file"
						accept={acceptedFormats}
						onchange={handleFileSelect}
						style="display: none;"
					/>
				</label>
				<p class="supported-formats">Supported: {supportedFormatLabels}</p>
			</div>
		{:else}
			<div class="file-info">
				<div class="file-details">
					<div class="file-icon {getDetectedFormatLabel().toLowerCase()}">
						{detectionComplete ? getDetectedFormatLabel() : "CHECKING"}
					</div>
					<div class="file-name-section">
						<p class="file-name" title={uploadedFile.name}>
							{uploadedFile.name}
						</p>
						<p class="file-size">
							{(uploadedFile.size / 1024).toFixed(2)} KB
						</p>
					</div>
					<button class="btn-remove" onclick={clearSelectedFile}>
						Remove
					</button>
				</div>

				{#if detectionComplete && !detectedFormatId}
					<div class="error-message">
						This file type is not supported. Please upload a valid file.
					</div>
				{:else if detectionComplete}
					<div class="form-section">
						<input
							type="text"
							placeholder="Project name (optional)"
							bind:value={temporarySaveName}
						/>

						<div class="language-selection">
							<select
								onchange={(e) =>
									check(1, (e.target as HTMLSelectElement).value)}
								value={sourceLanguage}
							>
								<option disabled selected value="">Source Language ▼</option>
								{#each LANGUAGES as lang}
									<option value={lang.name + " (" + lang.code + ")"}
										>{lang.name} ({lang.code})</option
									>
								{/each}
							</select>

							<select
								onchange={(e) =>
									check(2, (e.target as HTMLSelectElement).value)}
								value={targetLanguage}
							>
								<option disabled selected value="">Target Language ▼</option>
								{#each LANGUAGES as lang}
									<option value={lang.name + " (" + lang.code + ")"}
										>{lang.name} ({lang.code})</option
									>
								{/each}
							</select>
						</div>

						<button
							class="btn save"
							onclick={processAndCreateProject}
							disabled={!sourceLanguage || !targetLanguage || isProcessing}
						>
							{isProcessing ? "Processing..." : "Create Project"}
						</button>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	tabindex="-1"
	class="modal-element-global {show ? '' : 'close-modal-global'}"
	onclick={() => (show = false)}
>
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-content" onclick={(e) => e.stopPropagation()}>
		<h2>Create New Project</h2>
		{@render uploadContent()}
	</div>
</div>

<style>
	.modal-content {
		display: grid;
		justify-items: center;
		min-width: 280px;
		max-width: 500px;
		border-radius: 5px;
		padding: 25px;
		margin: 0px 10px;
		background: var(--color-theme-7);
		pointer-events: auto;
		position: relative;
		z-index: 11;
		box-shadow:
			0 4px 6px rgba(0, 0, 0, 0.1),
			0 2px 4px rgba(0, 0, 0, 0.06);
	}

	h2 {
		text-align: center;
		font-size: 1.8rem;
		margin: 0px 0px 25px 0px;
		color: var(--color-theme-4);
		font-weight: 600;
	}

	.universal-upload-container {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 20px;
		max-width: 270px;
	}

	.drop-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 5px 20px;
		border: 2px dashed var(--color-theme-4);
		border-radius: 5px;
		background: var(--color-theme-8);
		transition: all 0.3s ease;
		cursor: pointer;
	}

	.drop-zone.dragging {
		border-color: var(--color-theme-3);
		background: var(--color-theme-1);
	}

	.drop-text {
		font-size: 1.1rem;
		color: var(--color-theme-4);
		font-weight: 600;
		margin: 15px 0 5px 0;
	}

	.or-text {
		color: var(--color-theme-5);
		margin: 10px 0;
		font-weight: 500;
	}

	.btn-select {
		display: inline-block;
		background: var(--color-theme-4);
		color: white;
		padding: 12px 24px;
		border-radius: 5px;
		font-weight: 600;
		cursor: pointer;
		transition: filter 0.2s linear;
		margin: 10px 0;
	}

	.btn-select:hover {
		filter: brightness(1.1);
	}

	.supported-formats {
		font-size: 0.85rem;
		color: var(--color-theme-5);
		margin: 15px 0 0 0;
		text-align: center;
	}

	.file-info {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.file-details {
		display: flex;
		align-items: center;
		gap: 15px;
		padding: 15px;
		background: var(--color-theme-8);
		border-radius: 5px;
		border: 2px solid var(--color-theme-1);
	}

	.file-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 60px;
		height: 60px;
		border-radius: 5px;
		background: var(--color-theme-4);
		color: white;
		font-weight: 700;
		font-size: 0.75rem;
		flex-shrink: 0;
	}

	.file-icon.docx {
		background: #2b579a;
	}

	.file-icon.json {
		background: #f7df1e;
		color: #333;
	}

	.file-icon.txt {
		background: #666;
	}

	.file-icon.xlsx {
		background: #217346;
	}

	.file-icon.html {
		background: #e34c26;
	}

	.file-icon.unsupported {
		background: #c02b2b;
	}

	.file-name-section {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.file-name {
		font-weight: 600;
		color: var(--color-theme-4);
		margin: 0 0 5px 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-size {
		font-size: 0.85rem;
		color: var(--color-theme-5);
		margin: 0;
	}

	.btn-remove {
		background: #c02b2b;
		color: white;
		border: none;
		border-radius: 5px;
		padding: 8px 16px;
		font-weight: 600;
		cursor: pointer;
		transition: filter 0.2s linear;
		flex-shrink: 0;
	}

	.btn-remove:hover {
		filter: brightness(1.1);
	}

	.error-message {
		background: #fee;
		color: #c02b2b;
		padding: 15px;
		border-radius: 5px;
		border: 2px solid #fcc;
		font-weight: 600;
		text-align: center;
	}

	.form-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.form-section input {
		padding: 10px 12px;
		border: 1px solid var(--color-theme-4);
		border-radius: 5px;
		font-size: 1rem;
		font-family: var(--font-body);
	}

	.form-section input:focus {
		outline: none;
		border-color: var(--color-theme-3);
	}

	.language-selection {
		display: grid;
		gap: 10px;
	}

	select {
		width: 100%;
		padding: 10px 12px;
		border-radius: 5px;
		border: 1px solid var(--color-theme-4);
		color: var(--color-theme-5);
		font-size: 1rem;
		background: white;
		cursor: pointer;
		transition: border-color 0.3s;
	}

	select:focus {
		border-color: var(--color-theme-3);
		outline: none;
	}

	option {
		padding: 10px 0px;
		background-color: var(--color-theme-8);
		color: var(--color-theme-5);
	}

	.btn {
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		font-size: 1.1rem;
		font-weight: 600;
		border-radius: 5px;
		padding: 12px;
		cursor: pointer;
		width: 100%;
		transition: filter 0.2s linear;
		color: white;
	}

	.btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
</style>
