import type { UserData } from "$lib/types/types";
import JSZip from "jszip";

export async function createXlsxFromModifiedXmlText(translation: UserData) {
	let xmlContentMap: any = translation.translationData.typeRef;

	// Replaces the contents of sharedStrings.xml with new translations
	xmlContentMap["xl/sharedStrings.xml"] = replaceSharedStrings(
		xmlContentMap["xl/sharedStrings.xml"],
		translation.translationData.seg2,
	);

	// Ensures _rels/.rels is present
	if (!xmlContentMap["_rels/.rels"]) {
		xmlContentMap["_rels/.rels"] = `
			<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
            </Relationships>`;
	}

	// Creates a new ZIP file with the modified content
	const zip = new JSZip();

	// Add all the XML files to the ZIP
	for (const filePath in xmlContentMap) {
		const content = xmlContentMap[filePath];
		if (typeof content === "string") {
			zip.file(filePath, content);
		} else {
			console.error(
				`Invalid content type for file ${filePath}:`,
				typeof content,
			);
		}
	}

	// Generates the updated XLSX as a Blob
	const updatedXlsx = await zip.generateAsync({ type: "blob" });

	// Triggers the download of the modified .xlsx file
	const link = document.createElement("a");
	link.href = URL.createObjectURL(updatedXlsx);
	link.download = `${translation.translationData.name}.xlsx`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
}

// Replaces contents in sharedStrings.xml with the new translations
function replaceSharedStrings(
	sharedStringsXml: string,
	textArray: string[],
): string {
	console.log("Before modification:", sharedStringsXml);
	const parser = new DOMParser();
	const xmlDoc = parser.parseFromString(sharedStringsXml, "application/xml");

	const siElements = xmlDoc.getElementsByTagName("si");

	for (let i = 0; i < siElements.length && i < textArray.length; i++) {
		const tElement = siElements[i].getElementsByTagName("t")[0];
		if (tElement) {
			tElement.textContent = textArray[i];
		}
	}

	const serializer = new XMLSerializer();
	return serializer.serializeToString(xmlDoc); // Return the modified XML string
}
