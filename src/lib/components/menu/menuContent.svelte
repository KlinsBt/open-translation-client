<script lang="ts">
	// import IndexedDB from "../../IndexedDbExample.svelte";
	// import TextInput from "$lib/old/textInput.svelte";
	// import PdfUpload from "$lib/components/uploads/pdfInput.svelte";
	// import Compr from "$lib/components/uploads/compression/msgPackUpload.svelte";
	// import { loadTranslationsUserData } from "$lib/functions/saveData/localStorage";
	import TextUpload from "$lib/components/uploads/textUpload.svelte";
	import JsonUpload from "$lib/components/uploads/jsonUpload.svelte";
	import DocxUpload from "$lib/components/uploads/docxUpload.svelte";
	import ExcelUpload from "$lib/components/uploads/xlsxUpload.svelte";
	import HtmlUpload from "$lib/components/uploads/htmlUpload.svelte";
	import SaveFileUpload from "$lib/components/uploads/saveFileUploads/saveFileUpload.svelte";
	import ProjectCard from "./components/projectCards.svelte";
	import RightArrow from "../svg/rightArrow.svelte";
	import {
		sortUserDataByDateAscending,
		sortUserDataByDateDescending,
		sortUserDataByNameAscending,
		sortUserDataByNameDescending,
	} from "$lib/functions/sorting";
	import { loadTranslationsUserDataFromIndexedDB } from "$lib/functions/saveData/indexedDb";
	import {
		showLoading,
		userData,
		userDataStatistics,
	} from "$lib/functions/saveData/stores.svelte";
	import { onMount } from "svelte";
	import { getProjectsProgressStatistics } from "$lib/functions/statistics";
	import Modal from "../modal.svelte";
	import { goto } from "$app/navigation";

	let newProject: number = $state(0);
	let sortByName: boolean = $state(false); // default sort by date
	let ascendingOrder: boolean = $state(true); // default ascending order

	let showUploadModal: boolean = $state(false);

	onMount(async () => {
		if ($userData.length === 0) {
			showLoading.set(true);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		await loadTranslationsUserDataFromIndexedDB();
		userDataStatistics.set(getProjectsProgressStatistics($userData));
		showLoading.set(false);
	});

	function toggleSortByName() {
		sortByName = true;
		ascendingOrder = !ascendingOrder;
		console.log("Asc: ", ascendingOrder);
		if (sortByName && ascendingOrder) {
			userData.set(sortUserDataByNameAscending($userData));
		} else if (sortByName && !ascendingOrder) {
			userData.set(sortUserDataByNameDescending($userData));
		} else if (!sortByName && ascendingOrder) {
			userData.set(sortUserDataByDateAscending($userData));
		} else if (!sortByName && !ascendingOrder) {
			userData.set(sortUserDataByDateDescending($userData));
		}
	}

	function toggleSortByDate() {
		sortByName = false;
		ascendingOrder = !ascendingOrder;
		// console.log("Asc: ", ascendingOrder);
		if (ascendingOrder) {
			userData.set(sortUserDataByDateAscending($userData));
			console.log($userData);
		} else {
			userData.set(sortUserDataByDateDescending($userData));
			console.log($userData);
		}
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
	class="modal-element-global {showUploadModal ? '' : 'close-modal-global'}"
	onclick={() => (showUploadModal = false)}
>
	<Modal title="Import Save File" content={upload} />
</div>

{#if newProject === 0}
	<div class="dashboard">
		<div class="order-bar">
			<!-- <span>Sort by:</span> -->
			<button class:active={sortByName} onclick={toggleSortByName}>
				Name {sortByName ? (ascendingOrder ? "▲" : "▼") : ""}
			</button>
			<button class:active={!sortByName} onclick={toggleSortByDate}>
				Date {!sortByName ? (ascendingOrder ? "▲" : "▼") : ""}
			</button>
			<button
				class="tm-btn"
				onclick={() => {
					goto("/tm");
				}}
			>
				Translation Memory
			</button>

			<button
				class="tm-btn"
				onclick={() => {
					goto("/tb");
				}}
			>
				Term Base
			</button>
		</div>

		<div class="project-cards">
			{#if $userData?.length > 0}
				{#each $userData as file, i}
					<ProjectCard {file} />
				{/each}
			{/if}
			<div class="add-project">
				<div class="add-icon">+</div>
				<div>
					<button
						onclick={() => {
							newProject = 1;
						}}>Create new project</button
					>
					<button
						onclick={() => {
							showUploadModal = true;
						}}>Upload project file</button
					>
				</div>
			</div>
		</div>
	</div>
	<div class="buttons-container">
		<button
			class="back-btn back"
			onclick={() => {
				goto("/");
			}}
		>
			<!-- <RightArrow /> -->
			Close App
		</button>
	</div>
{:else if newProject === 1}
	<h1 class="section-title">Create Translation Project</h1>

	<div class="new-file-container">
		<JsonUpload />
		<DocxUpload />
		<ExcelUpload />
		<HtmlUpload />
		<TextUpload />
		<!-- <PdfUpload /> -->
		<!-- <Compr /> -->
	</div>

	<button
		class="back-btn back"
		onclick={() => {
			newProject = 0;
		}}
	>
		<RightArrow />
		Go Back
	</button>
{/if}

<style>
	.dashboard {
		display: grid;
		align-content: center;
		align-items: center;
		padding: 50px 0px 50px 0px;
		max-width: 1500px;
	}

	.order-bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		font-weight: 600;
		margin-bottom: 70px;
		color: var(--color-theme-4);
	}

	.order-bar button {
		border: none;
		background: none;
		cursor: pointer;
		font-size: 1rem;
		color: var(--color-theme-3);
	}

	.order-bar .active {
		font-weight: bold;
		border-bottom: 2px solid var(--color-theme-3);
	}

	.project-cards {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 1px;
	}

	/* .additional {
		background-color: var(--color-theme-4);
		color: white;
		padding: 2px 5px;
		border-radius: 3px;
		font-size: 0.7rem;
	} */

	.add-project {
		display: grid;
		justify-items: center;
		align-items: center;
		background: white;
		border: 2px dashed var(--color-theme-4);
		/* border-radius: 8px; */
		padding: 0px 14px;
		width: 150px;
		cursor: pointer;
	}

	.add-icon {
		font-size: 5rem;
		font-weight: 700;
		color: var(--color-theme-4);
		margin: 0px;
	}

	.add-project div {
		display: flex;
		flex-direction: column;
		gap: 10px 0px;
		margin-bottom: 20px;
	}

	.add-project button {
		background-color: var(--color-theme-4);
		color: white;
		border: none;
		border-radius: 5px;
		padding: 10px;
		cursor: pointer;
		font-weight: bold;
		width: 100%;
	}

	.add-project button:hover {
		filter: brightness(1.1);
	}

	.new-file-container {
		display: flex;
		justify-content: center;
		align-items: start;
		flex-wrap: wrap;
		padding: 0px;
		gap: 1rem;
		padding: 0px 0px 50px 0px;
		min-height: 75vh;
	}

	.save-file-upload-container {
		display: flex;
		justify-content: center;
		align-items: start;
		flex-wrap: wrap;
		padding: 0px;
	}

	.back-btn {
		background-color: var(--color-theme-4);
		color: white;
		border: none;
		border-radius: 5px;
		padding: 10px 20px;
		cursor: pointer;
		font-weight: 600;
		font-size: 1.3rem;
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 0px 5px;
		margin: 0px;
	}

	.back-btn:hover {
		filter: brightness(1.1);
	}

	.buttons-container {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 0px 20px;
	}

	.buttons-container > button {
		margin: 10px 0px;
	}

	.section-title {
		text-align: center;
		font-size: 2rem;
		font-weight: 600;
		color: var(--color-theme-3);
	}

	.tm-btn {
		background-color: var(--color-theme-4) !important;
		color: white !important;
		border-radius: 5px !important;
		padding: 10px !important;
		font-weight: 600;
		font-size: 0.8rem !important;
	}

	.tm-btn:hover {
		filter: brightness(1.1);
	}

	button:disabled,
	button[disabled] {
		background-color: #cccccc !important;
		color: #666666 !important;
		pointer-events: none;
	}

	@media (max-width: 774px) {
		.order-bar {
			justify-content: center;
		}

		.project-cards {
			justify-content: center;
		}
	}
</style>
