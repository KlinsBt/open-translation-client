import type { Type, UserData } from "$lib/types/types";
import {
	NEUTRAL_DOCUMENT_VERSION,
	contentToPlainText,
	createNeutralDocument,
	createTextContent,
	type ContentFragment,
	type NeutralDocument,
	type SegmentContent,
	type TranslationState,
	type TranslationUnit,
} from "./documentModel";
import { migrateProjectData } from "./persistenceMigrations";
import { SafeInputError, safeParseXml } from "./safeInput";
import { parseXmlRecord } from "./streaming";
import { assertVendorXliffExportAllowed } from "./xliffProfiles";

export const XLIFF_2_NAMESPACE = "urn:oasis:names:tc:xliff:document:2.0";
export const XLIFF_20_SCHEMA =
	"https://docs.oasis-open.org/xliff/xliff-core/v2.0/os/schemas/xliff_core_2.0.xsd";
export const XLIFF_21_SCHEMA =
	"https://docs.oasis-open.org/xliff/xliff-core/v2.1/os/schemas/xliff_core_2.0.xsd";
export const XLIFF_2_SCHEMA = XLIFF_21_SCHEMA;
export const XLIFF_METADATA_NAMESPACE = "urn:oasis:names:tc:xliff:metadata:2.0";
const STREAM_NAMESPACE = "urn:opentlc:stream";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";
const XSI_NAMESPACE = "http://www.w3.org/2001/XMLSchema-instance";

export type Xliff2Version = "2.0" | "2.1";

export interface Xliff2DocumentMetadata {
	kind: "xliff-2";
	version: Xliff2Version;
	skeletonXml: string;
}

export interface Xliff2GroupMetadata {
	key: string;
	attributes: Record<string, string>;
}

export interface Xliff2UnitMetadata {
	kind: "xliff-2-unit";
	recordIndex: number;
	fileIndex: number;
	unitId: string;
	unitAttributes: Record<string, string>;
	groupPath: Xliff2GroupMetadata[];
	segmentIndex: number;
	segmentKind: "segment" | "ignorable";
	segmentAttributes: Record<string, string>;
	sourceAttributes: Record<string, string>;
	targetAttributes: Record<string, string>;
	hadTarget: boolean;
	notesXml?: string;
	originalDataXml?: string;
	extensions: string[];
}

export interface ParsedXliff2Record {
	recordIndex: number;
	id: string;
	attributes: Record<string, string>;
	notesXml?: string;
	notes: TranslationUnit["notes"];
	originalDataXml?: string;
	extensions: string[];
	segments: Array<{
		kind: "segment" | "ignorable";
		attributes: Record<string, string>;
		sourceAttributes: Record<string, string>;
		targetAttributes: Record<string, string>;
		hadTarget: boolean;
		source: SegmentContent;
		target: SegmentContent;
	}>;
}

export interface Xliff2ValidationResult {
	valid: boolean;
	issues: string[];
}

