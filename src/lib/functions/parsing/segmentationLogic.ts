import type {
	DocxFragmentMeta,
	DocxSegmentMeta,
	HtmlSegmentMeta,
	JsonSegmentMeta,
	SegmentMeta,
	UserData,
} from "$lib/types/types";

type TranslationData = UserData["translationData"];

export interface SegmentEditResult {
	data: TranslationData;
	error?: string;
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

function ensureOwnedSeparator(value: string, entry: SegmentMeta | undefined) {
	const separator = entry?.separator ?? "";
	return separator && !value.endsWith(separator)
		? `${value}${separator}`
		: value;
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

	newSeg1.splice(idx, 1, source.slice(0, splitAt), source.slice(splitAt));
	// A character offset in one language is not a meaningful target split point.
	// Keep the translatable target on the first half; its structural separator is
	// owned by metadata and moves to the second half.
	newSeg2.splice(
		idx,
		1,
		stripOwnedSeparator(translation.seg2[idx], translation.segmentsMeta?.[idx]),
		"",
	);
	newChecked.splice(idx, 1, false, false);
	if (newMeta && splitMeta) {
		newMeta.splice(idx, 1, splitMeta.first, splitMeta.second);
	}

	return {
		data: {
			...translation,
			seg1: newSeg1,
			seg2: newSeg2,
			checked: newChecked,
			segmentsMeta: newMeta,
		},
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

	newSeg1.splice(idx, 2, newSeg1[idx] + newSeg1[idx + 1]);
	newSeg2.splice(
		idx,
		2,
		ensureOwnedSeparator(newSeg2[idx] + newSeg2[idx + 1], combinedMeta.entry),
	);
	newChecked.splice(idx, 2, newChecked[idx] && newChecked[idx + 1]);
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
