export type LanguageMatchRank = 0 | 1 | 2;

function unwrapLanguageLabel(value: string): string {
	const trimmed = value.trim();
	return trimmed.match(/\(([^()]+)\)\s*$/)?.[1]?.trim() ?? trimmed;
}

/** Canonicalizes a BCP 47 tag. UI labels and common underscore tags are accepted. */
export function canonicalizeLanguageTag(value: string): string | null {
	const candidate = unwrapLanguageLabel(value).replaceAll("_", "-");
	if (!candidate) return null;
	try {
		return Intl.getCanonicalLocales(candidate)[0] ?? null;
	} catch {
		return null;
	}
}

function comparableLanguage(value: string): string {
	return (
		canonicalizeLanguageTag(value) ?? unwrapLanguageLabel(value).toLowerCase()
	);
}

/**
 * Exact canonical tags rank above base-language matches. Invalid legacy labels
 * only match exactly and never participate in base-language fallback.
 */
export function languageMatchRank(
	candidate: string,
	requested: string,
): LanguageMatchRank {
	const canonicalCandidate = canonicalizeLanguageTag(candidate);
	const canonicalRequested = canonicalizeLanguageTag(requested);
	if (canonicalCandidate && canonicalRequested) {
		if (canonicalCandidate === canonicalRequested) return 2;
		return canonicalCandidate.split("-", 1)[0] ===
			canonicalRequested.split("-", 1)[0]
			? 1
			: 0;
	}
	return comparableLanguage(candidate) === comparableLanguage(requested)
		? 2
		: 0;
}

export function bestLanguageMatches<T>(
	values: readonly T[],
	requested: string,
	getLanguage: (value: T) => string,
): T[] {
	let bestRank: LanguageMatchRank = 0;
	const ranked: Array<{ value: T; rank: LanguageMatchRank }> = [];
	for (const value of values) {
		const rank = languageMatchRank(getLanguage(value), requested);
		if (rank > bestRank) bestRank = rank;
		ranked.push({ value, rank });
	}
	return bestRank === 0
		? []
		: ranked.filter(({ rank }) => rank === bestRank).map(({ value }) => value);
}
