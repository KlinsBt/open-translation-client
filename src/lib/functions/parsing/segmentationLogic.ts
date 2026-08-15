import type {
	DocxFragmentMeta,
	DocxSegmentMeta,
	HtmlSegmentMeta,
	JsonSegmentMeta,
	SegmentJoinState,
	SegmentMeta,
	UserData,
} from "$lib/types/types";

type TranslationData = UserData["translationData"];

export interface SegmentEditResult {
	data: TranslationData;
	error?: string;
	restoredJoinBoundary?: boolean;
}

export type SplitResult = SegmentEditResult;
export type CombineResult = SegmentEditResult;

const XLSX_EDIT_ERROR =
	"XLSX segments cannot be split or joined because worksheet cell alignment must be preserved.";

function arraysAreAligned(translation: TranslationData): boolean {
	return (
		translation.seg1.length === translation.seg2.length &&
		translation.seg1.length === translation.checked.length
	);
}

function isDocxMetaEntry(
	entry: SegmentMeta | undefined,
): entry is DocxSegmentMeta {
	return (
		!!entry &&
		typeof entry === "object" &&
		"fragments" in entry &&
		Array.isArray(entry.fragments)
	);
}

function isJsonMetaEntry(
	entry: SegmentMeta | undefined,
): entry is JsonSegmentMeta {
	return (
		!!entry &&
		typeof entry === "object" &&
		!("kind" in entry) &&
		"path" in entry &&
		Array.isArray(entry.path) &&
		entry.path.every((part) => typeof part === "string")
	);
}

function isHtmlMetaEntry(
	entry: SegmentMeta | undefined,
): entry is HtmlSegmentMeta {
	return (
		!!entry &&
		typeof entry === "object" &&
		"kind" in entry &&
		(entry.kind === "text" || entry.kind === "attribute") &&
		"path" in entry &&
		Array.isArray(entry.path) &&
		entry.path.every((part) => typeof part === "number") &&
		(entry.kind === "text" || typeof entry.attribute === "string")
	);
}

function validateForStructuralEdit(
	translation: TranslationData,
): string | undefined {
	if (!arraysAreAligned(translation)) {
		return "Segment source, target, and confirmation arrays are out of sync.";
	}

	if (translation.type === "xlsx") return XLSX_EDIT_ERROR;
	if (translation.type === "text") return undefined;

	if (
		!translation.segmentsMeta ||
		translation.segmentsMeta.length !== translation.seg1.length
	) {
		return `Cannot edit ${translation.type.toUpperCase()} segmentation because its structural metadata is missing or out of sync.`;
	}

	const metaIsValid = translation.segmentsMeta.every((entry) => {
		if (translation.type === "json") return isJsonMetaEntry(entry);
		if (translation.type === "html") return isHtmlMetaEntry(entry);
		if (translation.type === "docx") {
			return isDocxMetaEntry(entry) && entry.fragments.length > 0;
		}
		return false;
	});

	if (!metaIsValid) {
		return `Cannot edit ${translation.type.toUpperCase()} segmentation because its structural metadata is invalid.`;
	}

	return undefined;
}

function splitDocxMetaEntry(
	metaEntry: DocxSegmentMeta,
	splitPoint: number,
): { first: DocxSegmentMeta; second: DocxSegmentMeta } | undefined {
	const firstFragments: DocxFragmentMeta[] = [];
	const secondFragments: DocxFragmentMeta[] = [];
	let consumed = 0;

	for (const fragment of metaEntry.fragments) {
		const length = fragment.end - fragment.start;
		const nextConsumed = consumed + length;

		if (nextConsumed <= splitPoint) {
			firstFragments.push({ ...fragment });
		} else if (consumed >= splitPoint) {
			secondFragments.push({ ...fragment });
		} else {
			const cut = splitPoint - consumed;
			firstFragments.push({ ...fragment, end: fragment.start + cut });
			secondFragments.push({ ...fragment, start: fragment.start + cut });
		}

		consumed = nextConsumed;
	}

	if (
		consumed < splitPoint ||
		firstFragments.length === 0 ||
		secondFragments.length === 0
	) {
		return undefined;
	}

	return {
		first: { separator: "", fragments: firstFragments },
		second: {
			separator: metaEntry.separator ?? "",
			fragments: secondFragments,
		},
	};
}

