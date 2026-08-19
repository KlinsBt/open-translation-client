import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import type { PackageXmlSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
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

const DITA_ROOTS = new Set([
	"dita",
	"topic",
	"concept",
	"task",
	"reference",
	"glossentry",
	"glossgroup",
	"map",
	"bookmap",
	"subjectscheme",
]);
const DITA_DTD_FILES = new Set([
	"dita.dtd",
	"topic.dtd",
	"concept.dtd",
	"task.dtd",
	"reference.dtd",
	"glossentry.dtd",
	"glossgroup.dtd",
	"map.dtd",
	"bookmap.dtd",
	"subjectscheme.dtd",
]);
const METADATA_ELEMENTS = new Set([
	"prolog",
	"metadata",
	"topicmeta",
	"bookmeta",
	"critdates",
	"permissions",
	"publisher",
	"author",
	"source",
	"resourceid",
	"othermeta",
	"category",
	"keywords",
	"prodinfo",
]);
const CODE_ELEMENTS = new Set([
	"codeblock",
	"codeph",
	"pre",
	"lines",
	"syntaxdiagram",
	"filepath",
	"userinput",
	"systemoutput",
	"msgblock",
	"screen",
]);
const NON_DITA_CONTENT = new Set([
	"mathml",
	"math",
	"svg",
	"foreign",
	"unknown",
	"data",
	"data-about",
]);
const PROFILING_ATTRIBUTES = [
	"audience",
	"platform",
	"product",
	"props",
	"otherprops",
	"rev",
	"status",
] as const;

interface DitaReference {
	part: string;
	target?: string;
	fragment?: string;
	key?: string;
	kind: "href" | "conref" | "keyref";
}

interface DitaPartModel {
	part: string;
	content: string;
	syntax: XmlSyntaxDocument;
	kind: "topic" | "map";
	ids: Set<string>;
	references: DitaReference[];
	keys: Set<string>;
}

interface DitaSource {
	package: boolean;
	parts: Record<string, string | Blob>;
	models: Map<string, DitaPartModel>;
	rootPart: string;
	archive?: SafeZipPackage;
	textSource?: Awaited<ReturnType<typeof readSafeTextFile>>;
}

function invalidDita(message: string): SafeInputError {
	return new SafeInputError("DITA_INVALID", message);
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(entry) => entry.localName.toLowerCase() === name.toLowerCase(),
	)?.value;
}

function classContains(element: XmlElementLocation, token: string): boolean {
	return ` ${attribute(element, "class") ?? ""} `.includes(` ${token} `);
}

function ditaKind(root: XmlElementLocation): "topic" | "map" {
	const name = root.localName.toLowerCase();
	if (!DITA_ROOTS.has(name) && !attribute(root, "class"))
		throw invalidDita(`Unsupported DITA root element “${root.qName}”.`);
	if (
		["map", "bookmap", "subjectscheme"].includes(name) ||
		classContains(root, "map/map")
	)
		return "map";
	if (
		[
			"dita",
			"topic",
			"concept",
			"task",
			"reference",
			"glossentry",
			"glossgroup",
		].includes(name) ||
		classContains(root, "topic/topic")
	)
		return "topic";
	throw invalidDita(`Root element “${root.qName}” is not a DITA topic or map.`);
}

