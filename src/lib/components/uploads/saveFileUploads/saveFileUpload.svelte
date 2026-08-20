<script lang="ts">
	import {
		saveAndOpenNewFileWithStringArrayFromSaveFile,
		updateAndOpenNewFileWithStringArray,
	} from "$lib/functions/saveTranslationOnIndexedDb.js";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import type { UserData } from "$lib/types/types.js";
	import { userData, showLoading } from "$lib/functions/saveData/stores.svelte";
	import { validateJsonData } from "./saveFileFunctions.js";
	import { setLoadingAndRender } from "$lib/functions/uiHelpers";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";
	import {
		readSafeTextFile,
		parseSafeJson,
		safeInputMessage,
	} from "$lib/formats/safeInput";
	import { importXliffProjectStreaming } from "$lib/formats/streamingImporters";
	import { detectProjectFileFormat } from "$lib/formats/detect";
	import { migrateProjectData } from "$lib/formats/persistenceMigrations";
	import "$lib/components/uploads/uploadDialog.css";

	let isDragging = $state(false);

	let saveData: UserData | null = null;
	let saveFileIdExists: boolean = $state(false);

	async function processTranslationFile(file: File | null): Promise<void> {
		await setLoadingAndRender();
		try {
			if (!file) throw new Error("No file was selected.");
			const detection = await detectProjectFileFormat(file);
			if (!detection)
				throw new Error(
					"The file is not recognizable as Open TLC JSON or XLIFF.",
				);
			if (detection.format === "json") {
				const { text } = await readSafeTextFile(file);
				const parsedData = migrateProjectData(parseSafeJson<unknown>(text));
				if (!validateJsonData(parsedData))
					throw new Error("Invalid Open TLC JSON project structure.");
				saveData = parsedData;
			} else {
				saveData = (await importXliffProjectStreaming(file)).data;
			}
			if (!saveData)
				throw new Error("The project file contains no project data.");
			if (saveData.id !== undefined && checkIfUniqueId(saveData.id)) {
				saveFileIdExists = true;
				return;
			}
			const profile = saveData.translationData.documentModel?.metadata
				?.xliffProfile as
				| { label?: string; exportPolicy?: "same-profile" }
				| undefined;
			notifySuccess(
				profile?.exportPolicy === "same-profile"
					? `${profile.label ?? detection.label} detected. Vendor structure will be retained by the same-profile export.`
					: `${detection.label} detected (${detection.confidence} confidence). New project created.`,
			);
			await createNewProjectWithSaveFile();
		} catch (error) {
			notifyError(safeInputMessage(error));
		} finally {
			showLoading.set(false);
		}
	}

	async function handleTranslationFileUpload(event: Event): Promise<void> {
		const inputElement = event.target as HTMLInputElement;
		await processTranslationFile(
			inputElement.files ? inputElement.files[0] : null,
		);
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
		await processTranslationFile(file);
	}

	async function createNewProjectWithSaveFile() {
		if (!saveData) return;
		const data: UserData = structuredClone(saveData);
		delete data.id;
		await saveAndOpenNewFileWithStringArrayFromSaveFile($userData, data);
		showLoading.set(false);
	}

	async function updateExistingProjectWithSaveFile() {
		const timestamp = new Date().valueOf().toString();
		if (!saveData) return;
		saveData.translationData.creationDate = timestamp;
		await updateAndOpenNewFileWithStringArray(saveData);
		showLoading.set(false);
	}

	function checkIfUniqueId(id: number): boolean {
		let singleData: UserData = $userData.find((d) => d.id === id) as UserData;
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
		class="upload-surface"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		class:is-dragging={isDragging}
	>
		<div class="upload-guidance">
			<strong>Restore an existing Open TLC project</strong>
			<span>Drop a portable project or CAT interchange file below.</span>
		</div>
		<DragAndDropHere />
		<button class="upload-file-button">
			Choose project file
			<input
				id="fileInput"
				type="file"
				accept="application/json,application/xml,text/xml,.json,.xlf,.xlif,.xliff,.xliffdoc,.sdlxliff,.mqxlf,.mqxliff,.mxliff"
				oninput={handleTranslationFileUpload}
			/>
		</button>
		<div class="project-format-pills" aria-label="Accepted project formats">
			<span>Open TLC JSON</span>
			<span>XLIFF 1.2</span>
			<span>XLIFF 2.0 / 2.1</span>
			<span>Vendor XLIFF + same-profile export</span>
			<span>.xlif / .mqxlf aliases</span>
		</div>
	</div>
{:else}
	<div class="upload-overwrite">
		<p class="upload-overwrite-message">
			A project with the same identifier already exists. Replace its local data
			or cancel the import.
		</p>
		<button
			class="upload-danger-button"
			onclick={() => updateExistingProjectWithSaveFile()}
		>
			Replace existing project
		</button>
		<button class="upload-secondary-button" onclick={() => cancelOverwrite()}>
			Cancel
		</button>
	</div>
{/if}

<style>
	.project-format-pills {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		padding-top: 0.2rem;
	}

	.project-format-pills span {
		border: 1px solid #c9e0e5;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.78);
		padding: 0.25rem 0.55rem;
		color: #49717d;
		font-size: 0.68rem;
		font-weight: 700;
	}
</style>
