<script lang="ts">
	import { onDestroy, onMount, tick } from "svelte";
	import Segment from "./segment.svelte";
	import AutoFill from "../svg/autoFill.svelte";
	import DocLock from "../svg/docLock.svelte";
	import JoinSegments from "../svg/joinSegments.svelte";
	import SaveFile from "../svg/saveFile.svelte";
	import RightArrow from "../svg/rightArrow.svelte";
	import Export from "../svg/export2.svelte";
	import TmTb from "../svg/tmTb.svelte";
	import {
		singleUserData,
		openMenu,
		seg1WordCount,
		seg2WordCount,
		tmData,
		tbData,
		singleTmData,
		selectedSegmentId,
	} from "$lib/functions/saveData/stores.svelte";
	import { functionCreateExportFile } from "$lib/functions/outputGeneration/handleTranslationExport";
	import {
		downloadConvertedTranslation,
		type ConvertedExportFormat,
	} from "$lib/functions/outputGeneration/convertedExport";
	import { getFormatAdapter } from "$lib/formats/registry";

	import { generateJsonSaveFile } from "$lib/functions/saveFileGeneration/generateJsonSaveFile";
	import {
		generateXliffSaveFile2_0,
		generateXliffSaveFile2_1,
	} from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
	import { generateXliffSaveFile1_2 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile1_2";
	import { getXliffVendorProfile } from "$lib/formats/xliffProfiles";
	import { downloadVendorXliff } from "$lib/formats/vendorXliff";
	import {
		getTbNamesAndIds,
		getTmNamesAndIds,
		loadTbDataFromIndexedDB,
		loadTmDataFromIndexedDB,
		updateTranslationOnIndexedDB,
	} from "$lib/functions/saveData/indexedDb";
	import Modal from "../modal.svelte";
	import {
		calcPercentageOfTotalSegmentsChecked,
		countWords,
		getTotalWordCount,
	} from "$lib/functions/statistics";
	import TranslationMemory from "../translationMemory/tmInSegments/translationMemory.svelte";
	import TermBase from "../termBase/tbSegments/termBase.svelte";
	import TmxUpload from "../uploads/tmxUpload/tmxUpload.svelte";
	import TbxUpload from "../uploads/tbxUpload/tbxUpload.svelte";
	import TmEditing from "../translationMemory/tmEditing/tmEditing.svelte";
	import TbEditing from "../termBase/tbEditing/tbEditing.svelte";
	import type { TbData, TmData, UserData } from "$lib/types/types";
	import {
		notifySuccess,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";
	import { editTm, editTb } from "$lib/functions/saveData/stores.svelte";
	import {
		splitSegmentData,
		combineSegmentRangeData,
		getSegmentJoinBoundaryOffsets,
	} from "$lib/functions/parsing/segmentationLogic";
	import { getProjectCompletionSummary } from "$lib/formats/qualityAssurance";
	import { createPersistedEditQueue } from "$lib/functions/saveData/persistedEditQueue";
	import { withLoading } from "$lib/functions/uiHelpers";
	import { VirtualSegmentSizeIndex } from "$lib/functions/virtualSegmentWindow";
	import { formatChangingExportPresentation } from "$lib/functions/outputGeneration/exportPresentation";
	import { resolveEditorShortcut } from "$lib/functions/editorShortcuts";

	const ESTIMATED_SEGMENT_HEIGHT = 126;
	const SEGMENT_GAP = 10;
	const VIRTUAL_OVERSCAN = 10;
	const CONVERTED_EXPORTS: ReadonlyArray<{
		format: ConvertedExportFormat;
		icon: string;
		label: string;
		description: string;
	}> = [
		{
			format: "pdf",
			icon: "PDF",
			label: "PDF document",
			description: "A polished, shareable PDF containing the translated text.",
		},
		{
			format: "docx",
			icon: "DOCX",
			label: "Word document",
			description: "Translated segments as an editable DOCX document.",
		},
		{
			format: "rtf",
			icon: "RTF",
			label: "Rich Text Format",
			description: "Portable formatted text for Word and compatible editors.",
		},
		{
			format: "html",
			icon: "HTML",
			label: "Web page",
			description: "UTF-8 HTML with one paragraph per translated segment.",
		},
		{
			format: "txt",
			icon: "TXT",
			label: "Plain text",
			description: "Target-language text without document formatting.",
		},
		{
			format: "csv",
			icon: "CSV",
			label: "Bilingual CSV",
			description: "Source, target, segment number, and confirmation status.",
		},
	];
	let segmentsContainer: HTMLElement | null = $state(null);
	let virtualSizeIndex = new VirtualSegmentSizeIndex(
		$singleUserData.translationData.seg2.length,
		ESTIMATED_SEGMENT_HEIGHT,
	);
	let virtualStart = $state(0);
	let virtualEnd = $state(
		Math.min($singleUserData.translationData.seg2.length, 30),
	);
	let virtualRevision = $state(0);
	let tmSelected: null | number = $derived(
		$singleUserData.translationData.tm?.id ?? null,
	);
	let tmActive: boolean = $state(
		$singleUserData.translationData.tm?.active ?? false,
	);

	let tbSelected: number | null = $state(
		$singleUserData.translationData.tb?.id ?? null,
	);
	let tbActive: boolean = $state(
		$singleUserData.translationData.tb?.active ?? false,
	);
	let lastSelectedSegmentId: number = $state(0);
	const primaryExportPresentation = $derived.by(() => {
		const data = $singleUserData.translationData;
		const formatChanging = formatChangingExportPresentation(data);
		if (formatChanging) return formatChanging;
		if (data.type === "odf") {
			const profile =
				typeof data.typeRef === "object" &&
				typeof data.typeRef.profile === "string"
					? data.typeRef.profile.toUpperCase()
					: "OpenDocument";
			return {
				label: profile,
				description: `Rebuild the translated ${profile} package while retaining its template, master-document, formula, scripts, embedded objects, and other package resources.`,
			};
		}
		if (data.type === "html") {
			const extension =
				typeof data.typeRef === "object" &&
				typeof data.typeRef.sourceExtension === "string"
					? data.typeRef.sourceExtension.toUpperCase()
					: "HTML";
			return {
				label: extension,
				description: `Rebuild the translated ${extension} file while preserving server directives, template expressions, help targets, encoding, and unrelated markup.`,
			};
		}
		if (data.type === "visio") {
			const extension =
				typeof data.typeRef === "object" &&
				typeof data.typeRef.sourceExtension === "string"
					? data.typeRef.sourceExtension.toUpperCase()
					: "VISIO";
			const binary =
				typeof data.typeRef === "object" &&
				data.typeRef.profile === "visio-binary";
			return binary
				? {
						label: "VDX conversion",
						description: `Create an editable Visio XML drawing from the translated ${extension} source; unchanged projects retain the exact original binary.`,
					}
				: {
						label: extension,
						description: `Rebuild the translated ${extension} drawing, stencil, template, or report while retaining formulas, geometry, macros, relationships, objects, and binary resources.`,
					};
		}
		if (data.type === "psd") {
			const unchanged =
				data.seg1.length === data.seg2.length &&
				data.seg1.every((source, index) => source === data.seg2[index]);
			return unchanged
				? {
						label: "Original PSD",
						description:
							"Export the exact retained Photoshop source because no text layer has changed.",
					}
				: {
						label: "SVG text-layer conversion",
						description:
							"Create a safe SVG containing the translated text layers at their recorded positions; the retained original PSD remains in the project.",
					};
		}
		if (data.type === "outlook-msg") {
			const unchanged =
				data.seg1.length === data.seg2.length &&
				data.seg1.every((source, index) => source === data.seg2[index]);
			return unchanged
				? {
						label: "Original Outlook MSG",
						description:
							"Export the exact retained Outlook item because no selected text has changed.",
					}
				: {
						label: "Safe EML delivery",
						description:
							"Create a UTF-8 email containing the translated subject and body. Opaque attachments and unknown MAPI properties remain only in the retained source MSG.",
					};
		}
		if (data.type !== "legacy-office")
			return {
				label: getFormatAdapter(data.type).label,
				description:
					"Rebuild the translated file in its original source format.",
			};
		const extension =
			typeof data.typeRef === "object" &&
			typeof data.typeRef.sourceExtension === "string"
				? data.typeRef.sourceExtension.toUpperCase()
				: "LEGACY OFFICE";
		if (["DOC", "DOT", "BAK"].includes(extension))
			return {
				label: "DOCX conversion",
				description: `Create an editable DOCX from the translated ${extension} source.`,
			};
		if (["PPT", "PPS", "POT"].includes(extension))
			return {
				label: "HTML conversion",
				description: `Create translated HTML from the ${extension} source without claiming layout round-trip.`,
			};
		return {
			label: "XLSX conversion",
			description: `Create a modern XLSX/XLSM delivery from the translated ${extension} workbook so formulas and VBA can remain protected.`,
		};
	});

	let showSaveFileModal: boolean = $state(false);
	let showTmTbModal: boolean = $state(false);
	let showTmAddModal: boolean = $state(false);
	let showTbAddModal: boolean = $state(false);
	let pendingDeliveryExport: (() => Promise<void>) | null = $state(null);
	let exportInProgress = $state(false);
	let exportError: string | null = $state(null);
	let completionWarning = $derived(
		getProjectCompletionSummary($singleUserData),
	);
	let combineSelection: Set<number> = $state(new Set());
	let persistenceFailureCount = 0;
	let persistenceHealthy = true;
	const projectEditQueue = createPersistedEditQueue<UserData>(
		$singleUserData,
		updateTranslationOnIndexedDB,
		{
			onCommit() {
				persistenceHealthy = true;
			},
			onFailure(error, committed) {
				persistenceFailureCount += 1;
				persistenceHealthy = false;
				singleUserData.set(committed);
				seg1WordCount.set(getTotalWordCount(committed.translationData.seg1));
				seg2WordCount.set(getTotalWordCount(committed.translationData.seg2));
				notifyError(
					error instanceof Error
						? error.message
						: "Could not save the latest segment edit.",
				);
			},
		},
		{
			cloneScheduled: (project) => project,
			cloneForPersistence: (project) => structuredClone(project),
			onPersisted: (scheduled, persisted) => {
				if (
					scheduled.id !== undefined &&
					persisted.id !== undefined &&
					scheduled.id !== persisted.id
				)
					return;
				scheduled.persistenceRevision = persisted.persistenceRevision;
				if (scheduled.id === undefined) scheduled.id = persisted.id;
			},
		},
	);
	let pendingSplitOffsets: Map<number, number> = $state(new Map());
	let percentage: number = $derived(
		calcPercentageOfTotalSegmentsChecked(
			$singleUserData.translationData.checked,
		),
	);
	let allSegmentsLocked = $derived(
		$singleUserData.translationData.locked.length > 0 &&
			$singleUserData.translationData.locked.every(Boolean),
	);
	let translationExportAvailable: boolean = $derived(
		getFormatAdapter($singleUserData.translationData.type).capabilities.export,
	);
	let vendorXliffProfile = $derived(
		getXliffVendorProfile($singleUserData.translationData.documentModel),
	);

	function refreshVirtualWindow() {
		const viewportHeight = segmentsContainer?.clientHeight ?? 741;
		const range = virtualSizeIndex.rangeForViewport(
			segmentsContainer?.scrollTop ?? 0,
			viewportHeight,
			VIRTUAL_OVERSCAN,
		);
		virtualStart = range.start;
		virtualEnd = range.end;
	}

	function handleScroll() {
		refreshVirtualWindow();
	}

	function virtualOffset(index: number): number {
		void virtualRevision;
		return virtualSizeIndex.offsetFor(index);
	}

	function virtualTotalHeight(): number {
		void virtualRevision;
		return virtualSizeIndex.totalSize();
	}

	function resetVirtualMeasurementsFrom(index: number, count: number) {
		virtualSizeIndex.resize(count);
		virtualSizeIndex.resetFrom(index);
		virtualRevision += 1;
		refreshVirtualWindow();
	}

	function measureSegment(node: HTMLElement, index: number) {
		let currentIndex = index;
		let pendingFrame: number | undefined;
		const measure = () => {
			const measured = node.getBoundingClientRect().height + SEGMENT_GAP;
			if (virtualSizeIndex.update(currentIndex, measured)) {
				virtualRevision += 1;
				refreshVirtualWindow();
			}
		};
		const scheduleMeasure = () => {
			if (pendingFrame !== undefined) return;
			pendingFrame = requestAnimationFrame(() => {
				pendingFrame = undefined;
				measure();
			});
		};
		const observer = new ResizeObserver(scheduleMeasure);
		observer.observe(node);
		queueMicrotask(scheduleMeasure);
		return {
			update(nextIndex: number) {
				currentIndex = nextIndex;
				scheduleMeasure();
			},
			destroy() {
				if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
				observer.disconnect();
			},
		};
	}

	$effect(() => {
		const count = $singleUserData.translationData.seg2.length;
		if (virtualSizeIndex.count === count) return;
		virtualSizeIndex.resize(count);
		virtualRevision += 1;
		refreshVirtualWindow();
	});

	onMount(() => {
		refreshVirtualWindow();
		let pendingFrame: number | undefined;
		const scheduleRefresh = () => {
			if (pendingFrame !== undefined) return;
			pendingFrame = requestAnimationFrame(() => {
				pendingFrame = undefined;
				refreshVirtualWindow();
			});
		};
		const observer = new ResizeObserver(scheduleRefresh);
		if (segmentsContainer) observer.observe(segmentsContainer);
		return () => {
			if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
			observer.disconnect();
		};
	});

	function exportFailureMessage(error: unknown): string {
		if (error instanceof DOMException && error.name === "AbortError")
			return "Export was cancelled. Your project is unchanged; choose a format to try again.";
		const detail = error instanceof Error ? error.message.trim() : "";
		return detail
			? `${detail} Your project is unchanged; correct the problem and retry.`
			: "The file could not be exported. Your project is unchanged; try again.";
	}

	async function completeExport(
		action: () => Promise<unknown> | unknown,
		successMessage: string,
	) {
		if (exportInProgress) return;
		exportError = null;
		exportInProgress = true;
		try {
			await projectEditQueue.flush();
			if (!persistenceHealthy)
				throw new Error(
					"The latest edit was not saved, so export was cancelled. Resolve the storage or concurrent-edit error and save again before exporting.",
				);
			await action();
			pendingDeliveryExport = null;
			showSaveFileModal = false;
			notifySuccess(successMessage);
		} catch (error) {
			pendingDeliveryExport = null;
			exportError = exportFailureMessage(error);
		} finally {
			exportInProgress = false;
		}
	}

	async function exportTranslatedSourceAndClose() {
		await completeExport(
			() => functionCreateExportFile($singleUserData),
			"Translation file exported",
		);
	}

	async function exportConvertedFile(format: ConvertedExportFormat) {
		await completeExport(
			() => downloadConvertedTranslation($singleUserData, format),
			`${format.toUpperCase()} file exported`,
		);
	}

	async function requestDeliveryExport(action: () => Promise<void>) {
		const completion = getProjectCompletionSummary($singleUserData);
		if (
			completion.emptyTargetUnits.length > 0 ||
			completion.unconfirmedUnits.length > 0
		) {
			pendingDeliveryExport = action;
			return;
		}
		await action();
	}

	async function continueIncompleteExport() {
		const action = pendingDeliveryExport;
		pendingDeliveryExport = null;
		if (action) await action();
	}

	async function persistCandidate(project: UserData) {
		const failureCount = persistenceFailureCount;
		singleUserData.set(project);
		seg1WordCount.set(getTotalWordCount(project.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(project.translationData.seg2));
		void projectEditQueue.schedule(project);
		await projectEditQueue.flush();
		return persistenceFailureCount === failureCount;
	}

	async function persistProjectMutation(
		mutate: (project: UserData) => void,
	): Promise<UserData | undefined> {
		const candidate = structuredClone($singleUserData);
		mutate(candidate);
		if (!(await persistCandidate(candidate))) return undefined;
		return projectEditQueue.committedSnapshot();
	}

	function editTargetSegment(detail: { index: number; value: string }) {
		const project = $singleUserData;
		const previousValue = project.translationData.seg2[detail.index] ?? "";
		project.translationData.seg2[detail.index] = detail.value;
		project.translationData.checked[detail.index] = false;
		singleUserData.set(project);
		seg2WordCount.update(
			(total) => total - countWords(previousValue) + countWords(detail.value),
		);
		void projectEditQueue.schedule(project);
	}

	function flushProjectEdits() {
		return projectEditQueue.flush();
	}

	function handlePageHide() {
		void projectEditQueue.flush();
	}

	function handleVisibilityChange() {
		if (document.visibilityState === "hidden") void projectEditQueue.flush();
	}

	onDestroy(() => {
		// Writes start on input and live outside child-segment lifetime. Destruction
		// merely observes the already-running queue; it is not the save trigger.
		void projectEditQueue.flush();
	});

	async function lockAllSegments() {
		if (!$singleUserData) return;
		let newUserData = structuredClone($singleUserData);
		newUserData.translationData.locked = newUserData.translationData.locked.map(
			() => true,
		);
		await persistCandidate(newUserData);
	}

	async function unlockAllSegments() {
		if (!$singleUserData) return;
		let newUserData = structuredClone($singleUserData);
		newUserData.translationData.locked = newUserData.translationData.locked.map(
			() => false,
		);
		newUserData.translationData.checked =
			newUserData.translationData.checked.map(() => false);
		await persistCandidate(newUserData);
	}

	async function focusSegment(idx: number) {
		if (!segmentsContainer) return;
		const targetTop = virtualSizeIndex.offsetFor(idx);
		const targetHeight = virtualSizeIndex.sizeAt(idx);
		segmentsContainer.scrollTop = Math.max(
			0,
			targetTop - segmentsContainer.clientHeight / 2 + targetHeight / 2,
		);
		refreshVirtualWindow();
		await tick();
		const el = document.querySelector<HTMLElement>(
			`[data-segment-id="${idx}"]`,
		);
		if (!el) return;
		// Prefer the translation textarea inside the segment
		const input =
			el.querySelector<HTMLTextAreaElement>("textarea") ??
			el.querySelector<HTMLElement>("[tabindex]");
		(input ?? el).focus();
		(input ?? el).scrollIntoView({ block: "center" });
	}

	async function selectSegmentByOffset(offset: number) {
		const total = $singleUserData.translationData.seg1.length;
		if (total === 0) return;
		let current = $selectedSegmentId;
		if (current === null || current === undefined) {
			current = 0;
			selectedSegmentId.set(0);
		}
		let next = current + offset;
		if (next < 0) next = 0;
		if (next >= total) next = total - 1;
		lastSelectedSegmentId = next;
		selectedSegmentId.set(next);
		await focusSegment(next);
	}

	async function toggleLockCurrentSegment() {
		const idx = $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		if (!$singleUserData) return;
		const total = $singleUserData.translationData.locked.length;
		if (idx < 0 || idx >= total) return;
		const newUserData = structuredClone($singleUserData);
		newUserData.translationData.locked[idx] =
			!newUserData.translationData.locked[idx];
		if (!newUserData.translationData.locked[idx])
			newUserData.translationData.checked[idx] = false;
		if (!(await persistCandidate(newUserData))) return;
		notifyInfo(
			`Segment ${idx + 1} ${newUserData.translationData.locked[idx] ? "locked" : "unlocked"}`,
		);
	}

	async function fillCurrentSegment() {
		if (!$singleUserData) return;
		const idx = $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		const total = $singleUserData.translationData.seg1.length;
		if (idx < 0 || idx >= total) return;
		if ($singleUserData.translationData.locked[idx]) {
			notifyError("Unlock this segment before changing it.");
			return;
		}

		// Only fill if target is empty
		if ($singleUserData.translationData.seg2[idx] !== "") return;

		const newUserData = structuredClone($singleUserData);
		newUserData.translationData.seg2[idx] =
			newUserData.translationData.seg1[idx];
		newUserData.translationData.checked[idx] = false;
		if (!(await persistCandidate(newUserData))) return;
		seg2WordCount.set(getTotalWordCount(newUserData.translationData.seg2));
		notifySuccess(`Filled segment ${idx + 1}`);
	}

	async function splitCurrentSegment() {
		const idx = $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		const offset = pendingSplitOffsets.get(idx);
		if (offset === undefined) {
			notifyError("Place the caret inside a source segment first.");
			return;
		}
		await splitAtOffset(idx, offset);
	}

	async function splitAtOffset(customIdx?: number, customOffset?: number) {
		if (!$singleUserData) return;
		const idx = customIdx ?? $selectedSegmentId ?? lastSelectedSegmentId ?? 0;
		if (idx < 0 || idx >= $singleUserData.translationData.seg1.length) return;
		if ($singleUserData.translationData.locked[idx]) {
			notifyError("Unlock this segment before splitting it.");
			return;
		}

		const offsetFromStore =
			customOffset ?? pendingSplitOffsets.get(idx) ?? null;
		if (offsetFromStore === null) {
			notifyError("Place the caret inside this source segment first.");
			return;
		}

		const splitAt = offsetFromStore;
		const result = splitSegmentData(
			$singleUserData.translationData,
			idx,
			splitAt,
		);
		if (result.error) {
			notifyError(result.error);
			return;
		}
		const newUserData = { ...$singleUserData, translationData: result.data };
		if (!(await persistCandidate(newUserData))) return;
		resetVirtualMeasurementsFrom(idx, newUserData.translationData.seg2.length);
		selectedSegmentId.set(idx + 1);
		seg1WordCount.set(getTotalWordCount(newUserData.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(newUserData.translationData.seg2));
		pendingSplitOffsets = new Map();
		combineSelection = new Set();
		notifySuccess(
			result.restoredJoinBoundary
				? `Restored the original source and target segments at boundary ${idx + 1}.`
				: `Split segment ${idx + 1}; its existing target remains in the first half.`,
		);
	}

	async function combineWithNextSegment() {
		if (!$singleUserData) return;

		const selected = Array.from(combineSelection.values()).sort(
			(a, b) => a - b,
		);
		if (selected.length < 2) {
			notifyError("Select at least two segments before joining them.");
			return;
		}
		if (
			selected.some(
				(index) => $singleUserData.translationData.locked[index] === true,
			)
		) {
			notifyError("Unlock every selected segment before joining them.");
			return;
		}

		const result = combineSegmentRangeData(
			$singleUserData.translationData,
			selected,
		);
		if (result.error) {
			notifyError(result.error);
			return;
		}

		const newUserData = { ...$singleUserData, translationData: result.data };
		if (!(await persistCandidate(newUserData))) return;
		resetVirtualMeasurementsFrom(
			selected[0],
			newUserData.translationData.seg2.length,
		);
		seg1WordCount.set(getTotalWordCount(newUserData.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(newUserData.translationData.seg2));
		combineSelection = new Set();
		pendingSplitOffsets = new Map();
		selectedSegmentId.set(selected[0]);
		notifySuccess(
			`Joined ${selected.length} consecutive segments. The dashed source marker can restore the boundary.`,
		);
	}

	async function handleKeydown(event: KeyboardEvent) {
		const command = resolveEditorShortcut(event);
		if (!command || document.querySelector('[role="dialog"]')) return;

		event.preventDefault();
		switch (command) {
			case "next-segment":
				await selectSegmentByOffset(1);
				break;
			case "previous-segment":
				await selectSegmentByOffset(-1);
				break;
			case "toggle-lock":
				await toggleLockCurrentSegment();
				break;
			case "open-resources":
				await toggleTmTbModal();
				break;
			case "fill-segment":
				await fillCurrentSegment();
				break;
			case "split-segment":
				await splitCurrentSegment();
				break;
			case "join-segments":
				await combineWithNextSegment();
				break;
		}
	}

	async function fillAllEmptySegments() {
		if (!$singleUserData) return;
		let newUserData = structuredClone($singleUserData);
		newUserData.translationData.seg2 = newUserData.translationData.seg2.map(
			(segment, i) => {
				if (segment === "" && !newUserData.translationData.locked[i])
					return newUserData.translationData.seg1[i];
				return segment;
			},
		);
		newUserData.translationData.checked =
			newUserData.translationData.checked.map((confirmed, index) =>
				newUserData.translationData.seg2[index] !==
				$singleUserData.translationData.seg2[index]
					? false
					: confirmed,
			);
		if (!(await persistCandidate(newUserData))) return;
		seg2WordCount.set(getTotalWordCount(newUserData.translationData.seg2));
	}

	async function selectTmId(id: number | string, name: string) {
		if (typeof id === "string") {
			id = parseInt(id);
		}
		let newUserData = structuredClone($singleUserData);
		newUserData.translationData!.tm!.id = id;
		newUserData.translationData!.tm!.name = name;
		if (!(await persistCandidate(newUserData))) return;
		singleTmData.set($tmData.find((data) => data.id === id) as TmData);
		notifyInfo(`Translation Memory selected: ${name}`);
	}

	async function selectTbId(id: number | string, name: string) {
		if (typeof id === "string") {
			id = parseInt(id);
		}
		let newUserData = structuredClone($singleUserData);
		newUserData.translationData!.tb!.id = id;
		newUserData.translationData!.tb!.name = name;
		if (!(await persistCandidate(newUserData))) return;
		tbSelected = id;
		notifyInfo(`Term Base selected: ${name}`);
	}

	async function getAllTmDataFromIndexedDB() {
		if ($tmData.length > 0) return;
		const data = await loadTmDataFromIndexedDB();
		tmData.set(data as TmData[]);
	}

	async function getAllTbDataFromIndexedDB() {
		if ($tbData.length > 0) return;
		const data = await loadTbDataFromIndexedDB();
		tbData.set(data as TbData[]);
	}

	async function toggleSaveFileModal() {
		exportError = null;
		pendingDeliveryExport = null;
		showSaveFileModal = true;
	}

	async function toggleTmTbModal() {
		try {
			await withLoading(() =>
				Promise.all([getAllTmDataFromIndexedDB(), getAllTbDataFromIndexedDB()]),
			);
			showTmTbModal = true;
		} catch (error) {
			notifyError(
				error instanceof Error
					? `Project resources could not be loaded: ${error.message}`
					: "Project resources could not be loaded.",
			);
		}
	}

	function closeTmAddModal() {
		showTmAddModal = false;
		editTm.set(false);
	}

	function closeTbAddModal() {
		showTbAddModal = false;
		editTb.set(false);
	}

	async function toggleMenu() {
		openMenu.set(!$openMenu);
	}

	async function changeTmActive(active: boolean) {
		const previous = $singleUserData.translationData.tm?.active ?? false;
		const candidate = structuredClone($singleUserData);
		if (candidate.translationData.tm)
			candidate.translationData.tm.active = active;
		if (!(await persistCandidate(candidate))) {
			tmActive = previous;
			return;
		}
		notifyInfo(`Translation Memory ${active ? "activated" : "deactivated"}`);
	}

	async function changeTbActive(active: boolean) {
		const previous = $singleUserData.translationData.tb?.active ?? false;
		const candidate = structuredClone($singleUserData);
		candidate.translationData.tb.active = active;
		if (!(await persistCandidate(candidate))) {
			tbActive = previous;
			return;
		}
		notifyInfo(`Term Base ${active ? "activated" : "deactivated"}`);
	}

	$effect(() => {
		if ($selectedSegmentId !== null && $selectedSegmentId !== undefined) {
			lastSelectedSegmentId = $selectedSegmentId;
		}
	});
</script>

<svelte:window on:keydown={handleKeydown} on:pagehide={handlePageHide} />
<svelte:document on:visibilitychange={handleVisibilityChange} />

{#snippet exportMenu()}
	<div class="modal-stack">
		{#if exportError}
			<div class="export-error" role="alert">
				<strong>Export did not finish</strong>
				<span>{exportError}</span>
			</div>
		{/if}
		<div class="export-group-heading">
			<strong>Translated document</strong>
			<span>Export the completed translation for delivery.</span>
		</div>
		{#if translationExportAvailable}
			<button
				class="modal-action-card primary"
				disabled={exportInProgress}
				onclick={() => requestDeliveryExport(exportTranslatedSourceAndClose)}
			>
				<span class="modal-action-icon">FILE</span>
				<span class="modal-action-text"
					><strong>{primaryExportPresentation.label}</strong><small
						>{primaryExportPresentation.description}</small
					></span
				>
				<span class="modal-action-arrow">→</span>
			</button>
		{:else}
			<div class="export-unavailable-note">
				This source format is import-only. Choose a bilingual format below.
			</div>
		{/if}

		<div class="export-group-heading export-group-heading--secondary">
			<strong>Convert to another format</strong>
			<span
				>Create a new delivery document from the translated segment text.</span
			>
		</div>
		<div class="converted-export-grid">
			{#each CONVERTED_EXPORTS as exportOption}
				<button
					class="modal-action-card converted-export-card"
					disabled={exportInProgress}
					onclick={() =>
						requestDeliveryExport(() =>
							exportConvertedFile(exportOption.format),
						)}
				>
					<span class="modal-action-icon">{exportOption.icon}</span>
					<span class="modal-action-text"
						><strong>{exportOption.label}</strong><small
							>{exportOption.description}</small
						></span
					>
					<span class="modal-action-arrow">→</span>
				</button>
			{/each}
		</div>

		<div class="export-group-heading export-group-heading--secondary">
			<strong>Bilingual project formats</strong>
			<span
				>Continue editing here or exchange the project with another CAT tool.</span
			>
		</div>
		<button
			class="modal-action-card"
			disabled={exportInProgress}
			onclick={() =>
				completeExport(
					() => generateJsonSaveFile($singleUserData),
					"Open TLC project exported",
				)}
		>
			<span class="modal-action-icon">JSON</span>
			<span class="modal-action-text"
				><strong>Open TLC JSON</strong><small
					>Best for complete project backups and continued editing.</small
				></span
			>
			<span class="modal-action-arrow">→</span>
		</button>
		{#if vendorXliffProfile}
			<button
				class="modal-action-card primary"
				disabled={exportInProgress}
				onclick={() =>
					completeExport(
						() => downloadVendorXliff($singleUserData),
						`${vendorXliffProfile.label} exported`,
					)}
			>
				<span class="modal-action-icon"
					>{vendorXliffProfile.sourceExtension?.toUpperCase() ?? "XLF"}</span
				>
				<span class="modal-action-text"
					><strong>{vendorXliffProfile.label}</strong><small
						>Export to the imported vendor profile while retaining its
						namespaces, workflow state, inline codes, skeleton, and extensions.</small
					></span
				>
				<span class="modal-action-arrow">→</span>
			</button>
		{:else}
			<button
				class="modal-action-card"
				disabled={exportInProgress}
				onclick={() =>
					completeExport(
						() => generateXliffSaveFile1_2($singleUserData),
						"XLIFF 1.2 project exported",
					)}
			>
				<span class="modal-action-icon">1.2</span>
				<span class="modal-action-text"
					><strong>XLIFF 1.2</strong><small
						>Broad compatibility with established CAT workflows.</small
					></span
				>
				<span class="modal-action-arrow">→</span>
			</button>
			<button
				class="modal-action-card"
				disabled={exportInProgress}
				onclick={() =>
					completeExport(
						() => generateXliffSaveFile2_0($singleUserData),
						"XLIFF 2.0 project exported",
					)}
			>
				<span class="modal-action-icon">2.0</span>
				<span class="modal-action-text"
					><strong>XLIFF 2.0</strong><small
						>Modern standards-based bilingual interchange.</small
					></span
				>
				<span class="modal-action-arrow">→</span>
			</button>
			<button
				class="modal-action-card"
				disabled={exportInProgress}
				onclick={() =>
					completeExport(
						() => generateXliffSaveFile2_1($singleUserData),
						"XLIFF 2.1 project exported",
					)}
			>
				<span class="modal-action-icon">2.1</span>
				<span class="modal-action-text"
					><strong>XLIFF 2.1</strong><small
						>Latest supported XLIFF project interchange.</small
					></span
				>
				<span class="modal-action-arrow">→</span>
			</button>
		{/if}
	</div>
{/snippet}

{#snippet incompleteExportWarning()}
	<div class="modal-confirmation">
		<span class="modal-confirmation-icon neutral">QA</span>
		<h3>Export an incomplete translation?</h3>
		<p>
			{completionWarning.emptyTargetUnits.length} target
			{completionWarning.emptyTargetUnits.length === 1
				? " segment is"
				: " segments are"}
			empty and {completionWarning.unconfirmedUnits.length}
			{completionWarning.unconfirmedUnits.length === 1
				? " segment is"
				: " segments are"}
			not confirmed. The delivery may contain missing or unfinished text.
		</p>
		<div class="modal-actions inline">
			<button
				class="modal-button secondary"
				onclick={() => (pendingDeliveryExport = null)}>Review project</button
			>
			<button class="modal-button primary" onclick={continueIncompleteExport}
				>Export anyway</button
			>
		</div>
	</div>
{/snippet}

{#snippet tmTbMenu()}
	<div class="manage-tm-tb-container">
		<div class="manage-tm-container modal-section-card">
			<div class="checkable">
				<p class="header">Translation Memory</p>
				<input
					type="checkbox"
					class="tm-checkbox"
					bind:checked={tmActive}
					onchange={() => changeTmActive(tmActive)}
					title="Enable Translation Memory"
				/>
			</div>
			<div class="tm-tb-selection-container">
				<select
					class="tm-select"
					disabled={!tmActive}
					onchange={(e) =>
						selectTmId(
							(e.target as HTMLSelectElement).value,
							(e.target as HTMLSelectElement).selectedOptions[0].text,
						)}
				>
					<option disabled selected value="">
						{tmSelected !== null
							? $singleUserData.translationData.tm?.name
							: "Select Translation Memory"}
					</option>
					{#each $tmData as data}
						<option value={data.id}>
							{data.name}
						</option>
					{/each}
				</select>
			</div>
			<div class="modal-actions inline">
				<button
					class="modal-button secondary"
					onclick={() => {
						editTm.set(false);
						showTmTbModal = false;
						showTmAddModal = true;
					}}
				>
					+ Add TM
				</button>
				<button
					class="modal-button primary"
					disabled={tmSelected === null}
					onclick={() => {
						if (tmSelected === null) return;
						editTm.set(true);
						showTmTbModal = false;
						showTmAddModal = true;
					}}
				>
					Edit TM
				</button>
			</div>
		</div>

		<div class="manage-tb-container modal-section-card">
			<div class="checkable">
				<p class="header">Term Base</p>
				<input
					type="checkbox"
					class="tm-checkbox"
					bind:checked={tbActive}
					onchange={() => changeTbActive(tbActive)}
					title="Enable Term Base"
				/>
			</div>
			<div class="tm-tb-selection-container">
				<select
					class="tm-select"
					disabled={!tbActive}
					onchange={(e) =>
						selectTbId(
							(e.target as HTMLSelectElement).value,
							(e.target as HTMLSelectElement).selectedOptions[0].text,
						)}
				>
					<option disabled selected value="">
						{tbSelected !== null
							? $singleUserData.translationData.tb?.name
							: "Select Term Base"}
					</option>
					{#each $tbData as data}
						<option value={data.id}>
							{data.name}
						</option>
					{/each}
				</select>
			</div>
			<div class="modal-actions inline">
				<button
					class="modal-button secondary"
					onclick={() => {
						editTb.set(false);
						showTmTbModal = false;
						showTbAddModal = true;
					}}
				>
					+ Add TB
				</button>
				<button
					class="modal-button primary"
					disabled={tbSelected === null}
					onclick={() => {
						if (tbSelected === null) return;
						editTb.set(true);
						showTmTbModal = false;
						showTbAddModal = true;
					}}
				>
					Edit TB
				</button>
			</div>
		</div>
	</div>
{/snippet}

{#snippet tmAddMenu()}
	<div class="tm-add-container">
		{#if $editTm}
			<TmEditing />
		{:else}
			<TmxUpload />
		{/if}
	</div>
{/snippet}

{#snippet tbAddMenu()}
	<div class="tb-add-container">
		{#if $editTb}
			<TbEditing />
		{:else}
			<TbxUpload />
		{/if}
	</div>
{/snippet}

{#if showTmTbModal}
	<div
		role="presentation"
		class="modal-element-global {showTmTbModal ? '' : 'close-modal-global'}"
	>
		<Modal
			title="Language resources"
			description="Choose the translation memory and term base used by this project."
			content={tmTbMenu}
			large
			onClose={() => (showTmTbModal = false)}
		/>
	</div>
{:else if showSaveFileModal}
	<div
		role="presentation"
		class="modal-element-global {showSaveFileModal ? '' : 'close-modal-global'}"
	>
		<Modal
			title={pendingDeliveryExport ? "Translation QA warning" : "Export files"}
			description="Choose a translated delivery file or portable bilingual project format."
			content={pendingDeliveryExport ? incompleteExportWarning : exportMenu}
			wide
			onClose={() => {
				pendingDeliveryExport = null;
				showSaveFileModal = false;
			}}
		/>
	</div>
{:else if showTmAddModal}
	<div
		role="presentation"
		class="modal-element-global {showTmAddModal ? '' : 'close-modal-global'}"
	>
		<Modal
			title={$editTm ? "Edit translation memory" : "Add translation memory"}
			content={tmAddMenu}
			large
			onClose={closeTmAddModal}
		/>
	</div>
{:else if showTbAddModal}
	<div
		role="presentation"
		class="modal-element-global {showTbAddModal ? '' : 'close-modal-global'}"
	>
		<Modal
			title={$editTb ? "Edit term base" : "Add term base"}
			content={tbAddMenu}
			large
			onClose={closeTbAddModal}
		/>
	</div>
{/if}

<div class="toolbar">
	<div class="toolbar-inner">
		<div class="toolbar-project">
			<button
				class="toolbar-back"
				onclick={() => toggleMenu()}
				aria-label="Back to projects"
			>
				<RightArrow />
			</button>
			<div class="toolbar-project-copy">
				<span class="toolbar-eyebrow">Translation workspace</span>
				<strong>{$singleUserData.translationData.name}</strong>
			</div>
		</div>
		<div class="toolbar-actions">
			<button class="toolbar-button resource" onclick={() => toggleTmTbModal()}>
				<TmTb />
				TM &amp; Term Base
			</button>
			<button
				class="toolbar-button secondary"
				onclick={() => toggleSaveFileModal()}
			>
				<SaveFile marginBottom="0px" />
				Save project
			</button>
			<button
				class="toolbar-button primary"
				onclick={() => toggleSaveFileModal()}
				title="Choose a translated document or bilingual project format"
			>
				<Export marginBottom="2px" />
				Export translation
			</button>
			<button class="toolbar-help" aria-label="Keyboard shortcuts" tabindex="0">
				<span>?</span>
				<div class="shortcut-popover">
					<p>
						<strong>Ctrl/Cmd + Alt + ↓ / ↑:</strong>
						<br />
						<span>Select next/previous segment</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + Alt + L:</strong>
						<br />
						<span>Lock/Unlock current segment</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + Alt + F:</strong>
						<br />
						<span>Fill current segment (if empty)</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + Alt + M:</strong>
						<br />
						<span>Open TM/TB manager</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + Alt + E:</strong>
						<br />
						<span>Split current segment</span>
					</p>
					<p>
						<strong>Ctrl/Cmd + Alt + J:</strong>
						<br />
						<span>Join two or more selected segments</span>
					</p>
				</div>
			</button>
		</div>
	</div>
</div>

<div class="words-container">
	<div class="words-left">
		<span class="language-label">Source language</span>
		<h1>
			{$singleUserData.translationData.sourceLang !== undefined &&
			$singleUserData.translationData.sourceLang !== ""
				? $singleUserData.translationData.sourceLang
				: "Undefined"}
		</h1>
		<p><span>{$seg1WordCount}</span> words</p>
	</div>

	<div class="middle-container">
		<div class="top-stats">
			<div class="progress-copy">
				<p><span>{percentage}%</span> complete</p>
				<p>{$singleUserData.translationData.seg1.length} segments</p>
			</div>
			<div class="progress-track" aria-label={`${percentage}% complete`}>
				<span style={`width: ${percentage}%`}></span>
			</div>
		</div>
		<div class="segment-actions">
			<button
				class="bulk-action"
				onclick={() =>
					allSegmentsLocked ? unlockAllSegments() : lockAllSegments()}
			>
				<DocLock />
				{allSegmentsLocked ? "Unlock all" : "Lock all"}
			</button>
			<button class="bulk-action" onclick={() => fillAllEmptySegments()}>
				<AutoFill />
				Fill empty
			</button>
			<button
				class="bulk-action"
				onclick={combineWithNextSegment}
				title={combineSelection.size < 2
					? "Select at least two segments using the checkboxes"
					: "Join selected consecutive segments (Ctrl/Cmd+Alt+J)"}
				disabled={combineSelection.size < 2}
			>
				<JoinSegments />
				Join selected
			</button>
		</div>
	</div>

	<div class="words-right">
		<span class="language-label">Target language</span>
		<h1>
			{$singleUserData.translationData.targetLang !== undefined &&
			$singleUserData.translationData.targetLang !== ""
				? $singleUserData.translationData.targetLang
				: "Undefined"}
		</h1>
		<p><span>{$seg2WordCount}</span> words</p>
	</div>
</div>

<div
	class="segments-container"
	style={tmActive || tbActive ? "max-height: 50vh;" : "max-height: 741px;"}
	bind:this={segmentsContainer}
	onscroll={handleScroll}
>
	<div class="virtual-segments" style={`height: ${virtualTotalHeight()}px;`}>
		{#each $singleUserData.translationData.seg2.slice(virtualStart, virtualEnd) as _segment, offset}
			{@const i = virtualStart + offset}
			<div
				class="virtual-segment"
				style={`transform: translateY(${virtualOffset(i)}px);`}
				use:measureSegment={i}
			>
				<Segment
					id={i}
					textSegment1={$singleUserData.translationData.seg1[i]}
					textSegment2={$singleUserData.translationData.seg2[i]}
					locked={$singleUserData.translationData.locked[i]}
					confirmed={$singleUserData.translationData.checked[i]}
					combineSelected={combineSelection.has(i)}
					joinBoundaries={getSegmentJoinBoundaryOffsets(
						$singleUserData.translationData,
						i,
					)}
					splitOffset={pendingSplitOffsets.get(i) ?? null}
					onMarkSplit={(detail) => {
						if (detail.offset === null || detail.offset === undefined) {
							pendingSplitOffsets = new Map();
						} else {
							pendingSplitOffsets = new Map([[detail.index, detail.offset]]);
						}
						selectedSegmentId.set(detail.index);
					}}
					onSplitSegment={(detail) =>
						splitAtOffset(detail.index, detail.offset)}
					onToggleCombine={(detail) => {
						const idx = detail.index;
						pendingSplitOffsets = new Map();
						selectedSegmentId.set(idx);
						const next = new Set(combineSelection);
						if (next.has(idx)) {
							next.delete(idx);
						} else {
							next.add(idx);
						}
						combineSelection = next;
					}}
					onActivateSegment={(detail) => {
						if (!pendingSplitOffsets.has(detail.index)) {
							pendingSplitOffsets = new Map();
						}
						selectedSegmentId.set(detail.index);
					}}
					onEditTarget={editTargetSegment}
					onFlushEdits={flushProjectEdits}
					onPersistProjectMutation={persistProjectMutation}
				/>
			</div>
		{/each}
	</div>
</div>

<div
	class="tm-tb-container"
	style={tmActive && tbActive
		? "grid-template-columns: 70% 30%;"
		: "display: flex;"}
>
	{#if tmActive}
		<div class="translation-memory">
			<TranslationMemory onPersistProjectMutation={persistProjectMutation} />
		</div>
	{/if}
	{#if tbActive}
		<div class="term-base">
			<TermBase onPersistProjectMutation={persistProjectMutation} />
		</div>
	{/if}
</div>

<style>
	.export-error {
		display: grid;
		gap: 0.2rem;
		border: 1px solid #e9a9a9;
		border-left: 4px solid #bf3434;
		border-radius: 0.65rem;
		padding: 0.75rem 0.85rem;
		background: #fff5f5;
		color: #7d2424;
		font-size: 0.74rem;
		line-height: 1.45;
	}

	.export-error strong {
		font-size: 0.8rem;
	}

	.export-group-heading {
		display: grid;
		gap: 0.2rem;
		padding: 0.1rem 0.1rem 0.2rem;
		color: #245265;
	}

	.export-group-heading--secondary {
		margin-top: 0.55rem;
		padding-top: 1rem;
		border-top: 1px solid #dbe8eb;
	}

	.export-group-heading strong {
		font-size: 0.84rem;
	}

	.export-group-heading span,
	.export-unavailable-note {
		color: #70858d;
		font-size: 0.72rem;
		line-height: 1.45;
	}

	.export-unavailable-note {
		border: 1px solid #d4e3e6;
		border-radius: 0.6rem;
		padding: 0.75rem;
		background: #f6fafb;
	}

	.converted-export-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.55rem;
	}

	.converted-export-card {
		min-width: 0;
	}

	@media (max-width: 560px) {
		.converted-export-grid {
			grid-template-columns: 1fr;
		}
	}

	.manage-tm-tb-container {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 1rem;
		border-radius: 8px;
		width: 100%;
		margin: 0 auto;
	}

	.manage-tm-container,
	.manage-tb-container {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.checkable {
		display: flex;
		justify-content: space-between;
		align-items: start;
	}

	.header {
		font-size: 1.1rem;
		font-weight: bold;
		color: var(--color-theme-4);
		margin: 0px;
	}

	.tm-checkbox {
		width: 20px;
		height: 20px;
		cursor: pointer;
		accent-color: #007bff; /* Sets the color of the checkbox */
	}

	.tm-tb-selection-container {
		position: relative;
	}

	.tm-select {
		position: relative;
		z-index: 1;
		width: 100%;
		padding: 10px;
		border: 1px solid #ccc;
		border-radius: 0.55rem;
		background-color: white;
		font-size: 1rem;
	}

	@media (max-width: 680px) {
		.manage-tm-tb-container {
			grid-template-columns: 1fr;
		}
	}

	.toolbar {
		background: #123f5f;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
		padding: 0.7rem 1.5rem;
		width: 100%;
		box-sizing: border-box;
		box-shadow: 0 4px 18px rgba(14, 52, 72, 0.16);
		position: sticky;
		top: 0;
		z-index: 70;
	}

	.toolbar-inner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		width: 100%;
		margin: 0 auto;
	}

	.toolbar-project,
	.toolbar-actions,
	.toolbar-button,
	.toolbar-back {
		display: flex;
		align-items: center;
	}

	.toolbar-project {
		gap: 0.75rem;
		min-width: 0;
	}

	.toolbar-project-copy {
		display: grid;
		min-width: 0;
		color: white;
	}

	.toolbar-project-copy strong {
		overflow: hidden;
		max-width: 320px;
		font-size: 0.96rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.toolbar-eyebrow {
		color: #93cbd9;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.toolbar-actions {
		justify-content: flex-end;
		gap: 0.55rem;
	}

	.toolbar-back,
	.toolbar-button,
	.toolbar-help {
		min-height: 2.45rem;
		border-radius: 0.55rem;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 750;
		cursor: pointer;
		transition: 0.18s ease;
	}

	.toolbar-back {
		justify-content: center;
		width: 2.45rem;
		border: 1px solid rgba(255, 255, 255, 0.22);
		background: rgba(255, 255, 255, 0.08);
		color: white;
	}

	.toolbar-button {
		justify-content: center;
		gap: 0.45rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		padding: 0.55rem 0.85rem;
		background: rgba(255, 255, 255, 0.1);
		color: white;
	}

	.toolbar-button.resource {
		border-color: rgba(137, 210, 222, 0.35);
		background: rgba(73, 165, 184, 0.16);
	}

	.toolbar-button.primary {
		border-color: #40a7c3;
		background: #2c91af;
		box-shadow: 0 5px 14px rgba(0, 0, 0, 0.13);
	}

	.toolbar-button:hover:not(:disabled),
	.toolbar-back:hover,
	.toolbar-help:hover {
		transform: translateY(-1px);
		border-color: rgba(255, 255, 255, 0.45);
		filter: brightness(1.08);
	}

	.toolbar-button:disabled {
		cursor: not-allowed;
		opacity: 0.48;
	}

	.toolbar-help {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: center;
		width: 2.45rem;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.08);
		color: #d9f1f5;
		padding: 0;
		cursor: help;
		flex-shrink: 0;
	}

	.toolbar-help span {
		user-select: none;
		line-height: 1;
	}

	.toolbar-help .shortcut-popover {
		position: absolute;
		top: calc(100% + 8px);
		right: -12px;
		min-width: 200px;
		background: white;
		color: var(--color-theme-6);
		border: 1px solid #c7dde2;
		border-radius: 0.75rem;
		padding: 0.85rem;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateY(-8px);
		transition: all 0.2s ease;
		z-index: 10;
	}

	.toolbar-help .shortcut-popover::before {
		content: "";
		position: absolute;
		top: -8px;
		right: 20px;
		width: 0;
		height: 0;
		border-left: 8px solid transparent;
		border-right: 8px solid transparent;
		border-bottom: 8px solid #c7dde2;
	}

	.toolbar-help:hover .shortcut-popover,
	.toolbar-help:focus-within .shortcut-popover {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transform: translateY(0);
	}

	.shortcut-popover p {
		margin: 5px 0;
		font-size: 0.95rem;
		line-height: 1.5;
		font-weight: 500;
		text-align: left;
	}

	.shortcut-popover p:first-child {
		margin-top: 0;
	}

	.shortcut-popover p:last-child {
		margin-bottom: 0;
	}

	.shortcut-popover strong {
		display: inline-block;
		min-width: 140px;
		color: var(--color-theme-4);
		font-weight: 700;
	}

	.tm-tb-container {
		display: grid;
		width: 100%;
	}

	.translation-memory {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0px;
		width: 100%;
		height: 100%;
		/* z-index: 2; */
		border-top: 2px solid var(--color-theme-3);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
		/* overflow-y: scroll; */
	}

	.term-base {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0px;
		width: 100%;
		height: 100%;
		/* z-index: 2; */
		border-top: 2px solid var(--color-theme-3);
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
		/* overflow-y: scroll; */
	}

	.words-container {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) minmax(420px, 1.6fr) minmax(
				180px,
				1fr
			);
		align-items: center;
		gap: 2rem;
		background: rgba(240, 250, 252, 0.96);
		border-bottom: 1px solid #cce2e7;
		padding: 1rem clamp(1.25rem, 2vw, 2.5rem);
		box-sizing: border-box;
		width: 100%;
		box-shadow: 0 4px 14px rgba(19, 70, 88, 0.06);
		position: sticky;
		top: 62px;
		z-index: 50;
	}

	.words-left,
	.words-right {
		min-width: 0;
	}

	.words-right {
		text-align: right;
	}

	.language-label {
		color: #6c858e;
		font-size: 0.62rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.words-left h1,
	.words-right h1 {
		margin: 0.12rem 0 0;
		overflow: hidden;
		color: #17495b;
		font-size: 1rem;
		font-weight: 750;
		text-overflow: ellipsis;
		text-transform: none;
		white-space: nowrap;
	}

	.words-left p,
	.words-right p {
		margin: 0.15rem 0 0;
		color: #789099;
		font-size: 0.72rem;
	}

	.words-left p span,
	.words-right p span {
		color: #2b8ea9;
		font-weight: 800;
	}

	.middle-container {
		display: grid;
		gap: 0.75rem;
	}

	.top-stats {
		display: grid;
		gap: 0.4rem;
	}

	.progress-copy {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}

	.progress-copy p {
		margin: 0;
		color: #6c858e;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.progress-copy span {
		color: #218aa6;
	}

	.progress-track {
		height: 0.35rem;
		overflow: hidden;
		border-radius: 999px;
		background: #d8e8ec;
	}

	.progress-track span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: #2fa0bb;
		transition: width 0.25s ease;
	}

	.segment-actions {
		display: flex;
		justify-content: center;
		gap: 0.4rem;
	}

	.bulk-action {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.3rem;
		min-height: 2rem;
		border: 1px solid #b9d4da;
		border-radius: 0.45rem;
		padding: 0.4rem 0.6rem;
		background: white;
		color: #28657a;
		font: inherit;
		font-size: 0.68rem;
		font-weight: 750;
		cursor: pointer;
		transition: 0.18s ease;
	}

	.bulk-action:hover:not(:disabled) {
		border-color: #6facba;
		background: #f7fcfd;
		transform: translateY(-1px);
	}

	.bulk-action:disabled {
		background: #edf3f4;
		color: #9babad;
		cursor: not-allowed;
		opacity: 0.7;
	}

	.segments-container {
		padding: 1rem clamp(1.25rem, 2vw, 2.5rem);
		box-sizing: border-box;
		overflow-y: auto;
		width: 100%;
		background: #eaf6f8;
	}

	.virtual-segments {
		position: relative;
		width: 100%;
	}

	.virtual-segment {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		will-change: transform;
	}

	@media (max-width: 980px) {
		.toolbar-inner {
			align-items: flex-start;
		}

		.toolbar-actions {
			flex-wrap: wrap;
		}

		.words-container {
			grid-template-columns: 1fr 1.5fr 1fr;
			gap: 1rem;
		}

		.segment-actions {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}
	}

	@media (max-width: 720px) {
		.toolbar {
			padding: 0.65rem 0.75rem;
		}

		.toolbar-inner,
		.toolbar-actions {
			width: 100%;
		}

		.toolbar-inner {
			align-items: stretch;
			flex-direction: column;
		}

		.toolbar-actions {
			display: grid;
			grid-template-columns: repeat(3, 1fr) auto;
		}

		.toolbar-project-copy strong {
			max-width: calc(100vw - 5rem);
		}

		.words-container {
			position: static;
			grid-template-columns: 1fr 1fr;
			padding: 0.85rem 0.75rem;
		}

		.middle-container {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.segments-container {
			padding: 0.75rem;
		}
	}
</style>
