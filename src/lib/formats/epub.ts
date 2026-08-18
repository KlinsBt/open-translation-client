import type { PackageXmlSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	readSafeZipPackage,
	SafeInputError,
	safeParseXml,
	type SafeInputContext,
	type SafeZipPackage,
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

export const EPUB_MIME_TYPE = "application/epub+zip";

interface EpubManifestItem {
	id: string;
	href: string;
	path: string;
	mediaType: string;
	properties: string[];
	mediaOverlay?: string;
}

interface EpubPackageModel {
	version: "2" | "3";
	opfPath: string;
	manifest: EpubManifestItem[];
	spineIds: string[];
	navigation?: EpubManifestItem;
	ncx?: EpubManifestItem;
}

function invalidEpub(message: string): SafeInputError {
	return new SafeInputError("EPUB_INVALID", message);
}

function attribute(element: Element, name: string): string | undefined {
	return Array.from(element.attributes).find(
		(entry) => entry.localName === name || entry.name.endsWith(`:${name}`),
	)?.value;
}

function syntaxAttribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(entry) => entry.localName === name || entry.qName === name,
	)?.value;
}

function normalizePackagePath(basePath: string, href: string): string {
	const withoutFragment = href.split("#", 1)[0].split("?", 1)[0];
	let decoded: string;
	try {
		decoded = decodeURIComponent(withoutFragment);
	} catch {
		throw invalidEpub(`Manifest href “${href}” has invalid percent encoding.`);
	}
	if (
		!decoded ||
		decoded.startsWith("/") ||
		/^[a-z][a-z\d+.-]*:/i.test(decoded)
	)
		throw invalidEpub(
			`Manifest href “${href}” is not a safe relative package path.`,
		);
	const base = basePath.includes("/")
		? basePath.slice(0, basePath.lastIndexOf("/") + 1)
		: "";
	const output: string[] = [];
	for (const component of `${base}${decoded}`
		.replaceAll("\\", "/")
		.split("/")) {
		if (!component || component === ".") continue;
		if (component === "..") {
			if (!output.length)
				throw invalidEpub(
					`Manifest href “${href}” escapes the EPUB package root.`,
				);
			output.pop();
		} else output.push(component);
	}
	return output.join("/");
}

function validateEpubContainer(archive: SafeZipPackage): void {
	if (archive.entries.find((entry) => !entry.directory)?.path !== "mimetype")
		throw invalidEpub("EPUB requires mimetype to be the first ZIP entry.");
	if (archive.bytes.length < 30)
		throw invalidEpub("The EPUB ZIP local header is truncated.");
	const view = new DataView(
		archive.bytes.buffer,
		archive.bytes.byteOffset,
		archive.bytes.byteLength,
	);
	if (view.getUint32(0, true) !== 0x04034b50 || view.getUint16(8, true) !== 0)
		throw invalidEpub(
			"EPUB requires its first mimetype entry to be uncompressed.",
		);
}

function textPart(parts: Record<string, string | Blob>, path: string): string {
	const value = parts[path];
	if (typeof value !== "string")
		throw invalidEpub(`The EPUB package has no readable ${path}.`);
	return value;
}

