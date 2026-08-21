import type { UserData } from "$lib/types/types";

/*
 *  Calculate the progress of all projects by the percentage all checked segments
 *  divided by the total number projects, the number of finished projects
 *  and the the total number of words in each project
 */
export function getProjectsProgressStatistics(userData: UserData[]) {
	if (userData.length === 0) {
		return [0, 0, 0, 0];
	}
	// values[0] == TotalProjectsPercentage
	// values[1] == finishedProjects
	// values[2] == totalWords
	// values[3] == totalWordsTranslated
	let values = [0, 0, 0, 0];
	for (let i = 0; i < userData.length; i++) {
		let percentage: number = calcPercentageOfTotalSegmentsChecked(
			userData[i].translationData.checked,
		);
		values[2] += getTotalWordCount(userData[i].translationData.seg1);
		values[3] += getTotalWordCount(userData[i].translationData.seg2);
		values[0] += percentage;
		if (
			userData[i].translationData.checked.length > 0 &&
			userData[i].translationData.checked.every(Boolean)
		) {
			values[1] += 1;
		}
	}
	const average = Math.round(values[0] / userData.length);
	values[0] =
		values[1] === userData.length ? 100 : Math.min(99, Math.max(0, average));
	return values;
}

export function calcPercentageOfTotalSegmentsChecked(
	checked: boolean[],
): number {
	let total: number = checked.length;
	if (total === 0) return 0;
	try {
		let done = checked.filter((x) => x === true);
		let sum: number = (done.length / total) * 100;
		if (isNaN(sum)) {
			sum = 0;
		}
		if (done.length === total) return 100;
		return Math.min(99, Math.round(sum));
	} catch (error) {
		return 0;
	}
}

export async function getWordsAmountFromFullText(fullText: string) {
	return countWords(fullText);
}

export function countWords(text: string): number {
	if (!text.trim()) return 0;

	if (typeof Intl.Segmenter === "function") {
		const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
		let count = 0;
		for (const segment of segmenter.segment(text)) {
			if (segment.isWordLike) count += 1;
		}
		return count;
	}

	// Older engines get a Unicode-aware fallback. CJK characters are counted
	// individually rather than collapsing a complete sentence into one word.
	return (
		text.match(
			/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu,
		)?.length ?? 0
	);
}

export function getTotalWordCount(segmentsArray: string[]): number {
	return segmentsArray.reduce((total, text) => total + countWords(text), 0);
}
