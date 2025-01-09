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
				segment: sourceSegments[i],
				match: targetSegments[i],
				percentage: `${similarity.toFixed(2)}%`,
			});
		}
	}

	let sortedMatches = matches.sort((a, b) => {
		return parseFloat(b.percentage) - parseFloat(a.percentage);
	});
	return sortedMatches;
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

function tmDataToLangFilteredArrays(
	tmData: TmData,
	sourceLang: string,
	targetLang: string,
): [string[], string[]] {
	const sourceTextArray: string[] = [];
	const targetTextArray: string[] = [];

	// Iterate over each entry in the translation memory
	for (const term of tmData.terms) {
		// Check if the source language matches
		if (term.source.lang === sourceLang) {
			const sourceSegment = term.source.segment;

			// Iterate over all target segments
			for (const target of term.target) {
				if (target.lang === targetLang) {
					// Add matching source and target segments to the arrays
					sourceTextArray.push(sourceSegment);
					targetTextArray.push(target.segment);
				}
			}
		}
	}

	return [sourceTextArray, targetTextArray];
}

export function searchForMatches(
	translationMemory: TmData,
	textSegment1: string,
	sourceLang: string,
	targetLang: string,
) {
	// Extract only the terms matching the chosen sourceLang and targetLang
	const [sourceTextArray, targetTextArray] = tmDataToLangFilteredArrays(
		translationMemory,
		sourceLang,
		targetLang,
	);

	// console.log("Filtered Source Terms: ", sourceTextArray);
	// console.log("Filtered Target Terms: ", targetTextArray);

	// Perform fuzzy matching with the specified threshold
	const tmMatchesFound = getTranslationMemoryMatches(
		sourceTextArray,
		targetTextArray,
		textSegment1,
		55,
	);

	// console.log("Matches Found: ", tmMatchesFound);

	// Update the store and return the results
	tmMatches.set(tmMatchesFound);
	return tmMatchesFound;
}