export function maskKnownDitaDoctype(content: string): string {
	if (/<!ENTITY\b/i.test(content) || /<!DOCTYPE[\s\S]*?\[/i.test(content))
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"DITA internal subsets and entity declarations are disabled for safety.",
		);
	const declarations = [...content.matchAll(/<!DOCTYPE[\s\S]*?>/gi)];
	if (!declarations.length) return content;
	if (declarations.length !== 1)
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"DITA documents may contain at most one fixed document type declaration.",
		);
	const declaration = declarations[0][0];
	const parsed = declaration.match(
		/^<!DOCTYPE\s+([\w:.-]+)(?:\s+PUBLIC\s+"([^"]+)"\s+"([^"]+)"|\s+SYSTEM\s+"([^"]+)")\s*>$/i,
	);
	if (!parsed)
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"The DITA document type declaration is not a supported fixed declaration.",
		);
	const publicId = parsed[2] ?? "";
	const systemId = parsed[3] ?? parsed[4] ?? "";
	const dtdName = systemId.split(/[\\/]/).at(-1)?.toLowerCase() ?? "";
	if (
		!DITA_ROOTS.has(parsed[1].split(":").at(-1)!.toLowerCase()) ||
		!DITA_DTD_FILES.has(dtdName) ||
		(publicId && !/^-\/\/OASIS\/\/DTD DITA .+\/\/EN$/i.test(publicId))
	)
		throw new SafeInputError(
			"XML_UNSAFE_DECLARATION",
			"Only fixed OASIS DITA doctypes with known DTD system names are accepted.",
		);
	return `${content.slice(0, declarations[0].index)}${" ".repeat(declaration.length)}${content.slice(declarations[0].index! + declaration.length)}`;
}

function normalizeReferencePath(part: string, reference: string): string {
	let decoded: string;
	try {
		decoded = decodeURIComponent(reference);
	} catch {
		throw invalidDita(`Reference “${reference}” has invalid percent encoding.`);
	}
	if (decoded.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(decoded))
		throw invalidDita(`Reference “${reference}” is not a safe package path.`);
	const base = part.includes("/")
		? part.slice(0, part.lastIndexOf("/") + 1)
		: "";
	const output: string[] = [];
	for (const component of `${base}${decoded}`
		.replaceAll("\\", "/")
		.split("/")) {
		if (!component || component === ".") continue;
		if (component === "..") {
			if (!output.length)
				throw invalidDita(`Reference “${reference}” escapes the bundle root.`);
			output.pop();
		} else output.push(component);
	}
	return output.join("/");
}

