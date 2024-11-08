import type { UserData } from "$lib/types/types";

async function generateJsonFileDownload(jsonData: JSON, name: string) {
	// Converts JSON data to a Blob
	const blob: Blob = new Blob([JSON.stringify(jsonData, null, 2)], {
		type: "application/json",
	});

	// Creates a URL for the Blob
	const url: string = URL.createObjectURL(blob);

	// Creates a temporary <a> element to trigger the download
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name}.json`;

	// Appends the element, triggers the download, and removes the element
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	// Revokes the URL to release memory
	URL.revokeObjectURL(url);
}

export async function generateJsonSaveFile(userData: UserData) {
	try {
		const stringifiedData: JSON = JSON.parse(JSON.stringify(userData));
		await generateJsonFileDownload(
			stringifiedData,
			userData.translationData.name,
		);
	} catch (error) {
		console.error("Failed to generate JSON save file:", error);
	}
}
