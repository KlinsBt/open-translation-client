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

	let newProject: number = $state(0);
	let sortByName: boolean = $state(false); // default sort by date
	let ascendingOrder: boolean = $state(true); // default ascending order

	let show: boolean = $state(false);

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
	class="modal-element-global {show ? '' : 'close-modal-global'}"
	onclick={() => (show = false)}
>
	<Modal title="Import Save File" content={upload} />
</div>

{#if newProject === 0}
	<div class="dashboard">
		<div class="order-bar">
			<span>Sort by:</span>
			<button class:active={sortByName} onclick={toggleSortByName}>
				Name {sortByName ? (ascendingOrder ? "▲" : "▼") : ""}
			</button>
			<button class:active={!sortByName} onclick={toggleSortByDate}>
				Date {!sortByName ? (ascendingOrder ? "▲" : "▼") : ""}
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
							show = true;
						}}>Upload project file</button
					>
				</div>
			</div>
		</div>
	</div>
{:else if newProject === 1}
	<button
		class="back-btn back"
		onclick={() => {
			newProject = 0;
		}}
	>
		<RightArrow />
		Go Back
	</button>
	<div class="new-file-container">
		<JsonUpload />
		<DocxUpload />
		<ExcelUpload />
		<HtmlUpload />
		<TextUpload />
		<!-- <PdfUpload /> -->
		<!-- <Compr /> -->
	</div>
{/if}

<style>
</style>
