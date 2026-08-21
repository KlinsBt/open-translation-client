import { segmentPlainText } from "$lib/functions/parsing/parsingText";
import { splitTextWithPreferences } from "$lib/functions/parsing/splitWithPreferences";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import type { TypeRef, UserData, XmlSegmentMeta } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import { assertProjectExportQuality } from "./qualityAssurance";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import {
	createTextSkeleton,
	getTextSkeletonContent,
	type XmlValueReplacement,
} from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import {
	parseXmlSyntax,
	type XmlAttributeLocation,
	type XmlElementLocation,
	type XmlSyntaxDocument,
	type XmlValueLocation,
} from "./xmlFamily";

const ITS_NAMESPACE = "http://www.w3.org/2005/11/its";
const MADCAP_NAMESPACE = "http://www.madcapsoftware.com/Schemas/MadCap.xsd";
const SPREADSHEETML_2003_NAMESPACE =
	"urn:schemas-microsoft-com:office:spreadsheet";

export const SPECIALIST_XML_EXTENSIONS = [
	"its",
	"mulix",
	"sgm",
	"sgml",
	"xml",
	"html",
	"htm",
] as const;

export const SPECIALIST_XML_MIME_TYPES = [
	"application/its+xml",
	"application/xml",
	"text/xml",
	"application/sgml",
	"text/sgml",
	"text/html",
] as const;

export type SpecialistXmlProfile =
	| "its-rules"
	| "mulix"
	| "author-it"
	| "madcap"
	| "typo3"
	| "spreadsheetml-2003"
	| "sgml";

const PROFILE_LABELS: Record<SpecialistXmlProfile, string> = {
	"its-rules": "W3C ITS rules",
	mulix: "Multilingual XML (MULIX)",
	"author-it": "Author-it translation XML",
	madcap: "MadCap Flare XML/HTML",
	typo3: "TYPO3 locallang XML",
	"spreadsheetml-2003": "SpreadsheetML 2003 XML",
	sgml: "Constrained SGML",
};

const AUTHOR_IT_CONTENT = new Set([
	"text",
	"heading",
	"title",
	"webtitle",
	"printtitle",
	"helpentrytext",
	"webentrytext",
	"displayname",
	"prompt",
]);
const AUTHOR_IT_METADATA = new Set(["name", "description"]);
const AUTHOR_IT_PROTECTED = new Set([
	"macro",
	"script",
	"variable",
	"valueobject",
	"guid",
	"id",
	"localizationid",
	"createdby",
	"modifiedby",
	"createddate",
	"modifieddate",
	"wordcount",
]);
const MADCAP_CONTENT = new Set([
	"title",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"p",
	"li",
	"td",
	"th",
	"dt",
	"dd",
	"caption",
	"label",
	"span",
	"a",
	"div",
	"blockquote",
	"b",
	"strong",
	"em",
	"i",
	"u",
	"small",
	"sub",
	"sup",
]);
const MADCAP_PROTECTED = new Set([
	"script",
	"style",
	"code",
	"pre",
	"kbd",
	"samp",
	"svg",
	"math",
]);
const SGML_CONTENT = new Set([
	"title",
	"p",
	"para",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"li",
	"dt",
	"dd",
	"td",
	"th",
	"caption",
	"label",
	"section",
	"abstract",
	"em",
	"strong",
	"b",
	"i",
	"span",
]);
const SGML_PROTECTED = new Set([
	"script",
	"style",
	"code",
	"pre",
	"listing",
	"xmp",
	"object",
	"embed",
	"applet",
]);

interface SafeDoctype {
	root: string;
	declaration: string;
}

interface SpecialistInspection {
	profile: SpecialistXmlProfile;
	label: string;
	content: string;
	maskedContent: string;
	syntax: XmlSyntaxDocument;
	doctype?: SafeDoctype;
}

interface SelectedValue {
	source: XmlValueLocation;
	replacement: XmlValueLocation;
	target?: string;
}

function invalid(message: string): SafeInputError {
	return new SafeInputError("SPECIALIST_XML_INVALID", message);
}

