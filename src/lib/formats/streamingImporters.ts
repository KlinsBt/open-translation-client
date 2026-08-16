import type { TbData, TmData, Type, UserData } from "$lib/types/types";
import {
	parseXmlRecord,
	scanXmlRecords,
	type XmlRecordScanResult,
} from "./streaming";
import {
	parseSafeJson,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import {
	assembleXliff12Document,
	contentToEditableText,
	parseXliff12Record,
	type ParsedXliff12Record,
} from "./xliff12";
import {
	migrateProjectData,
	migrateTbData,
	migrateTmData,
} from "./persistenceMigrations";

export interface StreamingImportResult<T> {
	data: T;
	metrics: XmlRecordScanResult;
}

export async function importTmxStreaming(
	file: File,
	context?: SafeInputContext,
): Promise<StreamingImportResult<TmData>> {
	const terms: TmData["terms"] = [];
	const metrics = await scanXmlRecords(
		file,
		{ recordNames: ["tu"], batchSize: 250 },
		(recordXml, _index, namespaces) => {
			const unit = parseXmlRecord(recordXml, namespaces);
			const tuid = unit.getAttribute("tuid");
			if (tuid && Number.isNaN(Number(tuid)))
				throw new SafeInputError(
					"XML_MALFORMED",
					`TMX tuid “${tuid}” is not numeric.`,
				);
			const variants = Array.from(unit.getElementsByTagName("tuv"));
			if (variants.length < 2) return;
			const values = variants.map((variant) => ({
				lang:
					variant.getAttribute("xml:lang") ??
					variant.getAttributeNS(
						"http://www.w3.org/XML/1998/namespace",
						"lang",
					) ??
					"",
				segment: variant.getElementsByTagName("seg")[0]?.textContent ?? "",
			}));
			if (values.some((value) => !value.lang || !value.segment))
				throw new SafeInputError(
					"XML_MALFORMED",
					"Each TMX language variant needs xml:lang and segment text.",
				);
			terms.push({ source: values[0], target: values.slice(1) });
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
	if (!headerXml)
		throw new SafeInputError("XML_MALFORMED", "The TMX header is missing.");
	const header = parseXmlRecord(headerXml, metrics.namespaceDeclarations);
	for (const attribute of [
		"creationtool",
		"creationtoolversion",
		"segtype",
		"o-tmf",
		"adminlang",
		"srclang",
		"datatype",
	]) {
		if (!header.getAttribute(attribute))
			throw new SafeInputError(
				"XML_MALFORMED",
				`The TMX header is missing ${attribute}.`,
			);
	}
	if (terms.length === 0)
		throw new SafeInputError(
			"XML_MALFORMED",
			"The TMX file has no bilingual units.",
		);
	const properties = Array.from(header.getElementsByTagName("prop"));
	const id = Number(
		properties.find((property) => property.getAttribute("type") === "id")
			?.textContent ?? 0,
	);
	const name =
		properties
			.find((property) => property.getAttribute("type") === "name")
			?.textContent?.trim() || "New TM";
	return {
		data: migrateTmData({
			...(Number.isFinite(id) ? { id } : {}),
			name,
			terms,
		}),
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
		{ recordNames: ["conceptEntry", "termEntry"], batchSize: 250 },
		(recordXml, _index, namespaces) => {
			const record = parseXmlRecord(recordXml, namespaces);
			const entry =
				record.localName.toLowerCase() === "conceptentry"
					? extractConceptEntry(record)
					: extractTermEntry(record);
			if (entry.terms.length === 0)
				throw new SafeInputError(
					"XML_MALFORMED",
					"A TBX entry contains no terms.",
				);
			entries.push(entry);
		},
		context,
	);
	const root =
		parseStartElement(metrics.header, "tbx", metrics.namespaceDeclarations) ??
		parseStartElement(metrics.header, "martif", metrics.namespaceDeclarations);
	if (!root)
		throw new SafeInputError(
			"XML_MALFORMED",
			"The TBX root element is missing.",
		);
	if (root.localName.toLowerCase() === "tbx") {
		for (const attribute of ["style", "type", "xml:lang"])
			if (!root.getAttribute(attribute))
				throw new SafeInputError(
					"XML_MALFORMED",
					`The TBX root is missing ${attribute}.`,
				);
	} else if (!root.getAttribute("type") || !root.getAttribute("xml:lang")) {
		throw new SafeInputError(
			"XML_MALFORMED",
			"The martif root needs type and xml:lang attributes.",
		);
	}
	const titleXml = findClosedElement(metrics.header, "title");
	const name = titleXml
		? parseXmlRecord(
				titleXml,
				metrics.namespaceDeclarations,
			).textContent?.trim() || "Untitled TBX File"
		: "Untitled TBX File";
	const sourceDescription = findClosedElement(metrics.header, "sourceDesc");
	const idMatch = sourceDescription?.match(/OpenTLC ID:\s*(\d+)/i);
	return {
		data: migrateTbData({
			...(idMatch ? { id: Number(idMatch[1]) } : {}),
			name,
			entries,
		}),
		metrics,
	};
}

export async function importXliffProjectStreaming(
	file: File,
	context?: SafeInputContext,
): Promise<StreamingImportResult<UserData>> {
	const xliff12Records: ParsedXliff12Record[] = [];
	const xliff2Seg1: string[] = [];
	const xliff2Seg2: string[] = [];
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
			const segments = Array.from(unit.getElementsByTagName("segment"));
			for (const segment of segments) {
				xliff2Seg1.push(
					segment.getElementsByTagName("source")[0]?.textContent ?? "",
				);
				xliff2Seg2.push(
					segment.getElementsByTagName("target")[0]?.textContent ?? "",
				);
			}
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
	const xliff12Document =
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
	const seg1 = xliff12Document
		? xliff12Document.units.map((unit) => contentToEditableText(unit.source))
		: xliff2Seg1;
	const seg2 = xliff12Document
		? xliff12Document.units.map((unit) => contentToEditableText(unit.target))
		: xliff2Seg2;
	const checked =
		state.checked.length === seg1.length
			? state.checked
			: xliff12Document
				? xliff12Document.units.map(
						(unit) => unit.state === "reviewed" || unit.state === "final",
					)
				: seg1.map(() => false);
	const numericId = Number(state.id);
	return {
		data: migrateProjectData({
			...(state.schemaVersion === undefined
				? {}
				: { schemaVersion: state.schemaVersion }),
			...(Number.isFinite(numericId) ? { id: numericId } : {}),
			translationData: {
				name: state.name,
				sourceLang: state.sourceLang,
				targetLang: state.targetLang,
				creationDate: Date.now().toString(),
				seg1,
				seg2,
				checked,
				type: normalizedType,
				typeRef: state.typeRef,
				segmentsMeta: state.editingState.segmentsMeta,
				segmentJoinStates: state.editingState.segmentJoinStates,
				parsingTokens: state.editingState.parsingTokens,
				documentModel: xliff12Document ?? state.editingState.documentModel,
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
	const metadataXml = findClosedElement(metrics.header, "metadata");
	if (metadataXml) {
		const metadata = parseXmlRecord(metadataXml, metrics.namespaceDeclarations);
		for (const meta of Array.from(metadata.getElementsByTagName("mda:meta"))) {
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
	return ["text", "json", "docx", "xlsx", "html"].includes(value)
		? (value as Type)
		: "text";
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
