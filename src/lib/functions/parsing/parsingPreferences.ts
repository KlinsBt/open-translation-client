export interface ParsingPreference {
	id: string;
	label: string;
	tokens: string[];
	active: boolean;
}

const STORAGE_KEY = "parsing-preferences";
const DEFAULT_PREF: ParsingPreference = {
	id: "default",
	label: "Default (sentence-based)",
	tokens: [".", "?", "!", "。", "！", "？"],
	active: true,
};

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function ensureDefaultPref(prefs: ParsingPreference[]): ParsingPreference[] {
	const existingDefault = prefs.find((p) => p.id === DEFAULT_PREF.id);
	let updated = prefs;

	if (!existingDefault) {
		updated = [DEFAULT_PREF, ...prefs];
	} else {
		// Keep default tokens/label immutable, but preserve active state
		updated = prefs.map((p) =>
			p.id === DEFAULT_PREF.id
				? { ...DEFAULT_PREF, active: p.active }
				: p,
		);
	}

	// If nothing is active, default becomes active
	if (!updated.some((p) => p.active)) {
		updated = updated.map((p) => ({ ...p, active: p.id === DEFAULT_PREF.id }));
	}

	return updated;
}

function readStore(): ParsingPreference[] {
	if (!isBrowser()) return [DEFAULT_PREF];
	const raw = localStorage.getItem(STORAGE_KEY);
	if (!raw) return [DEFAULT_PREF];
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return ensureDefaultPref(parsed);
		return [DEFAULT_PREF];
	} catch (e) {
		console.warn("Failed to parse parsing preferences", e);
		return [DEFAULT_PREF];
	}
}

function writeStore(data: ParsingPreference[]) {
	if (!isBrowser()) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadParsingPreferences(): ParsingPreference[] {
	const prefs = ensureDefaultPref(readStore());
	writeStore(prefs);
	return prefs;
}

export function saveParsingPreferences(preferences: ParsingPreference[]) {
	writeStore(preferences);
}

export function addParsingPreference(
	label: string,
	tokens: string[],
): ParsingPreference[] {
	const existing = ensureDefaultPref(readStore());
	const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
	const newPref: ParsingPreference = {
		id,
		label: label || `Custom ${existing.length + 1}`,
		tokens: tokens.map((t) => t.trim()).filter(Boolean),
		active: false,
	};
	existing.push(newPref);
	const result = ensureDefaultPref(existing);
	writeStore(result);
	return result;
}

export function setActiveParsingPreference(id: string): ParsingPreference[] {
	const prefs = ensureDefaultPref(readStore()).map((p) => ({
		...p,
		active: p.id === id,
	}));
	writeStore(prefs);
	return prefs;
}

export function deleteParsingPreference(id: string): ParsingPreference[] {
	// Default preset cannot be deleted
	if (id === DEFAULT_PREF.id) {
		const prefs = ensureDefaultPref(readStore());
		writeStore(prefs);
		return prefs;
	}

	const prefs = ensureDefaultPref(readStore()).filter((p) => p.id !== id);
	const normalized = ensureDefaultPref(prefs);
	writeStore(normalized);
	return normalized;
}

export function updateParsingPreference(
	id: string,
	label: string,
	tokens: string[],
): ParsingPreference[] {
	const prefs = ensureDefaultPref(readStore());
	const updated = prefs.map((p) => {
		if (p.id !== id) return p;
		if (p.id === DEFAULT_PREF.id) return p; // default is immutable
		return {
			...p,
			label: label || p.label,
			tokens: tokens.map((t) => t.trim()).filter(Boolean),
		};
	});
	const normalized = ensureDefaultPref(updated);
	writeStore(normalized);
	return normalized;
}

export function getActiveTokens(): string[] {
	const prefs = ensureDefaultPref(readStore());
	const active = prefs.find((p) => p.active);
	return active ? active.tokens : DEFAULT_PREF.tokens;
}