function splitMetaEntry(
	translation: TranslationData,
	idx: number,
	splitAt: number,
): { first: SegmentMeta; second: SegmentMeta } | undefined {
	const entry = translation.segmentsMeta?.[idx];
	if (!entry) return undefined;

	if (translation.type === "json" && isJsonMetaEntry(entry)) {
		return {
			first: { path: [...entry.path], separator: "" },
			second: {
				path: [...entry.path],
				separator: entry.separator ?? "",
			},
		};
	}

	if (translation.type === "html" && isHtmlMetaEntry(entry)) {
		return {
			first: { ...entry, path: [...entry.path], separator: "" },
			second: {
				...entry,
				path: [...entry.path],
				separator: entry.separator ?? "",
			},
		};
	}

	if (translation.type === "docx" && isDocxMetaEntry(entry)) {
		return splitDocxMetaEntry(entry, splitAt);
	}

	return undefined;
}

function stripOwnedSeparator(value: string, entry: SegmentMeta | undefined) {
	const separator = entry?.separator ?? "";
	return separator && value.endsWith(separator)
		? value.slice(0, -separator.length)
		: value;
}

function cloneSegmentMeta(
	entry: SegmentMeta | undefined,
): SegmentMeta | undefined {
	if (!entry) return undefined;
	if (isDocxMetaEntry(entry)) {
		return {
			...entry,
			fragments: entry.fragments.map((fragment) => ({ ...fragment })),
		};
	}
	if (isJsonMetaEntry(entry)) return { ...entry, path: [...entry.path] };
	if (isHtmlMetaEntry(entry)) return { ...entry, path: [...entry.path] };
	return undefined;
}

function cloneJoinState(
	state: SegmentJoinState | null,
): SegmentJoinState | null {
	return state
		? {
				targetSnapshot: state.targetSnapshot,
				boundaries: state.boundaries.map((boundary) => ({
					...boundary,
					firstMeta: cloneSegmentMeta(boundary.firstMeta),
					secondMeta: cloneSegmentMeta(boundary.secondMeta),
				})),
			}
		: null;
}

function isValidJoinState(
	state: SegmentJoinState | null | undefined,
	source: string,
): state is SegmentJoinState {
	return (
		!!state &&
		typeof state.targetSnapshot === "string" &&
		Array.isArray(state.boundaries) &&
		state.boundaries.every(
			(boundary) =>
				!!boundary &&
				typeof boundary === "object" &&
				Number.isInteger(boundary.sourceOffset) &&
				boundary.sourceOffset > 0 &&
				boundary.sourceOffset < source.length &&
				(boundary.targetOffset === null ||
					(Number.isInteger(boundary.targetOffset) &&
						boundary.targetOffset >= 0 &&
						boundary.targetOffset <= state.targetSnapshot.length)),
		)
	);
}

function normalizedJoinStates(
	translation: TranslationData,
): Array<SegmentJoinState | null> {
	if (translation.segmentJoinStates?.length === translation.seg1.length) {
		return translation.segmentJoinStates.map((state, index) =>
			isValidJoinState(state, translation.seg1[index])
				? cloneJoinState(state)
				: null,
		);
	}
	return new Array(translation.seg1.length).fill(null);
}

export function getSegmentJoinBoundaryOffsets(
	translation: TranslationData,
	idx: number,
): number[] {
	const state = translation.segmentJoinStates?.[idx];
	return isValidJoinState(state, translation.seg1[idx] ?? "")
		? state.boundaries.map((boundary) => boundary.sourceOffset)
		: [];
}

function shiftedJoinBoundaries(
	state: SegmentJoinState | null,
	currentTarget: string,
	sourceOffset: number,
	targetOffset: number,
) {
	if (!state) return [];
	const targetOffsetsAreCurrent = state.targetSnapshot === currentTarget;
	return state.boundaries.map((boundary) => ({
		...boundary,
		sourceOffset: boundary.sourceOffset + sourceOffset,
		targetOffset:
			targetOffsetsAreCurrent && boundary.targetOffset !== null
				? boundary.targetOffset + targetOffset
				: null,
	}));
}

