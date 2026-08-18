<script lang="ts">
	import { saveAndOpenNewFileWithStringArray } from "$lib/functions/saveTranslationOnIndexedDb";
	import { saveAndOpenNewFileWithTextString } from "$lib/functions/saveTranslationOnIndexedDb";
	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import { showLoading } from "$lib/functions/saveData/stores.svelte";
	import {
		detectFormatWithConfidence,
		FORMAT_ADAPTERS,
		getFormatAcceptValue,
		getFormatAdapter,
		getSupportedFormatLabels,
	} from "$lib/formats/registry";
	import "$lib/components/uploads/uploadDialog.css";
	import type { FormatDetection } from "$lib/formats/detect";
	import type { FormatId } from "$lib/formats/formatIds";
	import type {
		FormatImportOption,
		FormatOptionValue,
		FormatOptionValues,
	} from "$lib/formats/types";
	import { normalizeImportOptions } from "$lib/formats/options";
	import {
		SafeInputError,
		safeInputMessage,
		type SafeInputProgress,
	} from "$lib/formats/safeInput";
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
	let formatDetection: FormatDetection | null = $state(null);
	let detectionComplete: boolean = $state(false);
	let isProcessing: boolean = $state(false);
	let importOptionValues: FormatOptionValues = $state({});
	let importController: AbortController | null = $state(null);
	let importProgress: SafeInputProgress | null = $state(null);
	const acceptedFormats = getFormatAcceptValue();
	const supportedFormatLabels = getSupportedFormatLabels();

	function getDetectedFormatLabel(): string {
		return formatDetection?.label ?? "UNSUPPORTED";
	}

	function confidenceLabel(): string {
		const confidence = formatDetection?.confidence ?? "low";
		return `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`;
	}

	function getImportOptions(): readonly FormatImportOption[] {
		return detectedFormatId
			? getFormatAdapter(detectedFormatId).importOptions
			: [];
	}

	async function selectFile(file: File) {
		uploadedFile = file;
		detectionComplete = false;
		try {
			const detected = await detectFormatWithConfidence(file);
			if (uploadedFile !== file) return;
			formatDetection = detected ?? null;
			detectedFormatId = detected?.formatId ?? null;
			importOptionValues = detected?.formatId
				? normalizeImportOptions(detected.formatId)
				: {};
			temporarySaveName = file.name.replace(/\.[^/.]+$/, "");
		} catch (error) {
			if (uploadedFile !== file) return;
			detectedFormatId = null;
			formatDetection = null;
			notifyError(safeInputMessage(error));
		} finally {
			if (uploadedFile === file) detectionComplete = true;
		}
	}

	function clearSelectedFile() {
		importController?.abort();
		uploadedFile = null;
		detectedFormatId = null;
		formatDetection = null;
		detectionComplete = false;
		importOptionValues = {};
	}

	function cancelImport() {
		importController?.abort();
	}

	function closeModal() {
		importController?.abort();
		show = false;
	}

	function progressPercent(): number {
		if (!importProgress || importProgress.total <= 0) return 0;
		return Math.min(
			100,
			Math.round((importProgress.completed / importProgress.total) * 100),
		);
	}

	function setImportOption(id: string, value: FormatOptionValue) {
		importOptionValues = { ...importOptionValues, [id]: value };
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
		importController = new AbortController();
		const context = {
			signal: importController.signal,
			onProgress: (progress: SafeInputProgress) => (importProgress = progress),
		};

		try {
			const timestamp = new Date().valueOf().toString();
			const adapter = getFormatAdapter(detectedFormatId);
			const validation = await adapter.validate(uploadedFile, context);
			if (!validation.valid) {
				throw new Error(validation.reason ?? `Invalid ${adapter.label} file.`);
			}

			const normalizedOptions = normalizeImportOptions(
				adapter.id,
				importOptionValues,
			);
			const imported = await adapter.importFile(
				uploadedFile,
				normalizedOptions,
				context,
			);
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
					imported.skeleton,
					imported.filterOptions,
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
					imported.skeleton,
					imported.filterOptions,
					imported.targetSegments,
				);
			}

			notifySuccess("Project created");
			show = false;
			resetForm();
		} catch (error) {
			console.error("Error processing file:", error);
			if (!(error instanceof SafeInputError && error.code === "ABORTED")) {
				notifyError(safeInputMessage(error));
			}
		} finally {
			isProcessing = false;
			importController = null;
			importProgress = null;
			showLoading.set(false);
		}
	}

	function resetForm() {
		uploadedFile = null;
		temporarySaveName = "";
		sourceLanguage = "";
		targetLanguage = "";
		detectedFormatId = null;
		formatDetection = null;
		detectionComplete = false;
		importOptionValues = {};
		importProgress = null;
	}
</script>

