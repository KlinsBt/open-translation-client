import type { TbData } from "$lib/types/types";

/**
 * Normalize a language code by removing region subtags.
 * E.g., "en-us" → "en", "de-de" → "de"
 * @param lang - The full language code
 * @returns The primary language tag
 */
function normalizeLang(lang: string): string {
	return lang.split("-")[0].toLowerCase();
}

/**
 * Validate the structure of a TBX file (e.g., TBX-Core or TBX-Basic).
 * @param tbxDocument - The parsed TBX document.
 * @returns True if valid, false otherwise.
 */
function validateTbxCore(tbxDocument: Document): boolean {
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

			// for (let k = 0; k < termSecs.length; k++) {
			// 	const termSec = termSecs[k];
			// 	const term = termSec.getElementsByTagName("term")[0];
			// 	// if (!term || !term.textContent) return false;
			// }
		}
	}

	return true;
}

/**
 * Extract structured data from a TBX file.
 * @param tbxDocument - The parsed TBX document.
 * @returns The extracted data in the TbData format.
 */
function extractFromTbxCore(tbxDocument: Document): TbData {
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

	const idMatch = sourceDescContent.match(/OpenTLC ID: (\d+)/);
	const id = idMatch ? parseInt(idMatch[1], 10) : 0;

	const textElement = tbxElement.getElementsByTagName("text")[0];
	const bodyElement = textElement.getElementsByTagName("body")[0];

	const conceptEntries = bodyElement.getElementsByTagName("conceptEntry");
	const entries: TbData["entries"] = [];

	for (let i = 0; i < conceptEntries.length; i++) {
		const conceptEntry = conceptEntries[i];
		const langSecs = conceptEntry.getElementsByTagName("langSec");

		const entryData: {
			terms: {
				lang: string;
				term: string;
				notes: { type: string; text: string }[];
			}[];
		} = {
			terms: [],
		};

		for (let j = 0; j < langSecs.length; j++) {
			const langSec = langSecs[j];
			let lang = langSec.getAttribute("xml:lang") || "";
			lang = normalizeLang(lang);

			const termSecs = langSec.getElementsByTagName("termSec");

			for (let k = 0; k < termSecs.length; k++) {
				const termSec = termSecs[k];

				// Extract <term> value
				let term = "";
				const termElement = termSec.getElementsByTagName("term")[0];
				if (termElement?.textContent?.trim()) {
					term = termElement.textContent.trim();
				} else {
					// Fallback: use first <termNote> as term
					const fallbackTermNote = termSec.getElementsByTagName("termNote")[0];
					if (fallbackTermNote?.textContent?.trim()) {
						term = fallbackTermNote.textContent.trim();
					}
				}

				// Collect all <note> elements
				const notes: { type: string; text: string }[] = [];
				const noteElements = termSec.getElementsByTagName("note");
				for (let n = 0; n < noteElements.length; n++) {
					const text = noteElements[n].textContent?.trim() || "";
					notes.push({ type: "", text });
				}

				// Collect all <termNote> elements
				const termNoteElements = termSec.getElementsByTagName("termNote");
				for (let n = 0; n < termNoteElements.length; n++) {
					const note = termNoteElements[n];
					const type = note.getAttribute("type") || "";
					const text = note.textContent?.trim() || "";
					notes.push({ type, text });
				}

				entryData.terms.push({
					lang,
					term,
					notes,
				});
			}
		}

		entries.push(entryData);
	}

	const tbData: TbData = {
		name,
		entries,
	};

	if (id !== 0) {
		tbData.id = id;
	}

	return tbData;
}

/**
 * Validate the structure of a TBX file with a slightly different structure (martif).
 * @param tbxDocument - The parsed TBX document.
 * @returns True if valid, false otherwise.
 */
function validateTbxMartif(doc: Document): boolean {
	const martif = doc.getElementsByTagName("martif")[0];
	if (!martif) return false;

	if (!martif.getAttribute("xml:lang") || !martif.getAttribute("type"))
		return false;

	const text = martif.getElementsByTagName("text")[0];
	const body = text?.getElementsByTagName("body")[0];
	if (!text || !body) return false;

	const termEntries = body.getElementsByTagName("termEntry");
	if (termEntries.length === 0) return false;

	for (const termEntry of termEntries) {
		const langSets = termEntry.getElementsByTagName("langSet");
		if (langSets.length === 0) return false;

		for (const langSet of langSets) {
			if (!langSet.getAttribute("xml:lang")) return false;

			const tigs = langSet.getElementsByTagName("tig");
			if (tigs.length === 0) return false;

			// for (const tig of tigs) {
			// 	const term = tig.getElementsByTagName("term")[0];
			// 	if (!term || !term.textContent?.trim()) return false;
			// }
		}
	}
	return true;
}