export function parseXliff2Record(
	recordXml: string,
	recordIndex: number,
	namespaceDeclarations = "",
): ParsedXliff2Record {
	const unit = parseXmlRecord(recordXml, namespaceDeclarations);
	if (localName(unit) !== "unit" || unit.namespaceURI !== XLIFF_2_NAMESPACE)
		throw malformed("An XLIFF 2.x record must be a core <unit> element.");
	const id = unit.getAttribute("id")?.trim() ?? "";
	if (!id) throw malformed("Each XLIFF 2.x unit needs a non-empty id.");

	const notesElement = directChild(unit, "notes");
	const originalData = directChild(unit, "originalData");
	const dataIds = new Set<string>();
	for (const data of originalData ? directChildren(originalData, "data") : []) {
		const dataId = data.getAttribute("id")?.trim() ?? "";
		if (!dataId || dataIds.has(dataId))
			throw malformed(
				`Original data in XLIFF unit “${id}” needs unique non-empty data ids.`,
			);
		dataIds.add(dataId);
	}

	const segmentElements = directElementChildren(unit).filter(
		(child) =>
			child.namespaceURI === XLIFF_2_NAMESPACE &&
			(localName(child) === "segment" || localName(child) === "ignorable"),
	);
	if (segmentElements.length === 0)
		throw malformed(`XLIFF unit “${id}” has no segment or ignorable element.`);
	const segmentIds = new Set<string>();
	const segments = segmentElements.map((segment, segmentIndex) => {
		const kind = localName(segment) as "segment" | "ignorable";
		const segmentId = segment.getAttribute("id")?.trim();
		if (segmentId && segmentIds.has(segmentId))
			throw malformed(`XLIFF unit “${id}” repeats segment id “${segmentId}”.`);
		if (segmentId) segmentIds.add(segmentId);
		const source = directChild(segment, "source");
		if (!source)
			throw malformed(
				`XLIFF unit “${id}” ${kind} ${segmentIndex + 1} has no source.`,
			);
		if (directChildren(segment, "source").length !== 1)
			throw malformed(
				`XLIFF unit “${id}” ${kind} ${segmentIndex + 1} must have one source.`,
			);
		if (directChildren(segment, "target").length > 1)
			throw malformed(
				`XLIFF unit “${id}” ${kind} ${segmentIndex + 1} has multiple targets.`,
			);
		const target = directChild(segment, "target");
		validateInlineContent(source, id, dataIds);
		if (target) validateInlineContent(target, id, dataIds);
		const order = target?.getAttribute("order");
		if (
			target?.hasAttribute("order") &&
			(!order || !/^\d+$/.test(order) || Number(order) < 1)
		)
			throw malformed(`Target order in XLIFF unit “${id}” must be positive.`);
		return {
			kind,
			attributes: attributesOf(segment),
			sourceAttributes: attributesOf(source),
			targetAttributes: target ? attributesOf(target) : {},
			hadTarget: Boolean(target),
			source: parseInlineContent(source),
			target: target ? parseInlineContent(target) : createTextContent(""),
		};
	});

	const notes = notesElement
		? directChildren(notesElement, "note").map((note) => ({
				...(note.getAttribute("id") ? { id: note.getAttribute("id")! } : {}),
				...(note.getAttribute("category")
					? { category: note.getAttribute("category")! }
					: {}),
				text: note.textContent ?? "",
				appliesTo:
					note.getAttribute("appliesTo") === "source" ||
					note.getAttribute("appliesTo") === "target"
						? (note.getAttribute("appliesTo") as "source" | "target")
						: ("unit" as const),
				...(positiveInteger(note.getAttribute("priority"))
					? { priority: positiveInteger(note.getAttribute("priority")) }
					: {}),
			}))
		: [];
	const extensions = directElementChildren(unit)
		.filter((child) => child.namespaceURI !== XLIFF_2_NAMESPACE)
		.map(serializeNode);
	return {
		recordIndex,
		id,
		attributes: attributesOf(unit),
		...(notesElement ? { notesXml: serializeNode(notesElement) } : {}),
		notes,
		...(originalData ? { originalDataXml: serializeNode(originalData) } : {}),
		extensions,
		segments,
	};
}