function parseEpubPackage(
	parts: Record<string, string | Blob>,
	context?: SafeInputContext,
): EpubPackageModel {
	if (textPart(parts, "mimetype").trim() !== EPUB_MIME_TYPE)
		throw invalidEpub("EPUB mimetype must be exactly application/epub+zip.");
	const container = safeParseXml(
		textPart(parts, "META-INF/container.xml"),
		context,
	);
	if (container.documentElement.localName !== "container")
		throw invalidEpub("META-INF/container.xml has no container root element.");
	const rootfiles = Array.from(container.getElementsByTagName("*")).filter(
		(element) => element.localName === "rootfile",
	);
	if (rootfiles.length !== 1)
		throw invalidEpub("EPUB must declare exactly one package rootfile.");
	const opfPath = attribute(rootfiles[0], "full-path");
	if (!opfPath || opfPath.startsWith("/") || opfPath.split("/").includes(".."))
		throw invalidEpub("EPUB rootfile path is missing or unsafe.");
	const opf = safeParseXml(textPart(parts, opfPath), context);
	if (opf.documentElement.localName !== "package")
		throw invalidEpub(`${opfPath} has no package root element.`);
	const declaredVersion = attribute(opf.documentElement, "version") ?? "";
	const version = declaredVersion.startsWith("2")
		? "2"
		: declaredVersion.startsWith("3")
			? "3"
			: undefined;
	if (!version)
		throw invalidEpub(`Unsupported EPUB package version “${declaredVersion}”.`);
	const manifestElements = Array.from(opf.getElementsByTagName("*")).filter(
		(element) => element.localName === "item",
	);
	const manifest: EpubManifestItem[] = [];
	const ids = new Set<string>();
	for (const element of manifestElements) {
		const id = attribute(element, "id");
		const href = attribute(element, "href");
		const mediaType = attribute(element, "media-type");
		if (!id || !href || !mediaType)
			throw invalidEpub(
				"Every EPUB manifest item needs id, href, and media-type.",
			);
		if (ids.has(id)) throw invalidEpub(`Duplicate EPUB manifest ID “${id}”.`);
		ids.add(id);
		const path = normalizePackagePath(opfPath, href);
		if (parts[path] === undefined)
			throw invalidEpub(
				`Manifest item “${id}” references missing package path ${path}.`,
			);
		manifest.push({
			id,
			href,
			path,
			mediaType,
			properties: (attribute(element, "properties") ?? "")
				.split(/\s+/)
				.filter(Boolean),
			...(attribute(element, "media-overlay")
				? { mediaOverlay: attribute(element, "media-overlay") }
				: {}),
		});
	}
	const spine = Array.from(opf.getElementsByTagName("*")).find(
		(element) => element.localName === "spine",
	);
	if (!spine) throw invalidEpub("EPUB package has no spine.");
	const spineIds = Array.from(spine.children)
		.filter((element) => element.localName === "itemref")
		.map((element) => attribute(element, "idref") ?? "");
	if (!spineIds.length || spineIds.some((id) => !ids.has(id)))
		throw invalidEpub(
			"EPUB spine contains a missing or invalid manifest reference.",
		);
	for (const item of manifest)
		if (item.mediaOverlay && !ids.has(item.mediaOverlay))
			throw invalidEpub(
				`Manifest item “${item.id}” has a missing media-overlay reference.`,
			);
	const navigation = manifest.find((item) => item.properties.includes("nav"));
	const tocId = attribute(spine, "toc");
	const ncx = manifest.find(
		(item) =>
			item.id === tocId || item.mediaType === "application/x-dtbncx+xml",
	);
	if (version === "3" && !navigation)
		throw invalidEpub("EPUB 3 packages require one navigation document.");
	if (version === "2" && !ncx)
		throw invalidEpub("EPUB 2 packages require an NCX navigation document.");
	const identifiers = Array.from(opf.getElementsByTagName("*")).filter(
		(element) =>
			element.localName === "identifier" && element.textContent?.trim(),
	);
	if (!identifiers.length)
		throw invalidEpub("EPUB package metadata has no publication identifier.");
	if (typeof parts["META-INF/signatures.xml"] === "string")
		throw invalidEpub(
			"Signed EPUB packages must be re-signed after localization.",
		);
	const encryption = parts["META-INF/encryption.xml"];
	if (
		typeof encryption === "string" &&
		/<EncryptedData\b/i.test(encryption) &&
		!/http:\/\/www\.idpf\.org\/2008\/embedding|http:\/\/ns\.adobe\.com\/pdf\/enc#RC/.test(
			encryption,
		)
	)
		throw invalidEpub(
			"Encrypted EPUB content is unsupported; only standard font obfuscation may pass through.",
		);
	return { version, opfPath, manifest, spineIds, navigation, ncx };
}