function parseReference(
	part: string,
	value: string,
	kind: "href" | "conref",
): DitaReference | undefined {
	const trimmed = value.trim();
	if (!trimmed || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return undefined;
	const [path, fragment] = trimmed.split("#", 2);
	return {
		part,
		...(path
			? { target: normalizeReferencePath(part, path) }
			: { target: part }),
		...(fragment ? { fragment } : {}),
		kind,
	};
}

function parseDitaPart(part: string, content: string): DitaPartModel {
	const syntax = parseXmlSyntax(maskKnownDitaDoctype(content));
	const root = syntax.elements[0];
	if (!root) throw invalidDita(`${part} has no document element.`);
	const kind = ditaKind(root);
	const ids = new Set<string>();
	const references: DitaReference[] = [];
	const keys = new Set<string>();
	for (const element of syntax.elements) {
		const id = attribute(element, "id");
		if (id) {
			if (ids.has(id))
				throw invalidDita(`${part} contains duplicate ID “${id}”.`);
			ids.add(id);
		}
		for (const key of (attribute(element, "keys") ?? "")
			.split(/\s+/)
			.filter(Boolean))
			keys.add(key);
		if (attribute(element, "scope") === "external") continue;
		for (const name of ["href", "conref", "conrefend"] as const) {
			const value = attribute(element, name);
			if (value) {
				const reference = parseReference(
					part,
					value,
					name === "href" ? "href" : "conref",
				);
				if (reference) references.push(reference);
			}
		}
		for (const name of ["keyref", "conkeyref"] as const) {
			const value = attribute(element, name)?.trim();
			if (value)
				references.push({
					part,
					key: value.split("/", 1)[0],
					kind: "keyref",
				});
		}
	}
	return { part, content, syntax, kind, ids, references, keys };
}

function validateBundle(
	models: Map<string, DitaPartModel>,
	rootPart: string,
	packagePaths: ReadonlySet<string>,
): void {
	const allKeys = new Set(
		[...models.values()].flatMap((model) => [...model.keys]),
	);
	for (const model of models.values())
		for (const reference of model.references) {
			if (reference.key && !allKeys.has(reference.key))
				throw invalidDita(
					`${model.part} references unresolved DITA key “${reference.key}”.`,
				);
			if (!reference.target) continue;
			if (!packagePaths.has(reference.target))
				throw invalidDita(
					`${model.part} references missing bundle resource ${reference.target}.`,
				);
			const target = models.get(reference.target);
			if (!target) {
				if (/\.(?:dita|ditamap|bookmap)$/i.test(reference.target))
					throw invalidDita(
						`${model.part} references missing DITA document ${reference.target}.`,
					);
				continue;
			}
			if (reference.fragment) {
				const fragmentIds = reference.fragment.split("/").filter(Boolean);
				if (fragmentIds.some((id) => !target.ids.has(id)))
					throw invalidDita(
						`${model.part} references missing fragment “${reference.fragment}” in ${target.part}.`,
					);
			}
		}
	if (models.get(rootPart)?.kind !== "map")
		throw invalidDita(
			"A multi-file DITA bundle requires one unambiguous root map.",
		);
}

function chooseRootMap(models: Map<string, DitaPartModel>): string {
	const maps = [...models.values()].filter((model) => model.kind === "map");
	if (!maps.length) throw invalidDita("A multi-file DITA bundle has no map.");
	const referencedMaps = new Set(
		[...models.values()].flatMap((model) =>
			model.references
				.map((reference) => reference.target)
				.filter(
					(target): target is string =>
						!!target && models.get(target)?.kind === "map",
				),
		),
	);
	const roots = maps.filter((model) => !referencedMaps.has(model.part));
	if (roots.length !== 1)
		throw invalidDita(
			"The DITA bundle does not have one unambiguous root map.",
		);
	return roots[0].part;
}

async function isZipFile(file: File): Promise<boolean> {
	const bytes = new Uint8Array(await file.slice(0, 4).arrayBuffer());
	return bytes.length === 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function readDitaSource(
	file: File,
	context?: SafeInputContext,
): Promise<DitaSource> {
	if (/\.ditazip$/i.test(file.name) || (await isZipFile(file))) {
		const archive = await readSafeZipPackage(file, context);
		const models = new Map<string, DitaPartModel>();
		for (const [part, content] of Object.entries(archive.parts))
			if (
				typeof content === "string" &&
				/\.(?:dita|ditamap|bookmap)$/i.test(part)
			)
				models.set(part, parseDitaPart(part, content));
		if (!models.size)
			throw invalidDita("The DITA bundle contains no DITA XML documents.");
		const rootPart = chooseRootMap(models);
		validateBundle(models, rootPart, new Set(Object.keys(archive.parts)));
		return { package: true, parts: archive.parts, models, rootPart, archive };
	}
	const textSource = await readSafeTextFile(file, context);
	const model = parseDitaPart(file.name, textSource.text);
	return {
		package: false,
		parts: { [file.name]: textSource.text },
		models: new Map([[file.name, model]]),
		rootPart: file.name,
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

function translationDisabled(chain: readonly XmlElementLocation[]): boolean {
	return chain.some(
		(element) =>
			attribute(element, "translate")?.toLowerCase() === "no" ||
			!element.effectiveTranslate,
	);
}

function reachableParts(source: DitaSource): Set<string> {
	const output = new Set<string>();
	const queue = [source.rootPart];
	while (queue.length) {
		const part = queue.shift()!;
		if (output.has(part)) continue;
		output.add(part);
		for (const reference of source.models.get(part)?.references ?? [])
			if (reference.target && source.models.has(reference.target))
				queue.push(reference.target);
	}
	return output;
}

function extractDitaPart(
	model: DitaPartModel,
	options: Readonly<FormatOptionValues>,
): PackageXmlSegmentMeta[] {
	const selectedAttributes = new Set(
		parseList(options.attributeSelectors).map((value) => value.toLowerCase()),
	);
	const candidates: XmlValueLocation[] = [];
	for (const value of model.syntax.values) {
		const element = model.syntax.elements[value.elementId];
		const chain = ancestors(element, model.syntax);
		const names = new Set(chain.map((entry) => entry.localName.toLowerCase()));
		if (options.respectTranslateMetadata && translationDisabled(chain))
			continue;
		if (
			!options.includeMetadata &&
			[...names].some((name) => METADATA_ELEMENTS.has(name))
		)
			continue;
		if (
			!options.includeCode &&
			[...names].some((name) => CODE_ELEMENTS.has(name))
		)
			continue;
		if ([...names].some((name) => NON_DITA_CONTENT.has(name))) continue;
		if (model.kind === "map" && !options.includeNavigation) continue;
		candidates.push(value);
	}
	for (const element of model.syntax.elements) {
		const chain = ancestors(element, model.syntax);
		if (options.respectTranslateMetadata && translationDisabled(chain))
			continue;
		for (const entry of element.attributes)
			if (
				selectedAttributes.has(entry.localName.toLowerCase()) &&
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
	}
	const output: PackageXmlSegmentMeta[] = [];
	for (const candidate of candidates.sort((a, b) => a.start - b.start)) {
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
				profile: `dita-${model.kind}`,
				part: model.part,
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

export async function validateDitaFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await readDitaSource(file, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not a safe, valid DITA document or bundle.",
				};
	}
}

export async function importDitaFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("dita", options);
	const source = await readDitaSource(file, context);
	const selected =
		source.package && filterOptions.contentScope === "map"
			? reachableParts(source)
			: new Set(source.models.keys());
	const meta = [...source.models.values()]
		.filter((model) => selected.has(model.part))
		.flatMap((model) => extractDitaPart(model, filterOptions));
	const segments: string[] = [];
	for (const entry of meta) {
		const sameRangeBefore = meta
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
			sameRangeBefore
		];
		segments.push(
			piece ? `${piece.text}${piece.separator ?? ""}` : entry.originalValue,
		);
	}
	const replacements = meta.map((entry, unitIndex) =>
		source.package
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
		format: "dita",
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
		profile: source.package
			? "DITA multi-file bundle"
			: `DITA ${source.models.get(source.rootPart)!.kind}`,
		rootMap: source.package ? source.rootPart : undefined,
		documents: source.models.size,
		keys: [...source.models.values()].reduce(
			(total, model) => total + model.keys.size,
			0,
		),
		security:
			"Fixed DITA doctypes are masked; entity declarations and escaping package references are rejected.",
	};
	for (const [index, entry] of meta.entries()) {
		const model = source.models.get(entry.part)!;
		const element = model.syntax.elements.find((candidate) =>
			entry.path
				.slice(0, -1)
				.every((value, pathIndex) => candidate.path[pathIndex] === value),
		);
		document.units[index].contexts.push({
			type: "dita-part",
			value: entry.part,
		});
		if (element) {
			const id = attribute(element, "id");
			if (id)
				document.units[index].contexts.push({ type: "dita-id", value: id });
			for (const name of PROFILING_ATTRIBUTES) {
				const value = attribute(element, name);
				if (value)
					document.units[index].contexts.push({ type: `dita-${name}`, value });
			}
		}
	}
	const skeleton = source.package
		? await createPackageSkeleton(
				file,
				"dita",
				source.parts,
				replacements,
				source.archive!.source,
			)
		: await createTextSkeleton(
				file,
				"dita",
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
		typeRef: {
			profile: source.package
				? "dita-bundle"
				: `dita-${source.models.get(source.rootPart)!.kind}`,
			rootPart: source.rootPart,
		} as TypeRef,
		segmentsMeta: meta,
	};
}