export function assembleXliff2Document(options: {
	skeletonXml: string;
	records: ParsedXliff2Record[];
	format: Type;
	documentId: string;
}): NeutralDocument {
	const skeleton = safeParseXml(options.skeletonXml);
	const root = skeleton.documentElement;
	const version = root.getAttribute("version");
	if (
		localName(root) !== "xliff" ||
		root.namespaceURI !== XLIFF_2_NAMESPACE ||
		(version !== "2.0" && version !== "2.1")
	)
		throw malformed(
			'XLIFF 2.x requires the official core namespace and version="2.0" or "2.1".',
		);
	const srcLang = root.getAttribute("srcLang")?.trim() ?? "";
	if (!srcLang) throw malformed("XLIFF 2.x requires srcLang on the root.");
	const trgLang = root.getAttribute("trgLang")?.trim() ?? "";
	const files = directChildren(root, "file");
	if (files.length === 0) throw malformed("XLIFF 2.x needs at least one file.");
	const fileIds = new Set<string>();
	for (const file of files) {
		const id = file.getAttribute("id")?.trim() ?? "";
		if (!id || fileIds.has(id))
			throw malformed("XLIFF 2.x files need unique non-empty ids.");
		fileIds.add(id);
	}

	const recordByIndex = new Map(
		options.records.map((record) => [record.recordIndex, record]),
	);
	const seenRecords = new Set<number>();
	const usedUnitIds = new Set<string>();
	const unitIdsByFile = files.map(() => new Set<string>());
	const units: TranslationUnit[] = [];
	for (const placeholder of allElements(root).filter(
		(element) =>
			element.namespaceURI === STREAM_NAMESPACE &&
			localName(element) === "opentlc-stream-record",
	)) {
		const recordIndex = Number(placeholder.getAttribute("index"));
		const record = recordByIndex.get(recordIndex);
		if (!record)
			throw malformed(`XLIFF unit placeholder ${recordIndex} is unresolved.`);
		seenRecords.add(recordIndex);
		const file = closestAncestor(placeholder, "file");
		if (!file)
			throw malformed(`XLIFF unit “${record.id}” is outside a file element.`);
		const fileIndex = files.indexOf(file);
		if (unitIdsByFile[fileIndex].has(record.id))
			throw malformed(
				`XLIFF file ${fileIndex + 1} repeats unit id “${record.id}”.`,
			);
		unitIdsByFile[fileIndex].add(record.id);
		const groupPath = ancestorGroups(placeholder, file).map(inspectGroup);
		const translatable =
			(record.attributes.translate ??
				inheritedYesNo(placeholder, "translate")) !== "no";
		for (const [segmentIndex, segment] of record.segments.entries()) {
			const segmentId = segment.attributes.id || String(segmentIndex + 1);
			const requestedId =
				record.segments.length === 1 ? record.id : `${record.id}:${segmentId}`;
			const unitId = uniqueUnitId(
				files.length === 1 ? requestedId : `${fileIndex + 1}:${requestedId}`,
				usedUnitIds,
			);
			const metadata: Xliff2UnitMetadata = {
				kind: "xliff-2-unit",
				recordIndex,
				fileIndex,
				unitId: record.id,
				unitAttributes: record.attributes,
				groupPath,
				segmentIndex,
				segmentKind: segment.kind,
				segmentAttributes: segment.attributes,
				sourceAttributes: segment.sourceAttributes,
				targetAttributes: segment.targetAttributes,
				hadTarget: segment.hadTarget,
				...(record.notesXml ? { notesXml: record.notesXml } : {}),
				...(record.originalDataXml
					? { originalDataXml: record.originalDataXml }
					: {}),
				extensions: record.extensions,
			};
			units.push({
				id: unitId,
				source: withContentProperties(
					segment.source,
					segment.sourceAttributes,
					srcLang,
				),
				target: withContentProperties(
					segment.target,
					segment.targetAttributes,
					trgLang,
				),
				state:
					segment.kind === "ignorable"
						? "initial"
						: stateFromXliff(segment.attributes.state),
				translatable: segment.kind === "segment" && translatable,
				contexts: [],
				notes: record.notes,
				sourceLocation: {
					part: file.getAttribute("original") ?? undefined,
					path: groupPath.map((group) => group.attributes.id ?? group.key),
					segmentIndex,
				},
				metadata: { xliff2: metadata },
			});
		}
	}
	if (seenRecords.size !== options.records.length)
		throw malformed(
			"One or more XLIFF 2.x units could not be placed in a file.",
		);
	return {
		schemaVersion: NEUTRAL_DOCUMENT_VERSION,
		id: options.documentId || `xliff-${version}`,
		format: options.format,
		sourceLanguage: srcLang,
		...(trgLang ? { targetLanguage: trgLang } : {}),
		units,
		metadata: {
			xliff2: {
				kind: "xliff-2",
				version,
				skeletonXml: options.skeletonXml,
			} satisfies Xliff2DocumentMetadata,
		},
	};
}

export function contentToEditableText(content: SegmentContent): string {
	return content.fragments
		.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
		.join("");
}

export function buildXliff2(
	userData: UserData,
	version: Xliff2Version,
): string {
	const versionedData = migrateProjectData(userData);
	const data = versionedData.translationData;
	assertVendorXliffExportAllowed(data.documentModel);
	const baseDocument =
		data.documentModel && data.documentModel.units.length === data.seg1.length
			? data.documentModel
			: createNeutralDocument({
					format: data.type,
					documentId: `project-${versionedData.id ?? "translation"}`,
					sourceSegments: data.seg1,
					targetSegments: data.seg2,
					checked: data.checked,
					sourceLanguage: data.sourceLang,
					targetLanguage: data.targetLang,
				});
	const units = baseDocument.units.map((unit, index) => ({
		...unit,
		source: overlayPlainText(unit.source, data.seg1[index] ?? ""),
		target: overlayPlainText(unit.target, data.seg2[index] ?? ""),
		state: updatedState(
			unit.state,
			data.seg2[index] ?? "",
			data.checked[index],
		),
	}));
	const metadata = getDocumentMetadata(baseDocument);
	let body: string;
	if (metadata) {
		const records = groupUnitsIntoRecords(units);
		body = metadata.skeletonXml;
		for (const record of records) {
			const placeholder = new RegExp(
				`<opentlc-stream-record\\s+xmlns=["']${escapeRegExp(STREAM_NAMESPACE)}["']\\s+index=["']${record.order}["']\\s*/>`,
			);
			if (!placeholder.test(body))
				throw new Error(`XLIFF unit placeholder ${record.order} is missing.`);
			body = body.replace(placeholder, renderRecord(record));
		}
		if (/<opentlc-stream-record\b/.test(body))
			throw new Error("The XLIFF document model does not contain every unit.");
	} else {
		const fileId = safeNmtoken(String(versionedData.id ?? "file-1"), "file-1");
		const unitXml = units
			.map((unit, index) => renderNewRecord(unit, index))
			.join("");
		body = `<xliff xmlns="${XLIFF_2_NAMESPACE}" version="${version}" srcLang="${escapeXmlAttribute(data.sourceLang || "und")}"${data.targetLang ? ` trgLang="${escapeXmlAttribute(data.targetLang)}"` : ""}><file id="${escapeXmlAttribute(fileId)}" original="${escapeXmlAttribute(data.name || "translation")}">${unitXml}</file></xliff>`;
	}
	return finalizeDocument(body, versionedData, version);
}