function localName(value: string): string {
	return value.includes(":") ? value.slice(value.indexOf(":") + 1) : value;
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find(
		(entry) => entry.localName.toLowerCase() === name.toLowerCase(),
	)?.value;
}

function rootElement(syntax: XmlSyntaxDocument): XmlElementLocation {
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	if (!root) throw invalid("The document has no root element.");
	return root;
}

function ancestors(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): XmlElementLocation[] {
	const result = [element];
	let current = element;
	while (current.parentId !== undefined) {
		current = syntax.elements[current.parentId];
		result.push(current);
	}
	return result;
}

function maskSafeDoctype(content: string): {
	masked: string;
	doctype?: SafeDoctype;
} {
	if (/<!\s*(?:ENTITY|ELEMENT|ATTLIST|NOTATION)\b/i.test(content))
		throw invalid(
			"DTD declarations and entities are disabled; external schemas and entities are never loaded.",
		);
	const declarations = [...content.matchAll(/<!DOCTYPE[\s\S]*?>/gi)];
	if (!declarations.length) return { masked: content };
	if (declarations.length !== 1)
		throw invalid("Only one document type declaration is allowed.");
	const declaration = declarations[0][0];
	if (declaration.includes("["))
		throw invalid("DOCTYPE internal subsets are disabled for safety.");
	const match = declaration.match(/^<!DOCTYPE\s+([\w:.-]+)(?:\s+[\s\S]*?)?>$/i);
	if (!match) throw invalid("The document type declaration is malformed.");
	const index = declarations[0].index!;
	return {
		masked: `${content.slice(0, index)}${" ".repeat(declaration.length)}${content.slice(index + declaration.length)}`,
		doctype: { root: localName(match[1]).toLowerCase(), declaration },
	};
}

function detectProfile(
	syntax: XmlSyntaxDocument,
	doctype: SafeDoctype | undefined,
	extension?: string,
): SpecialistXmlProfile | undefined {
	const root = rootElement(syntax);
	const name = root.localName.toLowerCase();
	if (root.namespaceUri === ITS_NAMESPACE && name === "rules")
		return "its-rules";
	if (name === "authoritroot") return "author-it";
	if (
		name === "html" &&
		Object.values(root.namespaces).some((value) => value === MADCAP_NAMESPACE)
	)
		return "madcap";
	if (name === "t3locallang") return "typo3";
	if (name === "workbook" && root.namespaceUri === SPREADSHEETML_2003_NAMESPACE)
		return "spreadsheetml-2003";
	if (["mulix", "multilingual", "multilingualxml"].includes(name))
		return "mulix";
	if (
		name === "sgmldoc" ||
		(doctype !== undefined && ["sgm", "sgml"].includes(extension ?? ""))
	)
		return "sgml";
	return undefined;
}

function validateDoctypePolicy(inspection: SpecialistInspection): void {
	if (!inspection.doctype) return;
	const root = rootElement(inspection.syntax);
	if (inspection.doctype.root !== root.localName.toLowerCase())
		throw invalid(
			`DOCTYPE root “${inspection.doctype.root}” does not match “${root.qName}”.`,
		);
	if (
		inspection.profile === "madcap" &&
		/\bPUBLIC\b/i.test(inspection.doctype.declaration) &&
		!/W3C\/\/DTD XHTML|W3C\/\/DTD HTML/i.test(inspection.doctype.declaration)
	)
		throw invalid(
			"MadCap documents may use only fixed W3C HTML/XHTML doctypes.",
		);
}

