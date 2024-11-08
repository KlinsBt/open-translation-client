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

export async function generateJsonTranslation(translation: UserData) {
	console.log("userData: ", translation);
	const name: string = translation.translationData.name || "translation_file";
	const typeRefData: JSON = JSON.parse(
		JSON.stringify(translation.translationData.typeRef),
	);
	console.log("typeRefData", typeRefData);
	let newJsonObject: Object = reconstructJsonFromValues(
		typeRefData,
		translation.translationData.seg2,
	);
	await generateJsonFileDownload(
		JSON.parse(JSON.stringify(newJsonObject)),
		name,
	);
}

function reconstructJsonFromValues(
	jsonData: Record<string, any>,
	values: string[],
): Record<string, any> {
	let valueIndex = 0;

	function traverse(obj: any): void {
		for (const key in obj) {
			if (typeof obj[key] === "object" && obj[key] !== null) {
				traverse(obj[key]);
			} else {
				obj[key] = values[valueIndex++];
			}
		}
	}

	const newJson = JSON.parse(JSON.stringify(jsonData));
	traverse(newJson);
	console.log("newJson", newJson);
	return newJson;
}
