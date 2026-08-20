import { tbMatches } from "$lib/functions/saveData/stores.svelte";
import type { TbData } from "$lib/types/types";
import { bestLanguageMatches } from "$lib/components/resources/languageMatching";

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

	const normalizedSentence = normalizeTermText(searchSentence);
	const normalizeNotes = (
		notes: string[] | { type: string; text: string }[],
	): string[] =>
		notes.map((note) =>
			typeof note === "string"
				? note
				: note.type
					? `${note.type}: ${note.text}`
					: note.text,
		);

	// Iterate over all entries in the TbData structure
	for (const entry of tbData.entries) {
		if (!entry || !entry.terms) continue; // Skip undefined or invalid entries

		for (const sourceTerm of bestLanguageMatches(
			entry.terms,
			sourceLanguage,
			(term) => term.lang,
		)) {
			if (containsWholeTerm(normalizedSentence, sourceTerm.term)) {
				const targetTerm = bestLanguageMatches(
					entry.terms,
					targetLanguage,
					(term) => term.lang,
				);

				for (const term of targetTerm) {
					// Add to matches if a target term exists
					if (term) {
						matches.push({
							searchEntry: sourceTerm.term,
							foundEntry: term.term,
							notes: normalizeNotes(term.notes),
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

export function normalizeTermText(value: string): string {
	return value
		.normalize("NFKC")
		.toLocaleLowerCase()
		.replace(/\s+/gu, " ")
		.trim();
}

export function containsWholeTerm(sentence: string, rawTerm: string): boolean {
	const term = normalizeTermText(rawTerm);
	if (!term) return false;
	const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const startsWithWord = /^[\p{L}\p{N}\p{M}_]/u.test(term);
	const endsWithWord = /[\p{L}\p{N}\p{M}_]$/u.test(term);
	const pattern = `${startsWithWord ? "(?<![\\p{L}\\p{N}\\p{M}_])" : ""}${escaped}${endsWithWord ? "(?![\\p{L}\\p{N}\\p{M}_])" : ""}`;
	return new RegExp(pattern, "iu").test(sentence);
}
