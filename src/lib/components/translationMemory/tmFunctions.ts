import { tmMatches } from "$lib/functions/saveData/stores.svelte";
import type { TmData } from "$lib/types/types";

export function getTranslationMemoryMatches(
	sourceSegments: string[],
	targetSegments: string[],
	segment: string,
	threshold: number,
): { segment: string; match: string; percentage: string }[] {
	const matches: { segment: string; match: string; percentage: string }[] = [];

	// Iterate over the TM source segments and find matches based on threshold
	for (let i = 0; i < sourceSegments.length; i++) {
		const similarity = similarityPercentage(segment, sourceSegments[i]);
		if (similarity >= threshold) {
			matches.push({
				segment,
				match: targetSegments[i],
				percentage: `${similarity.toFixed(2)}%`,
			});
		}
	}

	return matches;
}

// Helper function to calculate Levenshtein distance
function levenshteinDistance(a: string, b: string): number {
	const matrix = Array.from({ length: a.length + 1 }, () =>
		Array(b.length + 1).fill(0),
	);

	for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
	for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			if (a[i - 1] === b[j - 1]) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(
					matrix[i - 1][j] + 1, // Deletion
					matrix[i][j - 1] + 1, // Insertion
					matrix[i - 1][j - 1] + 1, // Substitution
				);
			}
		}
	}
	return matrix[a.length][b.length];
}

// Helper function to calculate similarity percentage
function similarityPercentage(a: string, b: string): number {
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 100; // If both strings are empty, consider 100% match
	const distance = levenshteinDistance(a, b);
	return ((maxLen - distance) / maxLen) * 100;
}

const translationMemory = [
	"This is an example sentence.",
	"This is another example sentence.",
	"This is an example sentence. This is an example sentence.",
	"John De",
	"30",
	"New Yorn",
	"You will rejoice to hear that no disaster has accomp",
	"If you have any questions, please fill out the form below",
	"If you have any questions, please fill out the form below and we'll get back to you soon.",
];

function tmDataToTmArray(tmData: TmData): string[][] {
	let sourceTextArray = [];
	let targetTextArray = [];
	for (let i = 0; i < tmData.terms.length; i++) {
		sourceTextArray.push(tmData.terms[i].source.segment);
		for (let j = 0; j < tmData.terms[i].target.length; j++) {
			targetTextArray.push(tmData.terms[i].target[j].segment);
		}
	}
	return [sourceTextArray, targetTextArray];
}

export function searchForMatches(
	translationMemory: TmData,
	textSegment1: string,
) {
	console.log("Searching for matches...");
	let extractedStringArray = tmDataToTmArray(translationMemory);
	console.log("extractedStringArray: ", extractedStringArray);
	let tmMatchesFound = getTranslationMemoryMatches(
		extractedStringArray[0],
		extractedStringArray[1],
		textSegment1,
		55,
	);
	console.log(tmMatchesFound);
	tmMatches.set(tmMatchesFound);
	return tmMatchesFound;
}
