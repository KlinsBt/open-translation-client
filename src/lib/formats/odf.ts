import type { PackageXmlSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	readSafeZipPackage,
	SafeInputError,
	safeParseXml,
	type SafeZipPackage,
	type SafeInputContext,
} from "./safeInput";
import {
	createPackageSkeleton,
	type PackageXmlValueReplacement,
} from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import {
	parseXmlSyntax,
	type XmlElementLocation,
	type XmlSyntaxDocument,
} from "./xmlFamily";

export type OdfProfile = "odt" | "ods" | "odp";

export const ODF_MIME_TYPES: Readonly<Record<OdfProfile, string>> = {
	odt: "application/vnd.oasis.opendocument.text",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
	odp: "application/vnd.oasis.opendocument.presentation",
};

function invalidOdf(message: string): SafeInputError {
	return new SafeInputError("ODF_INVALID", message);
}

export function detectOdfProfile(name: string, mimetype = ""): OdfProfile {
	const byMime = (
		Object.entries(ODF_MIME_TYPES) as Array<[OdfProfile, string]>
	).find(([, value]) => value === mimetype.trim())?.[0];
	if (byMime) return byMime;
	const extension = name.toLowerCase().split(".").at(-1);
	if (extension === "ods" || extension === "odp") return extension;
	return "odt";
}

function textPart(parts: Record<string, string | Blob>, path: string): string {
	const value = parts[path];
	if (typeof value !== "string")
		throw invalidOdf(`The ODF package has no readable ${path}.`);
	return value;
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(entry) => entry.localName === name || entry.qName === name,
	)?.value;
}

function ancestors(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation[] {
	const values: XmlElementLocation[] = [element];
	let current = element;
	while (current.parentId !== undefined) {
		current = syntax.elements[current.parentId];
		values.push(current);
	}
	return values;
}

function insertionIntervals(
	syntax: XmlSyntaxDocument,
): Array<[number, number]> {
	const insertionIds = new Set<string>();
	for (const element of syntax.elements) {
		if (element.localName !== "insertion") continue;
		const chain = ancestors(element, syntax);
		const region = chain.find((entry) => entry.localName === "changed-region");
		const id =
			region && (attribute(region, "id") ?? attribute(region, "change-id"));
		if (id) insertionIds.add(id);
	}
	const starts = new Map<string, number>();
	const intervals: Array<[number, number]> = [];
	for (const element of syntax.elements) {
		const id = attribute(element, "change-id");
		if (!id || !insertionIds.has(id)) continue;
		if (element.localName === "change-start")
			starts.set(id, element.startTagEnd + 1);
		else if (element.localName === "change-end") {
			const start = starts.get(id);
			if (start !== undefined) intervals.push([start, element.startTagStart]);
		}
	}
	return intervals;
}

function selectedOdfValues(
	part: string,
	content: string,
	options: Readonly<FormatOptionValues>,
): Array<PackageXmlSegmentMeta & { line?: number; style?: string }> {
	const syntax = parseXmlSyntax(content);
	const tracked = String(options.trackedChanges);
	const insertions = tracked === "original" ? insertionIntervals(syntax) : [];
	const selected: Array<
		PackageXmlSegmentMeta & { line?: number; style?: string }
	> = [];
	for (const value of syntax.values) {
		const element = syntax.elements[value.elementId];
		const chain = ancestors(element, syntax);
		const names = new Set(chain.map((entry) => entry.localName));
		if (names.has("scripts") || names.has("event-listeners")) continue;
		const inTrackedMetadata = names.has("tracked-changes");
		if (tracked === "final" && inTrackedMetadata) continue;
		if (tracked === "original" && !inTrackedMetadata) {
			if (
				insertions.some(
					([start, end]) => value.start >= start && value.end <= end,
				)
			)
				continue;
		}
		if (names.has("annotation") && !options.includeComments) continue;
		if (names.has("notes") && !options.includeNotes) continue;
		if (part === "styles.xml" && !names.has("header") && !names.has("footer"))
			continue;
		if (part === "styles.xml" && !options.includeHeadersFooters) continue;
		const visible = ["p", "h", "span", "a", "list-header"].includes(
			element.localName,
		);
		const accessibility = ["title", "desc"].includes(element.localName);
		if (!visible && !(accessibility && options.includeAccessibilityText))
			continue;
		selected.push({
			profile: "odf",
			part,
			path: value.path,
			location: value.location,
			start: value.start,
			end: value.end,
			originalValue: value.value,
			style:
				chain.map((entry) => attribute(entry, "style-name")).find(Boolean) ??
				undefined,
		});
	}
	return selected;
}

function validateOdfParts(
	parts: Record<string, string | Blob>,
	name: string,
	context?: SafeInputContext,
): OdfProfile {
	const mimetype = textPart(parts, "mimetype").trim();
	const profile = detectOdfProfile(name, mimetype);
	const extension = name.toLowerCase().split(".").at(-1);
	if (["odt", "ods", "odp"].includes(extension ?? "") && extension !== profile)
		throw invalidOdf(
			`ODF mimetype does not match the .${extension} extension.`,
		);
	if (mimetype !== ODF_MIME_TYPES[profile])
		throw invalidOdf(`ODF mimetype “${mimetype}” does not match .${profile}.`);
	const content = textPart(parts, "content.xml");
	const contentDocument = safeParseXml(content, context);
	if (contentDocument.documentElement.localName !== "document-content")
		throw invalidOdf(
			"content.xml has no office:document-content root element.",
		);
	const body = Array.from(contentDocument.getElementsByTagName("*")).find(
		(element) => element.localName === "body",
	);
	const expectedBody = { odt: "text", ods: "spreadsheet", odp: "presentation" }[
		profile
	];
	if (
		!body ||
		!Array.from(body.children).some(
			(element) => element.localName === expectedBody,
		)
	)
		throw invalidOdf(
			`content.xml has no office:${expectedBody} body for .${profile}.`,
		);
	const manifest = textPart(parts, "META-INF/manifest.xml");
	const manifestDocument = safeParseXml(manifest, context);
	if (manifestDocument.documentElement.localName !== "manifest")
		throw invalidOdf("META-INF/manifest.xml has no manifest root element.");
	const rootEntry = Array.from(manifestDocument.getElementsByTagName("*")).find(
		(element) =>
			element.localName === "file-entry" &&
			Array.from(element.attributes).some(
				(entry) =>
					(entry.localName === "full-path" ||
						entry.name.endsWith(":full-path")) &&
					entry.value === "/",
			),
	);
	if (!rootEntry) throw invalidOdf("The ODF manifest has no root file-entry.");
	const rootMime = Array.from(rootEntry.attributes).find(
		(entry) =>
			entry.localName === "media-type" || entry.name.endsWith(":media-type"),
	)?.value;
	if (rootMime !== mimetype)
		throw invalidOdf(
			"The ODF manifest root media type does not match mimetype.",
		);
	if (typeof parts["META-INF/documentsignatures.xml"] === "string")
		throw invalidOdf(
			"Digitally signed ODF packages must be re-signed after localization and are not exported safely.",
		);
	return profile;
}

function validateOdfContainer(archive: SafeZipPackage): void {
	if (archive.entries.find((entry) => !entry.directory)?.path !== "mimetype")
		throw invalidOdf("ODF requires mimetype to be the first ZIP entry.");
	if (archive.bytes.length < 30)
		throw invalidOdf("The ODF ZIP local header is truncated.");
	const view = new DataView(
		archive.bytes.buffer,
		archive.bytes.byteOffset,
		archive.bytes.byteLength,
	);
	if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== 0)
		throw invalidOdf(
			"ODF requires its first mimetype entry to be uncompressed.",
		);
}

