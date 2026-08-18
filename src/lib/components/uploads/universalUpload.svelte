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
	import Modal from "$lib/components/modal.svelte";

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
	const supportedFormatLabels = FORMAT_ADAPTERS.map((adapter) => adapter.label);

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

	function optionChoiceLabel(optionId: string, choice: string): string {
		const labels: Record<string, Record<string, string>> = {
			trackedChanges: {
				current: "Final document (recommended)",
				original: "Original document before edits",
				all: "Both inserted and deleted text",
			},
		};
		return (
			labels[optionId]?.[choice] ??
			choice
				.replaceAll("-", " ")
				.replace(/^./, (character) => character.toUpperCase())
		);
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
					<div
						class="supported-format-pills"
						aria-label="Supported source formats"
					>
						{#each supportedFormatLabels as label}
							<span>{label}</span>
						{/each}
					</div>
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
						<label class="form-field" for="project-name">
							<span>Project name</span>
							<input
								id="project-name"
								type="text"
								placeholder="Name this translation project"
								bind:value={temporarySaveName}
							/>
						</label>

						<div class="language-selection">
							<label class="form-field">
								<span>Source language</span>
								<select
									onchange={(e) =>
										check(1, (e.target as HTMLSelectElement).value)}
									value={sourceLanguage}
								>
									<option disabled selected value=""
										>Choose source language</option
									>
									{#each LANGUAGES as lang}
										<option value={lang.name + " (" + lang.code + ")"}
											>{lang.name} ({lang.code})</option
										>
									{/each}
								</select>
							</label>

							<label class="form-field">
								<span>Target language</span>
								<select
									onchange={(e) =>
										check(2, (e.target as HTMLSelectElement).value)}
									value={targetLanguage}
								>
									<option disabled selected value=""
										>Choose target language</option
									>
									{#each LANGUAGES as lang}
										<option value={lang.name + " (" + lang.code + ")"}
											>{lang.name} ({lang.code})</option
										>
									{/each}
								</select>
							</label>
						</div>

						{#if getImportOptions().length > 0}
							<details class="filter-options">
								<summary>
									<span>
										<strong>Customize imported content</strong>
										<small
											>Optional — recommended defaults are already selected</small
										>
									</span>
								</summary>
								<div class="filter-options-grid">
									{#each getImportOptions() as option}
										<label class:boolean-option={option.type === "boolean"}>
											<span class="option-label">
												{option.label}
												{#if option.description}
													<button
														type="button"
														class="option-help"
														aria-label={`${option.label}: ${option.description}`}
														onclick={(event) => event.stopPropagation()}
													>
														<span aria-hidden="true">?</span>
														<span class="option-tooltip" role="tooltip"
															>{option.description}</span
														>
													</button>
												{/if}
											</span>
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
														<option value={choice}
															>{optionChoiceLabel(option.id, choice)}</option
														>
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
																? (event.target as HTMLInputElement)
																		.valueAsNumber
																: (event.target as HTMLInputElement).value,
														)}
												/>
											{/if}
										</label>
									{/each}
								</div>
							</details>
						{/if}

						{#if isProcessing && importProgress}
							<div class="import-progress" aria-live="polite">
								<progress value={progressPercent()} max="100"></progress>
								<small>{importProgress.message} ({progressPercent()}%)</small>
							</div>
						{/if}

						{#if !sourceLanguage || !targetLanguage}
							<p class="project-requirement" aria-live="polite">
								Choose both a source and target language to continue.
							</p>
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
	role="presentation"
	class="modal-element-global {show ? '' : 'close-modal-global'}"
	onclick={closeModal}
>
	<Modal
		title="Create new project"
		description="Import a source file and configure its translation workflow."
		content={uploadContent}
		large
		onClose={closeModal}
	/>
</div>

<style>
	.universal-upload-container {
		display: grid;
		gap: 1rem;
		width: min(100%, 760px);
	}

	.drop-zone {
		justify-items: center;
		cursor: pointer;
	}

	.file-info {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.file-details {
		display: flex;
		align-items: center;
		gap: 0.9rem;
		padding: 0.85rem;
		background: #f7fbfc;
		border-radius: 0.7rem;
		border: 1px solid #c8dde2;
	}

	.file-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 3.3rem;
		height: 3.3rem;
		border-radius: 0.55rem;
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
		font-weight: 750;
		color: #22546a;
		margin: 0 0 0.2rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.file-size {
		font-size: 0.72rem;
		color: #71868e;
		margin: 0;
	}

	.btn-remove {
		background: #fff7f7;
		color: #a33e3e;
		border: 1px solid #e5baba;
		border-radius: 0.5rem;
		padding: 0.55rem 0.8rem;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 750;
		cursor: pointer;
		transition: filter 0.2s linear;
		flex-shrink: 0;
	}

	.btn-remove:hover {
		border-color: #ce8181;
		background: #fff0f0;
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
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.15rem 0.65rem;
		padding: 0.7rem 0.85rem;
		border: 1px solid #c8e0e4;
		border-radius: 0.65rem;
		background: #f1f9fa;
		color: #315f6d;
		font-size: 0.76rem;
	}

	.detection-result::before {
		content: "✓";
		display: grid;
		grid-row: 1 / span 2;
		place-items: center;
		width: 1.65rem;
		height: 1.65rem;
		border-radius: 50%;
		background: #d8eef1;
		color: #20758c;
		font-weight: 850;
	}

	.detection-result strong {
		color: #275a6b;
	}

	.detection-result span {
		grid-column: 2;
		color: #688088;
		line-height: 1.35;
	}

	.detection-result.detection-unsupported {
		border-color: #edd4a9;
		background: #fff4e5;
		color: #7a4100;
	}

	.detection-result.detection-unsupported::before {
		content: "!";
		background: #f7e5c8;
		color: #8a5716;
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
		gap: 1rem;
	}

	.form-field {
		display: grid;
		gap: 0.38rem;
		color: #285365;
		font-size: 0.75rem;
		font-weight: 750;
	}

	.form-section input {
		box-sizing: border-box;
		width: 100%;
		padding: 0.72rem 0.8rem;
		border: 1px solid #b9d4da;
		border-radius: 0.55rem;
		font-size: 0.9rem;
		font-family: var(--font-body);
	}

	.form-section input:focus {
		outline: none;
		border-color: var(--color-theme-3);
	}

	.language-selection {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.filter-options {
		margin: 0;
		border: 1px solid #c8dde2;
		border-radius: 0.7rem;
		background: #f8fcfd;
		overflow: visible;
	}

	.filter-options summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.85rem 1rem;
		color: #28586a;
		cursor: pointer;
		list-style: none;
	}

	.filter-options summary::-webkit-details-marker {
		display: none;
	}

	.filter-options summary::after {
		content: "+";
		display: grid;
		flex: 0 0 1.6rem;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		background: #e3f2f5;
		color: #247c94;
		font-size: 1rem;
		font-weight: 700;
	}

	.filter-options[open] summary::after {
		content: "−";
	}

	.filter-options summary span {
		display: grid;
		gap: 0.15rem;
	}

	.filter-options summary strong {
		font-size: 0.84rem;
	}

	.filter-options summary small {
		color: #748991;
		font-size: 0.7rem;
		font-weight: 500;
	}

	.filter-options-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.85rem;
		padding: 1rem;
		border-top: 1px solid #d9e8eb;
		background: white;
	}

	.filter-options label {
		display: grid;
		align-content: start;
		gap: 0.4rem;
		color: var(--color-theme-5);
		font-size: 0.78rem;
	}

	.filter-options .boolean-option {
		grid-template-columns: 1fr auto;
		align-items: center;
		min-height: 2.8rem;
		border: 1px solid #d7e5e8;
		border-radius: 0.55rem;
		padding: 0.55rem 0.7rem;
		background: #f9fcfd;
	}

	.filter-options .boolean-option input {
		width: 18px;
		height: 18px;
	}

	.option-label {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-weight: 700;
	}

	.option-help {
		position: relative;
		display: inline-grid;
		place-items: center;
		width: 1rem;
		height: 1rem;
		border: 1px solid #9fc4cc;
		border-radius: 50%;
		color: #39798b;
		font-size: 0.62rem;
		font-weight: 850;
		cursor: help;
	}

	.option-help:focus-visible {
		outline: 2px solid #50a9be;
		outline-offset: 2px;
	}

	.option-tooltip {
		position: absolute;
		left: 50%;
		bottom: calc(100% + 0.55rem);
		z-index: 20;
		width: min(250px, 60vw);
		border-radius: 0.55rem;
		padding: 0.6rem 0.7rem;
		background: #143f50;
		box-shadow: 0 8px 22px rgba(20, 63, 80, 0.2);
		color: white;
		font-size: 0.68rem;
		font-weight: 500;
		line-height: 1.4;
		opacity: 0;
		pointer-events: none;
		transform: translate(-50%, 0.3rem);
		transition: 0.16s ease;
	}

	.option-help:hover .option-tooltip,
	.option-help:focus .option-tooltip {
		opacity: 1;
		transform: translate(-50%, 0);
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

	.project-requirement {
		margin: -0.15rem 0 0;
		color: #71868e;
		font-size: 0.7rem;
		line-height: 1.35;
		text-align: center;
	}

	.project-actions .cancel {
		background: #c02b2b;
		color: white;
	}

	select {
		width: 100%;
		padding: 0.72rem 0.8rem;
		border-radius: 0.55rem;
		border: 1px solid #b9d4da;
		color: var(--color-theme-5);
		font-size: 0.9rem;
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

	@media (max-width: 620px) {
		.language-selection,
		.filter-options-grid {
			grid-template-columns: 1fr;
		}

		.file-details {
			align-items: flex-start;
		}
	}

	.btn {
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		font-size: 1.1rem;
		font-weight: 600;
		border-radius: 0.55rem;
		padding: 0.75rem;
		cursor: pointer;
		width: 100%;
		transition: filter 0.2s linear;
		color: white;
	}

	.btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn:disabled {
		background: #e7edef;
		color: #8b9ba0;
		opacity: 1;
		cursor: not-allowed;
	}
</style>