function validateProfileStructure(inspection: SpecialistInspection): void {
	const { profile, syntax } = inspection;
	const elements = syntax.elements;
	if (profile === "its-rules") {
		const root = rootElement(syntax);
		if (!/^2(?:\.0)?$/.test(attribute(root, "version") ?? ""))
			throw invalid("An ITS rules file must declare ITS version 2.0.");
		if (
			!elements.some(
				(element) =>
					element.namespaceUri === ITS_NAMESPACE &&
					/Rule$/.test(element.localName),
			)
		)
			throw invalid(
				"The ITS rules document contains no ITS data-category rule.",
			);
	} else if (profile === "author-it") {
		if (!elements.some((element) => element.localName === "Object"))
			throw invalid("Author-it XML must contain at least one Object record.");
	} else if (profile === "madcap") {
		if (!elements.some((element) => element.localName.toLowerCase() === "body"))
			throw invalid("A MadCap topic must contain an HTML body.");
	} else if (profile === "typo3") {
		if (!elements.some((element) => element.localName === "languageKey"))
			throw invalid("TYPO3 locallang XML contains no languageKey block.");
	} else if (profile === "spreadsheetml-2003") {
		if (!elements.some((element) => element.localName === "Worksheet"))
			throw invalid("SpreadsheetML 2003 XML contains no Worksheet.");
	} else if (profile === "mulix") {
		if (!multilingualPairs(syntax).length)
			throw invalid(
				"MULIX requires entries containing paired source and target elements.",
			);
	} else if (profile === "sgml") {
		if (
			!inspection.doctype &&
			rootElement(syntax).localName.toLowerCase() !== "sgmldoc"
		)
			throw invalid(
				"Constrained SGML requires a safe DOCTYPE signature or an SGMLDoc root.",
			);
	}
}

export function inspectSpecialistXmlText(
	content: string,
	extension?: string,
): SpecialistInspection {
	const { masked, doctype } = maskSafeDoctype(content);
	const syntax = parseXmlSyntax(masked);
	const profile = detectProfile(syntax, doctype, extension?.toLowerCase());
	if (!profile)
		throw invalid(
			"The content does not match an ITS, MULIX, Author-it, MadCap, TYPO3, SpreadsheetML 2003, or constrained SGML signature.",
		);
	const inspection: SpecialistInspection = {
		profile,
		label: PROFILE_LABELS[profile],
		content,
		maskedContent: masked,
		syntax,
		...(doctype ? { doctype } : {}),
	};
	validateDoctypePolicy(inspection);
	validateProfileStructure(inspection);
	return inspection;
}

async function inspectFile(
	file: File,
	context?: SafeInputContext,
): Promise<
	SpecialistInspection & { read: Awaited<ReturnType<typeof readSafeTextFile>> }
> {
	const read = await readSafeTextFile(file, context);
	throwIfAborted(context?.signal);
	return {
		...inspectSpecialistXmlText(read.text, file.name.split(".").pop()),
		read,
	};
}

export async function detectSpecialistXmlProfile(
	file: File,
	context?: SafeInputContext,
): Promise<SpecialistXmlProfile | undefined> {
	try {
		return (await inspectFile(file, context)).profile;
	} catch (error) {
		if (error instanceof SafeInputError && error.code === "ABORTED")
			throw error;
		return undefined;
	}
}

export function specialistXmlProfileLabel(
	profile: SpecialistXmlProfile,
): string {
	return PROFILE_LABELS[profile];
}

export async function validateSpecialistXmlFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await inspectFile(file, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason:
						"The file is not a safe supported specialist XML/SGML document.",
				};
	}
}

function xmlValueForAttribute(
	element: XmlElementLocation,
	entry: XmlAttributeLocation,
): XmlValueLocation {
	return {
		location: "attribute",
		elementId: element.id,
		path: [...element.path, `@${entry.qName}`],
		attribute: entry.qName,
		start: entry.start,
		end: entry.end,
		value: entry.value,
	};
}

function hasProtectedAncestor(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
	protectedNames: ReadonlySet<string>,
): boolean {
	return ancestors(element, syntax).some((ancestor) =>
		protectedNames.has(ancestor.localName.toLowerCase()),
	);
}

function underLanguageKey(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
	key: string,
): boolean {
	return ancestors(element, syntax).some(
		(ancestor) =>
			ancestor.localName === "languageKey" &&
			(attribute(ancestor, "index") ?? "default").toLowerCase() === key,
	);
}

function spreadsheetStringData(element: XmlElementLocation): boolean {
	const type = element.attributes.find(
		(entry) => entry.localName.toLowerCase() === "type",
	)?.value;
	return !type || type.toLowerCase() === "string";
}