function extractFromMartif(tbxDocument: Document): TbData {
	const martif = tbxDocument.getElementsByTagName("martif")[0];
	const title =
		martif.getElementsByTagName("title")[0]?.textContent?.trim() ||
		"Untitled TBX File";

	const textElement = martif.getElementsByTagName("text")[0];
	const bodyElement = textElement.getElementsByTagName("body")[0];

	// Extract term entries
	const termEntries = bodyElement.getElementsByTagName("termEntry");
	const entries: TbData["entries"] = [];

	for (let i = 0; i < termEntries.length; i++) {
		const termEntry = termEntries[i];
		// const descrip = termEntry.getElementsByTagName("descrip");
		const langSets = termEntry.getElementsByTagName("langSet");

		const entryData: {
			// id: number;
			terms: {
				lang: string;
				term: string;
				notes: {
					type: string;
					text: string;
				}[];
			}[];
		} = {
			// id: parseInt(conceptId, 10) || i + 1,
			terms: [],
		};

		for (let j = 0; j < langSets.length; j++) {
			const langSet = langSets[j];
			let lang = langSet.getAttribute("xml:lang") || "";
			lang = normalizeLang(lang);

			const termTig = langSet.getElementsByTagName("tig");
			// for (let k = 0; k < termTig.length; k++) {
			// 	const termSec = termTig[k];
			// 	const term =
			// 		termSec.getElementsByTagName("term")[0]?.textContent?.trim() || "";

			// 	const notes = Array.from(termSec.getElementsByTagName("termNote")).map(
			// 		(note) => {
			// 			const type = note.getAttribute("type") || "";
			// 			const text = note.textContent?.trim() || "";
			// 			return { type, text };
			// 		},
			// 	);

			// 	entryData.terms.push({
			// 		lang,
			// 		term,
			// 		notes,
			// 	});
			// }

			for (let k = 0; k < termTig.length; k++) {
				const tig = termTig[k];

				// Extract the <term> value, or fallback to first <termNote>
				let term = "";
				const termElement = tig.getElementsByTagName("term")[0];
				if (termElement?.textContent?.trim()) {
					term = termElement.textContent.trim();
				} else {
					const fallbackTermNote = tig.getElementsByTagName("termNote")[0];
					if (fallbackTermNote?.textContent?.trim()) {
						term = fallbackTermNote.textContent.trim();
					}
				}

				// Extract all <termNote> elements
				const notes: { type: string; text: string }[] = [];

				const termNoteElements = tig.getElementsByTagName("termNote");
				for (let n = 0; n < termNoteElements.length; n++) {
					const noteElement = termNoteElements[n];
					const type = noteElement.getAttribute("type") || "";
					const text = noteElement.textContent?.trim() || "";
					notes.push({ type, text });
				}

				entryData.terms.push({
					lang,
					term,
					notes,
				});
			}
		}

		entries.push(entryData);
	}

	const tbData: TbData = {
		name: title,
		entries,
	};

	// if (id !== 0) {
	// 	tbData.id = id;
	// }

	return tbData;
}

// function extractFromMartif(doc: Document): TbData {
// 	const martif = doc.getElementsByTagName("martif")[0];

// 	/* metadata -------------------------------------------------------------- */
// 	// <martif> files rarely contain a title – fall back gracefully
// 	const name =
// 		martif.getElementsByTagName("title")[0]?.textContent?.trim() ||
// 		"Untitled TBX File";

// 	/* entries --------------------------------------------------------------- */
// 	const body = martif
// 		.getElementsByTagName("text")[0]
// 		.getElementsByTagName("body")[0];
// 	const termEntries = body.getElementsByTagName("termEntry");

// 	const entries: TbData["entries"] = [];

// 	for (const termEntry of Array.from(termEntries)) {
// 		const entryTerms: TbData["entries"][number]["terms"] = [];

// 		for (const langSet of Array.from(
// 			termEntry.getElementsByTagName("langSet"),
// 		)) {
// 			const lang = langSet.getAttribute("xml:lang") ?? "";

// 			for (const tig of Array.from(langSet.getElementsByTagName("tig"))) {
// 				const term =
// 					tig.getElementsByTagName("term")[0]?.textContent?.trim() ?? "";
// 				const notes = Array.from(tig.getElementsByTagName("termNote")).map(
// 					(n) => n.textContent?.trim() ?? "",
// 				);

// 				entryTerms.push({ lang, term, notes });
// 			}
// 		}
// 		entries.push({ terms: entryTerms });
// 	}

// 	return { name, entries };
// }

export function validateTbxFile(doc: Document): boolean {
	const root = doc.documentElement;
	if (!root) return false;

	switch (root.localName.toLowerCase()) {
		case "tbx":
			return validateTbxCore(doc);
		case "martif":
			return validateTbxMartif(doc);
		default:
			return false;
	}
}

export function extractTbxData(doc: Document): TbData {
	const root = doc.documentElement.localName.toLowerCase();
	if (root === "tbx") {
		return extractFromTbxCore(doc);
	}
	if (root === "martif") {
		return extractFromMartif(doc);
	}
	throw new Error("Unsupported TBX format: " + root);
}
