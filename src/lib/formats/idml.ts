import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { PackageXmlSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	readSafeZipPackage,
	SafeInputError,
	type SafeInputContext,
	type SafeZipPackage,
} from "./safeInput";
import {
	createPackageSkeleton,
	createTextSkeleton,
	type PackageXmlValueReplacement,
	type XmlValueReplacement,
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
	type XmlValueLocation,
} from "./xmlFamily";

export const IDML_MIME_TYPE = "application/vnd.adobe.indesign-idml-package";
const ACCESSIBILITY_ATTRIBUTES = new Set([
	"customalttext",
	"actualtext",
	"alternatetext",
]);

interface InDesignStory {
	part: string;
	content: string;
	syntax: XmlSyntaxDocument;
	profile: "idml" | "icml" | "inx";
}

interface InDesignSource {
	profile: "idml" | "icml" | "inx";
	parts: Record<string, string | Blob>;
	stories: InDesignStory[];
	archive?: SafeZipPackage;
	textSource?: Awaited<ReturnType<typeof readSafeTextFile>>;
}

function invalidIdml(message: string): SafeInputError {
	return new SafeInputError("IDML_INVALID", message);
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(entry) => entry.qName === name || entry.localName === name,
	)?.value;
}

function normalizePackagePath(reference: string): string {
	let decoded: string;
	try {
		decoded = decodeURIComponent(reference.split("#", 1)[0]);
	} catch {
		throw invalidIdml(
			`IDML package reference “${reference}” has invalid encoding.`,
		);
	}
	if (
		!decoded ||
		decoded.startsWith("/") ||
		/^[a-z][a-z\d+.-]*:/i.test(decoded)
	)
		throw invalidIdml(
			`IDML package reference “${reference}” is not a safe relative path.`,
		);
	const output: string[] = [];
	for (const component of decoded.replaceAll("\\", "/").split("/")) {
		if (!component || component === ".") continue;
		if (component === "..") {
			if (!output.length)
				throw invalidIdml(
					`IDML package reference “${reference}” escapes the package root.`,
				);
			output.pop();
		} else output.push(component);
	}
	return output.join("/");
}

function validateIdmlContainer(archive: SafeZipPackage): void {
	if (archive.entries.find((entry) => !entry.directory)?.path !== "mimetype")
		throw invalidIdml("IDML requires mimetype to be the first ZIP entry.");
	if (archive.bytes.length < 30)
		throw invalidIdml("The IDML ZIP local header is truncated.");
	const view = new DataView(
		archive.bytes.buffer,
		archive.bytes.byteOffset,
		archive.bytes.byteLength,
	);
	if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== 0)
		throw invalidIdml(
			"IDML requires its first mimetype entry to be uncompressed.",
		);
	if (archive.parts.mimetype !== IDML_MIME_TYPE)
		throw invalidIdml(`IDML mimetype must be exactly ${IDML_MIME_TYPE}.`);
}

function textPart(parts: Record<string, string | Blob>, path: string): string {
	const content = parts[path];
	if (typeof content !== "string")
		throw invalidIdml(
			`IDML package part ${path} is missing or not readable XML.`,
		);
	return content;
}

function parseStory(
	part: string,
	content: string,
	packageStory: boolean,
	profile: InDesignSource["profile"],
): InDesignStory {
	const syntax = parseXmlSyntax(content);
	const root = syntax.elements[0];
	if (!root) throw invalidIdml(`${part} has no XML document element.`);
	if (packageStory && root.localName !== "Story")
		throw invalidIdml(`${part} is not an IDML Story package part.`);
	if (
		!packageStory &&
		!(
			["Document", "Story"].includes(root.localName) &&
			syntax.elements.some((element) => element.localName === "Story")
		)
	)
		throw invalidIdml(
			"ICML requires a Document or Story root containing a Story element.",
		);
	if (
		profile === "inx" &&
		(root.localName !== "Document" ||
			!attribute(root, "DOMVersion") ||
			!syntax.elements.some((element) => element.localName === "Story"))
	)
		throw invalidIdml(
			"INX requires an InDesign Document root with DOMVersion and Story content.",
		);
	if (!syntax.elements.some((element) => element.localName === "Content"))
		throw invalidIdml(`${part} has no InDesign Content elements.`);
	return { part, content, syntax, profile };
}