function splitJoinState(
	state: SegmentJoinState,
	sourceSplitAt: number,
	targetSplitAt: number,
	firstTarget: string,
	secondTarget: string,
): [SegmentJoinState | null, SegmentJoinState | null] {
	const firstBoundaries = state.boundaries
		.filter((boundary) => boundary.sourceOffset < sourceSplitAt)
		.map((boundary) => ({
			...boundary,
			firstMeta: cloneSegmentMeta(boundary.firstMeta),
			secondMeta: cloneSegmentMeta(boundary.secondMeta),
		}));
	const secondBoundaries = state.boundaries
		.filter((boundary) => boundary.sourceOffset > sourceSplitAt)
		.map((boundary) => ({
			...boundary,
			sourceOffset: boundary.sourceOffset - sourceSplitAt,
			targetOffset:
				boundary.targetOffset === null
					? null
					: boundary.targetOffset - targetSplitAt,
			firstMeta: cloneSegmentMeta(boundary.firstMeta),
			secondMeta: cloneSegmentMeta(boundary.secondMeta),
		}));

	return [
		firstBoundaries.length > 0
			? { targetSnapshot: firstTarget, boundaries: firstBoundaries }
			: null,
		secondBoundaries.length > 0
			? { targetSnapshot: secondTarget, boundaries: secondBoundaries }
			: null,
	];
}

function samePath(
	first: readonly (string | number)[],
	second: readonly (string | number)[],
) {
	return (
		first.length === second.length &&
		first.every((part, index) => part === second[index])
	);
}

function sameHtmlDestination(first: HtmlSegmentMeta, second: HtmlSegmentMeta) {
	return (
		first.kind === second.kind &&
		samePath(first.path, second.path) &&
		(first.kind !== "attribute" ||
			(second.kind === "attribute" && first.attribute === second.attribute))
	);
}

function docxParagraph(entry: DocxSegmentMeta): number | undefined {
	const paragraphs = new Set(
		entry.fragments.map((fragment) => fragment.paragraphIndex),
	);
	return paragraphs.size === 1 ? entry.fragments[0]?.paragraphIndex : undefined;
}

function combineMetaEntries(
	translation: TranslationData,
	idx: number,
): { entry?: SegmentMeta; error?: string } {
	if (translation.type === "text") return {};

	const current = translation.segmentsMeta?.[idx];
	const next = translation.segmentsMeta?.[idx + 1];

	if (
		translation.type === "json" &&
		isJsonMetaEntry(current) &&
		isJsonMetaEntry(next)
	) {
		if (!samePath(current.path, next.path)) {
			return { error: "Cannot join segments from different JSON fields." };
		}
		return {
			entry: {
				path: [...current.path],
				separator: next.separator ?? "",
			},
		};
	}

	if (
		translation.type === "html" &&
		isHtmlMetaEntry(current) &&
		isHtmlMetaEntry(next)
	) {
		if (!sameHtmlDestination(current, next)) {
			return {
				error: "Cannot join segments from different HTML nodes or attributes.",
			};
		}
		return {
			entry: {
				...current,
				path: [...current.path],
				separator: next.separator ?? "",
			},
		};
	}

	if (
		translation.type === "docx" &&
		isDocxMetaEntry(current) &&
		isDocxMetaEntry(next)
	) {
		const currentParagraph = docxParagraph(current);
		const nextParagraph = docxParagraph(next);
		if (
			currentParagraph === undefined ||
			nextParagraph === undefined ||
			currentParagraph !== nextParagraph
		) {
			return {
				error: "Cannot join DOCX segments across paragraph boundaries.",
			};
		}
		return {
			entry: {
				separator: next.separator ?? "",
				fragments: [
					...current.fragments.map((fragment) => ({ ...fragment })),
					...next.fragments.map((fragment) => ({ ...fragment })),
				],
			},
		};
	}

	return {
		error: `Cannot join ${translation.type.toUpperCase()} segments with incompatible structural metadata.`,
	};
}

