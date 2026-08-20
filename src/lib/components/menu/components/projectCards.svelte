<script lang="ts">
	import {
		getTotalWordCount,
		calcPercentageOfTotalSegmentsChecked,
	} from "$lib/functions/statistics";
	import type { TbData, TmData, UserData } from "$lib/types/types.js";
	import {
		openMenu,
		seg1WordCount,
		seg2WordCount,
		singleUserData,
		translationIdSelected,
		userData,
		tmData,
		tbData,
	} from "$lib/functions/saveData/stores.svelte";
	import {
		deleteTranslationFromIndexedDB,
		loadTbDataFromIndexedDB,
		loadTmDataFromIndexedDB,
		updateTranslationOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import Modal from "../../modal.svelte";
	import { LANGUAGES } from "$lib/components/data/languages";
	import {
		notifySuccess,
		notifyWarning,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";
	import type { ProjectViewMode } from "../projectDashboard";
	import { commitPersistedMutation } from "$lib/functions/saveData/persistenceContract";
	import { withLoading } from "$lib/functions/uiHelpers";

	function publishProject(project: UserData) {
		singleUserData.set(project);
		userData.update((projects) =>
			projects.map((candidate) =>
				candidate.id === project.id ? project : candidate,
			),
		);
	}

	let optionsOpen: boolean = $state(false);
	let editNameWindow: boolean = $state(false);
	let editLanguagesWindow: boolean = $state(false);
	let confirmDeletionWindow: boolean = $state(false);

	let newFileName: string = $state("");
	let newSourceLang: string = $state("");
	let newTargetLang: string = $state("");

	async function loadFile(id: number) {
		try {
			await withLoading(async () => {
				const data = $userData.find((candidate) => candidate.id === id);
				if (!data) throw new Error("The selected project no longer exists.");
				const tmReference = data.translationData.tm;
				if (typeof tmReference?.id === "number" && tmReference.active) {
					await getAllTmDataFromIndexedDB();
					if (!$tmData.some((memory) => memory.id === tmReference.id))
						throw new Error(
							`Translation memory “${tmReference.name ?? tmReference.id}” is no longer available. Choose another memory in project resources.`,
						);
				}
				const tbReference = data.translationData.tb;
				if (typeof tbReference?.id === "number" && tbReference.active) {
					await getAllTbDataFromIndexedDB();
					if (!$tbData.some((termBase) => termBase.id === tbReference.id))
						throw new Error(
							`Term base “${tbReference.name ?? tbReference.id}” is no longer available. Choose another term base in project resources.`,
						);
				}
				singleUserData.set(data);
				translationIdSelected.set(id);
				seg1WordCount.set(getTotalWordCount(data.translationData.seg1));
				seg2WordCount.set(getTotalWordCount(data.translationData.seg2));
				openMenu.set(false);
			});
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "The project could not be opened.",
			);
		}
	}

	async function getAllTmDataFromIndexedDB() {
		if ($tmData.length === 0) {
			const data = await loadTmDataFromIndexedDB();
			tmData.set(data as TmData[]);
		}
	}

	async function getAllTbDataFromIndexedDB() {
		if ($tbData.length === 0) {
			const data = await loadTbDataFromIndexedDB();
			tbData.set(data as TbData[]);
		}
	}

	async function updateFileName(newName: string) {
		if (!$singleUserData) return;
		if (!newName.trim()) return notifyError("Enter a project name.");
		try {
			const updated = await commitPersistedMutation(
				$singleUserData,
				(candidate) => (candidate.translationData.name = newName.trim()),
				updateTranslationOnIndexedDB,
			);
			publishProject(updated);
			editNameWindow = false;
			show = false;
			notifyInfo("Project name updated");
		} catch (error) {
			notifyError(error instanceof Error ? error.message : "Rename failed.");
		}
	}

	async function updateFileLanguages() {
		if (!$singleUserData) return;
		if (newTargetLang === "" || newSourceLang === "") {
			notifyError("Please select both source and target languages");
			return;
		}
		if (newTargetLang === newSourceLang) {
			notifyError("Source and target languages must be different");
			return;
		}
		try {
			const updated = await commitPersistedMutation(
				$singleUserData,
				(candidate) => {
					candidate.translationData.sourceLang = newSourceLang;
					candidate.translationData.targetLang = newTargetLang;
				},
				updateTranslationOnIndexedDB,
			);
			publishProject(updated);
			editLanguagesWindow = false;
			show = false;
			notifyInfo("Project languages updated");
		} catch (error) {
			notifyError(error instanceof Error ? error.message : "Update failed.");
		}
	}

	async function handleSaveFileDeletion(id: number) {
		if (typeof id !== "number") return;
		try {
			await deleteTranslationFromIndexedDB(id);
			confirmDeletionWindow = false;
			show = false;
			notifyWarning("Project deleted");
		} catch (error) {
			notifyError(error instanceof Error ? error.message : "Deletion failed.");
		}
	}

	let show: boolean = $state(false);

	function unixTimeToDate(unixTime: number): string {
		const date = new Date(unixTime);
		return date.toLocaleDateString();
	}

	function getStringInsideBrackets(input: string): string | null {
		if (typeof input !== "string") {
			return null;
		}

		const match = input.match(/\(([^)]+)\)/);
		if (!match) {
			return input;
		}
		return match ? match[1] : null;
	}

	let {
		file,
		viewMode = "cards",
	}: {
		file: UserData;
		viewMode?: ProjectViewMode;
	} = $props();
	let projectName = $derived(file.translationData.name);
	let displayName = $derived(
		projectName.length > 28 ? `${projectName.slice(0, 28)}…` : projectName,
	);
	let classicDisplayName = $derived(
		projectName.length > 15 ? `${projectName.slice(0, 15)}...` : projectName,
	);
	let progress = $derived(
		calcPercentageOfTotalSegmentsChecked(file.translationData.checked),
	);
	let sourceWords = $derived(getTotalWordCount(file.translationData.seg1));
	let sourceLanguage = $derived(
		getStringInsideBrackets(file.translationData.sourceLang) ?? "—",
	);
	let targetLanguage = $derived(
		getStringInsideBrackets(file.translationData.targetLang) ?? "—",
	);
	let creationDate = $derived(
		unixTimeToDate(parseInt(file.translationData.creationDate)),
	);

	function check(opt: number, lang: string) {
		if (opt === 1) {
			newSourceLang = lang;
		} else {
			newTargetLang = lang;
		}
	}

	function selectAndShowModal(id: number) {
		optionsOpen = false;
		show = true;
		let data = $userData.find((d) => d.id === id);
		if (!data) return;
		singleUserData.set(data);
		translationIdSelected.set(id);
		seg1WordCount.set(getTotalWordCount(data.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(data.translationData.seg2));
	}

	function closeProjectModal() {
		show = false;
		optionsOpen = false;
		editNameWindow = false;
		editLanguagesWindow = false;
		confirmDeletionWindow = false;
	}

	function openRenameForm() {
		newFileName = projectName;
		editNameWindow = true;
	}

	function openLanguageForm() {
		newSourceLang = file.translationData.sourceLang;
		newTargetLang = file.translationData.targetLang;
		editLanguagesWindow = true;
	}

	let modalTitle = $derived(
		confirmDeletionWindow
			? "Delete project"
			: editNameWindow
				? "Rename project"
				: editLanguagesWindow
					? "Project languages"
					: optionsOpen
						? "Project settings"
						: "Project options",
	);
</script>

{#snippet options()}
	{#if !optionsOpen}
		<div class="modal-stack">
			<p class="modal-copy">Continue translating or manage this project.</p>
			<div class="modal-actions">
				<button class="modal-button primary" onclick={() => loadFile(file.id!)}>
					Open project
				</button>
				<button class="modal-action-card" onclick={() => (optionsOpen = true)}>
					<span class="modal-action-icon" aria-hidden="true">SET</span>
					<span class="modal-action-text">
						<strong>Project settings</strong>
						<small>Rename, change languages, or delete this project</small>
					</span>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
			</div>
		</div>
	{:else if editNameWindow}
		<div class="modal-form">
			<label class="modal-field">
				<span>Project name</span>
				<input
					type="text"
					bind:value={newFileName}
					placeholder="Project name"
				/>
			</label>
			<div class="modal-actions inline">
				<button
					class="modal-button secondary"
					onclick={() => (editNameWindow = false)}>Back</button
				>
				<button
					class="modal-button primary"
					disabled={!newFileName.trim()}
					onclick={() => updateFileName(newFileName)}>Save name</button
				>
			</div>
		</div>
	{:else if editLanguagesWindow}
		<div class="modal-form">
			<div class="modal-field-grid">
				<label class="modal-field">
					<span>Source language</span>
					<select
						value={newSourceLang}
						onchange={(e) => check(1, (e.target as HTMLSelectElement).value)}
					>
						{#each LANGUAGES as lang}
							<option value={lang.name + " (" + lang.code + ")"}
								>{lang.name} ({lang.code})</option
							>
						{/each}
					</select>
				</label>
				<label class="modal-field">
					<span>Target language</span>
					<select
						value={newTargetLang}
						onchange={(e) => check(2, (e.target as HTMLSelectElement).value)}
					>
						{#each LANGUAGES as lang}
							<option value={lang.name + " (" + lang.code + ")"}
								>{lang.name} ({lang.code})</option
							>
						{/each}
					</select>
				</label>
			</div>
			<div class="modal-actions inline">
				<button
					class="modal-button secondary"
					onclick={() => (editLanguagesWindow = false)}>Back</button
				>
				<button class="modal-button primary" onclick={updateFileLanguages}
					>Save languages</button
				>
			</div>
		</div>
	{:else if confirmDeletionWindow}
		<div class="modal-confirmation">
			<span class="modal-confirmation-icon" aria-hidden="true">!</span>
			<h3>Delete this project permanently?</h3>
			<p>
				The local project and its translated segments will be removed from this
				browser.
			</p>
			<div class="modal-actions inline">
				<button
					class="modal-button secondary"
					onclick={() => (confirmDeletionWindow = false)}>Keep project</button
				>
				<button
					class="modal-button danger"
					onclick={() => handleSaveFileDeletion(file.id!)}
					>Delete project</button
				>
			</div>
		</div>
	{:else}
		<div class="modal-stack">
			<div class="modal-actions">
				<button class="modal-action-card" onclick={openRenameForm}>
					<span class="modal-action-icon" aria-hidden="true">Aa</span>
					<span class="modal-action-text"
						><strong>Rename project</strong><small
							>Change the name shown in your workspace</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
				<button class="modal-action-card" onclick={openLanguageForm}>
					<span class="modal-action-icon" aria-hidden="true">文</span>
					<span class="modal-action-text"
						><strong>Project languages</strong><small
							>Update the source and target languages</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
				<button
					class="modal-action-card danger"
					onclick={() => (confirmDeletionWindow = true)}
				>
					<span class="modal-action-icon" aria-hidden="true">!</span>
					<span class="modal-action-text"
						><strong>Delete project</strong><small
							>Permanently remove the local project</small
						></span
					>
					<span class="modal-action-arrow" aria-hidden="true">→</span>
				</button>
			</div>
			<button class="modal-button quiet" onclick={() => (optionsOpen = false)}
				>← Back to project</button
			>
		</div>
	{/if}
{/snippet}

{#if show}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		role="presentation"
		class="modal-element-global"
		onclick={closeProjectModal}
	>
		<Modal
			title={modalTitle}
			description={projectName}
			content={options}
			onClose={closeProjectModal}
		/>
	</div>
{/if}

{#if viewMode === "cards"}
	<button
		type="button"
		class="project-card"
		class:selected={$translationIdSelected === file.id}
		onclick={() => selectAndShowModal(file.id!)}
		aria-label={`Open options for ${projectName}`}
	>
		<span class="card-topline">
			<span class="words-badge">{sourceWords} words</span>
			<span class="type-badge">{file.translationData.type}</span>
		</span>
		<span class="progress-circle" aria-label={`${progress}% complete`}>
			<span>{progress}%</span>
			<svg aria-hidden="true" viewBox="0 0 100 100">
				<circle class="bg" cx="50" cy="50" r="40"></circle>
				<circle
					class="progress"
					cx="50"
					cy="50"
					r="40"
					style={`stroke-dashoffset: ${(252 * (100 - progress)) / 100}`}
				></circle>
			</svg>
		</span>
		<span class="project-name" title={projectName}>{displayName}</span>
		<span class="project-meta">
			<span
				><strong>{file.translationData.checked.length}</strong> segments</span
			>
			<span>{creationDate}</span>
		</span>
		<span class="languages">
			<span class="source-lang">{sourceLanguage}</span>
			<span class="language-arrow" aria-hidden="true">→</span>
			<span class="target-lang">{targetLanguage}</span>
		</span>
		<span class="open-hint"
			>Project options <span aria-hidden="true">→</span></span
		>
	</button>
{:else if viewMode === "classic"}
	<button
		type="button"
		class="classic-project-card"
		class:selected={$translationIdSelected === file.id}
		onclick={() => selectAndShowModal(file.id!)}
		aria-label={`Open options for ${projectName}`}
	>
		<span class="classic-words-badge">{sourceWords}</span>
		<span class="classic-type-badge">{file.translationData.type}</span>
		<span class="classic-progress-circle" aria-label={`${progress}% complete`}>
			<span>{progress}%</span>
			<svg aria-hidden="true" viewBox="0 0 100 100">
				<circle class="bg" cx="50" cy="50" r="40"></circle>
				<circle
					class="progress"
					cx="50"
					cy="50"
					r="40"
					style={`stroke-dashoffset: ${(252 * (100 - progress)) / 100}`}
				></circle>
			</svg>
		</span>
		<span class="classic-project-name" title={projectName}
			>{classicDisplayName}</span
		>
		<span class="classic-info">
			<span
				><strong>{file.translationData.checked.length}</strong> Segments</span
			>
			<span>{creationDate}</span>
		</span>
		<span class="classic-languages">
			<span>{sourceLanguage}</span>
			<span>{targetLanguage}</span>
		</span>
	</button>
{:else}
	<button
		type="button"
		class="project-row"
		class:selected={$translationIdSelected === file.id}
		onclick={() => selectAndShowModal(file.id!)}
		aria-label={`Open options for ${projectName}`}
	>
		<span class="project-primary">
			<strong title={projectName}>{displayName}</strong>
			<small>Open project options</small>
		</span>
		<span class="table-type">{file.translationData.type}</span>
		<span class="table-languages">
			{sourceLanguage}<span aria-hidden="true">→</span>{targetLanguage}
		</span>
		<span>{file.translationData.checked.length}</span>
		<span>{sourceWords}</span>
		<span class="table-progress">
			<span><i style={`width: ${progress}%`}></i></span>
			<strong>{progress}%</strong>
		</span>
		<span>{creationDate}</span>
	</button>
{/if}

<style>
	.project-card {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		min-width: 0;
		border: 1px solid #d4e5e8;
		border-radius: 0.8rem;
		background: white;
		padding: 1rem;
		color: #294c58;
		font: inherit;
		text-align: center;
		position: relative;
		width: 100%;
		cursor: pointer;
		overflow: hidden;
		box-shadow: 0 5px 16px rgba(38, 83, 96, 0.06);
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			border-color 0.18s ease;
	}

	.project-card:hover,
	.project-card:focus-visible {
		border-color: #72afbd;
		box-shadow: 0 12px 28px rgba(38, 83, 96, 0.14);
		transform: translateY(-2px);
		outline: none;
	}

	.project-card.selected,
	.classic-project-card.selected,
	.project-row.selected {
		border-color: var(--color-theme-4);
		box-shadow: 0 0 0 2px rgba(55, 154, 184, 0.12);
	}

	.classic-project-card {
		display: flex;
		position: relative;
		flex-direction: column;
		align-items: stretch;
		width: 100%;
		min-height: 298px;
		border: 0;
		background: white;
		padding: 1rem;
		color: #17364a;
		font: inherit;
		text-align: center;
		cursor: pointer;
		overflow: hidden;
		transition: box-shadow 0.18s ease;
	}

	.classic-project-card:hover,
	.classic-project-card:focus-visible {
		z-index: 1;
		box-shadow: 0 1px 10px var(--color-theme-4);
		outline: none;
	}

	.classic-words-badge,
	.classic-type-badge {
		position: absolute;
		top: 10px;
		border-radius: 3px;
		padding: 2px 5px;
		font-size: 0.7rem;
	}

	.classic-words-badge {
		left: 10px;
		background: var(--color-theme-3);
		color: white;
	}

	.classic-type-badge {
		right: 10px;
		background: var(--color-theme-1);
		color: #333;
	}

	.classic-progress-circle {
		display: block;
		position: relative;
		width: 100px;
		height: 100px;
		margin: 0 auto 1rem;
	}

	.classic-progress-circle svg {
		width: 100px;
		height: 100px;
		transform: rotate(-90deg);
	}

	.classic-progress-circle circle {
		fill: none;
		stroke-width: 7px;
	}

	.classic-progress-circle .bg {
		stroke: #e0e0e0;
	}

	.classic-progress-circle .progress {
		stroke: var(--color-theme-4);
		stroke-dasharray: 252;
		stroke-dashoffset: 252;
	}

	.classic-progress-circle > span {
		position: absolute;
		top: 50%;
		left: 50%;
		color: var(--color-theme-4);
		font-size: 1.5rem;
		font-weight: 700;
		transform: translate(-50%, -50%);
	}

	.classic-project-name {
		display: block;
		margin: 0.5rem 0;
		overflow: hidden;
		color: var(--color-theme-6);
		font-size: 1rem;
		font-weight: 750;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.classic-info {
		display: grid;
		gap: 0.3rem;
		margin-bottom: 5px;
		color: #888;
		font-size: 0.75rem;
	}

	.classic-info strong {
		color: var(--color-theme-4);
		font-weight: 500;
	}

	.classic-info span:last-child {
		color: var(--color-theme-3);
		font-size: 0.7rem;
	}

	.classic-languages {
		display: flex;
		justify-content: space-evenly;
		margin-top: auto;
		background: var(--color-theme-8);
		padding: 2px 0;
		font-size: 0.8rem;
		text-transform: uppercase;
	}

	.classic-languages span:first-child {
		color: rgb(70, 196, 213);
	}

	.classic-languages span:last-child {
		color: rgb(38, 102, 232);
	}

	.card-topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		min-height: 1.55rem;
	}

	.type-badge,
	.table-type {
		border-radius: 999px;
		background: #dff4f7;
		padding: 0.25rem 0.55rem;
		color: #176b80;
		font-size: 0.66rem;
		font-weight: 800;
		letter-spacing: 0.045em;
		text-transform: uppercase;
	}

	.words-badge {
		color: #6a8189;
		font-size: 0.69rem;
		font-weight: 700;
	}

	.progress-circle {
		display: block;
		position: relative;
		width: 92px;
		height: 92px;
		margin: 1rem auto 0.8rem;
	}

	.progress-circle svg {
		transform: rotate(-90deg);
		width: 92px;
		height: 92px;
	}

	.progress-circle circle {
		fill: none;
		stroke-width: 7px;
	}

	.progress-circle .bg {
		stroke: #e2ecee;
	}

	.progress-circle .progress {
		stroke: var(--color-theme-4);
		stroke-dasharray: 252;
		stroke-dashoffset: 252;
		stroke-linecap: round;
		transition: stroke-dashoffset 0.3s ease;
	}

	.progress-circle > span {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 1.15rem;
		color: var(--color-theme-4);
		font-weight: 800;
	}

	.project-name {
		display: block;
		overflow: hidden;
		color: #173f4e;
		font-size: 0.96rem;
		font-weight: 800;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-meta {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.4rem;
		margin: 0.45rem 0 0.8rem;
		color: #748990;
		font-size: 0.7rem;
	}

	.project-meta span + span::before {
		content: "·";
		margin-right: 0.4rem;
		color: #a1b2b7;
	}

	.project-meta strong {
		color: #3e6572;
	}

	.languages {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		gap: 0.4rem;
		border-radius: 0.45rem;
		background: #edf7f8;
		padding: 0.45rem 0.6rem;
	}

	.source-lang,
	.target-lang {
		overflow: hidden;
		font-size: 0.7rem;
		font-weight: 750;
		text-overflow: ellipsis;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.source-lang {
		color: #288b9f;
		text-align: right;
	}

	.target-lang {
		color: #285fc2;
		text-align: left;
	}

	.language-arrow {
		color: #8ba1a8;
	}

	.open-hint {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 0.8rem;
		padding-top: 0.75rem;
		border-top: 1px solid #e3edef;
		color: #39798b;
		font-size: 0.69rem;
		font-weight: 750;
	}

	.project-row {
		display: grid;
		grid-template-columns: var(--project-columns);
		gap: 0.85rem;
		align-items: center;
		width: 100%;
		min-height: 4.25rem;
		border: 0;
		border-bottom: 1px solid #e0ebed;
		background: white;
		padding: 0.75rem 1rem;
		color: #567079;
		font: inherit;
		font-size: 0.76rem;
		text-align: left;
		cursor: pointer;
		transition:
			background-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.project-row:hover,
	.project-row:focus-visible {
		background: #f3fafb;
		box-shadow: inset 3px 0 0 var(--color-theme-4);
		outline: none;
	}

	.project-primary {
		display: grid;
		min-width: 0;
	}

	.project-primary strong {
		overflow: hidden;
		color: #234c5a;
		font-size: 0.82rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.project-primary small {
		margin-top: 0.2rem;
		color: #8a9ca2;
		font-size: 0.66rem;
	}

	.table-type {
		justify-self: start;
	}

	.table-languages {
		display: flex;
		gap: 0.3rem;
		align-items: center;
		color: #316f82;
		font-weight: 750;
		text-transform: uppercase;
	}

	.table-languages span {
		color: #91a4a9;
	}

	.table-progress {
		display: flex;
		align-items: center;
		gap: 0.55rem;
	}

	.table-progress > span {
		flex: 1;
		height: 0.35rem;
		border-radius: 999px;
		background: #dfeaec;
		overflow: hidden;
	}

	.table-progress i {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--color-theme-4);
	}

	.table-progress strong {
		min-width: 2.2rem;
		color: #397588;
		font-size: 0.7rem;
		text-align: right;
	}
</style>