export function validateXliff2Xml(xml: string): Xliff2ValidationResult {
	const issues: string[] = [];
	let document: Document;
	try {
		document = safeParseXml(xml);
	} catch (error) {
		return {
			valid: false,
			issues: [error instanceof Error ? error.message : "Malformed XML."],
		};
	}
	const root = document.documentElement;
	if (localName(root) !== "xliff") issues.push("The root must be xliff.");
	if (root.namespaceURI !== XLIFF_2_NAMESPACE)
		issues.push("The root must use the XLIFF 2.0 core namespace.");
	if (
		root.getAttribute("version") !== "2.0" &&
		root.getAttribute("version") !== "2.1"
	)
		issues.push('The root version must be "2.0" or "2.1".');
	if (!root.getAttribute("srcLang"))
		issues.push("The root is missing srcLang.");
	const files = directChildren(root, "file");
	if (files.length === 0) issues.push("At least one file is required.");
	const fileIds = new Set<string>();
	for (const [fileIndex, file] of files.entries()) {
		const fileId = file.getAttribute("id")?.trim() ?? "";
		if (!fileId) issues.push(`File ${fileIndex + 1} is missing id.`);
		else if (fileIds.has(fileId))
			issues.push(`The file id “${fileId}” is duplicated.`);
		fileIds.add(fileId);
		if (
			directElementChildren(file).every(
				(child) =>
					child.namespaceURI !== XLIFF_2_NAMESPACE ||
					(localName(child) !== "unit" && localName(child) !== "group"),
			)
		)
			issues.push(`File ${fileIndex + 1} has no unit or group.`);
		const units = allElements(file).filter(
			(element) =>
				element.namespaceURI === XLIFF_2_NAMESPACE &&
				localName(element) === "unit",
		);
		const unitIds = new Set<string>();
		for (const unit of units) {
			const unitId = unit.getAttribute("id")?.trim() ?? "";
			if (unitId && unitIds.has(unitId))
				issues.push(`File ${fileIndex + 1} repeats unit id “${unitId}”.`);
			unitIds.add(unitId);
			try {
				parseXliff2Record(serializeNode(unit), 0);
			} catch (error) {
				issues.push(
					error instanceof Error ? error.message : "Invalid XLIFF unit.",
				);
			}
		}
	}
	return { valid: issues.length === 0, issues };
}

function parseInlineContent(element: Element): SegmentContent {
	const fragments: ContentFragment[] = [];
	let sequence = 0;
	const pushText = (text: string) => {
		const previous = fragments.at(-1);
		if (previous?.kind === "text") previous.text += text;
		else fragments.push({ kind: "text", text });
	};
	const walk = (parent: Element) => {
		for (const node of Array.from(parent.childNodes)) {
			if (node.nodeType === 3 || node.nodeType === 4) {
				pushText(node.nodeValue ?? "");
				continue;
			}
			if (node.nodeType !== 1) continue;
			const child = node as Element;
			const name = localName(child);
			sequence++;
			const id =
				child.getAttribute("id") ??
				child.getAttribute("startRef") ??
				`${name}-${sequence}`;
			const xml = serializeNode(child);
			if (name === "pc" || name === "mrk") {
				const pairId = `${name}:${id}:${sequence}`;
				fragments.push(
					codeFragment(child, `${id}:start`, "start", pairId, openingTag(xml)),
				);
				walk(child);
				fragments.push(
					codeFragment(
						child,
						`${id}:end`,
						"end",
						pairId,
						`</${child.tagName}>`,
					),
				);
				continue;
			}
			const isolated = child.getAttribute("isolated") === "yes";
			const codeType =
				(name === "sc" || name === "sm") && !isolated
					? "start"
					: (name === "ec" || name === "em") && !isolated
						? "end"
						: "standalone";
			const pairId =
				codeType === "start"
					? id
					: codeType === "end"
						? (child.getAttribute("startRef") ?? id)
						: undefined;
			fragments.push(
				codeFragment(child, `${name}:${id}:${sequence}`, codeType, pairId, xml),
			);
		}
	};
	walk(element);
	return {
		fragments,
		...(xmlLanguage(element) ? { language: xmlLanguage(element) } : {}),
		preserveWhitespace: inheritedXmlSpace(element) === "preserve",
	};
}

