import { migrateTmData } from "$lib/formats/persistenceMigrations";
import { parseTmxDocument, validateTmxDocument } from "$lib/formats/tmx14";
import type { TmData } from "$lib/types/types";

export function validateTmxFile(document: Document): boolean {
	return validateTmxDocument(document).valid;
}

export function extractTmxData(document: Document): TmData {
	return migrateTmData(parseTmxDocument(document));
}