export function maskKnownEpubDoctype(
	content: string,
	kind: "xhtml" | "ncx",
): string {
	if (/<!ENTITY\b/i.test(content))
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"EPUB entity declarations are disabled for safety.",
		);
	const declarations = [...content.matchAll(/<!DOCTYPE[\s\S]*?>/gi)];
	if (!declarations.length)
		return kind === "xhtml" ? maskExecutableXhtml(content) : content;
	if (declarations.length !== 1)
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"EPUB content has multiple document type declarations.",
		);
	const declaration = declarations[0][0];
	const allowed =
		kind === "xhtml"
			? /^<!DOCTYPE\s+html(?:\s+PUBLIC\s+"-\/\/W3C\/\/DTD XHTML 1\.1\/\/EN"\s+"http:\/\/www\.w3\.org\/TR\/xhtml11\/DTD\/xhtml11\.dtd")?\s*>$/i
			: /^<!DOCTYPE\s+ncx\s+PUBLIC\s+"-\/\/NISO\/\/DTD ncx 2005-1\/\/EN"\s+"http:\/\/www\.daisy\.org\/z3986\/2005\/ncx-2005-1\.dtd"\s*>$/i;
	if (!allowed.test(declaration))
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"The EPUB document type declaration is not an allowed fixed XHTML/NCX declaration.",
		);
	const masked = `${content.slice(0, declarations[0].index)}${" ".repeat(declaration.length)}${content.slice(declarations[0].index! + declaration.length)}`;
	return kind === "xhtml" ? maskExecutableXhtml(masked) : masked;
}

function maskExecutableXhtml(content: string): string {
	return content
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, (value) =>
			" ".repeat(value.length),
		)
		.replace(/<link\b[^>]*\/?\s*>/gi, (value) => " ".repeat(value.length));
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

function extractEpubXml(
	part: string,
	content: string,
	kind: "xhtml" | "svg" | "ncx" | "opf",
	options: Readonly<FormatOptionValues>,
): PackageXmlSegmentMeta[] {
	const masked =
		kind === "xhtml" || kind === "ncx"
			? maskKnownEpubDoctype(content, kind)
			: content;
	const syntax = parseXmlSyntax(masked);
	const output: PackageXmlSegmentMeta[] = [];
	for (const value of syntax.values) {
		const element = syntax.elements[value.elementId];
		const chain = ancestors(element, syntax);
		const names = new Set(chain.map((entry) => entry.localName.toLowerCase()));
		let selected = false;
		if (kind === "xhtml")
			selected =
				names.has("body") &&
				!["script", "style", "code", "pre", "kbd", "samp", "math"].some(
					(name) => names.has(name),
				);
		else if (kind === "svg")
			selected = ["text", "tspan", "textpath", "title", "desc"].includes(
				element.localName.toLowerCase(),
			);
		else if (kind === "ncx")
			selected = element.localName.toLowerCase() === "text";
		else if (kind === "opf")
			selected =
				options.includeMetadata === true &&
				[
					"title",
					"description",
					"subject",
					"rights",
					"publisher",
					"creator",
					"contributor",
				].includes(element.localName.toLowerCase());
		if (selected)
			output.push({
				profile: `epub-${kind}`,
				part,
				path: value.path,
				location: value.location,
				start: value.start,
				end: value.end,
				originalValue: value.value,
			});
	}
	if (options.includeAccessibilityText && (kind === "xhtml" || kind === "svg"))
		for (const element of syntax.elements)
			for (const entry of element.attributes)
				if (
					["alt", "title", "aria-label"].includes(entry.localName) &&
					entry.value.trim()
				)
					output.push({
						profile: `epub-${kind}`,
						part,
						path: [...element.path, `@${entry.qName}`],
						location: "attribute",
						attribute: entry.qName,
						start: entry.start,
						end: entry.end,
						originalValue: entry.value,
					});
	return output.sort((a, b) => a.start - b.start);
}

