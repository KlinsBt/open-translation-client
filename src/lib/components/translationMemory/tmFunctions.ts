import { tmMatches } from "$lib/functions/saveData/stores.svelte";
import type { TmData } from "$lib/types/types";

export function getTranslationMemoryMatches(
	sourceSegments: string[],
	targetSegments: string[],
	segment: string,
	threshold: number,
): { segment: string; match: string; percentage: string }[] {
	const matches: { segment: string; match: string; percentage: string }[] = [];

	const normalizedQuery = normalizeForMatch(segment);
	for (let i = 0; i < sourceSegments.length; i++) {
		const candidate = normalizeForMatch(sourceSegments[i]);
		const maxLength = Math.max(normalizedQuery.length, candidate.length);
		const maximumDistance = Math.floor(maxLength * (1 - threshold / 100));
		if (Math.abs(normalizedQuery.length - candidate.length) > maximumDistance)
			continue;
		const similarity = similarityPercentage(normalizedQuery, candidate);
		if (similarity >= threshold) {
			matches.push({
				segment: sourceSegments[i],
				match: targetSegments[i],
				percentage: `${similarity.toFixed(2)}%`,
			});
		}
	}

	const sortedMatches = matches.sort((a, b) => {
		return parseFloat(b.percentage) - parseFloat(a.percentage);
	});
	return sortedMatches.slice(0, 50);
}

export function normalizeForMatch(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/\s+/gu, " ")
		.trim();
}

function levenshteinDistance(a: string, b: string): number {
	const first = Array.from(a);
	const second = Array.from(b);
	if (first.length < second.length) return levenshteinDistance(b, a);
	let previous = Array.from({ length: second.length + 1 }, (_, index) => index);
	let current = new Array<number>(second.length + 1);
	for (let row = 1; row <= first.length; row++) {
		current[0] = row;
		for (let column = 1; column <= second.length; column++)
			current[column] = Math.min(
				current[column - 1] + 1,
				previous[column] + 1,
				previous[column - 1] + (first[row - 1] === second[column - 1] ? 0 : 1),
			);
		[previous, current] = [current, previous];
	}
	return previous[second.length];
}

function tokenDiceSimilarity(a: string, b: string): number {
	const tokensA = new Set(a.split(/\s+/u).filter(Boolean));
	const tokensB = new Set(b.split(/\s+/u).filter(Boolean));
	if (tokensA.size === 0 && tokensB.size === 0) return 100;
	let intersection = 0;
	for (const token of tokensA) if (tokensB.has(token)) intersection++;
	return (2 * intersection * 100) / (tokensA.size + tokensB.size);
}

export function similarityPercentage(a: string, b: string): number {
	const maxLen = Math.max(Array.from(a).length, Array.from(b).length);
	if (maxLen === 0) return 100; // If both strings are empty, consider 100% match
	if (maxLen > 500) return tokenDiceSimilarity(a, b);
	const distance = levenshteinDistance(a, b);
	return ((maxLen - distance) / maxLen) * 100;
}

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
