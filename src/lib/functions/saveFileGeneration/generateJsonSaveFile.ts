import type { UserData } from "$lib/types/types";
import { migrateProjectData } from "$lib/formats/persistenceMigrations";

async function generateJsonFileDownload(jsonData: string, name: string) {
	// Converts JSON data to a Blob
	const blob: Blob = new Blob([jsonData], {
		type: "application/json",
	});

	// Creates a URL for the Blob
	const url: string = URL.createObjectURL(blob);

	// Creates a temporary <a> element to trigger the download
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name}.json`;

	// Appends the element, triggers the download, and removes the element
	try {
		document.body.appendChild(a);
		a.click();
	} finally {
		a.remove();
		setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
	}
}

export function buildJsonSaveFile(userData: UserData): string {
	return JSON.stringify(migrateProjectData(userData), null, 2);
}

export async function generateJsonSaveFile(userData: UserData) {
	const stringifiedData = buildJsonSaveFile(userData);
	await generateJsonFileDownload(
		stringifiedData,
		userData.translationData.name,
	);
}
