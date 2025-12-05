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
	const typeRef: any = translation.translationData.typeRef;
	const sourceData = (typeRef && typeRef.data) || translation.translationData.typeRef;
	const segMeta: number[] = (typeRef && typeRef.segMeta) || [];
	let newJsonObject: Object = reconstructJsonFromValues(
		sourceData as Record<string, any>,
		translation.translationData.seg2,
		segMeta,
	);
	await generateJsonFileDownload(
		JSON.parse(JSON.stringify(newJsonObject)),
		name,
	);
}

function reconstructJsonFromValues(
	jsonData: Record<string, any>,
	values: string[],
	segMeta: number[] = [],
): Record<string, any> {
	let valueIndex = 0;
	let metaIndex = 0;

	function traverse(obj: any): void {
		for (const key in obj) {
			if (typeof obj[key] === "object" && obj[key] !== null) {
				traverse(obj[key]);
			} else {
				const takeCount =
					segMeta.length > metaIndex ? segMeta[metaIndex] : 1;
				const parts = values.slice(valueIndex, valueIndex + takeCount);
				obj[key] = parts.join("");
				valueIndex += takeCount;
				metaIndex++;
			}
		}
	}

	const newJson = JSON.parse(JSON.stringify(jsonData));
	traverse(newJson);
	console.log("newJson", newJson);
	return newJson;
}
