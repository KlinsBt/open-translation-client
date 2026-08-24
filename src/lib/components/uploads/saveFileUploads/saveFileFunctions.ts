import { validateXliff12Xml } from "$lib/formats/xliff12";
import { validateXliff2Xml } from "$lib/formats/xliff2";
import { FORMAT_IDS } from "$lib/formats/formatIds";

export function getXliffVersion(xliff: Document): number {
	const xliffElement = xliff.getElementsByTagName("xliff")[0];
	if (!xliffElement) return 0;

	const version = xliffElement.getAttribute("version");
	if (!version) return 0;

	return parseFloat(version);
}

export function validateXliff2_0Data(xliffDocument: Document): boolean {
	return validateXliff2Xml(new XMLSerializer().serializeToString(xliffDocument))
		.valid;
}

export function validateXliff1_2Data(xliffDocument: Document): boolean {
	return validateXliff12Xml(
		new XMLSerializer().serializeToString(xliffDocument),
	).valid;
}

export function validateJsonData(data: any): boolean {
	if (!data) return false;
	// if (typeof data.id !== "number" || data.id <= 0) return false;
	if (!data.translationData || typeof data.translationData !== "object")
		return false;

	const td = data.translationData;
	if (typeof td.name !== "string") return false;
	if (typeof td.targetLang !== "string") return false;
	if (typeof td.sourceLang !== "string") return false;
	if (typeof td.creationDate !== "string" || !/^\d+$/.test(td.creationDate))
		return false;
	if (
		!Array.isArray(td.seg1) ||
		!td.seg1.every((s: any) => typeof s === "string")
	)
		return false;
	if (
		!Array.isArray(td.seg2) ||
		!td.seg2.every((s: any) => typeof s === "string")
	)
		return false;
	if (td.seg1.length !== td.seg2.length) return false;
	if (
		!Array.isArray(td.checked) ||
		!td.checked.every((s: any) => typeof s === "boolean") ||
		td.checked.length !== td.seg1.length
	)
		return false;
	if (!FORMAT_IDS.includes(td.type)) return false;
	if (typeof td.typeRef !== "string" && typeof td.typeRef !== "object")
		return false;

	return true;
}