function codeFragment(
	element: Element,
	id: string,
	codeType: "standalone" | "start" | "end",
	pairId: string | undefined,
	originalData: string,
): ContentFragment {
	return {
		kind: "code",
		id,
		codeType,
		...(pairId ? { pairId } : {}),
		originalData,
		displayText:
			element.getAttribute("disp") ??
			element.getAttribute("equiv") ??
			element.getAttribute("type") ??
			localName(element),
		canCopy: element.getAttribute("canCopy") !== "no",
		canDelete: element.getAttribute("canDelete") !== "no",
		canReorder: element.getAttribute("canReorder") !== "no",
	};
}

function validateInlineContent(
	container: Element,
	unitId: string,
	dataIds: Set<string>,
): void {
	const startCodes = new Set<string>();
	const startMarkers = new Set<string>();
	for (const child of allElements(container)) {
		if (child.namespaceURI !== XLIFF_2_NAMESPACE) continue;
		const name = localName(child);
		if (
			["ph", "pc", "sc", "mrk", "sm"].includes(name) &&
			!child.getAttribute("id")
		)
			throw malformed(`Inline ${name} in XLIFF unit “${unitId}” needs id.`);
		for (const attribute of ["dataRef", "dataRefStart", "dataRefEnd"]) {
			const reference = child.getAttribute(attribute);
			if (reference && !dataIds.has(reference))
				throw malformed(
					`Inline ${name} in XLIFF unit “${unitId}” references missing original data “${reference}”.`,
				);
		}
		if (name === "sc" && child.getAttribute("isolated") !== "yes")
			startCodes.add(child.getAttribute("id") ?? "");
		if (name === "ec" && child.getAttribute("isolated") !== "yes") {
			const reference = child.getAttribute("startRef") ?? "";
			if (!reference || !startCodes.has(reference))
				throw malformed(
					`Inline ec in XLIFF unit “${unitId}” must reference an earlier sc.`,
				);
			startCodes.delete(reference);
		}
		if (name === "sm") startMarkers.add(child.getAttribute("id") ?? "");
		if (name === "em") {
			const reference = child.getAttribute("startRef") ?? "";
			if (!reference || !startMarkers.has(reference))
				throw malformed(
					`Inline em in XLIFF unit “${unitId}” must reference an earlier sm.`,
				);
			startMarkers.delete(reference);
		}
	}
	if (startCodes.size > 0 || startMarkers.size > 0)
		throw malformed(`Inline pairs in XLIFF unit “${unitId}” are unbalanced.`);
}

interface RenderRecord {
	order: number;
	units: TranslationUnit[];
}

function groupUnitsIntoRecords(units: TranslationUnit[]): RenderRecord[] {
	const records = new Map<string, RenderRecord>();
	for (const [index, unit] of units.entries()) {
		const metadata = getUnitMetadata(unit);
		const key = metadata ? `record:${metadata.recordIndex}` : `unit:${index}`;
		const record = records.get(key) ?? {
			order: metadata?.recordIndex ?? index,
			units: [],
		};
		record.units.push(unit);
		records.set(key, record);
	}
	return [...records.values()].sort((left, right) => left.order - right.order);
}

function renderRecord(record: RenderRecord): string {
	const first = record.units[0];
	const metadata = getUnitMetadata(first);
	if (!metadata) return renderNewRecord(first, record.order);
	const attributes = {
		...metadata.unitAttributes,
		id: metadata.unitId,
		...(metadata.unitAttributes.translate || !first.translatable
			? { translate: first.translatable ? "yes" : "no" }
			: {}),
	};
	const children: string[] = [...metadata.extensions];
	if (metadata.notesXml) children.push(renderNotes(first, metadata.notesXml));
	if (metadata.originalDataXml) children.push(metadata.originalDataXml);
	for (const unit of record.units) children.push(renderSegment(unit));
	return `<unit${renderAttributes(attributes)}>${children.join("")}</unit>`;
}

