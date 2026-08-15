import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	addParsingPreference,
	deleteParsingPreference,
	getActiveTokens,
	getDefaultTokens,
	loadParsingPreferences,
	saveParsingPreferences,
	setActiveParsingPreference,
	updateParsingPreference,
} from "./parsingPreferences";

const values = new Map<string, string>();

beforeEach(() => {
	values.clear();
	vi.stubGlobal("window", {});
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
		removeItem: (key: string) => values.delete(key),
		clear: () => values.clear(),
	});
});

describe("parsing preferences", () => {
	it("recovers the immutable default from corrupt storage", () => {
		const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
		values.set("parsing-preferences", "not-json");
		const preferences = loadParsingPreferences();
		expect(preferences).toHaveLength(1);
		expect(preferences[0]).toMatchObject({ id: "default", active: true });
		expect(warning).toHaveBeenCalledOnce();
	});

	it("adds, selects, updates, and deletes a custom preference", () => {
		let preferences = addParsingPreference("Paragraph", [" || ", ""]);
		const custom = preferences.find(
			(preference) => preference.id !== "default",
		)!;
		expect(custom.tokens).toEqual(["||"]);

		preferences = setActiveParsingPreference(custom.id);
		expect(
			preferences.find((preference) => preference.id === custom.id)?.active,
		).toBe(true);
		expect(getActiveTokens()).toEqual(["||"]);

		preferences = updateParsingPreference(custom.id, "Updated", ["###"]);
		expect(
			preferences.find((preference) => preference.id === custom.id),
		).toMatchObject({
			label: "Updated",
			tokens: ["###"],
		});

		preferences = deleteParsingPreference(custom.id);
		expect(preferences).toHaveLength(1);
		expect(preferences[0].active).toBe(true);
	});

	it("falls back to the default when selecting an unknown ID", () => {
		const preferences = setActiveParsingPreference("missing");
		expect(
			preferences.find((preference) => preference.id === "default")?.active,
		).toBe(true);
	});

	it("normalizes saved preferences and returns defensive token copies", () => {
		saveParsingPreferences([]);
		expect(loadParsingPreferences()[0].id).toBe("default");

		const tokens = getDefaultTokens();
		tokens.push("changed");
		expect(getDefaultTokens()).not.toContain("changed");
	});
});
