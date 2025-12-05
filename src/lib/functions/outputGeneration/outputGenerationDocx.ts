import type { UserData } from "$lib/types/types";
import { applyTranslationsToDocxXml } from "$lib/functions/parsing/parsingDocx";
import JSZip from "jszip";

export async function createDocxFromModifiedXmlText(translation: UserData) {
	let xmlContentMap: any = translation.translationData.typeRef;
	// Replace the text in document.xml with the new strings
	xmlContentMap["word/document.xml"] = replaceTextStrings(
		xmlContentMap["word/document.xml"],
		translation.translationData.seg2,
	);

	// Log the content of document.xml for inspection
	console.log(
		"Updated document.xml content:",
		xmlContentMap["word/document.xml"],
	);

	// Ensure _rels/.rels is present
	if (!xmlContentMap["_rels/.rels"]) {
		xmlContentMap["_rels/.rels"] =
			`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
            </Relationships>`;
	}

	// Create a new ZIP file with the modified content
	const zip = new JSZip();

	// Add all the XML files to the ZIP
	for (const filePath in xmlContentMap) {
		const content = xmlContentMap[filePath];
		// if (
		// 	typeof content !== "string" &&
		// 	!(content instanceof Blob) &&
		// 	!(content instanceof ArrayBuffer)
		// ) {
		// 	console.error(
		// 		`Invalid content type for file ${filePath}:`,
		// 		typeof content,
		// 	);
		// 	continue; // Skip invalid files
		// }
		zip.file(filePath, content);
	}

	// Generate the updated DOCX as a Blob
	const updatedDocx = await zip.generateAsync({ type: "blob" });

	// Trigger the download of the modified .docx file
	const link = document.createElement("a");
	link.href = URL.createObjectURL(updatedDocx);
	link.download = `${translation.translationData.name}.docx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

// Replace text strings in the XML string with the modified ones
function replaceTextStrings(documentXml: any, textArray: string[]) {
	if (typeof documentXml !== "string") return documentXml;
	return applyTranslationsToDocxXml(documentXml, textArray);
}