function renderSegment(unit: TranslationUnit): string {
	const metadata = getUnitMetadata(unit);
	if (!metadata) return renderNewRecord(unit, 0);
	const kind = metadata.segmentKind;
	const attributes = {
		...metadata.segmentAttributes,
		...(kind === "segment" ? { state: stateToXliff(unit.state) } : {}),
	};
	const targetText = contentToEditableText(unit.target);
	const includeTarget = metadata.hadTarget || targetText.length > 0;
	return `<${kind}${renderAttributes(attributes)}><source${renderAttributes(metadata.sourceAttributes)}>${renderContent(unit.source)}</source>${includeTarget ? `<target${renderAttributes(metadata.targetAttributes)}>${renderContent(unit.target)}</target>` : ""}</${kind}>`;
}

function renderNewRecord(unit: TranslationUnit, index: number): string {
	const unitId = safeNmtoken(unit.id, `u${index + 1}`);
	return `<unit id="${escapeXmlAttribute(unitId)}"${unit.translatable ? "" : ' translate="no"'}><segment id="s1" state="${stateToXliff(unit.state)}"><source>${renderContent(unit.source)}</source><target>${renderContent(unit.target)}</target></segment></unit>`;
}

function renderNotes(unit: TranslationUnit, original: string): string {
	if (unit.notes.length === 0) return original;
	return `<notes>${unit.notes
		.map((note) => {
			const attributes = {
				...(note.id ? { id: note.id } : {}),
				...(note.appliesTo && note.appliesTo !== "unit"
					? { appliesTo: note.appliesTo }
					: {}),
				...(note.category ? { category: note.category } : {}),
				...(note.priority ? { priority: String(note.priority) } : {}),
			};
			return `<note${renderAttributes(attributes)}>${escapeXml(note.text)}</note>`;
		})
		.join("")}</notes>`;
}