function spreadsheetFormulaAncestor(
	element: XmlElementLocation,
	syntax: XmlSyntaxDocument,
): boolean {
	return ancestors(element, syntax).some(
		(ancestor) =>
			ancestor.localName === "Cell" &&
			ancestor.attributes.some(
				(entry) => entry.localName.toLowerCase() === "formula",
			),
	);
}

function multilingualPairs(syntax: XmlSyntaxDocument): SelectedValue[] {
	const result: SelectedValue[] = [];
	const belongsTo = (value: XmlValueLocation, ancestorId: number): boolean => {
		let element = syntax.elements[value.elementId];
		while (element) {
			if (element.id === ancestorId) return true;
			if (element.parentId === undefined) return false;
			element = syntax.elements[element.parentId];
		}
		return false;
	};
	for (const sourceElement of syntax.elements.filter(
		(element) => element.localName.toLowerCase() === "source",
	)) {
		if (sourceElement.parentId === undefined) continue;
		const targetElement = syntax.elements.find(
			(element) =>
				element.parentId === sourceElement.parentId &&
				element.localName.toLowerCase() === "target",
		);
		if (!targetElement) continue;
		const sources = syntax.values.filter((value) =>
			belongsTo(value, sourceElement.id),
		);
		const targets = syntax.values.filter((value) =>
			belongsTo(value, targetElement.id),
		);
		if (sources.length !== targets.length || !sources.length) continue;
		for (const [index, source] of sources.entries()) {
			const target = targets[index];
			result.push({ source, replacement: target, target: target.value });
		}
	}
	return result;
}

function selectProfileValues(
	inspection: SpecialistInspection,
	includeMetadata: boolean,
): SelectedValue[] {
	const { profile, syntax } = inspection;
	if (profile === "mulix") return multilingualPairs(syntax);
	const selected: SelectedValue[] = [];
	for (const value of syntax.values) {
		const element = syntax.elements[value.elementId];
		const name = element.localName.toLowerCase();
		let include = false;
		if (profile === "its-rules")
			include = element.namespaceUri === ITS_NAMESPACE && name === "locnote";
		else if (profile === "author-it")
			include =
				!hasProtectedAncestor(element, syntax, AUTHOR_IT_PROTECTED) &&
				(AUTHOR_IT_CONTENT.has(name) ||
					(includeMetadata && AUTHOR_IT_METADATA.has(name)));
		else if (profile === "madcap")
			include =
				MADCAP_CONTENT.has(name) &&
				!hasProtectedAncestor(element, syntax, MADCAP_PROTECTED) &&
				(name !== "title" || includeMetadata);
		else if (profile === "typo3")
			include =
				name === "label" && underLanguageKey(element, syntax, "default");
		else if (profile === "spreadsheetml-2003")
			include =
				value.location === "text" &&
				element.localName === "Data" &&
				element.namespaceUri === SPREADSHEETML_2003_NAMESPACE &&
				spreadsheetStringData(element) &&
				!spreadsheetFormulaAncestor(element, syntax);
		else if (profile === "sgml")
			include =
				SGML_CONTENT.has(name) &&
				!hasProtectedAncestor(element, syntax, SGML_PROTECTED);
		if (include) selected.push({ source: value, replacement: value });
	}

	for (const element of syntax.elements) {
		const name = element.localName.toLowerCase();
		if (
			profile === "madcap" &&
			!hasProtectedAncestor(element, syntax, MADCAP_PROTECTED)
		)
			for (const entry of element.attributes) {
				const attributeName = entry.localName.toLowerCase();
				if (
					["alt", "title", "aria-label"].includes(attributeName) ||
					(includeMetadata &&
						name === "meta" &&
						attributeName === "content" &&
						["description", "keywords", "abstract"].includes(
							(attribute(element, "name") ?? "").toLowerCase(),
						))
				)
					selected.push({
						source: xmlValueForAttribute(element, entry),
						replacement: xmlValueForAttribute(element, entry),
					});
			}
		if (profile === "sgml")
			for (const entry of element.attributes)
				if (["alt", "title", "summary"].includes(entry.localName.toLowerCase()))
					selected.push({
						source: xmlValueForAttribute(element, entry),
						replacement: xmlValueForAttribute(element, entry),
					});
	}
	return selected.sort((a, b) => a.source.start - b.source.start);
}

