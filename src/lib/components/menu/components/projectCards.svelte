<script lang="ts">
	import {
		getTotalWordCount,
		calcPercentageOfTotalSegmentsChecked,
	} from "$lib/functions/statistics";
	import type { UserData } from "$lib/types/types.js";
	import OpenFile from "../../svg/openFile.svelte";
	import Options from "../../svg/options.svelte";
	import Delete from "../../svg/delete.svelte";
	import RightArrow from "../../svg/rightArrow.svelte";
	import Languages from "../../svg/languages.svelte";
	import Rename from "../../svg/rename.svelte";
	import {
		openMenu,
		seg1WordCount,
		seg2WordCount,
		singleUserData,
		translationIdSelected,
		showLoading,
		userData,
	} from "$lib/functions/saveData/stores.svelte";
	import {
		deleteTranslationFromIndexedDB,
		updateTranslationOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import Modal from "../../modal.svelte";
	import { LANGUAGES } from "$lib/components/data/languages";

	let optionsOpen: boolean = $state(false);
	let editNameWindow: boolean = $state(false);
	let editLanguagesWindow: boolean = $state(false);
	let confirmDeletionWindow: boolean = $state(false);

	let newFileName: string = $state("");
	let newSourceLang: string = $state("");
	let newTargetLang: string = $state("");

	async function loadFile(id: number) {
		// Set loading state immediately
		showLoading.set(true);
		// Small timeout to ensure loading state is updated before proceeding
		await new Promise((resolve) => setTimeout(resolve, 0));
		let data = $userData.find((d) => d.id === id);
		console.log(data);
		if (!data) {
			console.log("Data not found");
			showLoading.set(false);
			return;
		}
		singleUserData.set(data);
		translationIdSelected.set(id);
		seg1WordCount.set(getTotalWordCount(data.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(data.translationData.seg2));
		openMenu.set(false);
		showLoading.set(false);
	}

	function updateFileName(newName: string) {
		console.log("Updating file name to: ", newName);
		if (!$singleUserData) return console.log("Data not found");
		if (newName === "") return console.log("Invalid name");
		let newUserData = $singleUserData;
		newUserData.translationData.name = newName;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		editNameWindow = false;
		show = false;
	}

	function updateFileLanguages() {
		if (!$singleUserData) return console.log("Data not found");
		if (newTargetLang === "" || newSourceLang === "")
			return console.log("Invalid languages");
		let newUserData = $singleUserData;
		newUserData.translationData.sourceLang = newSourceLang;
		newUserData.translationData.targetLang = newTargetLang;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		editLanguagesWindow = false;
		show = false;
	}

	function handleSaveFileDeletion(id: number) {
		if (typeof id !== "number") return console.log("Invalid ID");
		console.log("Deleting file with ID: ", id);
		deleteTranslationFromIndexedDB(id);
		show = false;
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
	}: {
		file: UserData;
	} = $props();

	function check(opt: number, lang: string) {
		if (opt === 1) {
			console.log("source");
			newSourceLang = lang;
			console.log(newSourceLang);
		} else {
			console.log("target");
			newTargetLang = lang;
			console.log(newTargetLang);
		}
	}
</script>

{#snippet options()}
	<div class="options-container">
		{#if !optionsOpen}
			<div class="main-buttons-container">
				<button class="btn save" onclick={() => loadFile(file.id!)}>
					Open Project
					<span>
						<OpenFile />
					</span>
				</button>
				<button class="btn option" onclick={() => (optionsOpen = true)}>
					Edit Project
					<span>
						<Options />
					</span>
				</button>
			</div>
		{:else}
			<div class="options">
				<div class="option-buttons-container">
					{#if editNameWindow}
						<input
							type="text"
							bind:value={newFileName}
							placeholder="New File Name"
						/>
						<button class="btn" onclick={() => updateFileName(newFileName)}>
							Confirm New Name
						</button>
						<button class="btn update" onclick={() => (editNameWindow = false)}>
							Cancel
						</button>
					{:else if editLanguagesWindow}
						<div class="language-selection">
							<select
								onchange={(e) =>
									check(1, (e.target as HTMLSelectElement).value)}
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
							>
								<option disabled selected value="">Target Language ▼</option>
								{#each LANGUAGES as lang}
									<option value={lang.name + " (" + lang.code + ")"}
										>{lang.name} ({lang.code})</option
									>
								{/each}
							</select>
						</div>
						<button class="btn" onclick={() => updateFileLanguages()}>
							Confirm New Languages
						</button>
						<button
							class="btn update"
							onclick={() => (editLanguagesWindow = false)}
						>
							Cancel
						</button>
					{:else if confirmDeletionWindow}
						<p class="deletion-confirmation">
							Are you sure you want to delete this project?
						</p>
						<button
							class="btn delete"
							onclick={() => handleSaveFileDeletion(file.id!)}
						>
							Delete
						</button>
						<button
							class="btn update"
							onclick={() => (confirmDeletionWindow = false)}
						>
							Cancel
						</button>
					{:else}
						<button class="btn option" onclick={() => (editNameWindow = true)}>
							Rename Project
							<span>
								<Rename />
							</span>
						</button>
						<button
							class="btn option"
							onclick={() => (editLanguagesWindow = true)}
						>
							Edit Languages
							<span>
								<Languages />
							</span>
						</button>
						<button
							class="btn delete"
							onclick={() => (confirmDeletionWindow = true)}
						>
							Delete Project
							<span>
								<Delete />
							</span>
						</button>
						<button class="btn update" onclick={() => (optionsOpen = false)}>
							<span style="display: grid; margin-left: -5px">
								<RightArrow />
							</span>
							Go Back
						</button>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	class="modal-element-global {show ? '' : 'close-modal-global'}"
	onclick={() => (show = false)}
>
	<Modal title={file.translationData.name} content={options} />
</div>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="project-card" onclick={() => (show = true)}>
	<span class="words-badge">
		{getTotalWordCount(file.translationData.seg1)}
	</span>
	<span class="type-badge">{file.translationData.type}</span>
	<div class="progress-circle">
		<span
			>{calcPercentageOfTotalSegmentsChecked(
				file.translationData.checked,
			)}%</span
		>
		<svg>
			<circle class="bg" cx="50" cy="50" r="40"></circle>
			<circle
				class="progress"
				cx="50"
				cy="50"
				r="40"
				style="stroke-dashoffset: {(252 *
					(100 -
						parseInt(
							calcPercentageOfTotalSegmentsChecked(
								file.translationData.checked,
							).toString(),
						))) /
					100};"
			></circle>
		</svg>
	</div>
	<h4>{file.translationData.name}</h4>
	<div class="text-info">
		<!-- <p>
								<span>{getTotalWordCount(file.translationData.seg1)}</span> /
								<span>{getTotalWordCount(file.translationData.seg2)}</span> Words
							</p> -->
		<p><span>{file.translationData.checked.length}</span> Segments</p>
		<p class="creation-date">
			{unixTimeToDate(parseInt(file.translationData.creationDate))}
		</p>
	</div>
	<div class="languages">
		<span class="source-lang"
			>{getStringInsideBrackets(file.translationData.sourceLang)}</span
		>
		<span class="target-lang"
			>{getStringInsideBrackets(file.translationData.targetLang)}</span
		>
		<!-- {#if file.translationData.additionalLanguages}
								<span class="additional">+{file.translationData.additionalLanguages}</span>
							{/if} -->
	</div>
</div>

<style>
</style>