{#snippet uploadContent()}
	<div class="universal-upload-container">
		{#if !uploadedFile}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="drop-zone upload-surface {isDragging ? 'dragging' : ''}"
				ondragover={handleDragOver}
				ondragleave={handleDragLeave}
				ondrop={handleDrop}
				role="button"
				tabindex="0"
			>
				<div class="upload-guidance">
					<strong>Choose the source file you want to translate</strong>
					<span>Its format will be detected and validated automatically.</span>
				</div>
				<DragAndDropHere />
				<label for="file-input" class="upload-file-button">
					Select File
					<input
						id="file-input"
						type="file"
						accept={acceptedFormats}
						onchange={handleFileSelect}
						style="display: none;"
					/>
				</label>
				<details class="upload-format-note">
					<summary>{FORMAT_ADAPTERS.length} supported format workflows</summary>
					<p>{supportedFormatLabels}</p>
				</details>
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
				{#if detectionComplete && formatDetection}
					<div
						class="detection-result"
						class:detection-unsupported={!formatDetection.supported}
						aria-live="polite"
					>
						<strong
							>Detected: {formatDetection.label} · {confidenceLabel()}</strong
						>
						<span>{formatDetection.reason}</span>
						{#if formatDetection.workflow}
							<strong>{formatDetection.workflow.primaryAction}</strong>
							<ol class="workflow-steps">
								{#each formatDetection.workflow.steps as step}
									<li>{step}</li>
								{/each}
							</ol>
							{#if formatDetection.workflow.privacyWarning}
								<span class="workflow-warning"
									>Privacy: {formatDetection.workflow.privacyWarning}</span
								>
							{/if}
							{#if formatDetection.workflow.fidelityWarning}
								<span class="workflow-warning"
									>Fidelity: {formatDetection.workflow.fidelityWarning}</span
								>
							{/if}
						{/if}
					</div>
				{/if}

				{#if detectionComplete && !detectedFormatId}
					<div class="error-message">
						{formatDetection
							? `${formatDetection.label} is not supported for project creation yet.`
							: "This file type could not be identified or is not supported."}
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

						{#if getImportOptions().length > 0}
							<fieldset class="filter-options">
								<legend>Import options</legend>
								{#each getImportOptions() as option}
									<label class:boolean-option={option.type === "boolean"}>
										<span>{option.label}</span>
										{#if option.type === "boolean"}
											<input
												type="checkbox"
												checked={Boolean(importOptionValues[option.id])}
												onchange={(event) =>
													setImportOption(
														option.id,
														(event.target as HTMLInputElement).checked,
													)}
											/>
										{:else if option.type === "select"}
											<select
												value={String(importOptionValues[option.id] ?? "")}
												onchange={(event) =>
													setImportOption(
														option.id,
														(event.target as HTMLSelectElement).value,
													)}
											>
												{#each option.choices ?? [] as choice}
													<option value={choice}>{choice}</option>
												{/each}
											</select>
										{:else}
											<input
												type={option.type}
												placeholder={option.placeholder ?? ""}
												value={importOptionValues[option.id] ?? ""}
												oninput={(event) =>
													setImportOption(
														option.id,
														option.type === "number"
															? (event.target as HTMLInputElement).valueAsNumber
															: (event.target as HTMLInputElement).value,
													)}
											/>
										{/if}
										{#if option.description}
											<small>{option.description}</small>
										{/if}
									</label>
								{/each}
							</fieldset>
						{/if}

						{#if isProcessing && importProgress}
							<div class="import-progress" aria-live="polite">
								<progress value={progressPercent()} max="100"></progress>
								<small>{importProgress.message} ({progressPercent()}%)</small>
							</div>
						{/if}

						<div class="project-actions">
							<button
								class="btn save"
								onclick={processAndCreateProject}
								disabled={!sourceLanguage || !targetLanguage || isProcessing}
							>
								{isProcessing ? "Processing..." : "Create Project"}
							</button>
							{#if isProcessing}
								<button class="btn cancel" onclick={cancelImport}>Cancel</button
								>
							{/if}
						</div>
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
	onclick={closeModal}
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
		box-sizing: border-box;
		width: min(100%, 680px);
		max-height: calc(100vh - 2rem);
		border: 1px solid rgba(119, 164, 176, 0.3);
		border-radius: 1rem;
		padding: 1.65rem;
		background: var(--color-theme-7);
		overflow-y: auto;
		pointer-events: auto;
		position: relative;
		box-shadow: 0 24px 70px rgba(4, 28, 40, 0.28);
	}

	h2 {
		text-align: center;
		font-size: clamp(1.35rem, 4vw, 1.75rem);
		line-height: 1.2;
		margin: 0 0 1.25rem;
		color: #194858;
		font-weight: 750;
		letter-spacing: -0.025em;
	}

	.universal-upload-container {
		display: grid;
		gap: 1rem;
		width: min(100%, 580px);
	}

	.drop-zone {
		justify-items: center;
		cursor: pointer;
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

	.detection-result {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 10px 12px;
		border-radius: 5px;
		background: color-mix(in srgb, var(--color-theme-1) 65%, transparent);
		color: var(--color-theme-4);
		font-size: 0.82rem;
	}

	.detection-result span {
		line-height: 1.35;
	}

	.detection-result.detection-unsupported {
		background: #fff4e5;
		color: #7a4100;
	}

	.workflow-steps {
		margin: 4px 0;
		padding-left: 1.25rem;
	}

	.workflow-steps li + li {
		margin-top: 3px;
	}

	.workflow-warning {
		font-weight: 600;
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

	.filter-options {
		display: grid;
		gap: 10px;
		margin: 0;
		padding: 12px;
		border: 1px solid var(--color-theme-4);
		border-radius: 5px;
	}

	.filter-options legend {
		padding: 0 5px;
		font-weight: 600;
		color: var(--color-theme-4);
	}

	.filter-options label {
		display: grid;
		gap: 5px;
		color: var(--color-theme-5);
	}

	.filter-options .boolean-option {
		grid-template-columns: 1fr auto;
		align-items: center;
	}

	.filter-options .boolean-option input {
		width: 18px;
		height: 18px;
	}

	.filter-options small {
		grid-column: 1 / -1;
		line-height: 1.3;
	}

	.import-progress {
		display: grid;
		gap: 5px;
		color: var(--color-theme-5);
	}

	.import-progress progress {
		width: 100%;
	}

	.project-actions {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
	}

	.project-actions .cancel {
		background: #c02b2b;
		color: white;
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
