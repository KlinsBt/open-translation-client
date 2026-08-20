import type { TbData, TmData, Type, UserData } from "$lib/types/types";
import { FORMAT_IDS } from "./formatIds";
import {
	parseXmlRecord,
	scanXmlRecords,
	type XmlRecordScanResult,
} from "./streaming";
import {
	parseSafeJson,
	SafeInputError,
	safeParseXml,
	type SafeInputContext,
} from "./safeInput";
import {
	assembleXliff12Document,
	contentToEditableText,
	parseXliff12Record,
	type ParsedXliff12Record,
} from "./xliff12";
import {
	assembleXliff2Document,
	contentToEditableText as contentToXliff2EditableText,
	parseXliff2Record,
	type ParsedXliff2Record,
} from "./xliff2";
import {
	applyXliffVendorProfile,
	detectXliffVendorProfile,
} from "./xliffProfiles";
import {
	assembleTmxData,
	parseTmxHeader,
	parseTmxUnit,
	type ParsedTmxUnit,
} from "./tmx14";
import {
	parseTbxEntry,
	readTbxDocumentMetadata,
	TBX_V3_NAMESPACE,
	validateTbxData,
} from "./tbx";
import {
	migrateProjectData,
	migrateTbData,
	migrateTmData,
	PROJECT_SCHEMA_VERSION,
} from "./persistenceMigrations";

export interface StreamingImportResult<T> {
	data: T;
	metrics: XmlRecordScanResult;
}

