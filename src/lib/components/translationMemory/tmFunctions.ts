import { tmMatches } from "$lib/functions/saveData/stores.svelte";
import type { TmData } from "$lib/types/types";
import { bestLanguageMatches } from "$lib/components/resources/languageMatching";
import { canonicalizeLanguageTag } from "$lib/components/resources/languageMatching";

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

interface PreparedTmCandidate {
	source: string;
	target: string;
	prepared: PreparedSegment;
	order: number;
}

export interface PreparedTranslationMemoryIndex {
	readonly sourceLanguage: string;
	readonly targetLanguage: string;
	readonly candidates: readonly PreparedTmCandidate[];
}

interface CachedTranslationMemoryIndexes {
	revision: number;
	terms: TmData["terms"];
	byLanguagePair: Map<string, PreparedTranslationMemoryIndex>;
}

const translationMemoryIndexCache = new WeakMap<
	TmData,
	CachedTranslationMemoryIndexes
>();

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
	const candidates = sourceSegments
		.map((source, index): PreparedTmCandidate | null => {
			if (targetSegments[index] === undefined) return null;
			return {
				source,
				target: targetSegments[index],
				prepared: prepareSegment(normalizeForMatch(source)),
				order: index,
			};
		})
		.filter((candidate): candidate is PreparedTmCandidate => candidate !== null)
		.sort(comparePreparedCandidates);
	return matchPreparedTranslationMemoryIndex(
		{
			sourceLanguage: "",
			targetLanguage: "",
			candidates,
		},
		segment,
		threshold,
	);
}

function comparePreparedCandidates(
	first: PreparedTmCandidate,
	second: PreparedTmCandidate,
): number {
	return (
		first.prepared.characterLength - second.prepared.characterLength ||
		first.order - second.order
	);
}

function firstCandidateAtLeast(
	candidates: readonly PreparedTmCandidate[],
	minimumLength: number,
): number {
	let low = 0;
	let high = candidates.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (candidates[middle].prepared.characterLength < minimumLength)
			low = middle + 1;
		else high = middle;
	}
	return low;
}

function firstCandidateAbove(
	candidates: readonly PreparedTmCandidate[],
	maximumLength: number,
): number {
	let low = 0;
	let high = candidates.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (candidates[middle].prepared.characterLength <= maximumLength)
			low = middle + 1;
		else high = middle;
	}
	return low;
}

export function matchPreparedTranslationMemoryIndex(
	index: PreparedTranslationMemoryIndex,
	segment: string,
	threshold: number,
): { segment: string; match: string; percentage: string }[] {
	const safeThreshold = Math.max(0, Math.min(100, threshold));
	const preparedQuery = prepareSegment(normalizeForMatch(segment));
	const thresholdRatio = safeThreshold / 100;
	const minimumLength =
		thresholdRatio === 0
			? 0
			: Math.max(0, Math.floor(preparedQuery.characterLength * thresholdRatio));
	const maximumLength =
		thresholdRatio === 0
			? Number.POSITIVE_INFINITY
			: Math.ceil(preparedQuery.characterLength / thresholdRatio);
	const start = firstCandidateAtLeast(index.candidates, minimumLength);
	const end = firstCandidateAbove(index.candidates, maximumLength);
	const matches: Array<{
		segment: string;
		match: string;
		percentage: string;
		order: number;
	}> = [];

	for (let i = start; i < end; i++) {
		const candidate = index.candidates[i];
		const maxLength = Math.max(
			preparedQuery.characterLength,
			candidate.prepared.characterLength,
		);
		const maximumDistance = Math.floor(maxLength * (1 - safeThreshold / 100));
		if (
			Math.abs(
				preparedQuery.characterLength - candidate.prepared.characterLength,
			) > maximumDistance
		)
			continue;
		const similarity = preparedSimilarity(preparedQuery, candidate.prepared);
		if (similarity >= safeThreshold) {
			matches.push({
				segment: candidate.source,
				match: candidate.target,
				percentage: `${similarity.toFixed(2)}%`,
				order: candidate.order,
			});
		}
	}

	return matches
		.sort(
			(a, b) =>
				parseFloat(b.percentage) - parseFloat(a.percentage) ||
				a.order - b.order,
		)
		.slice(0, 50)
		.map(({ order: _order, ...match }) => match);
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

function normalizedLanguageCacheKey(language: string): string {
	return (
		canonicalizeLanguageTag(language) ?? language.trim().toLocaleLowerCase()
	);
}

function buildTranslationMemoryIndex(
	tmData: TmData,
	sourceLang: string,
	targetLang: string,
): PreparedTranslationMemoryIndex {
	const candidates: PreparedTmCandidate[] = [];
	let order = 0;

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
			candidates.push({
				source: sourceSegment,
				target: target.segment,
				prepared: prepareSegment(normalizeForMatch(sourceSegment)),
				order: order++,
			});
		}
	}

	candidates.sort(comparePreparedCandidates);
	return {
		sourceLanguage: normalizedLanguageCacheKey(sourceLang),
		targetLanguage: normalizedLanguageCacheKey(targetLang),
		candidates,
	};
}

export function prepareTranslationMemoryIndex(
	tmData: TmData,
	sourceLang: string,
	targetLang: string,
): PreparedTranslationMemoryIndex {
	const revision = tmData.persistenceRevision;
	if (revision === undefined)
		return buildTranslationMemoryIndex(tmData, sourceLang, targetLang);

	let cached = translationMemoryIndexCache.get(tmData);
	if (
		!cached ||
		cached.revision !== revision ||
		cached.terms !== tmData.terms
	) {
		cached = {
			revision,
			terms: tmData.terms,
			byLanguagePair: new Map(),
		};
		translationMemoryIndexCache.set(tmData, cached);
	}
	const key = `${normalizedLanguageCacheKey(sourceLang)}\u0000${normalizedLanguageCacheKey(targetLang)}`;
	let prepared = cached.byLanguagePair.get(key);
	if (!prepared) {
		prepared = buildTranslationMemoryIndex(tmData, sourceLang, targetLang);
		cached.byLanguagePair.set(key, prepared);
	}
	return prepared;
}

export function searchForMatches(
	translationMemory: TmData,
	textSegment1: string,
	sourceLang: string,
	targetLang: string,
) {
	const index = prepareTranslationMemoryIndex(
		translationMemory,
		sourceLang,
		targetLang,
	);
	const tmMatchesFound = matchPreparedTranslationMemoryIndex(
		index,
		textSegment1,
		55,
	);

	// Update the store and return the results
	tmMatches.set(tmMatchesFound);
	return tmMatchesFound;
}