function finalizeDocument(
	xml: string,
	userData: UserData,
	version: Xliff2Version,
): string {
	const document = safeParseXml(xml.replace(/^\s*<\?xml[^?]*\?>\s*/i, ""));
	const root = document.documentElement;
	root.setAttribute("version", version);
	root.setAttribute("srcLang", userData.translationData.sourceLang || "und");
	if (userData.translationData.targetLang)
		root.setAttribute("trgLang", userData.translationData.targetLang);
	else root.removeAttribute("trgLang");
	root.setAttributeNS(XMLNS_NAMESPACE, "xmlns:xsi", XSI_NAMESPACE);
	root.setAttributeNS(XMLNS_NAMESPACE, "xmlns:mda", XLIFF_METADATA_NAMESPACE);
	root.setAttributeNS(
		XSI_NAMESPACE,
		"xsi:schemaLocation",
		mergeSchemaLocation(
			root.getAttributeNS(XSI_NAMESPACE, "schemaLocation"),
			version,
		),
	);
	const firstFile = directChildren(root, "file")[0];
	if (!firstFile) throw new Error("XLIFF export requires a file element.");
	for (const group of allElements(firstFile).filter(
		(element) =>
			element.namespaceURI === XLIFF_METADATA_NAMESPACE &&
			localName(element) === "metaGroup" &&
			element.getAttribute("category") === "open_tlc_metadata",
	))
		group.remove();
	let metadata = directElementChildren(firstFile).find(
		(element) =>
			element.namespaceURI === XLIFF_METADATA_NAMESPACE &&
			localName(element) === "metadata",
	);
	if (!metadata) {
		metadata = document.createElementNS(
			XLIFF_METADATA_NAMESPACE,
			"mda:metadata",
		);
		const firstCoreChild = directElementChildren(firstFile).find(
			(element) => element.namespaceURI === XLIFF_2_NAMESPACE,
		);
		firstFile.insertBefore(metadata, firstCoreChild ?? null);
	}
	metadata.appendChild(createOpenTlcMetadata(document, userData));
	return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(document)}\n`;
}

function createOpenTlcMetadata(
	document: Document,
	userData: UserData,
): Element {
	const data = userData.translationData;
	const values: Record<string, unknown> = {
		schema_version: userData.schemaVersion ?? 1,
		name: data.name,
		checked: data.checked,
		type: data.type,
		type_ref: data.typeRef,
		tm: data.tm,
		tb: data.tb,
		editing_state: {
			segmentsMeta: data.segmentsMeta,
			segmentJoinStates: data.segmentJoinStates,
			parsingTokens: data.parsingTokens,
			...(data.documentModel && !getDocumentMetadata(data.documentModel)
				? { documentModel: data.documentModel }
				: {}),
			skeleton: data.skeleton,
			filterOptions: data.filterOptions,
		},
	};
	const group = document.createElementNS(
		XLIFF_METADATA_NAMESPACE,
		"mda:metaGroup",
	);
	group.setAttribute("category", "open_tlc_metadata");
	for (const [type, value] of Object.entries(values)) {
		const meta = document.createElementNS(XLIFF_METADATA_NAMESPACE, "mda:meta");
		meta.setAttribute("type", type);
		meta.textContent =
			type === "name" || type === "type" || type === "schema_version"
				? String(value)
				: JSON.stringify(value);
		group.appendChild(meta);
	}
	return group;
}

function overlayPlainText(
	content: SegmentContent,
	text: string,
): SegmentContent {
	const plain = contentToPlainText(content);
	if (
		plain === text ||
		(plain === undefined && contentToEditableText(content) === text)
	)
		return content;
	if (plain !== undefined)
		return createTextContent(
			text,
			content.language,
			content.preserveWhitespace,
		);
	const indexes = content.fragments.flatMap((fragment, index) =>
		fragment.kind === "text" ? [index] : [],
	);
	if (indexes.length === 0) return content;
	const oldLength = indexes.reduce((total, index) => {
		const fragment = content.fragments[index];
		return total + (fragment.kind === "text" ? fragment.text.length : 0);
	}, 0);
	let oldOffset = 0;
	let newOffset = 0;
	const fragments = content.fragments.map((fragment) => ({ ...fragment }));
	for (const [position, index] of indexes.entries()) {
		const fragment = content.fragments[index];
		if (fragment.kind !== "text") continue;
		oldOffset += fragment.text.length;
		const end =
			position === indexes.length - 1 || oldLength === 0
				? text.length
				: nearestBoundary(
						text,
						Math.round((oldOffset / oldLength) * text.length),
						newOffset,
					);
		fragments[index] = { kind: "text", text: text.slice(newOffset, end) };
		newOffset = end;
	}
	return { ...content, fragments };
}

function nearestBoundary(
	text: string,
	preferred: number,
	minimum: number,
): number {
	let best = Math.max(minimum, Math.min(text.length, preferred));
	let distance = Number.POSITIVE_INFINITY;
	for (let index = minimum; index <= text.length; index++) {
		if (
			index !== minimum &&
			index !== text.length &&
			!(/\s/u.test(text[index - 1] ?? "") || /\s/u.test(text[index] ?? ""))
		)
			continue;
		const nextDistance = Math.abs(index - preferred);
		if (nextDistance < distance) {
			best = index;
			distance = nextDistance;
		}
	}
	return best;
}

function renderContent(content: SegmentContent): string {
	return content.fragments
		.map((fragment) =>
			fragment.kind === "text"
				? escapeXml(fragment.text)
				: fragment.originalData ||
					`<ph id="${escapeXmlAttribute(fragment.id)}"/>`,
		)
		.join("");
}

function updatedState(
	state: TranslationState,
	target: string,
	checked: boolean | undefined,
): TranslationState {
	if (checked && state !== "final") return "reviewed";
	if (!checked && state === "reviewed")
		return target ? "translated" : "initial";
	if (target && state === "initial") return "translated";
	return state;
}

function stateFromXliff(state: string | undefined): TranslationState {
	return state === "translated" || state === "reviewed" || state === "final"
		? state
		: "initial";
}

function stateToXliff(
	state: TranslationState,
): "initial" | "translated" | "reviewed" | "final" {
	if (state === "needs-review") return "translated";
	return state;
}

function getDocumentMetadata(
	document: NeutralDocument,
): Xliff2DocumentMetadata | undefined {
	const value = document.metadata?.xliff2 as Xliff2DocumentMetadata | undefined;
	return value?.kind === "xliff-2" ? value : undefined;
}

function getUnitMetadata(
	unit: TranslationUnit,
): Xliff2UnitMetadata | undefined {
	const value = unit.metadata?.xliff2 as Xliff2UnitMetadata | undefined;
	return value?.kind === "xliff-2-unit" ? value : undefined;
}

function inspectGroup(group: Element, index = 0): Xliff2GroupMetadata {
	const attributes = attributesOf(group);
	const siblingIndex = directElementChildren(parentElementOf(group) ?? group)
		.filter((element) => localName(element) === "group")
		.indexOf(group);
	return {
		key: `${attributes.id ?? "group"}-${siblingIndex >= 0 ? siblingIndex : index}`,
		attributes,
	};
}

function withContentProperties(
	content: SegmentContent,
	attributes: Record<string, string>,
	language: string,
): SegmentContent {
	return {
		...content,
		...(attributes["xml:lang"] || language
			? { language: attributes["xml:lang"] || language }
			: {}),
		preserveWhitespace:
			attributes["xml:space"] === "preserve" || content.preserveWhitespace,
	};
}

function inheritedYesNo(
	element: Element,
	attribute: string,
): string | undefined {
	let current: Element | null = parentElementOf(element);
	while (current) {
		const value = current.getAttribute(attribute);
		if (value) return value;
		current = parentElementOf(current);
	}
	return undefined;
}

function attributesOf(element: Element): Record<string, string> {
	return Object.fromEntries(
		Array.from(element.attributes).map((attribute) => [
			attribute.name,
			attribute.value,
		]),
	);
}

function renderAttributes(
	attributes: Record<string, string | undefined>,
): string {
	return Object.entries(attributes)
		.filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined && entry[1] !== "",
		)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
		.join("");
}

function mergeSchemaLocation(
	existing: string | null,
	version: Xliff2Version,
): string {
	const values = (existing ?? "").trim().split(/\s+/).filter(Boolean);
	const pairs = new Map<string, string>();
	for (let index = 0; index + 1 < values.length; index += 2)
		pairs.set(values[index], values[index + 1]);
	pairs.set(
		XLIFF_2_NAMESPACE,
		version === "2.0" ? XLIFF_20_SCHEMA : XLIFF_21_SCHEMA,
	);
	return Array.from(
		pairs,
		([namespace, location]) => `${namespace} ${location}`,
	).join(" ");
}

function directElementChildren(element: Element): Element[] {
	return Array.from(element.childNodes).filter(
		(node): node is Element => node.nodeType === 1,
	);
}

function directChildren(element: Element, name: string): Element[] {
	return directElementChildren(element).filter(
		(child) =>
			child.namespaceURI === XLIFF_2_NAMESPACE && localName(child) === name,
	);
}

function directChild(element: Element, name: string): Element | undefined {
	return directChildren(element, name)[0];
}

function allElements(element: Element): Element[] {
	return Array.from(element.getElementsByTagName("*"));
}

function closestAncestor(element: Element, name: string): Element | undefined {
	let current = parentElementOf(element);
	while (current) {
		if (
			current.namespaceURI === XLIFF_2_NAMESPACE &&
			localName(current) === name
		)
			return current;
		current = parentElementOf(current);
	}
	return undefined;
}

function ancestorGroups(element: Element, stop: Element): Element[] {
	const groups: Element[] = [];
	let current = parentElementOf(element);
	while (current && current !== stop) {
		if (
			current.namespaceURI === XLIFF_2_NAMESPACE &&
			localName(current) === "group"
		)
			groups.unshift(current);
		current = parentElementOf(current);
	}
	return groups;
}

function localName(element: Element): string {
	return element.localName || element.tagName.split(":").at(-1) || "";
}

function xmlLanguage(element: Element): string | undefined {
	return (
		element.getAttribute("xml:lang") ??
		element.getAttributeNS(XML_NAMESPACE, "lang") ??
		undefined
	);
}

function inheritedXmlSpace(element: Element): string | undefined {
	let current: Element | null = element;
	while (current) {
		const value =
			current.getAttribute("xml:space") ??
			current.getAttributeNS(XML_NAMESPACE, "space");
		if (value) return value;
		current = parentElementOf(current);
	}
	return undefined;
}

function parentElementOf(element: Element): Element | null {
	const parent = element.parentNode;
	return parent?.nodeType === 1 ? (parent as Element) : null;
}

function positiveInteger(value: string | null): number | undefined {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : undefined;
}

function uniqueUnitId(requested: string, used: Set<string>): string {
	let candidate = requested;
	let suffix = 2;
	while (!candidate || used.has(candidate))
		candidate = `${requested || "unit"}-${suffix++}`;
	used.add(candidate);
	return candidate;
}

function safeNmtoken(value: string, fallback: string): string {
	const normalized = value.trim().replace(/[^\w.:-]+/gu, "-");
	return normalized || fallback;
}

function serializeNode(node: Node): string {
	return new XMLSerializer().serializeToString(node);
}

function openingTag(xml: string): string {
	const close = xml.indexOf(">");
	return close < 0 ? xml : xml.slice(0, close + 1);
}

function escapeXml(value: string): string {
	return value.replace(/[<>&'"]/g, (character) => {
		switch (character) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			case "'":
				return "&apos;";
			default:
				return "&amp;";
		}
	});
}

function escapeXmlAttribute(value: string): string {
	return escapeXml(value);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function malformed(message: string): SafeInputError {
	return new SafeInputError("XML_MALFORMED", message);
}