function parseIdmlArchive(archive: SafeZipPackage): InDesignSource {
	validateIdmlContainer(archive);
	const designmap = parseXmlSyntax(textPart(archive.parts, "designmap.xml"));
	if (designmap.elements[0]?.localName !== "Document")
		throw invalidIdml("designmap.xml has no IDML Document root.");
	const storyPaths: string[] = [];
	for (const element of designmap.elements) {
		const src = attribute(element, "src");
		if (!src) continue;
		const path = normalizePackagePath(src);
		if (archive.parts[path] === undefined)
			throw invalidIdml(
				`designmap.xml references missing package part ${path}.`,
			);
		if (element.localName === "Story") storyPaths.push(path);
	}
	if (!storyPaths.length)
		throw invalidIdml("designmap.xml does not declare any stories.");
	if (new Set(storyPaths).size !== storyPaths.length)
		throw invalidIdml("designmap.xml declares a story more than once.");
	if (
		Object.keys(archive.parts).some((path) =>
			/(?:^|\/)signatures?\.xml$/i.test(path),
		)
	)
		throw invalidIdml(
			"Signed IDML packages must be re-signed after localization.",
		);
	const stories = storyPaths.map((path) =>
		parseStory(path, textPart(archive.parts, path), true, "idml"),
	);
	const selfIds = new Set<string>();
	for (const story of stories)
		for (const element of story.syntax.elements) {
			const self = attribute(element, "Self");
			if (!self) continue;
			if (selfIds.has(self))
				throw invalidIdml(`Duplicate IDML Self identifier “${self}”.`);
			selfIds.add(self);
		}
	return {
		profile: "idml",
		parts: archive.parts,
		stories,
		archive,
	};
}

