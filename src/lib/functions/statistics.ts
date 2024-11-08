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
		if (percentage === 100) {
			values[1] += 1;
		}
	}
	values[0] = parseInt((values[0] / userData.length).toFixed(0));
	return values;
}

export function calcPercentageOfTotalSegmentsChecked(
	checked: boolean[],
): number {
	let total: number = checked.length;
	try {
		let done = checked.filter((x) => x === true);
		// console.log("Checked Segments", done);
		let sum: number = (done.length / total) * 100;
		if (isNaN(sum)) {
			sum = 0;
		}
		// console.log(sum);
		return parseInt(sum.toFixed(0));
	} catch (error) {
		return 0;
	}
}

export async function getWordsAmountFromFullText(fullText: string) {
	let words = fullText.split(" ");
	return words.length;
}

export function getTotalWordCount(segmentsArray: string[]): number {
	let totalWordCount = 0;

	for (let i = 0; i < segmentsArray.length; i++) {
		const text: string = segmentsArray[i];

		// Split the text by spaces to get the words, and filter out empty strings
		const words: string[] = text.split(/\s+/).filter((word) => word.length > 0);

		// Add the word count to the total
		totalWordCount += words.length;
	}

	return totalWordCount;
}
