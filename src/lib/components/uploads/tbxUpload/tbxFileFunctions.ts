import type { TbData } from "$lib/types/types";

/**
 * Validate the structure of a TBX file (e.g., TBX-Core or TBX-Basic).
 * @param tbxDocument - The parsed TBX document.
 * @returns True if valid, false otherwise.
 */
export function validateTbxFile(tbxDocument: Document): boolean {
	// Check for TBX root element
	const tbxElement = tbxDocument.getElementsByTagName("tbx")[0];
	if (!tbxElement) return false;

	// Validate required attributes in the TBX element
	const style = tbxElement.getAttribute("style");
	const type = tbxElement.getAttribute("type");
	const xmlLang = tbxElement.getAttribute("xml:lang");
	if (!style || !type || !xmlLang) return false;

	// Validate <tbxHeader>
	const tbxHeader = tbxElement.getElementsByTagName("tbxHeader")[0];
	if (!tbxHeader) return false;

	// Validate <fileDesc> inside the header
	const fileDesc = tbxHeader.getElementsByTagName("fileDesc")[0];
	if (!fileDesc) return false;

	// Check for <text> and <body> elements
	const textElement = tbxElement.getElementsByTagName("text")[0];
	if (!textElement) return false;

	const bodyElement = textElement.getElementsByTagName("body")[0];
	if (!bodyElement) return false;

	// Check for at least one <conceptEntry>
	const conceptEntries = bodyElement.getElementsByTagName("conceptEntry");
	if (conceptEntries.length === 0) return false;

	// Validate each <conceptEntry>
	for (let i = 0; i < conceptEntries.length; i++) {
		const conceptEntry = conceptEntries[i];
		const langSecs = conceptEntry.getElementsByTagName("langSec");
		if (langSecs.length === 0) return false;

		for (let j = 0; j < langSecs.length; j++) {
			const langSec = langSecs[j];
			// const lang = langSec.getAttribute("xml:lang");
			// if (!lang) return false;

			const termSecs = langSec.getElementsByTagName("termSec");
			if (termSecs.length === 0) return false;

			for (let k = 0; k < termSecs.length; k++) {
				const termSec = termSecs[k];
				const term = termSec.getElementsByTagName("term")[0];
				// if (!term || !term.textContent) return false;
			}
		}
	}

	return true; // All checks passed
}

/**
 * Extract structured data from a TBX file.
 * @param tbxDocument - The parsed TBX document.
 * @returns The extracted data in the TbData format.
 */
export function extractTbxData(tbxDocument: Document): TbData {
	const tbxElement = tbxDocument.getElementsByTagName("tbx")[0];
	const tbxHeader = tbxElement.getElementsByTagName("tbxHeader")[0];

	// Extract metadata
	const fileDesc = tbxHeader.getElementsByTagName("fileDesc")[0];
	const name =
		fileDesc?.getElementsByTagName("title")[0]?.textContent?.trim() ||
		"Untitled TBX File";

	const sourceDescContent =
		fileDesc?.getElementsByTagName("sourceDesc")[0]?.textContent?.trim() ||
		"No description available";

	// Extract the ID from the sourceDesc content
	const idMatch = sourceDescContent.match(/OpenTLC ID: (\d+)/);
	const id = idMatch ? parseInt(idMatch[1], 10) : 0;

	const textElement = tbxElement.getElementsByTagName("text")[0];
	const bodyElement = textElement.getElementsByTagName("body")[0];

	// Extract concept entries
	const conceptEntries = bodyElement.getElementsByTagName("conceptEntry");
	const entries: TbData["entries"] = [];

	for (let i = 0; i < conceptEntries.length; i++) {
		const conceptEntry = conceptEntries[i];
		const conceptId = conceptEntry.getAttribute("id") || (i + 1).toString();
		const langSecs = conceptEntry.getElementsByTagName("langSec");

		const entryData: {
			id: number;
			terms: {
				lang: string;
				term: string;
				notes: string[];
			}[];
		} = {
			id: parseInt(conceptId, 10) || i + 1,
			terms: [],
		};

		for (let j = 0; j < langSecs.length; j++) {
			const langSec = langSecs[j];
			const lang = langSec.getAttribute("xml:lang") || "";

			const termSecs = langSec.getElementsByTagName("termSec");
			for (let k = 0; k < termSecs.length; k++) {
				const termSec = termSecs[k];
				const term =
					termSec.getElementsByTagName("term")[0]?.textContent?.trim() || "";

				const notes = Array.from(termSec.getElementsByTagName("note")).map(
					(note) => note.textContent?.trim() || "",
				);

				entryData.terms.push({
					lang,
					term,
					notes,
				});
			}
		}

		entries.push(entryData);
	}

	// Construct the TbData object
	const tbData: TbData = {
		name,
		entries,
	};

	if (id !== 0) {
		tbData.id = id;
	}

	return tbData;
}
