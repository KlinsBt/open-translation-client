<script lang="ts">
	import {
		getTotalWordCount,
		calcPercentageOfTotalSegmentsChecked,
	} from "$lib/functions/statistics";
	import type { TbData, TmData, UserData } from "$lib/types/types.js";
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
		if (data.translationData.tm) {
			if (
				typeof data.translationData.tm.id === "number" &&
				data.translationData.tm.active
			) {
				console.log("Loading TM data");
				// await loadTmDataOfProject(data.translationData.tm.id);
				getAllTmDataFromIndexedDB();
			}
		}
		if (data.translationData.tb) {
			if (
				typeof data.translationData.tb.id === "number" &&
				data.translationData.tb.active
			) {
				console.log("Loading TB data");
				// await loadTbDataOfProject(data.translationData.tb.id);
				getAllTbDataFromIndexedDB();
			}
		}
		singleUserData.set(data);
		translationIdSelected.set(id);
		seg1WordCount.set(getTotalWordCount(data.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(data.translationData.seg2));
		openMenu.set(false);
		showLoading.set(false);
	}

	async function getAllTmDataFromIndexedDB() {
		showLoading.set(true);
		if ($tmData.length > 0) {
			showLoading.set(false);
			return;
		} else {
			let data = await loadTmDataFromIndexedDB();
			tmData.set(data as TmData[]);
			showLoading.set(false);
			console.log(tmData);
		}
	}

	async function getAllTbDataFromIndexedDB() {
		showLoading.set(true);
		if ($tbData.length > 0) {
			showLoading.set(false);
			return;
		} else {
			let data = await loadTbDataFromIndexedDB();
			tbData.set(data as TbData[]);
			showLoading.set(false);
			console.log(tbData);
		}
	}

	// async function loadTmDataOfProject(tmId: number) {
	// 	let tm = await getTmDataById(tmId);
	// 	if (!tm) return console.log("TM data not found");
	// 	singleTmData.set(tm);
	// 	console.log($singleTmData);
	// }

	// async function loadTbDataOfProject(tbId: number) {
	// 	let tb = await getTbDataById(tbId);
	// 	if (!tb) return console.log("TB data not found");
	// 	singleTbData.set(tb);
	// 	console.log($singleTbData);
	// }

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
		notifyInfo("Project name updated");
	}

	function updateFileLanguages() {
		if (!$singleUserData) return console.log("Data not found");
		if (newTargetLang === "" || newSourceLang === "") {
			notifyError("Please select both source and target languages");
			return;
		}
		let newUserData = $singleUserData;
		newUserData.translationData.sourceLang = newSourceLang;
		newUserData.translationData.targetLang = newTargetLang;
		singleUserData.set(newUserData);
		updateTranslationOnIndexedDB($singleUserData);
		editLanguagesWindow = false;
		show = false;
		notifyInfo("Project languages updated");
	}

	function handleSaveFileDeletion(id: number) {
		if (typeof id !== "number") return console.log("Invalid ID");
		console.log("Deleting file with ID: ", id);
		deleteTranslationFromIndexedDB(id);
		confirmDeletionWindow = false;
		show = false;
		notifyError("Project deleted");
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

	function selectAndShowModal(id: number) {
		optionsOpen = false;
		show = true;
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
	<Modal
		title={file.translationData.name.length > 15
			? file.translationData.name.slice(0, 15) + "..."
			: file.translationData.name}
		content={options}
	/>
</div>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="project-card" onclick={() => selectAndShowModal(file.id!)}>
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
	<h4>
		{file.translationData.name.length > 15
			? file.translationData.name.slice(0, 15) + "..."
			: file.translationData.name}
	</h4>
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
	.project-card {
		background: white;
		padding: 1rem;
		text-align: center;
		position: relative;
		width: 150px;
		cursor: pointer;
		overflow: hidden;
		/* border-radius: 8px; */
		/* box-shadow: 0 2px 4px var(--color-theme-1); */
	}

	.project-card:hover {
		box-shadow: 0 1px 10px var(--color-theme-4);
	}

	.type-badge {
		position: absolute;
		top: 10px;
		right: 10px;
		background-color: #ffcc4d;
		background-color: var(--color-theme-1);
		color: #333;
		border-radius: 3px;
		padding: 2px 5px;
		font-size: 0.7rem;
	}

	.words-badge {
		position: absolute;
		top: 10px;
		left: 10px;
		background-color: var(--color-theme-3);
		color: white;
		border-radius: 3px;
		padding: 2px 5px;
		font-size: 0.7rem;
	}

	.progress-circle {
		position: relative;
		width: 100px;
		height: 100px;
		margin: 0 auto 1rem;
	}

	.progress-circle svg {
		transform: rotate(-90deg);
		width: 100px;
		height: 100px;
	}

	.progress-circle circle {
		fill: none;
		stroke-width: 7;
	}

	.progress-circle .bg {
		stroke: #e0e0e0;
	}

	.progress-circle .progress {
		stroke: var(--color-theme-4);
		stroke-dasharray: 252;
		stroke-dashoffset: 252;
		transition: stroke-dashoffset 0.3s;
	}

	.progress-circle span {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		font-size: 1.5rem;
		color: var(--color-theme-4);
		font-weight: bold;
	}

	h4 {
		font-size: 1rem;
		margin: 0.5rem 0;
		color: var(--color-theme-6);
	}

	p {
		font-size: 0.8rem;
		color: #888;
		margin: 0.5rem 0;
	}

	.text-info {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		padding: 0rem;
		margin: 0px 0px 5px 0px;
		border-radius: 5px;
		font-size: 0.85rem;
		color: #555;
	}

	.text-info > p {
		margin: 0;
		font-weight: 500;
	}

	.text-info > p > span {
		font-weight: 500;
		color: var(--color-theme-4);
	}

	.creation-date {
		font-size: 0.7rem;
		color: var(--color-theme-3);
	}

	.languages {
		display: flex;
		justify-content: space-evenly;
		gap: 0rem;
		padding: 2px 0px;
		background-color: var(--color-theme-8);
	}

	.source-lang {
		font-size: 0.8rem;
		text-transform: uppercase;
		color: rgb(70, 196, 213);
	}

	.target-lang {
		font-size: 0.8rem;
		text-transform: uppercase;
		color: rgb(38, 102, 232);
	}

	.options-container {
		display: flex;
		justify-content: center;
		align-items: start;
		flex-wrap: wrap;
		padding: 0px;
	}

	.options {
		display: grid;
		justify-items: center;
		align-items: center;
		transition: bottom 0.15s linear;
	}

	.option-buttons-container {
		display: flex;
		flex-direction: column;
		gap: 0px;
		margin: 0px;
	}

	.option-buttons-container > input {
		padding: 10px;
		margin: 5px 0px;
		border: 1px solid var(--color-theme-4);
		border-radius: 5px;
	}

	.deletion-confirmation {
		font-size: 1.2rem;
		font-weight: 600;
		margin: 0px 0px 10px 0px;
		color: var(--color-theme-4);
		color: #c02b2b;
		text-align: center;
		max-width: 280px;
	}

	.main-buttons-container {
		display: grid;
		gap: 0px;
	}

	.main-buttons-container > .btn,
	.option-buttons-container > .btn {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--color-theme-4);
		color: white;
		border: none;
		font-size: 1.3rem;
		border-radius: 5px;
		padding: 10px;
		margin: 5px 0px;
		cursor: pointer;
		width: 100%;
		min-width: 250px;
		transition: filter 0.2s linear;
		position: relative;
	}

	.main-buttons-container > .btn > span,
	.option-buttons-container > .btn > span {
		margin: 0px 10px;
	}

	.main-buttons-container > .btn:hover,
	.option-buttons-container > .btn:hover {
		filter: brightness(1.1);
	}

	.language-selection {
		display: grid;
		justify-items: center;
		gap: 10px;
		margin: 0px 0px 5px 0px;
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
</style>