async function isZipFile(file: File): Promise<boolean> {
	const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	return bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function readInDesignSource(
	file: File,
	context?: SafeInputContext,
): Promise<InDesignSource> {
	if (/\.idml$/i.test(file.name) || (await isZipFile(file)))
		return parseIdmlArchive(await readSafeZipPackage(file, context));
	const textSource = await readSafeTextFile(file, context);
	const profile =
		/\.inx$/i.test(file.name) ||
		/<\?aid\b[^?]*\btype=["']document["']/i.test(textSource.text)
			? "inx"
			: "icml";
	return {
		profile,
		parts: { [file.name]: textSource.text },
		stories: [parseStory(file.name, textSource.text, false, profile)],
		textSource,
	};
}

function ancestors(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation[] {
	const output = [element];
	let current = element;
	while (current.parentId !== undefined) {
		current = syntax.elements[current.parentId];
		output.push(current);
	}
	return output;
}

function hidden(chain: readonly XmlElementLocation[]): boolean {
	return chain.some(
		(element) =>
			attribute(element, "Visible")?.toLowerCase() === "false" ||
			attribute(element, "Hidden")?.toLowerCase() === "true" ||
			element.localName === "HiddenText",
	);
}

function extractStory(
	story: InDesignStory,
	options: Readonly<FormatOptionValues>,
): PackageXmlSegmentMeta[] {
	const candidates: XmlValueLocation[] = [];
	for (const value of story.syntax.values) {
		const element = story.syntax.elements[value.elementId];
		const chain = ancestors(element, story.syntax);
		if (element.localName !== "Content") continue;
		if (
			!options.includeNotes &&
			chain.some((entry) => entry.localName === "Note")
		)
			continue;
		if (!options.includeHiddenText && hidden(chain)) continue;
		candidates.push(value);
	}
	if (options.includeAccessibilityText)
		for (const element of story.syntax.elements)
			for (const entry of element.attributes)
				if (
					ACCESSIBILITY_ATTRIBUTES.has(entry.localName.toLowerCase()) &&
					entry.value.trim()
				)
					candidates.push({
						location: "attribute",
						elementId: element.id,
						path: [...element.path, `@${entry.qName}`],
						attribute: entry.qName,
						start: entry.start,
						end: entry.end,
						value: entry.value,
					});
	const output: PackageXmlSegmentMeta[] = [];
	for (const candidate of candidates.sort(
		(first, second) => first.start - second.start,
	)) {
		const pieces =
			options.segmentationMode === "sentences"
				? segmentPlainText(candidate.value, "sentences")
				: options.segmentationMode === "preferences"
					? splitTextWithPreferences(candidate.value)
					: [{ text: candidate.value, separator: "" }];
		const effective = pieces.filter((piece) => piece.text.trim());
		for (const piece of effective.length
			? effective
			: [{ text: candidate.value, separator: "" }])
			output.push({
				profile: `${story.profile}-story`,
				part: story.part,
				path: candidate.path,
				location: candidate.location,
				...(candidate.attribute ? { attribute: candidate.attribute } : {}),
				start: candidate.start,
				end: candidate.end,
				originalValue: candidate.value,
				separator: piece.separator ?? "",
			});
	}
	return output;
}

export async function validateInDesignFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await readInDesignSource(file, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not a safe, valid IDML/ICML/INX document.",
				};
	}
}

export async function importInDesignFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("idml", options);
	const source = await readInDesignSource(file, context);
	const meta = source.stories.flatMap((story) =>
		extractStory(story, filterOptions),
	);
	const segments: string[] = [];
	for (const entry of meta) {
		const occurrence = meta
			.slice(0, segments.length)
			.filter(
				(candidate) =>
					candidate.part === entry.part &&
					candidate.start === entry.start &&
					candidate.end === entry.end,
			).length;
		const pieces =
			filterOptions.segmentationMode === "sentences"
				? segmentPlainText(entry.originalValue, "sentences")
				: filterOptions.segmentationMode === "preferences"
					? splitTextWithPreferences(entry.originalValue)
					: [{ text: entry.originalValue, separator: "" }];
		const piece = pieces.filter((candidate) => candidate.text.trim())[
			occurrence
		];
		segments.push(
			piece ? `${piece.text}${piece.separator ?? ""}` : entry.originalValue,
		);
	}
	const replacements = meta.map((entry, unitIndex) =>
		source.profile === "idml"
			? ({
					kind: "package-xml-value",
					unitIndex,
					...entry,
				} satisfies PackageXmlValueReplacement)
			: ({
					kind: "xml-value",
					unitIndex,
					path: entry.path,
					location: entry.location,
					...(entry.attribute ? { attribute: entry.attribute } : {}),
					start: entry.start,
					end: entry.end,
					originalValue: entry.originalValue,
					separator: entry.separator,
				} satisfies XmlValueReplacement),
	);
	const document = createNeutralDocument({
		format: "idml",
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
		profile: source.profile.toUpperCase(),
		stories: source.stories.length,
		security:
			"Scripts, graphics, fonts, styles, and unknown package parts remain inert source bytes.",
	};
	for (const [index, entry] of meta.entries()) {
		const story = source.stories.find(
			(candidate) => candidate.part === entry.part,
		)!;
		const element = story.syntax.elements.find((candidate) =>
			entry.path
				.slice(0, -1)
				.every((part, pathIndex) => candidate.path[pathIndex] === part),
		);
		document.units[index].contexts.push({
			type: "indesign-story",
			value: entry.part,
		});
		if (element) {
			const chain = ancestors(element, story.syntax);
			for (const [type, name] of [
				["indesign-paragraph-style", "AppliedParagraphStyle"],
				["indesign-character-style", "AppliedCharacterStyle"],
				["indesign-markup-tag", "MarkupTag"],
			] as const) {
				const value = chain
					.map((candidate) => attribute(candidate, name))
					.find(Boolean);
				if (value) document.units[index].contexts.push({ type, value });
			}
		}
	}
	const skeleton =
		source.profile === "idml"
			? await createPackageSkeleton(
					file,
					"idml",
					source.parts,
					replacements,
					source.archive!.source,
				)
			: await createTextSkeleton(
					file,
					"idml",
					source.textSource!.text,
					replacements,
					createSkeletonSource(file, source.textSource!),
				);
	return {
		kind: "segments",
		segments,
		document,
		skeleton,
		filterOptions,
		typeRef: { profile: source.profile } as TypeRef,
		segmentsMeta: meta,
	};
}
