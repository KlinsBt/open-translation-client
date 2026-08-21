import { tmMatches } from "$lib/functions/saveData/stores.svelte";
import type { TmData } from "$lib/types/types";
import { bestLanguageMatches } from "$lib/components/resources/languageMatching";

const LONG_SEGMENT_THRESHOLD = 500;
const SKETCH_BUCKETS = 2_048;

export function translationUnitValidationError(
	source: string,
	target: string,
	sourceLanguage: string,
	targetLanguage: string,
): string | undefined {
	if (!source.trim()) return "The source segment is empty and cannot be added.";
	if (!target.trim())
		return "Add a target translation before saving this unit to the memory.";
	if (!sourceLanguage || !targetLanguage)
		return "Choose valid source and target languages before saving to the memory.";
	return undefined;
}

interface PreparedSegment {
	text: string;
	characterLength: number;
	sketch?: OrderedTokenSketch;
}

interface OrderedTokenSketch {
	unigrams: Uint32Array;
	bigrams: Uint32Array;
	unigramCount: number;
	bigramCount: number;
}

export function getTranslationMemoryMatches(
	sourceSegments: string[],
	targetSegments: string[],
	segment: string,
	threshold: number,
): { segment: string; match: string; percentage: string }[] {
	const matches: { segment: string; match: string; percentage: string }[] = [];

	const normalizedQuery = normalizeForMatch(segment);
	const preparedQuery = prepareSegment(normalizedQuery);
	for (let i = 0; i < sourceSegments.length; i++) {
		const candidate = normalizeForMatch(sourceSegments[i]);
		const preparedCandidate = prepareSegment(candidate);
		const maxLength = Math.max(
			preparedQuery.characterLength,
			preparedCandidate.characterLength,
		);
		const maximumDistance = Math.floor(maxLength * (1 - threshold / 100));
		if (
			Math.abs(
				preparedQuery.characterLength - preparedCandidate.characterLength,
			) > maximumDistance
		)
			continue;
		const similarity = preparedSimilarity(preparedQuery, preparedCandidate);
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

function hashToken(token: string): number {
	let hash = 0x811c9dc5;
	for (const character of token) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function orderedTokenSketch(value: string): OrderedTokenSketch {
	const unigrams = new Uint32Array(SKETCH_BUCKETS);
	const bigrams = new Uint32Array(SKETCH_BUCKETS);
	let previous: number | undefined;
	let unigramCount = 0;
	let bigramCount = 0;
	for (const match of value.matchAll(/[\p{L}\p{N}\p{M}_]+|[^\s]/gu)) {
		const current = hashToken(match[0]);
		unigrams[current % SKETCH_BUCKETS]++;
		unigramCount++;
		if (previous !== undefined) {
			const pair = Math.imul(previous ^ 0x9e3779b9, 33) ^ current;
			bigrams[(pair >>> 0) % SKETCH_BUCKETS]++;
			bigramCount++;
		}
		previous = current;
	}
	return { unigrams, bigrams, unigramCount, bigramCount };
}

function multisetDice(
	first: Uint32Array,
	second: Uint32Array,
	firstCount: number,
	secondCount: number,
): number {
	if (firstCount + secondCount === 0) return 100;
	let intersection = 0;
	for (let index = 0; index < first.length; index++)
		intersection += Math.min(first[index], second[index]);
	return (2 * intersection * 100) / (firstCount + secondCount);
}

function prepareSegment(text: string): PreparedSegment {
	let characterLength = 0;
	for (const _character of text) characterLength++;
	return {
		text,
		characterLength,
		...(characterLength > LONG_SEGMENT_THRESHOLD
			? { sketch: orderedTokenSketch(text) }
			: {}),
	};
}

function preparedSimilarity(
	first: PreparedSegment,
	second: PreparedSegment,
): number {
	if (first.text === second.text) return 100;
	const maxLength = Math.max(first.characterLength, second.characterLength);
	if (maxLength === 0) return 100;
	if (maxLength <= LONG_SEGMENT_THRESHOLD) {
		const distance = levenshteinDistance(first.text, second.text);
		return ((maxLength - distance) / maxLength) * 100;
	}
	const firstSketch = first.sketch ?? orderedTokenSketch(first.text);
	const secondSketch = second.sketch ?? orderedTokenSketch(second.text);
	const unigram = multisetDice(
		firstSketch.unigrams,
		secondSketch.unigrams,
		firstSketch.unigramCount,
		secondSketch.unigramCount,
	);
	const bigram = multisetDice(
		firstSketch.bigrams,
		secondSketch.bigrams,
		firstSketch.bigramCount,
		secondSketch.bigramCount,
	);
	return Math.min(99.99, unigram * 0.35 + bigram * 0.65);
}

export function similarityPercentage(a: string, b: string): number {
	return preparedSimilarity(prepareSegment(a), prepareSegment(b));
}

function tmDataToLangFilteredArrays(
	tmData: TmData,
	sourceLang: string,
	targetLang: string,
): [string[], string[]] {
	const sourceTextArray: string[] = [];
	const targetTextArray: string[] = [];

	for (const term of bestLanguageMatches(
		tmData.terms,
		sourceLang,
		(entry) => entry.source.lang,
	)) {
		const sourceSegment = term.source.segment;

		for (const target of bestLanguageMatches(
			term.target,
			targetLang,
			(entry) => entry.lang,
		)) {
			sourceTextArray.push(sourceSegment);
			targetTextArray.push(target.segment);
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

	// Perform fuzzy matching with the specified threshold
	const tmMatchesFound = getTranslationMemoryMatches(
		sourceTextArray,
		targetTextArray,
		textSegment1,
		55,
	);

	// Update the store and return the results
	tmMatches.set(tmMatchesFound);
	return tmMatchesFound;
}
