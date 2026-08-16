import {
	parseTbxEntry,
	readTbxDocumentMetadata,
	validateTbxData,
	validateTbxDocument,
} from "$lib/formats/tbx";
import type { TbData } from "$lib/types/types";

export function validateTbxFile(document: Document): boolean {
	return validateTbxDocument(document.documentElement).length === 0;
}

/**
 * Compatibility entry point for callers that already own a DOM. New uploads use
 * the record-streaming importer so large termbases do not require a full DOM.
 */
export function extractTbxData(document: Document): TbData {
	const root = document.documentElement;
	const metadata = readTbxDocumentMetadata(root);
	const title = Array.from(root.getElementsByTagName("*"))
		.find((element) => element.localName === "title")
		?.textContent?.trim();
	const sourceDescription = Array.from(root.getElementsByTagName("*")).find(
		(element) => element.localName === "sourceDesc",
	)?.textContent;
	const id = sourceDescription?.match(/OpenTLC ID:\s*(\d+)/i)?.[1];
	const recordName = metadata.version === 3 ? "conceptEntry" : "termEntry";
	const records = Array.from(root.getElementsByTagName("*")).filter(
		(element) => element.localName === recordName,
	);
	const entries = records.map((record, index) => {
		const copy = new DOMParser().parseFromString(
			new XMLSerializer().serializeToString(record),
			"application/xml",
		).documentElement;
		const entry = parseTbxEntry(copy, index);
		if (entry.tbx)
			Object.assign(entry.tbx, {
				version: metadata.version,
				dialect: metadata.dialect,
				style: metadata.style,
			});
		return entry;
	});
	const data: TbData = {
		...(id ? { id: Number(id) } : {}),
		name: title || "Untitled TBX File",
		entries,
		tbx: metadata,
	};
	const issue = validateTbxData(data)[0];
	if (issue) throw new Error(`${issue.message} (${issue.path})`);
	return data;
}