export async function importTmxStreaming(
	file: File,
	context?: SafeInputContext,
): Promise<StreamingImportResult<TmData>> {
	const units: ParsedTmxUnit[] = [];
	const metrics = await scanXmlRecords(
		file,
		{
			recordNames: ["tu"],
			batchSize: 250,
			allowedDoctype:
				/^<!DOCTYPE\s+tmx\s+SYSTEM\s+["'](?:tmx14\.dtd|https?:\/\/(?:www\.)?(?:lisa\.org\/tmx|ttt\.org\/oscarStandards\/tmx)\/tmx14\.dtd)["']\s*>$/i,
		},
		(recordXml, index, namespaces) => {
			const unit = parseXmlRecord(recordXml, namespaces);
			units.push(parseTmxUnit(unit, index));
		},
		context,
	);
	const root = parseStartElement(
		metrics.header,
		"tmx",
		metrics.namespaceDeclarations,
	);
	if (!root)
		throw new SafeInputError(
			"XML_MALFORMED",
			"The TMX root element is missing.",
		);
	const headerXml = findClosedElement(metrics.header, "header");
	const header = headerXml
		? parseXmlRecord(headerXml, metrics.namespaceDeclarations)
		: parseStartElement(
				metrics.header,
				"header",
				metrics.namespaceDeclarations,
			);
	if (!header)
		throw new SafeInputError("XML_MALFORMED", "The TMX header is missing.");
	const parsedHeader = parseTmxHeader(
		root,
		header,
		metrics.header.match(/<!DOCTYPE\s+tmx\b[^>]*>/i)?.[0],
	);
	return {
		data: migrateTmData(assembleTmxData(parsedHeader, units)),
		metrics,
	};
}

export async function importTbxStreaming(
	file: File,
	context?: SafeInputContext,
): Promise<StreamingImportResult<TbData>> {
	const entries: TbData["entries"] = [];
	const metrics = await scanXmlRecords(
		file,
		{
			recordNames: ["conceptEntry", "termEntry"],
			batchSize: 250,
			collectSkeleton: true,
			allowedDoctype:
				/^<!DOCTYPE\s+martif\s+SYSTEM\s+["'](?:TBXBasiccoreStructV02\.dtd|https?:\/\/[^"']*TBXBasiccoreStructV02\.dtd)["']\s*>$/i,
		},
		(recordXml, index, namespaces) => {
			const record = parseXmlRecord(recordXml, namespaces);
			const entry = parseTbxEntry(record, index);
			if (entry.terms.length === 0)
				throw new SafeInputError(
					"XML_MALFORMED",
					"A TBX entry contains no terms.",
				);
			entries.push(entry);
		},
		context,
	);
	if (!metrics.skeleton)
		throw new SafeInputError(
			"XML_MALFORMED",
			"The TBX structural skeleton is missing.",
		);
	const skeletonDocument = safeParseXml(
		metrics.skeleton.replace(/<!DOCTYPE\s+martif\b[^>]*>/i, ""),
	);
	const root = skeletonDocument.documentElement;
	if (!["tbx", "martif"].includes(root.localName.toLowerCase()))
		throw new SafeInputError(
			"XML_MALFORMED",
			"The TBX root element is missing.",
		);
	const metadata = readTbxDocumentMetadata(root);
	for (const entry of entries)
		if (entry.tbx)
			Object.assign(entry.tbx, {
				version: metadata.version,
				dialect: metadata.dialect,
				style: metadata.style,
			});
	if (!root.getAttribute("type") || !root.getAttribute("xml:lang")) {
		throw new SafeInputError(
			"XML_MALFORMED",
			"The TBX root needs type and xml:lang attributes.",
		);
	}
	if (!["TBX-Core", "TBX-Min", "TBX-Basic"].includes(metadata.dialect))
		throw new SafeInputError(
			"XML_MALFORMED",
			`The TBX dialect “${root.getAttribute("type") ?? ""}” is not supported.`,
		);
	if (
		metadata.version === 3 &&
		(!["dca", "dct"].includes(root.getAttribute("style") ?? "") ||
			root.namespaceURI !== TBX_V3_NAMESPACE)
	)
		throw new SafeInputError(
			"XML_MALFORMED",
			`TBX v3 needs style dca/dct and the ${TBX_V3_NAMESPACE} namespace.`,
		);
	const directChildren = (element: Element, localName: string) =>
		Array.from(element.childNodes).filter(
			(node): node is Element =>
				node.nodeType === 1 && (node as Element).localName === localName,
		);
	const headerName = metadata.version === 3 ? "tbxHeader" : "martifHeader";
	const text = directChildren(root, "text")[0];
	const body = text ? directChildren(text, "body")[0] : undefined;
	if (!directChildren(root, headerName)[0] || !body)
		throw new SafeInputError(
			"XML_MALFORMED",
			"The TBX header or text/body wrapper is missing.",
		);
	const bodyElements = Array.from(body.childNodes).filter(
		(node): node is Element => node.nodeType === 1,
	);
	const placeholders = bodyElements.filter(
		(node): node is Element =>
			node.localName === "opentlc-stream-record" &&
			node.namespaceURI === "urn:opentlc:stream",
	);
	if (
		placeholders.length !== metrics.recordCount ||
		bodyElements.length !== placeholders.length
	)
		throw new SafeInputError(
			"XML_MALFORMED",
			"TBX entries must be direct children of text/body.",
		);
	const titleXml = findClosedElement(metrics.header, "title");
	const name = titleXml
		? parseXmlRecord(
				titleXml,
				metrics.namespaceDeclarations,
			).textContent?.trim() || "Untitled TBX File"
		: "Untitled TBX File";
	const sourceDescription = findClosedElement(metrics.header, "sourceDesc");
	const idMatch = sourceDescription?.match(/OpenTLC ID:\s*(\d+)/i);
	const data = migrateTbData({
		...(idMatch ? { id: Number(idMatch[1]) } : {}),
		name,
		entries,
		tbx: {
			...metadata,
			documentSkeletonXml: metrics.skeleton,
		},
	});
	const issue = validateTbxData(data)[0];
	if (issue)
		throw new SafeInputError(
			"XML_MALFORMED",
			`${issue.message} (${issue.path})`,
		);
	return { data, metrics };
}

export async function importXliffProjectStreaming(
	file: File,
	context?: SafeInputContext,
): Promise<StreamingImportResult<UserData>> {
	const xliff12Records: ParsedXliff12Record[] = [];
	const xliff2Records: ParsedXliff2Record[] = [];
	const metrics = await scanXmlRecords(
		file,
		{
			recordNames: ["trans-unit", "unit"],
			batchSize: 500,
			collectSkeleton: true,
		},
		(recordXml, index, namespaces) => {
			const unit = parseXmlRecord(recordXml, namespaces);
			if (unit.localName === "trans-unit") {
				xliff12Records.push(parseXliff12Record(recordXml, index, namespaces));
				return;
			}
			xliff2Records.push(parseXliff2Record(recordXml, index, namespaces));
		},
		context,
	);
	const root = parseStartElement(
		metrics.header,
		"xliff",
		metrics.namespaceDeclarations,
	);
	const fileElement = parseStartElement(
		metrics.header,
		"file",
		metrics.namespaceDeclarations,
	);
	if (!root || !fileElement)
		throw new SafeInputError(
			"XML_MALFORMED",
			"The XLIFF root or file element is missing.",
		);
	const version = Number(root.getAttribute("version"));
	if (!Number.isFinite(version))
		throw new SafeInputError("XML_MALFORMED", "The XLIFF version is invalid.");

	const state =
		version >= 2
			? extractXliff2Header(root, fileElement, metrics)
			: extractXliff12Header(fileElement, metrics);
	const normalizedType = normalizeType(state.type);
	const vendorProfile = detectXliffVendorProfile(
		metrics.skeleton ?? metrics.header,
		file.name,
		root.getAttribute("version") ?? String(version),
	);
	const rawXliff12Document =
		version < 2
			? assembleXliff12Document({
					skeletonXml:
						metrics.skeleton ??
						(() => {
							throw new SafeInputError(
								"XML_MALFORMED",
								"The XLIFF structural skeleton is missing.",
							);
						})(),
					records: xliff12Records,
					format: normalizedType,
					documentId: String(state.id ?? file.name),
				})
			: undefined;
	const xliff12Document = rawXliff12Document
		? applyXliffVendorProfile(rawXliff12Document, vendorProfile)
		: undefined;
	const rawXliff2Document =
		version >= 2
			? assembleXliff2Document({
					skeletonXml:
						metrics.skeleton ??
						(() => {
							throw new SafeInputError(
								"XML_MALFORMED",
								"The XLIFF structural skeleton is missing.",
							);
						})(),
					records: xliff2Records,
					format: normalizedType,
					documentId: String(state.id ?? file.name),
				})
			: undefined;
	const xliff2Document = rawXliff2Document
		? applyXliffVendorProfile(rawXliff2Document, vendorProfile)
		: undefined;
	const documentModel = xliff12Document ?? xliff2Document;
	const editableText = xliff12Document
		? contentToEditableText
		: contentToXliff2EditableText;
	const seg1 = documentModel
		? documentModel.units.map((unit) => editableText(unit.source))
		: [];
	const seg2 = documentModel
		? documentModel.units.map((unit) => editableText(unit.target))
		: [];
	const checked =
		state.checked.length === seg1.length
			? state.checked
			: xliff12Document
				? xliff12Document.units.map(
						(unit) => unit.state === "reviewed" || unit.state === "final",
					)
				: documentModel
					? documentModel.units.map(
							(unit) => unit.state === "reviewed" || unit.state === "final",
						)
					: seg1.map(() => false);
	const persistedLocked = state.editingState.locked;
	const locked =
		Array.isArray(persistedLocked) &&
		persistedLocked.length === seg1.length &&
		persistedLocked.every((value) => typeof value === "boolean")
			? [...persistedLocked]
			: documentModel
				? documentModel.units.map(
						(unit) =>
							unit.translatable === false ||
							(unit.metadata?.xliffProfile as { locked?: boolean } | undefined)
								?.locked === true,
					)
				: seg1.map(() => false);
	const numericId = Number(state.id);
	const projectName =
		vendorProfile &&
		(state.name === "Unnamed Translation" || /^Translation\s/.test(state.name))
			? fileNameWithoutExtension(file.name)
			: state.name;
	return {
		data: migrateProjectData({
			...(state.schemaVersion === undefined && state.hasOpenTlcMetadata
				? {}
				: {
						schemaVersion: state.schemaVersion ?? PROJECT_SCHEMA_VERSION,
					}),
			...(Number.isFinite(numericId) ? { id: numericId } : {}),
			translationData: {
				name: projectName,
				sourceLang: state.sourceLang,
				targetLang: state.targetLang,
				creationDate: Date.now().toString(),
				seg1,
				seg2,
				checked,
				locked,
				type: normalizedType,
				typeRef: state.typeRef,
				segmentsMeta: state.editingState.segmentsMeta,
				segmentJoinStates: state.editingState.segmentJoinStates,
				parsingTokens: state.editingState.parsingTokens,
				documentModel: documentModel ?? state.editingState.documentModel,
				skeleton: state.editingState.skeleton,
				filterOptions: state.editingState.filterOptions,
				tm: state.tm,
				tb: state.tb,
			},
		}),
		metrics,
	};
}

interface XliffHeaderState {
	schemaVersion?: number;
	id?: string | number;
	name: string;
	sourceLang: string;
	targetLang: string;
	checked: boolean[];
	hasOpenTlcMetadata: boolean;
	type: string;
	typeRef: UserData["translationData"]["typeRef"];
	tm: UserData["translationData"]["tm"];
	tb: UserData["translationData"]["tb"];
	editingState: Record<string, any>;
}

function extractXliff2Header(
	root: Element,
	file: Element,
	metrics: XmlRecordScanResult,
): XliffHeaderState {
	const values = new Map<string, string>();
	let hasOpenTlcMetadata = false;
	const metadataXml = findClosedElement(metrics.header, "metadata");
	if (metadataXml) {
		const metadata = parseXmlRecord(metadataXml, metrics.namespaceDeclarations);
		const openTlcGroup = Array.from(metadata.getElementsByTagName("*")).find(
			(element) =>
				(element.localName || element.tagName.split(":").at(-1)) ===
					"metaGroup" &&
				element.getAttribute("category") === "open_tlc_metadata",
		);
		hasOpenTlcMetadata = openTlcGroup !== undefined;
		for (const meta of Array.from(
			openTlcGroup?.getElementsByTagName("*") ?? [],
		).filter(
			(element) =>
				(element.localName || element.tagName.split(":").at(-1)) === "meta",
		)) {
			values.set(meta.getAttribute("type") ?? "", meta.textContent ?? "");
		}
	}
	return {
		schemaVersion: parseOptionalVersion(values.get("schema_version")),
		id: file.getAttribute("id") ?? undefined,
		name: values.get("name") || `Translation ${file.getAttribute("id") ?? ""}`,
		sourceLang: root.getAttribute("srcLang") ?? "",
		targetLang: root.getAttribute("trgLang") ?? "",
		checked: parseJsonOr(values.get("checked"), []),
		hasOpenTlcMetadata,
		type: values.get("type") || "text",
		typeRef: parseJsonOr(values.get("type_ref"), {}),
		tm: parseJsonOr(values.get("tm"), inactiveResource()),
		tb: parseJsonOr(values.get("tb"), inactiveResource()),
		editingState: parseJsonOr(values.get("editing_state"), {}),
	};
}

function extractXliff12Header(
	file: Element,
	metrics: XmlRecordScanResult,
): XliffHeaderState {
	const infoXml = findClosedElement(metrics.header, "SourceInfo");
	const info = infoXml
		? parseXmlRecord(infoXml, metrics.namespaceDeclarations)
		: undefined;
	const legacyValue = (name: string) =>
		Array.from(info?.getElementsByTagName("*") ?? []).find(
			(element) =>
				(element.localName || element.tagName.split(":").at(-1)) === name,
		)?.textContent ?? "";
	const projectNote = findClosedElements(metrics.header, "note")
		.map((xml) => parseXmlRecord(xml, metrics.namespaceDeclarations))
		.find((note) => note.getAttribute("from") === "OpenTLC");
	const parsedEmbedded = parseJsonOr<unknown>(
		projectNote?.textContent ?? undefined,
		{},
	);
	const embedded =
		parsedEmbedded !== null &&
		typeof parsedEmbedded === "object" &&
		!Array.isArray(parsedEmbedded)
			? (parsedEmbedded as Record<string, unknown>)
			: {};
	const value = (legacyName: string, key: string): string => {
		const current = embedded[key];
		if (typeof current === "string") return current;
		if (current !== undefined) return JSON.stringify(current);
		return legacyValue(legacyName);
	};
	return {
		schemaVersion: parseOptionalVersion(
			value("SchemaVersion", "schemaVersion"),
		),
		id: value("Id", "id") || undefined,
		name: value("Name", "name") || "Unnamed Translation",
		sourceLang: file.getAttribute("source-language") ?? "",
		targetLang: file.getAttribute("target-language") ?? "",
		checked: parseJsonOr(value("Checked", "checked"), []),
		hasOpenTlcMetadata: projectNote !== undefined || info !== undefined,
		type: value("Type", "type") || "text",
		typeRef: parseJsonOr(value("TypeRef", "typeRef"), {}),
		tm: parseJsonOr(value("Tm", "tm"), inactiveResource()),
		tb: parseJsonOr(value("Tb", "tb"), inactiveResource()),
		editingState: parseJsonOr(value("EditingState", "editingState"), {}),
	};
}

function parseOptionalVersion(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const version = Number(value);
	return Number.isNaN(version) ? Number.NaN : version;
}

function extractConceptEntry(record: Element): TbData["entries"][number] {
	const terms: TbData["entries"][number]["terms"] = [];
	for (const language of Array.from(record.getElementsByTagName("langSec"))) {
		const lang = normalizeLang(language.getAttribute("xml:lang") ?? "");
		for (const section of Array.from(
			language.getElementsByTagName("termSec"),
		)) {
			const term =
				section.getElementsByTagName("term")[0]?.textContent?.trim() ??
				section.getElementsByTagName("termNote")[0]?.textContent?.trim() ??
				"";
			const notes = [
				...Array.from(section.getElementsByTagName("note")).map((note) => ({
					type: "",
					text: note.textContent?.trim() ?? "",
				})),
				...Array.from(section.getElementsByTagName("termNote")).map((note) => ({
					type: note.getAttribute("type") ?? "",
					text: note.textContent?.trim() ?? "",
				})),
			];
			terms.push({ lang, term, notes });
		}
	}
	return { terms };
}

function extractTermEntry(record: Element): TbData["entries"][number] {
	const terms: TbData["entries"][number]["terms"] = [];
	for (const language of Array.from(record.getElementsByTagName("langSet"))) {
		const lang = normalizeLang(language.getAttribute("xml:lang") ?? "");
		const languageNotes = Array.from(
			language.getElementsByTagName("descrip"),
		).map((note) => ({
			type: note.getAttribute("type") ?? "",
			text: note.textContent?.trim() ?? "",
		}));
		const groups = [
			...Array.from(language.getElementsByTagName("tig")),
			...Array.from(language.getElementsByTagName("ntig")),
		];
		if (groups.length === 0) {
			for (const term of Array.from(language.getElementsByTagName("term")))
				terms.push({
					lang,
					term: term.textContent?.trim() ?? "",
					notes: languageNotes,
				});
			continue;
		}
		for (const group of groups) {
			const notes = [
				...languageNotes,
				...Array.from(group.getElementsByTagName("termNote")).map((note) => ({
					type: note.getAttribute("type") ?? "",
					text: note.textContent?.trim() ?? "",
				})),
				...Array.from(group.getElementsByTagName("note")).map((note) => ({
					type: "",
					text: note.textContent?.trim() ?? "",
				})),
			];
			terms.push({
				lang,
				term: group.getElementsByTagName("term")[0]?.textContent?.trim() ?? "",
				notes,
			});
		}
	}
	return { terms };
}

function parseStartElement(
	header: string,
	localName: string,
	namespaces: string,
): Element | undefined {
	const match = header.match(
		new RegExp(
			`<(?:[\\w.-]+:)?${escapeRegExp(localName)}(?=[\\s/>])[^>]*>`,
			"i",
		),
	)?.[0];
	if (!match) return undefined;
	const selfClosing = match.replace(/\s*\/?\s*>$/, "/>");
	return parseXmlRecord(selfClosing, namespaces);
}

function findClosedElement(
	text: string,
	localName: string,
): string | undefined {
	const escaped = escapeRegExp(localName);
	return text.match(
		new RegExp(
			`<((?:[\\w.-]+:)?${escaped})(?=[\\s>])[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
			"i",
		),
	)?.[0];
}

function findClosedElements(text: string, localName: string): string[] {
	const escaped = escapeRegExp(localName);
	return Array.from(
		text.matchAll(
			new RegExp(
				`<((?:[\\w.-]+:)?${escaped})(?=[\\s>])[^>]*>[\\s\\S]*?<\\/\\1\\s*>`,
				"gi",
			),
		),
		(match) => match[0],
	);
}

function parseJsonOr<T>(value: string | undefined, fallback: T): T {
	if (!value) return fallback;
	try {
		return parseSafeJson<T>(value);
	} catch {
		return fallback;
	}
}

function inactiveResource() {
	return { id: null, name: null, active: false };
}

function normalizeLang(value: string): string {
	return value.split("-")[0].toLowerCase();
}

function normalizeType(value: string): Type {
	return FORMAT_IDS.includes(value as Type) ? (value as Type) : "text";
}

function fileNameWithoutExtension(fileName: string): string {
	const leaf = fileName.replaceAll("\\", "/").split("/").at(-1) ?? fileName;
	const dot = leaf.lastIndexOf(".");
	return dot > 0 ? leaf.slice(0, dot) : leaf || "Translation";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
