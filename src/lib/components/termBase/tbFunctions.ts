import { tbMatches } from "$lib/functions/saveData/stores.svelte";
import type { TbData } from "$lib/types/types";

export function getTermMatches(
	tbData: TbData,
	searchSentence: string,
	sourceLanguage: string,
	targetLanguage: string,
): { searchEntry: string; foundEntry: string; notes: string[] }[] {
	const matches: {
		searchEntry: string;
		foundEntry: string;
		notes: string[];
	}[] = [];

	const normalizedSentence = searchSentence.toLowerCase();

	// Iterate over all entries in the TbData structure
	for (const entry of tbData.entries) {
		if (!entry || !entry.terms) continue; // Skip undefined or invalid entries

		// Find terms in the source language
		for (const sourceTerm of entry.terms) {
			if (
				sourceTerm.lang === sourceLanguage &&
				normalizedSentence.includes(sourceTerm.term.toLowerCase())
			) {
				// Find the corresponding term in the target language
				const targetTerm = entry.terms.filter(
					(term) => term.lang === targetLanguage,
				);

				for (const term of targetTerm) {
					// Add to matches if a target term exists
					if (term) {
						matches.push({
							searchEntry: sourceTerm.term,
							foundEntry: term.term,
							notes: term.notes,
						});
					}
				}

				// Add to matches if a target term exists
				// if (targetTerm) {
				// 	matches.push({
				// 		searchEntry: sourceTerm.term,
				// 		foundEntry: targetTerm.term,
				// 		notes: targetTerm.notes,
				// 	});
				// }
			}
		}
	}

	tbMatches.set(matches);
	return matches;
}