export function splitSegmentData(
	translation: TranslationData,
	idx: number,
	splitAt: number,
): SplitResult {
	const validationError = validateForStructuralEdit(translation);
	if (validationError) return { data: translation, error: validationError };

	if (!Number.isInteger(idx) || idx < 0 || idx >= translation.seg1.length) {
		return { data: translation, error: "Invalid segment index." };
	}

	const source = translation.seg1[idx];
	if (!Number.isInteger(splitAt) || splitAt <= 0 || splitAt >= source.length) {
		return {
			data: translation,
			error: "Place the caret inside the source text, not at either edge.",
		};
	}

	const splitMeta =
		translation.type === "text"
			? undefined
			: splitMetaEntry(translation, idx, splitAt);
	if (translation.type !== "text" && !splitMeta) {
		return {
			data: translation,
			error: `Cannot split this ${translation.type.toUpperCase()} segment without corrupting its structural mapping.`,
		};
	}

	const newSeg1 = [...translation.seg1];
	const newSeg2 = [...translation.seg2];
	const newChecked = [...translation.checked];
	const newMeta = translation.segmentsMeta
		? [...translation.segmentsMeta]
		: undefined;
	const hasAlignedJoinStates =
		translation.segmentJoinStates?.length === translation.seg1.length;
	const newJoinStates = hasAlignedJoinStates
		? normalizedJoinStates(translation)
		: undefined;
	const currentJoinState = newJoinStates?.[idx] ?? null;
	const matchingJoinBoundary = currentJoinState?.boundaries.find(
		(boundary) => boundary.sourceOffset === splitAt,
	);
	const canRestoreJoinedTargets =
		!!currentJoinState &&
		currentJoinState.targetSnapshot === translation.seg2[idx] &&
		matchingJoinBoundary?.targetOffset !== null &&
		matchingJoinBoundary?.targetOffset !== undefined;
	const targetSplitAt = canRestoreJoinedTargets
		? matchingJoinBoundary!.targetOffset!
		: null;
	const firstTarget =
		targetSplitAt === null
			? stripOwnedSeparator(
					translation.seg2[idx],
					translation.segmentsMeta?.[idx],
				)
			: translation.seg2[idx].slice(0, targetSplitAt);
	const secondTarget =
		targetSplitAt === null ? "" : translation.seg2[idx].slice(targetSplitAt);
	const restoredMeta =
		canRestoreJoinedTargets &&
		matchingJoinBoundary?.firstMeta &&
		matchingJoinBoundary.secondMeta
			? {
					first: cloneSegmentMeta(matchingJoinBoundary.firstMeta)!,
					second: cloneSegmentMeta(matchingJoinBoundary.secondMeta)!,
				}
			: undefined;
	const effectiveSplitMeta = restoredMeta ?? splitMeta;
	const restoredChecks =
		canRestoreJoinedTargets &&
		typeof matchingJoinBoundary?.firstChecked === "boolean" &&
		typeof matchingJoinBoundary.secondChecked === "boolean"
			? [matchingJoinBoundary.firstChecked, matchingJoinBoundary.secondChecked]
			: [false, false];

	newSeg1.splice(idx, 1, source.slice(0, splitAt), source.slice(splitAt));
	// A character offset in one language is not a meaningful target split point.
	// Keep the translatable target on the first half; its structural separator is
	// owned by metadata and moves to the second half.
	newSeg2.splice(idx, 1, firstTarget, secondTarget);
	newChecked.splice(idx, 1, ...restoredChecks);
	if (newMeta && effectiveSplitMeta) {
		newMeta.splice(idx, 1, effectiveSplitMeta.first, effectiveSplitMeta.second);
	}
	if (newJoinStates) {
		const splitStates =
			canRestoreJoinedTargets && currentJoinState && targetSplitAt !== null
				? splitJoinState(
						currentJoinState,
						splitAt,
						targetSplitAt,
						firstTarget,
						secondTarget,
					)
				: ([null, null] as const);
		newJoinStates.splice(idx, 1, ...splitStates);
	}

	return {
		data: {
			...translation,
			seg1: newSeg1,
			seg2: newSeg2,
			checked: newChecked,
			segmentsMeta: newMeta,
			segmentJoinStates: newJoinStates,
		},
		restoredJoinBoundary: canRestoreJoinedTargets,
	};
}