export async function validateEpubFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const archive = await readSafeZipPackage(file, context);
		validateEpubContainer(archive);
		const model = parseEpubPackage(archive.parts, context);
		for (const item of model.manifest) {
			if (item.mediaType === "application/xhtml+xml")
				extractEpubXml(item.path, textPart(archive.parts, item.path), "xhtml", {
					includeAccessibilityText: true,
				});
			else if (item.mediaType === "image/svg+xml")
				extractEpubXml(
					item.path,
					textPart(archive.parts, item.path),
					"svg",
					{},
				);
		}
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not a readable EPUB 2/3 package.",
				};
	}
}

export async function importEpubFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("epub", options);
	const archive = await readSafeZipPackage(file, context);
	validateEpubContainer(archive);
	const model = parseEpubPackage(archive.parts, context);
	const byId = new Map(model.manifest.map((item) => [item.id, item]));
	const selected = new Map<
		string,
		{ item: EpubManifestItem; kind: "xhtml" | "svg" | "ncx" }
	>();
	const contentItems =
		filterOptions.contentScope === "all"
			? model.manifest.filter(
					(item) => item.mediaType === "application/xhtml+xml",
				)
			: model.spineIds
					.map((id) => byId.get(id))
					.filter(
						(item): item is EpubManifestItem =>
							item?.mediaType === "application/xhtml+xml",
					);
	for (const item of contentItems)
		selected.set(item.path, { item, kind: "xhtml" });
	if (filterOptions.includeNavigation && model.navigation)
		selected.set(model.navigation.path, {
			item: model.navigation,
			kind: "xhtml",
		});
	if (filterOptions.includeNavigation && model.ncx)
		selected.set(model.ncx.path, { item: model.ncx, kind: "ncx" });
	if (filterOptions.includeSvgText)
		for (const item of model.manifest.filter(
			(entry) => entry.mediaType === "image/svg+xml",
		))
			selected.set(item.path, { item, kind: "svg" });
	let meta = [...selected.values()].flatMap(({ item, kind }) =>
		extractEpubXml(
			item.path,
			textPart(archive.parts, item.path),
			kind,
			filterOptions,
		),
	);
	if (filterOptions.includeMetadata)
		meta = [
			...extractEpubXml(
				model.opfPath,
				textPart(archive.parts, model.opfPath),
				"opf",
				filterOptions,
			),
			...meta,
		];
	const segments = meta.map((entry) => entry.originalValue);
	const replacements: PackageXmlValueReplacement[] = meta.map(
		(entry, unitIndex) => ({
			kind: "package-xml-value",
			unitIndex,
			...entry,
		}),
	);
	const document = createNeutralDocument({
		format: "epub",
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
		profile: `EPUB ${model.version}`,
		opfPath: model.opfPath,
		spine: model.spineIds,
		manifestItems: model.manifest.length,
		mediaOverlays: model.manifest.filter((item) => item.mediaOverlay).length,
		scriptedItems: model.manifest.filter((item) =>
			item.properties.includes("scripted"),
		).length,
		security:
			"Scripts, CSS, fonts, audio/video, overlays, and unknown assets remain inert package bytes.",
	};
	for (const [index, entry] of meta.entries())
		document.units[index].contexts.push({
			type: "epub-package-part",
			value: entry.part,
		});
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(
			file,
			"epub",
			archive.parts,
			replacements,
			archive.source,
		),
		filterOptions,
		typeRef: {
			profile: `epub${model.version}`,
			opfPath: model.opfPath,
			mimeType: EPUB_MIME_TYPE,
		} as TypeRef,
		segmentsMeta: meta,
	};
}