export async function validateOdfFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const archive = await readSafeZipPackage(file, context);
		validateOdfContainer(archive);
		validateOdfParts(archive.parts, file.name, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not a readable OpenDocument package.",
				};
	}
}

export async function importOdfFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("odf", options);
	const archive = await readSafeZipPackage(file, context);
	validateOdfContainer(archive);
	const profile = validateOdfParts(archive.parts, file.name, context);
	const partsToExtract = ["content.xml"];
	if (
		filterOptions.includeHeadersFooters &&
		typeof archive.parts["styles.xml"] === "string"
	)
		partsToExtract.push("styles.xml");
	const meta = partsToExtract.flatMap((part) =>
		selectedOdfValues(part, textPart(archive.parts, part), filterOptions),
	);
	const segments = meta.map((entry) => entry.originalValue);
	const replacements: PackageXmlValueReplacement[] = meta.map(
		(entry, unitIndex) => ({
			kind: "package-xml-value",
			unitIndex,
			profile: `${profile}-1.2/1.3`,
			part: entry.part,
			path: entry.path,
			location: entry.location,
			start: entry.start,
			end: entry.end,
			originalValue: entry.originalValue,
		}),
	);
	const document = createNeutralDocument({
		format: "odf",
		sourceSegments: segments,
		unitIds: meta.map(
			(entry, index) => `${entry.part}:${entry.path.join("/")}:${index}`,
		),
		sourceLocations: meta.map((entry, segmentIndex) => ({
			part: entry.part,
			path: entry.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile,
		normativeVersion: "ODF 1.2/1.3 package",
		preservedParts: Object.keys(archive.parts).length,
		security:
			"Macros/scripts remain inert package bytes; signed packages are rejected.",
	};
	for (const [index, entry] of meta.entries()) {
		document.units[index].contexts.push({
			type: "odf-part",
			value: entry.part,
		});
		if (entry.style)
			document.units[index].contexts.push({
				type: "odf-style-name",
				value: entry.style,
			});
	}
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(
			file,
			"odf",
			archive.parts,
			replacements,
			archive.source,
		),
		filterOptions,
		typeRef: { profile, mimeType: ODF_MIME_TYPES[profile] } as TypeRef,
		segmentsMeta: meta,
	};
}
