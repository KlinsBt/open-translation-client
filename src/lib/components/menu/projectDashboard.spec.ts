import { describe, expect, it } from "vitest";
import type { UserData } from "$lib/types/types";
import {
	filterProjects,
	getNextProjectSort,
	parseProjectViewMode,
} from "./projectDashboard";

function project(
	name: string,
	type: UserData["translationData"]["type"],
	sourceLang: string,
	targetLang: string,
): UserData {
	return {
		translationData: {
			name,
			type,
			typeRef: "text",
			sourceLang,
			targetLang,
			creationDate: "0",
			seg1: [],
			seg2: [],
			checked: [],
			locked: [],
			tm: null,
			tb: { id: null, name: null, active: false },
		},
	};
}

describe("project dashboard filtering", () => {
	const projects = [
		project("Website copy", "html", "English (EN)", "German (DE)"),
		project("Product catalog", "json", "French (FR)", "Dutch (NL)"),
	];

	it("returns every project for blank searches", () => {
		expect(filterProjects(projects, "   ")).toBe(projects);
	});

	it("matches project names, formats, and languages without case sensitivity", () => {
		expect(filterProjects(projects, "website")).toEqual([projects[0]]);
		expect(filterProjects(projects, "JSON")).toEqual([projects[1]]);
		expect(filterProjects(projects, "german")).toEqual([projects[0]]);
	});
});

describe("project dashboard sorting state", () => {
	it("reverses the current field", () => {
		expect(
			getNextProjectSort({ field: "date", ascending: false }, "date"),
		).toEqual({ field: "date", ascending: true });
	});

	it("uses intuitive defaults when switching fields", () => {
		expect(
			getNextProjectSort({ field: "date", ascending: false }, "name"),
		).toEqual({ field: "name", ascending: true });
		expect(
			getNextProjectSort({ field: "name", ascending: false }, "date"),
		).toEqual({ field: "date", ascending: false });
	});
});

describe("project dashboard view preferences", () => {
	it("keeps the modern card layout as the default", () => {
		expect(parseProjectViewMode(null)).toBe("cards");
		expect(parseProjectViewMode("unknown")).toBe("cards");
	});

	it("restores the classic and table alternatives", () => {
		expect(parseProjectViewMode("classic")).toBe("classic");
		expect(parseProjectViewMode("table")).toBe("table");
	});
});
