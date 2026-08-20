import { serializeSrx20, type SrxDocument } from "$lib/formats/srx20";
import { reportProductionWarning } from "$lib/functions/productionDiagnostics";

export interface ParsingPreference {
	id: string;
	label: string;
	tokens: string[];
	active: boolean;
	kind?: "tokens" | "srx";
	srx?: SrxDocument;
	languageCode?: string;
}

export interface ActiveSrxProfile {
	document: SrxDocument;
	languageCode: string;
}

export const DEFAULT_TOKENS = [".", "?", "!", "。", "！", "？"];

const STORAGE_KEY = "parsing-preferences";
const DEFAULT_PREF: ParsingPreference = {
	id: "default",
	label: "Default (sentence-based)",
	tokens: DEFAULT_TOKENS,
	active: true,
	kind: "tokens",
};

function isBrowser() {
	return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function ensureDefaultPref(prefs: ParsingPreference[]): ParsingPreference[] {
	prefs = prefs
		.filter(
			(preference) =>
				preference &&
				typeof preference.id === "string" &&
				typeof preference.label === "string",
		)
		.map((preference) => ({
			...preference,
			kind: preference.kind === "srx" ? "srx" : "tokens",
			tokens: Array.isArray(preference.tokens)
				? preference.tokens.filter((token) => typeof token === "string")
				: [],
			active: preference.active === true,
		}));
	const existingDefault = prefs.find((p) => p.id === DEFAULT_PREF.id);
	let updated = prefs;

	if (!existingDefault) {
		updated = [DEFAULT_PREF, ...prefs];
	} else {
		// Keep default tokens/label immutable, but preserve active state
		updated = prefs.map((p) =>
			p.id === DEFAULT_PREF.id ? { ...DEFAULT_PREF, active: p.active } : p,
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
		reportProductionWarning("Parsing preferences reset", e);
		return [DEFAULT_PREF];
	}
}

function writeStore(data: ParsingPreference[]) {
	if (!isBrowser()) return;
	localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function normalizeLanguageCode(languageCode: string): string {
	try {
		const normalized = Intl.getCanonicalLocales(
			languageCode.trim() || "und",
		)[0];
		if (normalized) return normalized;
	} catch {
		// Report one stable workflow-facing error below.
	}
	throw new Error("SRX source language must be a valid BCP 47 language code.");
}

export function loadParsingPreferences(): ParsingPreference[] {
	const prefs = ensureDefaultPref(readStore());
	writeStore(prefs);
	return prefs;
}

export function saveParsingPreferences(preferences: ParsingPreference[]) {
	writeStore(ensureDefaultPref(preferences));
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
		kind: "tokens",
	};
	existing.push(newPref);
	const result = ensureDefaultPref(existing);
	writeStore(result);
	return result;
}

export function addSrxParsingPreference(
	label: string,
	languageCode: string,
	document: SrxDocument,
): ParsingPreference[] {
	serializeSrx20(document);
	const existing = ensureDefaultPref(readStore());
	const id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
	existing.push({
		id,
		label: label || `SRX ${existing.length + 1}`,
		tokens: [],
		active: false,
		kind: "srx",
		srx: document,
		languageCode: normalizeLanguageCode(languageCode),
	});
	const result = ensureDefaultPref(existing);
	writeStore(result);
	return result;
}

export function setActiveParsingPreference(id: string): ParsingPreference[] {
	const selected = ensureDefaultPref(readStore()).map((p) => ({
		...p,
		active: p.id === id,
	}));
	const prefs = ensureDefaultPref(selected);
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
		if (p.id === DEFAULT_PREF.id || p.kind === "srx") return p;
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
	return active?.kind !== "srx"
		? (active?.tokens ?? DEFAULT_PREF.tokens)
		: DEFAULT_PREF.tokens;
}

export function getActiveSrxProfile(): ActiveSrxProfile | undefined {
	const active = ensureDefaultPref(readStore()).find(
		(preference) => preference.active && preference.kind === "srx",
	);
	if (!active?.srx || !active.languageCode) return undefined;
	try {
		serializeSrx20(active.srx);
		return {
			document: active.srx,
			languageCode: normalizeLanguageCode(active.languageCode),
		};
	} catch {
		return undefined;
	}
}

export function getDefaultTokens(): string[] {
	return [...DEFAULT_TOKENS];
}
