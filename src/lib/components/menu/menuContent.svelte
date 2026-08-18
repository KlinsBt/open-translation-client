<script lang="ts">
	// import IndexedDB from "../../IndexedDbExample.svelte";
	// import TextInput from "$lib/old/textInput.svelte";
	// import PdfUpload from "$lib/components/uploads/pdfInput.svelte";
	// import Compr from "$lib/components/uploads/compression/msgPackUpload.svelte";
	// import { loadTranslationsUserData } from "$lib/functions/saveData/localStorage";
	import SaveFileUpload from "$lib/components/uploads/saveFileUploads/saveFileUpload.svelte";
	import ProjectCard from "./components/projectCards.svelte";
	import {
		sortUserDataByDateAscending,
		sortUserDataByDateDescending,
		sortUserDataByNameAscending,
		sortUserDataByNameDescending,
	} from "$lib/functions/sorting";
	import { loadTranslationsUserDataFromIndexedDB } from "$lib/functions/saveData/indexedDb";
	import { showLoading, userData } from "$lib/functions/saveData/stores.svelte";
	import { onMount } from "svelte";
	import Modal from "../modal.svelte";
	import { goto } from "$app/navigation";
	import {
		loadParsingPreferences,
		type ParsingPreference,
	} from "$lib/functions/parsing/parsingPreferences";
	import ParsingPreferencesModal from "./components/parsingPreferencesModal.svelte";
	import UniversalUpload from "$lib/components/uploads/universalUpload.svelte";
	import {
		filterProjects,
		getNextProjectSort,
		parseProjectViewMode,
		type ProjectSortState,
		type ProjectViewMode,
	} from "./projectDashboard";

	let sortState: ProjectSortState = $state({
		field: "date",
		ascending: false,
	});
	let viewMode: ProjectViewMode = $state("cards");
	let searchQuery = $state("");
	let visibleProjects = $derived(filterProjects($userData, searchQuery));

	let showUploadModal: boolean = $state(false);
	let showNewProjectModal: boolean = $state(false);
	let showParsingModal: boolean = $state(false);
	let parsingPreferences: ParsingPreference[] = $state([]);

	onMount(async () => {
		if ($userData.length === 0) {
			showLoading.set(true);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		await loadTranslationsUserDataFromIndexedDB();
		applySort();
		showLoading.set(false);
		parsingPreferences = loadParsingPreferences();

		viewMode = parseProjectViewMode(
			localStorage.getItem("opentlc-project-view"),
		);
	});

	function applySort() {
		const projects = [...$userData];
		if (sortState.field === "name") {
			userData.set(
				sortState.ascending
					? sortUserDataByNameAscending(projects)
					: sortUserDataByNameDescending(projects),
			);
			return;
		}

		userData.set(
			sortState.ascending
				? sortUserDataByDateAscending(projects)
				: sortUserDataByDateDescending(projects),
		);
	}

	function changeSort(field: ProjectSortState["field"]) {
		sortState = getNextProjectSort(sortState, field);
		applySort();
	}

	function changeViewMode(mode: ProjectViewMode) {
		viewMode = mode;
		localStorage.setItem("opentlc-project-view", mode);
	}
</script>

{#snippet upload()}
	<div class="save-file-upload-container">
		<SaveFileUpload />
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	tabindex="-1"
	class="modal-element-global {showUploadModal ? '' : 'close-modal-global'}"
	onclick={() => (showUploadModal = false)}
>
	<Modal title="Import Save File" content={upload} />
</div>

<ParsingPreferencesModal bind:show={showParsingModal} bind:parsingPreferences />
<UniversalUpload bind:show={showNewProjectModal} />

<div class="dashboard">
	<header class="workspace-header">
		<div class="workspace-title">
			<p class="eyebrow">Local workspace</p>
			<h1>Your projects</h1>
			<p>Open, organize and continue translations stored in this browser.</p>
		</div>

		<div class="workspace-actions">
			<button class="back-link" onclick={() => goto("/")}>
				<span aria-hidden="true">←</span> Back to website
			</button>
			<button class="secondary-action" onclick={() => (showUploadModal = true)}>
				Import project
			</button>
			<button
				class="primary-action"
				onclick={() => (showNewProjectModal = true)}
			>
				<span aria-hidden="true">+</span> New project
			</button>
		</div>
	</header>

	<nav class="workspace-tools" aria-label="Workspace tools">
		<button onclick={() => (showParsingModal = true)}>
			<span class="tool-icon" aria-hidden="true">P</span>
			<span>
				<strong>Parsing preferences</strong>
				<small>Segmentation and import rules</small>
			</span>
		</button>
		<button onclick={() => goto("/tm")}>
			<span class="tool-icon" aria-hidden="true">TM</span>
			<span>
				<strong>Translation Memory</strong>
				<small>Manage reusable translations</small>
			</span>
		</button>
		<button onclick={() => goto("/tb")}>
			<span class="tool-icon" aria-hidden="true">TB</span>
			<span>
				<strong>Term Base</strong>
				<small>Manage approved terminology</small>
			</span>
		</button>
	</nav>

	<section class="workspace-panel" aria-labelledby="project-library-title">
		<div class="panel-heading">
			<div>
				<h2 id="project-library-title">Project library</h2>
				<p>
					{visibleProjects.length === $userData.length
						? `${$userData.length} ${$userData.length === 1 ? "project" : "projects"}`
						: `${visibleProjects.length} of ${$userData.length} projects`}
				</p>
			</div>
		</div>

		<div class="project-toolbar">
			<label class="project-search">
				<span class="visually-hidden">Search projects</span>
				<span class="search-icon" aria-hidden="true"></span>
				<input
					type="search"
					placeholder="Search projects, formats or languages"
					bind:value={searchQuery}
				/>
			</label>

			<div class="toolbar-options">
				<div class="sort-controls" aria-label="Sort projects">
					<span>Sort by</span>
					<button
						class:active={sortState.field === "name"}
						aria-pressed={sortState.field === "name"}
						aria-label={`Sort projects by name${sortState.field === "name" ? `, ${sortState.ascending ? "ascending" : "descending"}` : ""}`}
						onclick={() => changeSort("name")}
					>
						Name
						{#if sortState.field === "name"}
							<span aria-hidden="true">{sortState.ascending ? "↑" : "↓"}</span>
						{/if}
					</button>
					<button
						class:active={sortState.field === "date"}
						aria-pressed={sortState.field === "date"}
						aria-label={`Sort projects by date${sortState.field === "date" ? `, ${sortState.ascending ? "ascending" : "descending"}` : ""}`}
						onclick={() => changeSort("date")}
					>
						Date
						{#if sortState.field === "date"}
							<span aria-hidden="true">{sortState.ascending ? "↑" : "↓"}</span>
						{/if}
					</button>
				</div>

				<div class="view-controls" aria-label="Project view">
					<button
						class:active={viewMode === "cards"}
						aria-pressed={viewMode === "cards"}
						onclick={() => changeViewMode("cards")}
					>
						<span class="cards-icon" aria-hidden="true"></span> Cards
					</button>
					<button
						class:active={viewMode === "classic"}
						aria-pressed={viewMode === "classic"}
						onclick={() => changeViewMode("classic")}
					>
						<span class="classic-icon" aria-hidden="true"></span> Classic
					</button>
					<button
						class:active={viewMode === "table"}
						aria-pressed={viewMode === "table"}
						onclick={() => changeViewMode("table")}
					>
						<span class="table-icon" aria-hidden="true"></span> Table
					</button>
				</div>
			</div>
		</div>

		{#if $userData.length === 0}
			<div class="empty-state">
				<span aria-hidden="true">+</span>
				<h3>Create your first project</h3>
				<p>Import a source file or start a new translation project locally.</p>
				<div>
					<button
						class="primary-action"
						onclick={() => (showNewProjectModal = true)}
					>
						New project
					</button>
					<button
						class="secondary-action"
						onclick={() => (showUploadModal = true)}
					>
						Import project
					</button>
				</div>
			</div>
		{:else if visibleProjects.length === 0}
			<div class="empty-state search-empty">
				<h3>No matching projects</h3>
				<p>Try a project name, file format, or source and target language.</p>
				<button class="secondary-action" onclick={() => (searchQuery = "")}>
					Clear search
				</button>
			</div>
		{:else if viewMode !== "table"}
			<div
				class="project-grid"
				class:classic-grid={viewMode === "classic"}
				aria-label="Projects"
			>
				{#each visibleProjects as file (file.id)}
					<ProjectCard {file} {viewMode} />
				{/each}
			</div>
		{:else}
			<div class="project-table-wrapper">
				<div class="project-table" aria-label="Projects">
					<div class="project-table-header" aria-hidden="true">
						<span>Project</span>
						<span>Format</span>
						<span>Languages</span>
						<span>Segments</span>
						<span>Words</span>
						<span>Progress</span>
						<span>Created</span>
					</div>
					{#each visibleProjects as file (file.id)}
						<ProjectCard {file} viewMode="table" />
					{/each}
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.dashboard {
		display: grid;
		gap: 1.5rem;
		width: min(1240px, calc(100vw - 3rem));
		padding: 2.5rem 0 4rem;
		color: #173947;
	}

	.workspace-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1.5rem 2rem;
	}

	.workspace-title {
		min-width: min(100%, 320px);
	}

	.eyebrow {
		margin: 0 0 0.45rem;
		color: #19708a;
		font-size: 0.7rem;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.workspace-title h1 {
		margin: 0;
		color: #153f4e;
		font-size: clamp(1.85rem, 3vw, 2.55rem);
		letter-spacing: -0.035em;
		line-height: 1.1;
		text-align: left;
	}

	.workspace-title > p:last-child {
		margin: 0.65rem 0 0;
		color: #607983;
		font-size: 0.92rem;
	}

	.workspace-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.workspace-actions button,
	.empty-state button {
		min-height: 2.65rem;
		border-radius: 0.55rem;
		padding: 0.65rem 1rem;
		font: inherit;
		font-size: 0.84rem;
		font-weight: 750;
		cursor: pointer;
		transition:
			transform 0.18s ease,
			box-shadow 0.18s ease,
			background-color 0.18s ease,
			border-color 0.18s ease;
	}

	.primary-action {
		border: 1px solid var(--color-theme-4);
		background: var(--color-theme-4);
		color: white;
		box-shadow: 0 6px 16px rgba(24, 112, 145, 0.16);
	}

	.primary-action span {
		margin-right: 0.25rem;
		font-size: 1.1rem;
		line-height: 0;
	}

	.secondary-action {
		border: 1px solid #aacbd3;
		background: rgba(255, 255, 255, 0.78);
		color: #176b84;
	}

	.back-link {
		border: 1px solid transparent;
		background: transparent;
		color: #58727c;
	}

	.workspace-actions button:hover,
	.empty-state button:hover {
		transform: translateY(-1px);
	}

	.primary-action:hover {
		box-shadow: 0 8px 20px rgba(24, 112, 145, 0.24);
		filter: brightness(1.04);
	}

	.secondary-action:hover,
	.back-link:hover {
		border-color: #74aebb;
		background: white;
	}

	.workspace-tools {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.workspace-tools button {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		min-width: 0;
		border: 1px solid #c7dfe4;
		border-radius: 0.75rem;
		background: rgba(255, 255, 255, 0.82);
		padding: 0.85rem 1rem;
		color: #245563;
		font: inherit;
		text-align: left;
		cursor: pointer;
		box-shadow: 0 5px 16px rgba(34, 84, 98, 0.05);
		transition:
			transform 0.18s ease,
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.workspace-tools button:hover,
	.workspace-tools button:focus-visible {
		border-color: #65aabd;
		box-shadow: 0 9px 22px rgba(34, 84, 98, 0.11);
		transform: translateY(-1px);
		outline: none;
	}

	.tool-icon {
		display: grid;
		flex: 0 0 2.25rem;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0.55rem;
		background: #dff3f6;
		color: #126e87;
		font-size: 0.7rem;
		font-weight: 850;
	}

	.workspace-tools button > span:last-child {
		display: grid;
		min-width: 0;
	}

	.workspace-tools strong {
		color: #194858;
		font-size: 0.83rem;
	}

	.workspace-tools small {
		margin-top: 0.18rem;
		overflow: hidden;
		color: #728990;
		font-size: 0.68rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.workspace-panel {
		--project-columns: minmax(220px, 2fr) 84px 120px 86px 80px 150px 104px;
		min-width: 0;
		border: 1px solid #cfe1e5;
		border-radius: 1rem;
		background: rgba(255, 255, 255, 0.82);
		box-shadow: 0 18px 50px rgba(34, 84, 98, 0.09);
		overflow: hidden;
	}

	.panel-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem 2rem;
		padding: 1.4rem 1.5rem 1.15rem;
		border-bottom: 1px solid #dcebed;
	}

	.panel-heading h2 {
		margin: 0;
		color: #194453;
		font-size: 1.12rem;
	}

	.panel-heading p {
		margin: 0.3rem 0 0;
		color: #71868d;
		font-size: 0.78rem;
	}

	.project-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1rem 1.5rem;
		background: #f6fbfc;
	}

	.project-search {
		position: relative;
		flex: 1 1 300px;
		max-width: 430px;
	}

	.project-search input {
		width: 100%;
		height: 2.55rem;
		border: 1px solid #c7dce1;
		border-radius: 0.55rem;
		background: white;
		padding: 0 0.85rem 0 2.45rem;
		color: #274b58;
		font: inherit;
		font-size: 0.83rem;
		outline: none;
		transition:
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.project-search input:focus {
		border-color: #3994ac;
		box-shadow: 0 0 0 3px rgba(57, 148, 172, 0.14);
	}

	.project-search input::placeholder {
		color: #899ba1;
	}

	.search-icon {
		position: absolute;
		top: 50%;
		left: 0.85rem;
		z-index: 1;
		width: 0.72rem;
		height: 0.72rem;
		border: 2px solid #6f929d;
		border-radius: 50%;
		transform: translateY(-58%);
		pointer-events: none;
	}

	.search-icon::after {
		content: "";
		position: absolute;
		right: -0.35rem;
		bottom: -0.25rem;
		width: 0.38rem;
		height: 2px;
		border-radius: 2px;
		background: #6f929d;
		transform: rotate(45deg);
	}

	.toolbar-options,
	.sort-controls,
	.view-controls {
		display: flex;
		align-items: center;
	}

	.toolbar-options {
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.7rem 1.25rem;
	}

	.sort-controls {
		gap: 0.65rem;
	}

	.sort-controls > span {
		color: #758a91;
		font-size: 0.72rem;
		font-weight: 750;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.sort-controls button {
		border: 0;
		background: transparent;
		padding: 0.35rem 0.12rem;
		color: #53717c;
		font: inherit;
		font-size: 0.79rem;
		font-weight: 700;
		text-decoration-line: underline;
		text-decoration-color: #bed3d8;
		text-decoration-thickness: 1px;
		text-underline-offset: 0.45em;
		cursor: pointer;
	}

	.sort-controls button:hover,
	.sort-controls button:focus-visible {
		color: #126d86;
		text-decoration-color: currentColor;
	}

	.sort-controls button.active {
		color: #126d86;
		text-decoration-color: currentColor;
		text-decoration-thickness: 3px;
	}

	.view-controls {
		padding: 0.2rem;
		border: 1px solid #c8dce1;
		border-radius: 0.55rem;
		background: #eaf4f6;
	}

	.view-controls button {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		border: 0;
		border-radius: 0.38rem;
		background: transparent;
		padding: 0.42rem 0.62rem;
		color: #617983;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 750;
		cursor: pointer;
	}

	.view-controls button.active {
		background: white;
		color: #126d86;
		box-shadow: 0 1px 4px rgba(29, 72, 86, 0.14);
	}

	.cards-icon,
	.classic-icon,
	.table-icon {
		display: inline-block;
		width: 0.75rem;
		height: 0.65rem;
		background: repeating-linear-gradient(
			90deg,
			currentColor 0 3px,
			transparent 3px 5px
		);
	}

	.classic-icon {
		border: 1px solid currentColor;
		border-radius: 1px;
		background: none;
	}

	.table-icon {
		background: repeating-linear-gradient(
			0deg,
			currentColor 0 2px,
			transparent 2px 4px
		);
	}

	.project-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(215px, 1fr));
		gap: 1rem;
		padding: 1.5rem;
	}

	.project-grid.classic-grid {
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 1px;
		background: #e3eff1;
	}

	.project-table-wrapper {
		overflow-x: auto;
		padding: 0 1.5rem 1.5rem;
	}

	.project-table {
		min-width: 900px;
		border: 1px solid #d6e5e8;
		border-radius: 0.7rem;
		overflow: hidden;
	}

	.project-table-header {
		display: grid;
		grid-template-columns: var(--project-columns);
		gap: 0.85rem;
		align-items: center;
		padding: 0.75rem 1rem;
		background: #edf6f8;
		color: #617a83;
		font-size: 0.68rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.project-table :global(.project-row:last-child) {
		border-bottom: 0;
	}

	.empty-state {
		display: grid;
		justify-items: center;
		padding: 4.5rem 1.5rem;
		text-align: center;
	}

	.empty-state > span {
		display: grid;
		place-items: center;
		width: 3.5rem;
		height: 3.5rem;
		border: 1px dashed #5aa9bc;
		border-radius: 50%;
		color: #318aa2;
		font-size: 2rem;
	}

	.empty-state h3 {
		margin: 1rem 0 0;
		color: #1c4a59;
		font-size: 1.15rem;
	}

	.empty-state p {
		max-width: 430px;
		margin: 0.55rem 0 1.15rem;
		color: #71868d;
		font-size: 0.85rem;
	}

	.empty-state div {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.65rem;
	}

	.search-empty {
		padding-block: 3.5rem;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.save-file-upload-container {
		display: flex;
		justify-content: center;
		align-items: start;
		flex-wrap: wrap;
		padding: 0;
	}

	button:disabled {
		background-color: #cccccc !important;
		color: #666666 !important;
		pointer-events: none;
	}

	@media (max-width: 760px) {
		.dashboard {
			width: min(100% - 1.5rem, 1240px);
			padding-top: 1.5rem;
		}

		.workspace-header,
		.workspace-actions {
			align-items: stretch;
			flex-direction: column;
		}

		.workspace-actions {
			width: 100%;
		}

		.workspace-actions button {
			width: 100%;
		}

		.panel-heading,
		.project-toolbar {
			padding-inline: 1rem;
		}

		.workspace-tools {
			grid-template-columns: 1fr;
		}

		.project-search {
			flex-basis: 100%;
			max-width: none;
		}

		.toolbar-options {
			width: 100%;
			justify-content: space-between;
		}

		.project-grid {
			grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
			padding: 1rem;
		}

		.project-table-wrapper {
			padding-inline: 1rem;
		}
	}

	@media (max-width: 460px) {
		.toolbar-options {
			align-items: stretch;
			flex-direction: column;
		}

		.sort-controls,
		.view-controls {
			justify-content: center;
		}

		.view-controls button {
			flex: 1;
			justify-content: center;
		}

		.project-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
