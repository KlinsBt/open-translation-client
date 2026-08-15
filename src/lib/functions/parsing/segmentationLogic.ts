import type { UserData, DocxFragmentMeta } from "$lib/types/types";
type TranslationData = UserData["translationData"];

export interface SplitResult {
	data: TranslationData;
}

export interface CombineResult {
	data: TranslationData;
	error?: string;
}

export type DocxHtmlMeta =
	| {
			separator?: string;
			fragments?: any[];
	  }
	| {
			path: string[];
			separator?: string;
	  };

function splitMetaEntry(
	metaEntry: any,
	splitPoint: number,
): { first: any; second: any } {
	if (!metaEntry || !metaEntry.fragments) {
		return {
			first: { fragments: [], separator: "" },
			second: { fragments: [], separator: "" },
		};
	}
	const fragments = metaEntry.fragments;
	const firstFrags: any[] = [];
	const secondFrags: any[] = [];
	let consumed = 0;
	for (const frag of fragments) {
		const len = frag.end - frag.start;
		const nextConsumed = consumed + len;
		if (nextConsumed <= splitPoint) {
			firstFrags.push({ ...frag });
		} else if (consumed >= splitPoint) {
			secondFrags.push({ ...frag });
		} else {
			const cut = splitPoint - consumed;
			firstFrags.push({ ...frag, end: frag.start + cut });
			secondFrags.push({ ...frag, start: frag.start + cut });
		}
		consumed = nextConsumed;
	}
	return {
		first: { separator: metaEntry.separator ?? "", fragments: firstFrags },
		second: { separator: metaEntry.separator ?? "", fragments: secondFrags },
	};
}

function isJsonMetaEntry(
	entry: any,
): entry is { path: string[]; separator?: string } {
	return entry && typeof entry === "object" && Array.isArray(entry.path);
}

export function splitSegmentData(
	translation: TranslationData,
	idx: number,
	splitAt: number,
): SplitResult {
	const src = translation.seg1[idx];
	const trg = translation.seg2[idx];
	const firstSrc = src.slice(0, splitAt);
	const secondSrc = src.slice(splitAt);
	const firstTrg = trg.slice(0, Math.min(trg.length, splitAt));
	const secondTrg = trg.slice(Math.min(trg.length, splitAt));

	const newSeg1 = [...translation.seg1];
	const newSeg2 = [...translation.seg2];
	const newChecked = [...translation.checked];

	newSeg1.splice(idx, 1, firstSrc, secondSrc);
	newSeg2.splice(idx, 1, firstTrg, secondTrg);
	newChecked.splice(idx, 1, false, false);

	let newMeta = translation.segmentsMeta ? [...translation.segmentsMeta] : [];

	if (newMeta[idx] && isJsonMetaEntry(newMeta[idx])) {
		const entry = newMeta[idx];
		const sepFirst = entry.separator ?? "";
		newMeta.splice(
			idx,
			1,
			{ path: [...entry.path], separator: sepFirst },
			{ path: [...entry.path], separator: "" },
		);
	} else if (newMeta[idx]) {
		const { first, second } = splitMetaEntry(newMeta[idx], splitAt);
		newMeta.splice(idx, 1, first, second);
	} else {
		newMeta.splice(
			idx,
			1,
			{ fragments: [], separator: "" },
			{ fragments: [], separator: "" },
		);
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
	if (idx < 0 || idx >= translation.seg1.length - 1) {
		return { data: translation, error: "Invalid index" };
	}

	const newSeg1 = [...translation.seg1];
	const newSeg2 = [...translation.seg2];
	const newChecked = [...translation.checked];

	newSeg1[idx] = newSeg1[idx] + newSeg1[idx + 1];
	newSeg2[idx] = newSeg2[idx] + newSeg2[idx + 1];
	newChecked[idx] = newChecked[idx] && newChecked[idx + 1];

	newSeg1.splice(idx + 1, 1);
	newSeg2.splice(idx + 1, 1);
	newChecked.splice(idx + 1, 1);

	let newMeta = translation.segmentsMeta ? [...translation.segmentsMeta] : [];

	if (
		newMeta[idx] &&
		newMeta[idx + 1] &&
		isJsonMetaEntry(newMeta[idx]) &&
		isJsonMetaEntry(newMeta[idx + 1])
	) {
		const currentEntry = newMeta[idx] as { path: string[]; separator?: string };
		const nextEntry = newMeta[idx + 1] as {
			path: string[];
			separator?: string;
		};
		if (JSON.stringify(currentEntry.path) !== JSON.stringify(nextEntry.path)) {
			return {
				data: translation,
				error: "Cannot combine segments from different JSON fields.",
			};
		}
		newMeta[idx] = { ...currentEntry, separator: "" };
		newMeta.splice(idx + 1, 1);
	} else if (
		newMeta[idx] &&
		newMeta[idx + 1] &&
		typeof newMeta[idx] === "object" &&
		typeof newMeta[idx + 1] === "object" &&
		!Array.isArray(newMeta[idx]) &&
		!Array.isArray(newMeta[idx + 1])
	) {
		const currentEntry = newMeta[idx] as {
			separator?: string;
			fragments: DocxFragmentMeta[];
		};
		const nextEntry = newMeta[idx + 1] as {
			separator?: string;
			fragments: DocxFragmentMeta[];
		};
		newMeta[idx] = {
			separator: "",
			fragments: [
				...(currentEntry.fragments || []),
				...(nextEntry.fragments || []),
			],
		};
		newMeta.splice(idx + 1, 1);
	} else if (newMeta[idx + 1]) {
		newMeta.splice(idx + 1, 1);
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

export function findSplitPoint(text: string): number {
	if (text.length <= 1) return 1;
	const mid = Math.floor(text.length / 2);
	const after = text.indexOf(" ", mid);
	const before = text.lastIndexOf(" ", mid);
	if (after !== -1 && after < text.length - 1) return after + 1;
	if (before !== -1 && before > 0) return before + 1;
	return mid;
}
