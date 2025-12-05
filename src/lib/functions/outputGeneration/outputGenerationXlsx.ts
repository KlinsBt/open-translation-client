import type { UserData } from "$lib/types/types";
import { applyTranslationsToWorkbook } from "$lib/functions/parsing/parsingXlsx";
import JSZip from "jszip";

export async function createXlsxFromModifiedXmlText(translation: UserData) {
	let xmlContentMap: any = translation.translationData.typeRef;

	// Apply translations to shared strings and inline strings across all sheets
	xmlContentMap = applyTranslationsToWorkbook(
		xmlContentMap,
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
		zip.file(filePath, content as any);
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