function segmentValue(
	value: string,
	mode: string,
): Array<{ text: string; separator: string }> {
	const pieces =
		mode === "sentences"
			? segmentPlainText(value, "sentences")
			: mode === "preferences"
				? splitTextWithPreferences(value)
				: [{ text: value, separator: "" }];
	const effective = pieces.filter((piece) => piece.text.trim());
	return (effective.length ? effective : [{ text: value, separator: "" }]).map(
		(piece) => ({ text: piece.text, separator: piece.separator ?? "" }),
	);
}

export async function importSpecialistXmlFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const inspection = await inspectFile(file, context);
	const filterOptions = normalizeImportOptions("specialist-xml", options);
	if (inspection.profile === "mulix") filterOptions.segmentationMode = "value";
	const selected = selectProfileValues(
		inspection,
		Boolean(filterOptions.includeMetadata),
	);
	if (!selected.length)
		throw invalid(
			`The ${inspection.label} profile contains no text selected by its safe vocabulary rules.`,
		);

	const segments: string[] = [];
	const targets: string[] = [];
	const meta: XmlSegmentMeta[] = [];
	const replacements: XmlValueReplacement[] = [];
	const sourceDetails: XmlValueLocation[] = [];
	for (const item of selected) {
		const pieces = segmentValue(
			item.source.value,
			String(filterOptions.segmentationMode),
		);
		for (const piece of pieces) {
			const unitIndex = segments.length;
			segments.push(`${piece.text}${piece.separator}`);
			targets.push(item.target ?? "");
			sourceDetails.push(item.source);
			const common = {
				path: [...item.replacement.path],
				...(item.replacement.attribute
					? { attribute: item.replacement.attribute }
					: {}),
				start: item.replacement.start,
				end: item.replacement.end,
				originalValue: item.replacement.value,
				separator: piece.separator,
			};
			meta.push({ kind: item.replacement.location, ...common });
			replacements.push({
				kind: "xml-value",
				location: item.replacement.location,
				unitIndex,
				...common,
			});
		}
	}

	const document = createNeutralDocument({
		format: "specialist-xml",
		sourceSegments: segments,
		targetSegments: targets,
		sourceLocations: sourceDetails.map((value, segmentIndex) => ({
			part: file.name,
			path: value.path,
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: inspection.label,
		encoding: inspection.read.encoding,
		hasBom: inspection.read.hasBom,
		doctypePolicy:
			"Fixed declarations are preserved but masked before parsing; internal subsets, entity declarations, network schemas, and external entities are never resolved.",
		inlinePolicy:
			"Markup remains in the positional skeleton; only profile-approved text nodes and attributes are editable.",
	};
	for (const [index, detail] of sourceDetails.entries()) {
		document.units[index].contexts.push({
			type: "specialist-profile",
			value: inspection.profile,
		});
		document.units[index].contexts.push({
			type: "xml-path",
			value: detail.path.join("/"),
		});
	}

	return {
		kind: "segments",
		segments,
		targetSegments: targets,
		document,
		skeleton: await createTextSkeleton(
			file,
			"specialist-xml",
			inspection.content,
			replacements,
			createSkeletonSource(file, inspection.read),
		),
		filterOptions,
		typeRef: {
			profile: inspection.profile,
			sourceExtension: file.name.toLowerCase().split(".").at(-1) ?? "xml",
			root: rootElement(inspection.syntax).qName,
		} as TypeRef,
		segmentsMeta: meta,
	};
}

function encodeValue(
	value: string,
	location: XmlValueReplacement["location"],
): string {
	if (location === "cdata") return value.replaceAll("]]>", "]]]]><![CDATA[>");
	const escaped = value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return location === "attribute"
		? escaped.replaceAll('"', "&quot;").replaceAll("'", "&apos;")
		: escaped;
}

function projectProfile(project: UserData): SpecialistXmlProfile {
	const profile =
		typeof project.translationData.typeRef === "object"
			? project.translationData.typeRef.profile
			: undefined;
	if (typeof profile !== "string" || !(profile in PROFILE_LABELS))
		throw new Error("Specialist XML export metadata is missing or invalid.");
	return profile as SpecialistXmlProfile;
}

export function buildSpecialistXmlTranslation(project: UserData): string {
	const content = getTextSkeletonContent(
		project.translationData.skeleton,
		"specialist-xml",
	);
	if (content === undefined)
		throw new Error(
			"Specialist XML/SGML export requires its original positional skeleton.",
		);
	const replacements = project.translationData.skeleton!.replacements.filter(
		(replacement): replacement is XmlValueReplacement =>
			replacement.kind === "xml-value",
	);
	if (
		replacements.length !== project.translationData.seg2.length ||
		new Set(replacements.map((replacement) => replacement.unitIndex)).size !==
			replacements.length ||
		replacements.some(
			(replacement) =>
				replacement.unitIndex < 0 ||
				replacement.unitIndex >= project.translationData.seg2.length ||
				replacement.start < 0 ||
				replacement.end > content.length ||
				replacement.start > replacement.end,
		)
	)
		throw new Error(
			"Specialist XML/SGML export mappings do not align uniquely with the target segments.",
		);

	const groups = new Map<string, XmlValueReplacement[]>();
	for (const replacement of replacements) {
		const key = `${replacement.start}:${replacement.end}`;
		const group = groups.get(key) ?? [];
		group.push(replacement);
		groups.set(key, group);
	}
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const group of groups.values()) {
		const ordered = group.sort((a, b) => a.unitIndex - b.unitIndex);
		let translated = "";
		for (const replacement of ordered) {
			const separator = replacement.separator ?? "";
			let value = project.translationData.seg2[replacement.unitIndex] ?? "";
			if (separator && value.endsWith(separator))
				value = value.slice(0, -separator.length);
			translated += `${value}${separator}`;
		}
		const first = ordered[0];
		if (translated === first.originalValue) continue;
		edits.push({
			start: first.start,
			end: first.end,
			value: encodeValue(translated, first.location),
		});
	}
	let output = content;
	for (const edit of edits.sort((a, b) => b.start - a.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	const sourceExtension =
		typeof project.translationData.typeRef === "object"
			? String(project.translationData.typeRef.sourceExtension ?? "xml")
			: "xml";
	const reopened = inspectSpecialistXmlText(output, sourceExtension);
	if (reopened.profile !== projectProfile(project))
		throw new Error(
			"Translated output no longer matches the original specialist vocabulary.",
		);
	return output;
}

function outputMime(project: UserData): string {
	const extension =
		typeof project.translationData.typeRef === "object"
			? String(project.translationData.typeRef.sourceExtension ?? "xml")
			: "xml";
	return ["sgm", "sgml"].includes(extension)
		? "text/sgml"
		: extension === "its"
			? "application/its+xml"
			: extension === "html" || extension === "htm"
				? "text/html"
				: "application/xml";
}

export function buildSpecialistXmlTranslationBlob(project: UserData): Blob {
	const output = buildSpecialistXmlTranslation(project);
	const skeleton = project.translationData.skeleton;
	const source = getTextSkeletonContent(skeleton, "specialist-xml");
	if (output === source && skeleton?.source.originalFile)
		return skeleton.source.originalFile;
	const encoding = skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, skeleton?.source.hasBom ?? false)],
		{ type: `${outputMime(project)};charset=${encoding}` },
	);
}

export async function generateSpecialistXmlTranslation(
	project: UserData,
): Promise<void> {
	assertProjectExportQuality(project);
	const sourceName =
		project.translationData.skeleton?.source.name ?? "document.xml";
	const extension = sourceName.includes(".")
		? sourceName.slice(sourceName.lastIndexOf("."))
		: ".xml";
	const requested = project.translationData.name || sourceName;
	const name = requested.toLowerCase().endsWith(extension.toLowerCase())
		? requested
		: `${requested}${extension}`;
	const url = URL.createObjectURL(buildSpecialistXmlTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