export function combineSegmentData(
	translation: TranslationData,
	idx: number,
): CombineResult {
	const validationError = validateForStructuralEdit(translation);
	if (validationError) return { data: translation, error: validationError };

	if (!Number.isInteger(idx) || idx < 0 || idx >= translation.seg1.length - 1) {
		return { data: translation, error: "Invalid segment index." };
	}
	const combinedMeta = combineMetaEntries(translation, idx);
	if (combinedMeta.error) {
		return { data: translation, error: combinedMeta.error };
	}

	const newSeg1 = [...translation.seg1];
	const newSeg2 = [...translation.seg2];
	const newChecked = [...translation.checked];
	const newMeta = translation.segmentsMeta
		? [...translation.segmentsMeta]
		: undefined;
	const newJoinStates = normalizedJoinStates(translation);
	const currentSourceLength = newSeg1[idx].length;
	const currentTargetLength = newSeg2[idx].length;
	const joinedTarget = newSeg2[idx] + newSeg2[idx + 1];
	const firstMeta = cloneSegmentMeta(newMeta?.[idx]);
	const secondMeta = cloneSegmentMeta(newMeta?.[idx + 1]);
	const joinedState: SegmentJoinState = {
		targetSnapshot: joinedTarget,
		boundaries: [
			...shiftedJoinBoundaries(newJoinStates[idx], newSeg2[idx], 0, 0),
			{
				sourceOffset: currentSourceLength,
				targetOffset: currentTargetLength,
				...(firstMeta ? { firstMeta } : {}),
				...(secondMeta ? { secondMeta } : {}),
				firstChecked: newChecked[idx],
				secondChecked: newChecked[idx + 1],
			},
			...shiftedJoinBoundaries(
				newJoinStates[idx + 1],
				newSeg2[idx + 1],
				currentSourceLength,
				currentTargetLength,
			),
		].sort((first, second) => first.sourceOffset - second.sourceOffset),
	};

	newSeg1.splice(idx, 2, newSeg1[idx] + newSeg1[idx + 1]);
	newSeg2.splice(idx, 2, joinedTarget);
	newChecked.splice(idx, 2, newChecked[idx] && newChecked[idx + 1]);
	newJoinStates.splice(idx, 2, joinedState);
	if (newMeta && combinedMeta.entry) {
		newMeta.splice(idx, 2, combinedMeta.entry);
	}

	return {
		data: {
			...translation,
			seg1: newSeg1,
			seg2: newSeg2,
			checked: newChecked,
			segmentsMeta: newMeta,
			segmentJoinStates: newJoinStates,
		},
	};
}

export function combineSegmentRangeData(
	translation: TranslationData,
	indices: readonly number[],
): CombineResult {
	if (indices.length < 2) {
		return {
			data: translation,
			error: "Select at least two consecutive segments to join.",
		};
	}

	const selected = [...indices].sort((a, b) => a - b);
	if (
		selected.some((index) => !Number.isInteger(index)) ||
		new Set(selected).size !== selected.length ||
		selected.some((index, position) =>
			position === 0 ? false : index !== selected[position - 1] + 1,
		)
	) {
		return {
			data: translation,
			error: "Selected segments must be consecutive to join.",
		};
	}

	if (
		selected[0] < 0 ||
		selected[selected.length - 1] >= translation.seg1.length
	) {
		return { data: translation, error: "Invalid segment selection." };
	}

	let combined = translation;
	for (let count = 1; count < selected.length; count++) {
		const result = combineSegmentData(combined, selected[0]);
		if (result.error) {
			// Range joins are atomic: never return a partially joined document.
			return { data: translation, error: result.error };
		}
		combined = result.data;
	}

	return { data: combined };
}

export function findSplitPoint(text: string): number {
	if (text.length === 0) return 0;
	if (text.length === 1) return 1;
	const mid = Math.floor(text.length / 2);
	const after = text.indexOf(" ", mid);
	const before = text.lastIndexOf(" ", mid);
	if (after !== -1 && after < text.length - 1) return after + 1;
	if (before !== -1 && before > 0) return before + 1;
	return mid;
}
