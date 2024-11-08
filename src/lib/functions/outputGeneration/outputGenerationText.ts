import type { UserData } from "$lib/types/types";

async function generateTextFileDownload(textData: string, name: string) {
	// Convert JSON data to a Blob
	const blob: Blob = new Blob([JSON.stringify(textData, null, 2)], {
		type: "plain/text",
	});

	// Create a URL for the Blob
	const url: string = URL.createObjectURL(blob);

	// Create a temporary <a> element to trigger the download
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name}.text`;

	// Append the element, trigger the download, and remove the element
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	// Revoke the URL to release memory
	URL.revokeObjectURL(url);
}

export async function generateTextTranslation(
	translation: UserData,
	// singleLineFormat: boolean, // if true, text is formatted as a single line
) {
	const name: string = translation.translationData.name || "translation";
	let stringifiedData: string[] = JSON.parse(
		JSON.stringify(translation.translationData.seg2),
	);
	let formatedString: string = "";

	// if (singleLineFormat) {
	// 	formatedString = stringifiedData.join(" ");
	// } else {
	// 	formatedString = stringifiedData.join("\n");
	// }

	generateTextFileDownload(stringifiedData.join(" "), name);
}
