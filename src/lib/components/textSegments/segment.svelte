<script lang="ts">
	import { updateTmOnIndexedDB } from "$lib/functions/saveData/indexedDb";
	// import { getTranslationMemoryMatches } from "$lib/components/translationMemory/tmFunctions";
	import {
		singleUserData,
		seg2WordCount,
		singleTmData,
		tmData,
		tbData,
		singleTbData,
		selectedSegmentId,
	} from "$lib/functions/saveData/stores.svelte";
	import { getTotalWordCount } from "$lib/functions/statistics";
	import {
		searchForMatches,
		translationUnitValidationError,
	} from "$lib/components/translationMemory/tmFunctions";
	import { getTermMatches } from "$lib/components/termBase/tbFunctions";
	import type { TbData, TmData, UserData } from "$lib/types/types";
	import {
		notifyError,
		notifySuccess,
	} from "$lib/components/notifications/toastStore";
	import { getSplitOffsetFromSelection } from "$lib/functions/parsing/segmentSelection";
	import { isRtlLanguage } from "$lib/functions/languageDirection";

	let {
		id,
		textSegment1,
		textSegment2,
		locked,
		confirmed,
		combineSelected = false,
		joinBoundaries = [],
		splitOffset = null,
		onMarkSplit,
		onSplitSegment,
		onToggleCombine,
		onActivateSegment,
		onEditTarget,
		onFlushEdits,
		onPersistProjectMutation,
	}: {
		id: number;
		textSegment1: string;
		textSegment2: string;
		locked: boolean;
		confirmed: boolean;
		combineSelected?: boolean;
		joinBoundaries?: number[];
		splitOffset?: number | null;
		onMarkSplit?: (detail: { index: number; offset: number | null }) => void;
		onSplitSegment?: (detail: { index: number; offset: number }) => void;
		onToggleCombine?: (detail: { index: number }) => void;
		onActivateSegment?: (detail: { index: number }) => void;
		onEditTarget?: (detail: { index: number; value: string }) => void;
		onFlushEdits?: () => Promise<void>;
		onPersistProjectMutation: (
			mutate: (project: UserData) => void,
		) => Promise<UserData | undefined>;
	} = $props();

	let tmMatchesFound: { segment: string; match: string; percentage: string }[] =
		$state([]);
	let tbMatchesFound: {
		searchEntry: string;
		foundEntry: string;
		notes: string[];
	}[] = $state([]);
	let sourceLang: string = $derived(
		getLanguageCode($singleUserData.translationData.sourceLang),
	);
	let targetLang: string = $derived(
		getLanguageCode($singleUserData.translationData.targetLang),
	);
	let rightToLeftSourceLang: boolean = $derived(isRtlLanguage(sourceLang));
	let rightToLeftTargetLang: boolean = $derived(isRtlLanguage(targetLang));
	let tmActive: boolean = $derived(
		$singleUserData.translationData.tm?.active ?? false,
	);
	let isSelected: boolean = $derived($selectedSegmentId === id);
	let validTmActive: boolean = $derived(
		tmActive &&
			$singleUserData.translationData.tm?.id != null &&
			$tmData.some(
				(resource) => resource.id === $singleUserData.translationData.tm?.id,
			),
	);
	type SourceDisplayPart = { text: string; markerOffset: number | null };
	let sourceDisplayParts: SourceDisplayPart[] = $derived.by(() => {
		const offsets = new Set(
			joinBoundaries.filter(
				(offset) => offset > 0 && offset < textSegment1.length,
			),
		);
		if (
			splitOffset !== null &&
			splitOffset > 0 &&
			splitOffset < textSegment1.length
		) {
			offsets.add(splitOffset);
		}

		const parts: SourceDisplayPart[] = [];
		let cursor = 0;
		for (const offset of [...offsets].sort((a, b) => a - b)) {
			parts.push({
				text: textSegment1.slice(cursor, offset),
				markerOffset: offset,
			});
			cursor = offset;
		}
		parts.push({ text: textSegment1.slice(cursor), markerOffset: null });
		return parts;
	});

	async function commitProjectMutation(mutate: (project: UserData) => void) {
		try {
			return await onPersistProjectMutation(mutate);
		} catch (error) {
			notifyError(
				error instanceof Error ? error.message : "Could not save this project.",
			);
			return undefined;
		}
	}

	async function toggleLockSegment() {
		const nextLocked = !locked;
		const updated = await commitProjectMutation((project) => {
			project.translationData.locked[id] = nextLocked;
			if (!nextLocked) project.translationData.checked[id] = false;
		});
		if (updated) {
			locked = nextLocked;
			if (!nextLocked) confirmed = false;
		}
	}

	async function toggleSegmentConfirmation() {
		if (!confirmed && !textSegment2.trim()) {
			notifyError("Add a target translation before confirming this segment.");
			return;
		}
		const nextConfirmed = !confirmed;
		const updated = await commitProjectMutation((project) => {
			project.translationData.checked[id] = nextConfirmed;
			if (nextConfirmed) project.translationData.locked[id] = true;
		});
		if (updated) {
			confirmed = nextConfirmed;
			if (nextConfirmed) locked = true;
		}
	}

	async function fillTargetSegmentText() {
		if (!$singleUserData) return;
		if (locked) return notifyError("Unlock this segment before changing it.");
		if (textSegment1 === "" || textSegment2 !== "") return;
		const updated = await commitProjectMutation((project) => {
			project.translationData.seg2[id] = textSegment1;
			project.translationData.checked[id] = false;
		});
		if (updated) {
			textSegment2 = textSegment1;
			seg2WordCount.set(getTotalWordCount(updated.translationData.seg2));
		}
	}

	function handleSourceMouseUp(event: MouseEvent) {
		const container = event.currentTarget as HTMLElement;
		const offset = getSplitOffsetFromSelection(
			container,
			window.getSelection(),
			textSegment1.length,
		);
		onMarkSplit?.({ index: id, offset });
	}

	function splitAtCaret() {
		if (locked || splitOffset === null) return;
		onSplitSegment?.({ index: id, offset: splitOffset });
	}

	function selectSplitOffset(offset: number) {
		onMarkSplit?.({ index: id, offset });
	}

	function handleMarkerKeydown(event: KeyboardEvent, offset: number) {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		selectSplitOffset(offset);
	}

	function toggleCombineSelect() {
		if (locked) return;
		onToggleCombine?.({ index: id });
	}

	function activateSegment() {
		selectedSegmentId.set(id);
		onActivateSegment?.({ index: id });
	}

	function handleInput(event: Event) {
		const value = (event.target as HTMLTextAreaElement).value;
		textSegment2 = value;
		selectedSegmentId.set(id);
		onEditTarget?.({ index: id, value });
	}

	function useAutoHeight(node: HTMLTextAreaElement) {
		function adjustHeight() {
			// Reset the height so the scrollHeight can be recalculated properly
			node.style.height = "auto";
			// Set the height based on scrollHeight (the actual content height)
			node.style.height = `${node.scrollHeight}px`;
		}

		// Run the adjustment on initialization
		adjustHeight();

		// Add event listeners to adjust height when content changes
		node.addEventListener("input", adjustHeight);

		return {
			destroy() {
				// Remove the event listener when the component is destroyed
				node.removeEventListener("input", adjustHeight);
			},
		};
	}

	function updateTmMatches(textSegment1: string) {
		let id = $singleUserData.translationData.tm?.id;
		singleTmData.set($tmData.find((data) => data.id === id) as TmData);
		tmMatchesFound = searchForMatches(
			$singleTmData,
			textSegment1,
			sourceLang,
			targetLang,
		);
	}

	function updateTbMatches(textSegment1: string) {
		let id = $singleUserData.translationData.tb?.id;
		singleTbData.set($tbData.find((data) => data.id === id) as TbData);
		tbMatchesFound = getTermMatches(
			$singleTbData,
			textSegment1,
			sourceLang,
			targetLang,
		);
	}

	function getLanguageCode(lang?: string): string {
		// Extract language code from full name like "English (en)" or return as-is
		if (!lang) return "";
		const match = lang.match(/\(([^)]+)\)/);
		return match?.[1] ?? lang;
	}

	async function tmIdExists(id: number | null): Promise<boolean> {
		if (id === null) return false;
		return !!$tmData.find((data) => data.id === id);
	}

	async function tbIdExists(id: number | null): Promise<boolean> {
		if (id === null) return false;
		return !!$tbData.find((data) => data.id === id);
	}

	async function checkIfElligibleForTmOrTbSearch(textSegment1: string) {
		selectedSegmentId.set(id);
		if (
			$singleUserData.translationData.tm?.active &&
			$singleUserData.translationData.tm?.id !== null &&
			(await tmIdExists($singleUserData.translationData.tm?.id))
		) {
			updateTmMatches(textSegment1);
		}
		if (
			$singleUserData.translationData.tb?.active &&
			$singleUserData.translationData.tb?.id !== null &&
			(await tbIdExists($singleUserData.translationData.tb?.id))
		) {
			updateTbMatches(textSegment1);
		}
	}

	async function addTranslationUnit(
		sourceSentence: string,
		targetSentence: string,
	) {
		if (locked) return notifyError("Unlock this segment before changing it.");
		if (!validTmActive || !$singleTmData?.terms)
			return notifyError("Choose an available translation memory first.");
		const validationError = translationUnitValidationError(
			sourceSentence,
			targetSentence,
			sourceLang,
			targetLang,
		);
		if (validationError) return notifyError(validationError);
		let localTmData = structuredClone($singleTmData);
		localTmData.terms.push({
			// id: localTmData.terms.length + 1,
			source: {
				lang: sourceLang,
				segment: sourceSentence,
			},
			target: [
				{
					lang: targetLang,
					segment: targetSentence,
				},
			],
		});
		try {
			await updateTmOnIndexedDB(localTmData);
			singleTmData.set(localTmData);
			notifySuccess("Translation unit added to TM successfully!");
		} catch (error) {
			notifyError(
				error instanceof Error
					? error.message
					: "Could not add this translation unit.",
			);
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="segment"
	data-segment-id={id}
	tabindex="0"
	class:selected={isSelected}
	class:combine-selected={combineSelected}
	class:segment-locked={locked}
	onclick={activateSegment}
	onfocus={activateSegment}
>
	<button
		class="toggle-container {locked ? 'locked' : 'unlocked'}"
		onclick={toggleLockSegment}
		aria-label={locked ? "Unlock segment" : "Lock segment"}
	>
		{#if locked}
			<!-- Locked Icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
				<path
					d="M 12 1 C 8.6761905 1 6 3.6761905 6 7 L 6 8 C 4.9 8 4 8.9 4 10 L 4 20 C 4 21.1 4.9 22 6 22 L 18 22 C 19.1 22 20 21.1 20 20 L 20 10 C 20 8.9 19.1 8 18 8 L 18 7 C 18 3.6761905 15.32381 1 12 1 z M 12 3 C 14.27619 3 16 4.7238095 16 7 L 16 8 L 8 8 L 8 7 C 8 4.7238095 9.7238095 3 12 3 z M 12 13 C 13.1 13 14 13.9 14 15 C 14 16.1 13.1 17 12 17 C 10.9 17 10 16.1 10 15 C 10 13.9 10.9 13 12 13 z"
				></path>
			</svg>
		{:else}
			<!-- Unlocked Icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
				<path
					d="M 18 1 C 14.67619 1 12 3.6761905 12 7 L 12 8 L 2.9296875 8 C 1.8656875 8 1 8.897 1 10 L 1 20 C 1 21.103 1.8656875 22 2.9296875 22 L 14.070312 22 C 15.134312 22 16 21.103 16 20 L 16 10 C 16 8.897 15.135266 8 14.072266 8 L 14 8 L 14 7 C 14 4.7238095 15.72381 3 18 3 C 20.27619 3 22 4.7238095 22 7 L 22 9 L 24 9 L 24 7 C 24 3.6761905 21.32381 1 18 1 z M 8.5078125 13 C 9.6078125 13 10.507812 13.9 10.507812 15 C 10.507812 16.1 9.6078125 17 8.5078125 17 C 7.4078125 17 6.5078125 16.1 6.5078125 15 C 6.5078125 13.9 7.4078125 13 8.5078125 13 z"
				></path>
			</svg>
		{/if}
	</button>

	<input
		type="checkbox"
		class="combine-toggle-checkbox"
		checked={combineSelected}
		onchange={toggleCombineSelect}
		disabled={locked}
		title="Select for combining"
	/>

	<!-- <span class="segment-number-outer">{id + 1}</span> -->

	<div class="field left source-text">
		<div class="left-buttons-container">
			<button
				class="translate-btn"
				data-segment-action="fill"
				onclick={() => fillTargetSegmentText()}
				disabled={locked || textSegment2 !== ""}
				title={locked
					? "Unlock this segment before filling it"
					: textSegment2 !== ""
						? "The target already contains text"
						: "Copy the source text into the empty target"}
			>
				Fill
				<span>→</span>
			</button>
			<button
				class="tm-btn split-btn"
				onclick={(event) => {
					event.stopPropagation();
					splitAtCaret();
				}}
				disabled={locked || splitOffset === null}
				title="Place the caret inside the source text to enable split"
			>
				Split
			</button>
			<button
				class="tm-btn save"
				disabled={locked ||
					!validTmActive ||
					!textSegment1.trim() ||
					!textSegment2.trim() ||
					!sourceLang ||
					!targetLang}
				title="Save this completed source and target pair to the selected translation memory"
				onclick={() => addTranslationUnit(textSegment1, textSegment2)}
			>
				TM<span>+</span>
			</button>
		</div>
		<span class="segment-number-inner">{id + 1}.</span>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<p
			class="source-select"
			lang={sourceLang}
			dir={rightToLeftSourceLang ? "rtl" : "ltr"}
			onmouseup={handleSourceMouseUp}
		>
			{#each sourceDisplayParts as part}
				{part.text}{#if part.markerOffset !== null}<span
						class="source-split-marker"
						class:active-split-marker={splitOffset === part.markerOffset}
						class:join-boundary-marker={joinBoundaries.includes(
							part.markerOffset,
						)}
						role="button"
						tabindex="0"
						aria-label={joinBoundaries.includes(part.markerOffset)
							? "Select original join boundary for splitting"
							: "Selected split position"}
						title={joinBoundaries.includes(part.markerOffset)
							? "Original join boundary — click to split here"
							: "Segment will split here"}
						onclick={(event) => {
							event.stopPropagation();
							selectSplitOffset(part.markerOffset!);
						}}
						onkeydown={(event) =>
							handleMarkerKeydown(event, part.markerOffset!)}
					></span>{/if}
			{/each}
		</p>
	</div>

	<button
		class="confirm-btn"
		class:confirmed
		data-segment-action="confirm"
		onclick={toggleSegmentConfirmation}
		disabled={!textSegment2.trim()}
		aria-pressed={confirmed}
		title={!textSegment2.trim()
			? "Add a target translation before confirming this segment"
			: confirmed
				? "Mark this segment as needing review"
				: "Confirm and lock this translated segment"}
	>
		{confirmed ? "Confirmed" : "Confirm"}
	</button>

	{#if locked}
		<p
			class="field left target-field locked-target"
			lang={targetLang}
			dir={rightToLeftTargetLang ? "rtl" : "ltr"}
		>
			{textSegment2}
		</p>
	{:else}
		<textarea
			lang={targetLang}
			dir={rightToLeftTargetLang ? "rtl" : "ltr"}
			spellcheck="false"
			onfocus={async () => {
				checkIfElligibleForTmOrTbSearch(textSegment1);
			}}
			oninput={handleInput}
			onblur={() => void onFlushEdits?.()}
			class="field right"
			class:target-field={true}
			bind:value={textSegment2}
			placeholder="Translate the text here..."
			use:useAutoHeight
			cols="30"
		></textarea>
	{/if}
</div>

<style>
	.segment {
		--read-only-surface: #dcecf0;

		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		overflow: visible;
		width: 100%;
		border: 1px solid #cbdfe4;
		border-radius: 0.75rem;
		background: #cbdfe4;
		box-shadow: 0 3px 10px rgba(21, 72, 88, 0.045);
		transition:
			border-color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.segment:hover {
		border-color: #9dc7d1;
	}

	.segment.selected {
		border-color: #369bb5;
		box-shadow: 0 0 0 3px rgba(54, 155, 181, 0.12);
	}

	.target-field {
		min-height: 6.25rem;
		border: 0;
		background: white;
	}

	.segment.combine-selected {
		border-color: #1d7790;
		border-style: dashed;
		box-shadow: 0 0 0 3px rgba(29, 119, 144, 0.1);
	}

	.source-select {
		line-height: 1.55;
		user-select: text;
	}

	.source-split-marker {
		display: inline-block;
		width: 0;
		height: 1.25em;
		margin: 0 2px;
		border-left: 2px solid var(--color-theme-4);
		vertical-align: -0.25em;
		cursor: pointer;
		opacity: 0.65;
	}

	.source-split-marker.join-boundary-marker {
		border-left-style: dashed;
		border-left-width: 3px;
		opacity: 0.9;
	}

	.source-split-marker.active-split-marker {
		border-left-color: #c54141;
		border-left-style: solid;
		opacity: 1;
		filter: drop-shadow(0 0 2px rgb(197 65 65 / 45%));
	}

	.combine-toggle-checkbox {
		position: absolute;
		width: 1rem;
		height: 1rem;
		cursor: pointer;
		left: -1.3rem;
		top: 50%;
		z-index: 2;
		margin: -0.5rem 0 0;
		accent-color: #268ba7;
	}

	.field {
		display: block;
		box-sizing: border-box;
		width: 100%;
		margin: 0;
		padding: 2.75rem 1rem 1rem;
		border-radius: 0;
		color: #244957;
		font: inherit;
		font-size: 0.9rem;
		transition: 0.18s ease;
	}

	.left-buttons-container {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.35rem;
		position: absolute;
		top: 0.55rem;
		right: 3.5rem;
		z-index: 3;
	}

	.translate-btn,
	.tm-btn,
	.confirm-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.2rem;
		min-width: auto;
		min-height: 1.7rem;
		border: 1px solid #b5d3da;
		border-radius: 0.4rem;
		padding: 0.25rem 0.5rem;
		background: rgba(255, 255, 255, 0.8);
		color: #276d82;
		font: inherit;
		font-size: 0.64rem;
		font-weight: 800;
		cursor: pointer;
		transition: 0.18s ease;
	}

	.translate-btn {
		border-color: #3b9fba;
		background: #3b9fba;
		color: white;
	}

	button.split-btn {
		border-color: #2c7f98;
		background: #2c7f98;
		color: white;
	}

	button.split-btn:disabled {
		border-color: #b5d3da;
		background: rgba(255, 255, 255, 0.8);
		color: #276d82;
	}

	.translate-btn:hover:not(:disabled),
	.tm-btn:hover:not(:disabled),
	.confirm-btn:hover:not(:disabled) {
		transform: translateY(-1px);
		filter: brightness(1.05);
	}

	.translate-btn:disabled,
	.tm-btn:disabled,
	.confirm-btn:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.confirm-btn {
		position: absolute;
		top: 0.2rem;
		left: 50%;
		z-index: 5;
		min-height: 1.85rem;
		padding-inline: 0.62rem;
		background: #f8fcfd;
		box-shadow: 0 2px 8px rgba(21, 72, 88, 0.1);
		transform: translateX(-50%);
		transition:
			border-color 0.18s ease,
			background-color 0.18s ease,
			color 0.18s ease,
			box-shadow 0.18s ease;
	}

	.confirm-btn:hover:not(:disabled) {
		border-color: #6faebb;
		background: white;
		transform: translateX(-50%);
	}

	.confirm-btn.confirmed {
		border-color: #9cccb1;
		background: #eaf6ef !important;
		color: #2d7350 !important;
	}

	.confirm-btn.confirmed::before {
		content: "✓";
		font-size: 0.72rem;
		font-weight: 900;
	}

	.left {
		display: flex;
		align-items: flex-start;
		min-height: 6.25rem;
		background: var(--read-only-surface);
		color: #214a5a;
	}

	.left.target-field {
		border-radius: 0 0.7rem 0.7rem 0;
		background: var(--read-only-surface);
		color: #214a5a;
		line-height: 1.55;
	}

	.segment-locked .locked-target {
		box-shadow: inset 1px 0 0 #cbdfe4;
	}

	.source-text {
		position: relative;
		border-radius: 0.7rem 0 0 0.7rem;
	}

	.left p {
		margin: 0;
	}

	.segment-number-inner {
		position: absolute;
		top: 0.72rem;
		left: 0.85rem;
		color: #2b8da8;
		font-size: 0.72rem;
		font-weight: 850;
	}

	.right {
		border-radius: 0 0.7rem 0.7rem 0;
		color: #263f48;
		resize: none;
		font-size: 0.9rem;
		font-weight: 450;
		line-height: 1.55;
		overflow: hidden !important;
	}

	.right:focus {
		outline: none;
		background: #fbfeff;
		box-shadow: inset 0 0 0 2px #54afc5;
	}

	.toggle-container {
		position: absolute;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.85rem;
		height: 1.85rem;
		z-index: 4;
		border: 1px solid #b9d0d5;
		border-radius: 0.45rem;
		background: white;
		color: #65818a;
		cursor: pointer;
		transition: 0.18s ease;
		right: 0.65rem;
		top: 0.55rem;
	}

	.locked {
		border-color: #c4d9de;
		background: #e9f2f4;
	}

	.unlocked:hover,
	.locked:hover {
		border-color: #6faebb;
		transform: translateY(-1px);
	}

	.locked > svg,
	.unlocked > svg {
		width: 1rem;
		height: 1rem;
		fill: #427381;
	}

	@media (max-width: 760px) {
		.segment {
			grid-template-columns: 1fr;
		}

		.source-text {
			border-radius: 0.7rem 0.7rem 0 0;
		}

		.right,
		.target-field,
		.left.target-field {
			border-radius: 0 0 0.7rem 0.7rem;
		}

		.combine-toggle-checkbox {
			left: 0.55rem;
			top: -0.5rem;
		}

		.confirm-btn,
		.confirm-btn:hover:not(:disabled) {
			left: auto;
			right: 3rem;
			transform: none;
		}

		.left-buttons-container {
			right: 8rem;
		}
	}

	@media (max-width: 460px) {
		.field {
			padding-inline: 0.75rem;
		}
	}
</style>
