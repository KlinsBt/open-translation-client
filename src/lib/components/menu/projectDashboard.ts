import type { UserData } from "$lib/types/types";

export type ProjectSortField = "name" | "date";
export type ProjectViewMode = "cards" | "classic" | "table";

export function parseProjectViewMode(value: string | null): ProjectViewMode {
	return value === "classic" || value === "table" ? value : "cards";
}

export interface ProjectSortState {
	field: ProjectSortField;
	ascending: boolean;
}

export function getNextProjectSort(
	current: ProjectSortState,
	requestedField: ProjectSortField,
): ProjectSortState {
	if (current.field === requestedField) {
		return { field: requestedField, ascending: !current.ascending };
	}

	return {
		field: requestedField,
		ascending: requestedField === "name",
	};
}

export function filterProjects(
	projects: UserData[],
	query: string,
): UserData[] {
	const normalizedQuery = query.trim().toLocaleLowerCase();
	if (!normalizedQuery) return projects;

	return projects.filter(({ translationData }) =>
		[
			translationData.name,
			translationData.type,
			translationData.sourceLang,
			translationData.targetLang,
		]
			.join(" ")
			.toLocaleLowerCase()
			.includes(normalizedQuery),
	);
}
