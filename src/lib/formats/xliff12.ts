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
import { SafeInputError, safeParseXml } from "./safeInput";
import { parseXmlRecord } from "./streaming";
import { assertVendorXliffExportAllowed } from "./xliffProfiles";

export const XLIFF_12_NAMESPACE = "urn:oasis:names:tc:xliff:document:1.2";
export const XLIFF_12_SCHEMA =
	"https://docs.oasis-open.org/xliff/v1.2/cs02/xliff-core-1.2-strict.xsd";
const STREAM_NAMESPACE = "urn:opentlc:stream";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

export interface Xliff12GroupMetadata {
	key: string;
	attributes: Record<string, string>;
	extensions: string[];
}

export interface Xliff12FileMetadata {
	index: number;
	attributes: Record<string, string>;
	headerChildren: string[];
	bodyExtensions: string[];
}

export interface Xliff12DocumentMetadata {
	kind: "xliff-1.2";
	rootAttributes: Record<string, string>;
	rootExtensions: string[];
	files: Xliff12FileMetadata[];
}

export interface Xliff12UnitMetadata {
	kind: "xliff-1.2-unit";
	recordIndex: number;
	fileIndex: number;
	transUnitId: string;
	segmentMid?: string;
	segmentIndex: number;
	attributes: Record<string, string>;
	sourceAttributes: Record<string, string>;
	targetAttributes: Record<string, string>;
	segSourceAttributes?: Record<string, string>;
	segmentSourceAttributes?: Record<string, string>;
	segmentTargetAttributes?: Record<string, string>;
	groupPath: Xliff12GroupMetadata[];
	contextGroups: string[];
	altTrans: string[];
	extensions: string[];
}

export interface ParsedXliff12Record {
	recordIndex: number;
	id: string;
	attributes: Record<string, string>;
	sourceAttributes: Record<string, string>;
	targetAttributes: Record<string, string>;
	segSourceAttributes?: Record<string, string>;
	segments: Array<{
		mid?: string;
		source: SegmentContent;
		target: SegmentContent;
		sourceAttributes?: Record<string, string>;
		targetAttributes?: Record<string, string>;
	}>;
	notes: TranslationUnit["notes"];
	contextGroups: string[];
	contexts: TranslationUnit["contexts"];
	altTrans: string[];
	extensions: string[];
}

export interface Xliff12ValidationResult {
	valid: boolean;
	issues: string[];
}

export function parseXliff12Record(
	recordXml: string,
	recordIndex: number,
	namespaceDeclarations = "",
): ParsedXliff12Record {
	const transUnit = parseXmlRecord(recordXml, namespaceDeclarations);
	if (localName(transUnit) !== "trans-unit")
		throw malformed("An XLIFF 1.2 record must be a <trans-unit> element.");
	if (transUnit.namespaceURI && transUnit.namespaceURI !== XLIFF_12_NAMESPACE)
		throw malformed("The trans-unit uses an unexpected XML namespace.");

	const id = transUnit.getAttribute("id")?.trim() ?? "";
	if (!id) throw malformed("Each XLIFF 1.2 trans-unit needs a non-empty id.");
	const source = directChild(transUnit, "source");
	if (!source)
		throw malformed(`XLIFF trans-unit “${id}” has no source element.`);
	if (directChildren(transUnit, "source").length !== 1)
		throw malformed(`XLIFF trans-unit “${id}” must have exactly one source.`);
	if (directChildren(transUnit, "target").length > 1)
		throw malformed(`XLIFF trans-unit “${id}” has more than one target.`);
	const inlineIssues: string[] = [];
	validateInlineElements(transUnit, id, inlineIssues);
	if (inlineIssues.length > 0) throw malformed(inlineIssues[0]);

	const target = directChild(transUnit, "target");
	const segSource = directChild(transUnit, "seg-source");
	const sourceMarkers = segSource ? segmentMarkers(segSource) : [];
	const targetMarkers = target ? segmentMarkers(target) : [];
	const sourceMids = new Set<string>();
	for (const marker of sourceMarkers) {
		const mid = marker.getAttribute("mid")?.trim() ?? "";
		if (!mid || sourceMids.has(mid))
			throw malformed(
				`Source segment markers in trans-unit “${id}” need unique mid values.`,
			);
		sourceMids.add(mid);
	}
	const targetMids = new Set<string>();
	for (const marker of targetMarkers) {
		const mid = marker.getAttribute("mid")?.trim() ?? "";
		if (!mid || targetMids.has(mid))
			throw malformed(
				`Target segment markers in trans-unit “${id}” need unique mid values.`,
			);
		targetMids.add(mid);
	}
	if ([...targetMids].some((mid) => !sourceMids.has(mid)))
		throw malformed(
			`Target segment markers in trans-unit “${id}” must reference source mid values.`,
		);
	const targetByMid = new Map(
		targetMarkers.map((marker) => [marker.getAttribute("mid") ?? "", marker]),
	);
	const segments =
		sourceMarkers.length > 0
			? sourceMarkers.map((marker, index) => {
					const mid = marker.getAttribute("mid")?.trim();
					if (!mid)
						throw malformed(
							`Segment marker ${index + 1} in trans-unit “${id}” needs mid.`,
						);
					const targetMarker = targetByMid.get(mid);
					return {
						mid,
						source: parseInlineContent(marker),
						target: targetMarker
							? parseInlineContent(targetMarker)
							: createTextContent(""),
						sourceAttributes: attributesOf(marker),
						...(targetMarker
							? { targetAttributes: attributesOf(targetMarker) }
							: {}),
					};
				})
			: [
					{
						source: parseInlineContent(source),
						target: target ? parseInlineContent(target) : createTextContent(""),
					},
				];

	const notes = directChildren(transUnit, "note").map((note) => ({
		...(note.getAttribute("id") ? { id: note.getAttribute("id")! } : {}),
		...(note.getAttribute("from")
			? { category: note.getAttribute("from")! }
			: {}),
		text: note.textContent ?? "",
		appliesTo: noteAppliesTo(note.getAttribute("annotates")),
		...(positiveInteger(note.getAttribute("priority"))
			? { priority: positiveInteger(note.getAttribute("priority")) }
			: {}),
	}));
	const contextGroups = directChildren(transUnit, "context-group").map(
		serializeNode,
	);
	const contexts = directChildren(transUnit, "context-group").flatMap((group) =>
		allDescendants(group, "context").map((context) => ({
			type: context.getAttribute("context-type") ?? "context",
			value: context.textContent ?? "",
		})),
	);
	const altTrans = directChildren(transUnit, "alt-trans").map(serializeNode);
	const known = new Set([
		"source",
		"seg-source",
		"target",
		"context-group",
		"count-group",
		"prop-group",
		"note",
		"alt-trans",
		"phase-group",
	]);
	const extensions = directElementChildren(transUnit)
		.filter(
			(child) =>
				!known.has(localName(child)) ||
				(child.namespaceURI !== XLIFF_12_NAMESPACE && child.namespaceURI),
		)
		.map(serializeNode);

	return {
		recordIndex,
		id,
		attributes: attributesOf(transUnit),
		sourceAttributes: attributesOf(source),
		targetAttributes: target ? attributesOf(target) : {},
		...(segSource ? { segSourceAttributes: attributesOf(segSource) } : {}),
		segments,
		notes,
		contextGroups,
		contexts,
		altTrans,
		extensions,
	};
}

export function assembleXliff12Document(options: {
	skeletonXml: string;
	records: ParsedXliff12Record[];
	format: Type;
	documentId: string;
}): NeutralDocument {
	const skeleton = safeParseXml(options.skeletonXml);
	const root = skeleton.documentElement;
	if (
		localName(root) !== "xliff" ||
		root.namespaceURI !== XLIFF_12_NAMESPACE ||
		root.getAttribute("version") !== "1.2"
	)
		throw malformed(
			'XLIFF 1.2 requires an xliff root in the official namespace and version="1.2".',
		);

	const files = directChildren(root, "file");
	if (files.length === 0)
		throw malformed("XLIFF 1.2 needs at least one file element.");
	const fileMetadata = files.map((file, index) => inspectFile(file, index));
	const rootExtensions = directElementChildren(root)
		.filter((child) => localName(child) !== "file")
		.map(serializeNode);
	const recordByIndex = new Map(
		options.records.map((record) => [record.recordIndex, record]),
	);
	const seenRecordIndexes = new Set<number>();
	const units: TranslationUnit[] = [];
	const usedUnitIds = new Set<string>();
	const seenIdsByFile = files.map(() => new Set<string>());

	for (const placeholder of allElements(root).filter(
		(element) =>
			element.namespaceURI === STREAM_NAMESPACE &&
			localName(element) === "opentlc-stream-record",
	)) {
		const recordIndex = Number(placeholder.getAttribute("index"));
		const record = recordByIndex.get(recordIndex);
		if (!record)
			throw malformed(`XLIFF record placeholder ${recordIndex} is unresolved.`);
		seenRecordIndexes.add(recordIndex);
		const file = closestAncestor(placeholder, "file");
		const body = closestAncestor(placeholder, "body");
		if (!file || !body)
			throw malformed(
				`XLIFF trans-unit “${record.id}” is outside a file body.`,
			);
		const fileIndex = files.indexOf(file);
		if (seenIdsByFile[fileIndex].has(record.id))
			throw malformed(
				`XLIFF file ${fileIndex + 1} contains duplicate trans-unit id “${record.id}”.`,
			);
		seenIdsByFile[fileIndex].add(record.id);
		const groupPath = ancestorGroups(placeholder, body).map(inspectGroup);
		const fileAttributes = fileMetadata[fileIndex].attributes;
		const sourceLanguage = fileAttributes["source-language"];
		const targetLanguage = fileAttributes["target-language"];
		const state = stateFromXliff(
			record.attributes.approved,
			record.targetAttributes.state,
		);

		for (const [segmentIndex, segment] of record.segments.entries()) {
			const requestedId =
				record.segments.length === 1
					? record.id
					: `${record.id}:${segment.mid ?? segmentIndex + 1}`;
			const unitId = uniqueUnitId(
				files.length === 1 ? requestedId : `${fileIndex + 1}:${requestedId}`,
				usedUnitIds,
			);
			const source = withContentProperties(
				segment.source,
				record.sourceAttributes,
				fileAttributes,
				sourceLanguage,
			);
			const target = withContentProperties(
				segment.target,
				record.targetAttributes,
				fileAttributes,
				targetLanguage,
			);
			const metadata: Xliff12UnitMetadata = {
				kind: "xliff-1.2-unit",
				recordIndex,
				fileIndex,
				transUnitId: record.id,
				...(segment.mid ? { segmentMid: segment.mid } : {}),
				segmentIndex,
				attributes: record.attributes,
				sourceAttributes: record.sourceAttributes,
				targetAttributes: record.targetAttributes,
				...(record.segSourceAttributes
					? { segSourceAttributes: record.segSourceAttributes }
					: {}),
				...(segment.sourceAttributes
					? { segmentSourceAttributes: segment.sourceAttributes }
					: {}),
				...(segment.targetAttributes
					? { segmentTargetAttributes: segment.targetAttributes }
					: {}),
				groupPath,
				contextGroups: record.contextGroups,
				altTrans: record.altTrans,
				extensions: record.extensions,
			};
			units.push({
				id: unitId,
				source,
				target,
				state,
				translatable: record.attributes.translate !== "no",
				contexts: record.contexts,
				notes: record.notes,
				sourceLocation: {
					part: fileAttributes.original,
					path: groupPath.map((group) => group.attributes.id ?? group.key),
					segmentIndex,
				},
				metadata: { xliff12: metadata },
			});
		}
	}
	if (seenRecordIndexes.size !== options.records.length)
		throw malformed("One or more XLIFF records could not be placed in a file.");

	const firstFile = fileMetadata[0].attributes;
	const metadata: Xliff12DocumentMetadata = {
		kind: "xliff-1.2",
		rootAttributes: attributesOf(root),
		rootExtensions,
		files: fileMetadata,
	};
	return {
		schemaVersion: NEUTRAL_DOCUMENT_VERSION,
		id: options.documentId || "xliff-1.2",
		format: options.format,
		...(firstFile["source-language"]
			? { sourceLanguage: firstFile["source-language"] }
			: {}),
		...(firstFile["target-language"]
			? { targetLanguage: firstFile["target-language"] }
			: {}),
		units,
		metadata: { xliff12: metadata },
	};
}

export function contentToEditableText(content: SegmentContent): string {
	return content.fragments
		.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
		.join("");
}

export function buildXliff12(userData: UserData): string {
	const data = userData.translationData;
	assertVendorXliffExportAllowed(data.documentModel);
	return buildXliff12PreservingDocument(userData);
}

/** Structural serializer used by the dedicated same-profile vendor writer. */
export function buildXliff12PreservingDocument(
	userData: UserData,
	options: { includeOpenTlcMetadata?: boolean } = {},
): string {
	const data = userData.translationData;
	const includeOpenTlcMetadata = options.includeOpenTlcMetadata !== false;
	const baseDocument =
		data.documentModel && data.documentModel.units.length === data.seg1.length
			? data.documentModel
			: createNeutralDocument({
					format: data.type,
					documentId: `project-${userData.id ?? "translation"}`,
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
		state:
			data.checked[index] && unit.state !== "final"
				? ("reviewed" as const)
				: !data.checked[index] && unit.state === "reviewed"
					? data.seg2[index]
						? ("translated" as const)
						: ("initial" as const)
					: data.seg2[index] && unit.state === "initial"
						? ("translated" as const)
						: unit.state,
	}));
	const documentMetadata = getDocumentMetadata(baseDocument);
	const fileMetadata = documentMetadata?.files.length
		? documentMetadata.files
		: [defaultFileMetadata(data)];
	const unitsByFile = new Map<
		number,
		Array<{ unit: TranslationUnit; index: number }>
	>();
	for (const [index, unit] of units.entries()) {
		const metadata = getUnitMetadata(unit);
		const fileIndex =
			metadata && metadata.fileIndex < fileMetadata.length
				? metadata.fileIndex
				: 0;
		const entries = unitsByFile.get(fileIndex) ?? [];
		entries.push({ unit, index });
		unitsByFile.set(fileIndex, entries);
	}

	const rootAttributes = {
		...(documentMetadata?.rootAttributes ?? {}),
		xmlns: XLIFF_12_NAMESPACE,
		version: "1.2",
		...(includeOpenTlcMetadata
			? {
					"xmlns:xsi": "http://www.w3.org/2001/XMLSchema-instance",
					"xsi:schemaLocation": mergeSchemaLocation(
						documentMetadata?.rootAttributes["xsi:schemaLocation"],
					),
				}
			: {}),
	};
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<xliff${renderAttributes(rootAttributes, ["xmlns", "version"])}>`,
	];
	for (const extension of documentMetadata?.rootExtensions ?? [])
		lines.push(indent(extension, 1));
	for (const [filePosition, file] of fileMetadata.entries()) {
		const attributes = {
			...file.attributes,
			original: file.attributes.original || `${data.name || "translation"}.txt`,
			"source-language":
				file.attributes["source-language"] || data.sourceLang || "und",
			datatype: file.attributes.datatype || "plaintext",
			...(file.attributes["target-language"] || data.targetLang
				? {
						"target-language":
							file.attributes["target-language"] || data.targetLang,
					}
				: {}),
		};
		lines.push(`  <file${renderAttributes(attributes)}>`);
		const preservedHeader = includeOpenTlcMetadata
			? file.headerChildren.filter(
					(child) =>
						!/<(?:[\w.-]+:)?SourceInfo\b/.test(child) &&
						!/<note\b[^>]*\bfrom=(?:"OpenTLC"|'OpenTLC')/.test(child),
				)
			: file.headerChildren;
		if (
			preservedHeader.length > 0 ||
			(filePosition === 0 && includeOpenTlcMetadata)
		) {
			lines.push("    <header>");
			for (const child of preservedHeader.filter(isXliffCoreXml))
				lines.push(indent(child, 3));
			if (filePosition === 0 && includeOpenTlcMetadata)
				lines.push(...renderOpenTlcMetadata(userData, 3));
			for (const child of preservedHeader.filter(
				(child) => !isXliffCoreXml(child),
			))
				lines.push(indent(child, 3));
			lines.push("    </header>");
		}
		lines.push("    <body>");
		for (const extension of file.bodyExtensions)
			lines.push(indent(extension, 3));
		lines.push(
			...renderFileUnits(unitsByFile.get(file.index) ?? [], 3),
			"    </body>",
			"  </file>",
		);
	}
	lines.push("</xliff>", "");
	return lines.join("\n");
}

export function validateXliff12Xml(xml: string): Xliff12ValidationResult {
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
	if (root.namespaceURI !== XLIFF_12_NAMESPACE)
		issues.push("The root must use the XLIFF 1.2 namespace.");
	if (root.getAttribute("version") !== "1.2")
		issues.push('The root must have version="1.2".');
	const files = directChildren(root, "file");
	if (files.length === 0) issues.push("At least one file is required.");
	for (const [fileIndex, file] of files.entries()) {
		for (const attribute of ["original", "source-language", "datatype"])
			if (!file.getAttribute(attribute))
				issues.push(`File ${fileIndex + 1} is missing ${attribute}.`);
		const header = directChild(file, "header");
		if (
			header &&
			directElementChildren(header).some(
				(child) =>
					child.namespaceURI === XLIFF_12_NAMESPACE &&
					localName(child) === "group",
			)
		)
			issues.push(`File ${fileIndex + 1} has an invalid group inside header.`);
		const body = directChild(file, "body");
		if (!body) {
			issues.push(`File ${fileIndex + 1} is missing body.`);
			continue;
		}
		const ids = new Set<string>();
		for (const unit of allDescendants(body, "trans-unit")) {
			const id = unit.getAttribute("id")?.trim() ?? "";
			if (!id)
				issues.push(`File ${fileIndex + 1} has a trans-unit without id.`);
			else if (ids.has(id))
				issues.push(`File ${fileIndex + 1} repeats trans-unit id “${id}”.`);
			ids.add(id);
			if (directChildren(unit, "source").length !== 1)
				issues.push(`Trans-unit “${id}” must have exactly one source.`);
			if (directChildren(unit, "target").length > 1)
				issues.push(`Trans-unit “${id}” has more than one target.`);
			validateInlineElements(unit, id, issues);
		}
	}
	return { valid: issues.length === 0, issues };
}

function inspectFile(file: Element, index: number): Xliff12FileMetadata {
	const attributes = attributesOf(file);
	for (const attribute of ["original", "source-language", "datatype"])
		if (!attributes[attribute])
			throw malformed(`XLIFF file ${index + 1} is missing ${attribute}.`);
	const body = directChild(file, "body");
	if (!body) throw malformed(`XLIFF file ${index + 1} has no body.`);
	const header = directChild(file, "header");
	const headerChildren = header
		? directElementChildren(header).flatMap((child) => {
				if (
					localName(child) === "group" &&
					child.namespaceURI === XLIFF_12_NAMESPACE
				)
					return directElementChildren(child)
						.filter((nested) => localName(nested) === "SourceInfo")
						.map(serializeNode);
				return [serializeNode(child)];
			})
		: [];
	const bodyExtensions = directElementChildren(body)
		.filter(
			(child) =>
				localName(child) !== "group" && child.namespaceURI !== STREAM_NAMESPACE,
		)
		.map(serializeNode);
	return { index, attributes, headerChildren, bodyExtensions };
}

function inspectGroup(group: Element, index = 0): Xliff12GroupMetadata {
	const attributes = attributesOf(group);
	const siblingIndex = directElementChildren(parentElementOf(group) ?? group)
		.filter((element) => localName(element) === "group")
		.indexOf(group);
	return {
		key: `${attributes.id ?? "group"}-${siblingIndex >= 0 ? siblingIndex : index}`,
		attributes,
		extensions: directElementChildren(group)
			.filter(
				(child) =>
					localName(child) !== "group" &&
					child.namespaceURI !== STREAM_NAMESPACE,
			)
			.map(serializeNode),
	};
}

function parseInlineContent(element: Element): SegmentContent {
	const fragments: ContentFragment[] = [];
	let codeSequence = 0;
	const walk = (parent: Element) => {
		for (const node of Array.from(parent.childNodes)) {
			if (node.nodeType === 3 || node.nodeType === 4) {
				const text = node.nodeValue ?? "";
				const previous = fragments.at(-1);
				if (previous?.kind === "text") previous.text += text;
				else fragments.push({ kind: "text", text });
				continue;
			}
			if (node.nodeType !== 1) continue;
			const child = node as Element;
			const name = localName(child);
			const xml = serializeNode(child);
			codeSequence++;
			const id = child.getAttribute("id") ?? `${name}-${codeSequence}`;
			if (name === "g" || name === "mrk") {
				const pairId = `${name}:${child.getAttribute("id") ?? child.getAttribute("mid") ?? id}:${codeSequence}`;
				fragments.push({
					kind: "code",
					id: `${id}:start:${codeSequence}`,
					codeType: "start",
					pairId,
					originalData: openingTag(xml),
					displayText: child.getAttribute("ctype") ?? name,
					canCopy: true,
					canDelete: false,
					canReorder: false,
				});
				walk(child);
				fragments.push({
					kind: "code",
					id: `${id}:end:${codeSequence}`,
					codeType: "end",
					pairId,
					originalData: `</${child.tagName}>`,
					displayText: child.getAttribute("ctype") ?? name,
					canCopy: true,
					canDelete: false,
					canReorder: false,
				});
				continue;
			}
			const codeType = inlineCodeType(child);
			fragments.push({
				kind: "code",
				id: `${name}:${id}:${codeSequence}`,
				codeType,
				...(codeType === "standalone"
					? {}
					: { pairId: child.getAttribute("rid") ?? id }),
				originalData: xml,
				displayText:
					child.getAttribute("equiv-text") ??
					child.getAttribute("ctype") ??
					name,
				canCopy: true,
				canDelete: false,
				canReorder: false,
			});
		}
	};
	walk(element);
	return {
		fragments,
		...(xmlLanguage(element) ? { language: xmlLanguage(element) } : {}),
		preserveWhitespace: inheritedXmlSpace(element) === "preserve",
	};
}

function renderFileUnits(
	entries: Array<{ unit: TranslationUnit; index: number }>,
	depth: number,
): string[] {
	const roots: RenderGroup[] = [];
	const ungrouped: RenderRecord[] = [];
	const records = groupUnitsIntoRecords(entries);
	for (const record of records) {
		const path = getUnitMetadata(record.units[0].unit)?.groupPath ?? [];
		if (path.length === 0) {
			ungrouped.push(record);
			continue;
		}
		let siblings = roots;
		let node: RenderGroup | undefined;
		for (const group of path) {
			node = siblings.find((candidate) => candidate.metadata.key === group.key);
			if (!node) {
				node = { metadata: group, groups: [], records: [] };
				siblings.push(node);
			}
			siblings = node.groups;
		}
		node!.records.push(record);
	}
	const output = ungrouped.flatMap((record) => renderRecord(record, depth));
	for (const group of roots) output.push(...renderGroup(group, depth));
	return output;
}

interface RenderRecord {
	key: string;
	order: number;
	units: Array<{ unit: TranslationUnit; index: number }>;
}

interface RenderGroup {
	metadata: Xliff12GroupMetadata;
	groups: RenderGroup[];
	records: RenderRecord[];
}

function groupUnitsIntoRecords(
	entries: Array<{ unit: TranslationUnit; index: number }>,
): RenderRecord[] {
	const records = new Map<string, RenderRecord>();
	for (const entry of entries) {
		const metadata = getUnitMetadata(entry.unit);
		const key = metadata
			? `record:${metadata.recordIndex}`
			: `unit:${entry.index}`;
		const record = records.get(key) ?? {
			key,
			order: metadata?.recordIndex ?? entry.index,
			units: [],
		};
		record.units.push(entry);
		records.set(key, record);
	}
	return [...records.values()].sort((left, right) => left.order - right.order);
}

function renderGroup(group: RenderGroup, depth: number): string[] {
	const output = [
		`${"  ".repeat(depth)}<group${renderAttributes(group.metadata.attributes)}>`,
	];
	for (const extension of group.metadata.extensions)
		output.push(indent(extension, depth + 1));
	for (const record of group.records)
		output.push(...renderRecord(record, depth + 1));
	for (const child of group.groups)
		output.push(...renderGroup(child, depth + 1));
	output.push(`${"  ".repeat(depth)}</group>`);
	return output;
}

function renderRecord(record: RenderRecord, depth: number): string[] {
	const first = record.units[0].unit;
	const metadata = getUnitMetadata(first);
	const attributes = {
		...(metadata?.attributes ?? {}),
		id: metadata?.transUnitId ?? first.id,
		...(metadata?.attributes.translate || !first.translatable
			? { translate: first.translatable ? "yes" : "no" }
			: {}),
		...(first.state === "reviewed" || first.state === "final"
			? { approved: "yes" }
			: metadata?.attributes.approved
				? { approved: "no" }
				: {}),
	};
	const prefix = "  ".repeat(depth);
	const childPrefix = "  ".repeat(depth + 1);
	const output = [`${prefix}<trans-unit${renderAttributes(attributes)}>`];
	const segmented = record.units.some(
		(entry) => getUnitMetadata(entry.unit)?.segmentMid,
	);
	if (segmented) {
		output.push(
			`${childPrefix}<source${renderAttributes(metadata?.sourceAttributes ?? {})}>${record.units.map(({ unit }) => renderContent(unit.source)).join("")}</source>`,
			`${childPrefix}<seg-source${renderAttributes(metadata?.segSourceAttributes ?? {})}>${record.units.map(({ unit }, index) => renderSegmentMarker(unit, index, "source")).join("")}</seg-source>`,
			`${childPrefix}<target${renderAttributes({ ...(metadata?.targetAttributes ?? {}), state: stateToXliff(first.state) })}>${record.units.map(({ unit }, index) => renderSegmentMarker(unit, index, "target")).join("")}</target>`,
		);
	} else {
		output.push(
			`${childPrefix}<source${renderAttributes(metadata?.sourceAttributes ?? {})}>${renderContent(first.source)}</source>`,
			`${childPrefix}<target${renderAttributes({ ...(metadata?.targetAttributes ?? {}), state: stateToXliff(first.state) })}>${renderContent(first.target)}</target>`,
		);
	}
	for (const contextGroup of metadata?.contextGroups ?? [])
		output.push(indent(contextGroup, depth + 1));
	for (const note of first.notes) {
		const noteAttributes = {
			...(note.id ? { id: note.id } : {}),
			...(note.category ? { from: note.category } : {}),
			...(note.appliesTo && note.appliesTo !== "unit"
				? { annotates: note.appliesTo }
				: {}),
			...(note.priority ? { priority: String(note.priority) } : {}),
		};
		output.push(
			`${childPrefix}<note${renderAttributes(noteAttributes)}>${escapeXml(note.text)}</note>`,
		);
	}
	for (const altTrans of metadata?.altTrans ?? [])
		output.push(indent(altTrans, depth + 1));
	for (const extension of metadata?.extensions ?? [])
		output.push(indent(extension, depth + 1));
	output.push(`${prefix}</trans-unit>`);
	return output;
}

function renderSegmentMarker(
	unit: TranslationUnit,
	index: number,
	side: "source" | "target",
): string {
	const metadata = getUnitMetadata(unit);
	const attributes = {
		...(side === "source"
			? metadata?.segmentSourceAttributes
			: metadata?.segmentTargetAttributes),
		mtype: "seg",
		mid: metadata?.segmentMid ?? String(index + 1),
	};
	return `<mrk${renderAttributes(attributes)}>${renderContent(unit[side])}</mrk>`;
}

function renderOpenTlcMetadata(userData: UserData, depth: number): string[] {
	const data = userData.translationData;
	const editingState = {
		segmentsMeta: data.segmentsMeta,
		segmentJoinStates: data.segmentJoinStates,
		parsingTokens: data.parsingTokens,
		locked: data.locked,
		skeleton: data.skeleton,
		filterOptions: data.filterOptions,
	};
	const prefix = "  ".repeat(depth);
	const metadata = JSON.stringify({
		schemaVersion: userData.schemaVersion ?? 1,
		...(userData.id === undefined ? {} : { id: userData.id }),
		name: data.name,
		checked: data.checked,
		type: data.type,
		typeRef: data.typeRef,
		tm: data.tm,
		tb: data.tb,
		editingState,
	});
	return [
		`${prefix}<note from="OpenTLC" annotates="general">${escapeXml(metadata)}</note>`,
	];
}

function defaultFileMetadata(
	data: UserData["translationData"],
): Xliff12FileMetadata {
	return {
		index: 0,
		attributes: {
			original: `${data.name || "translation"}.txt`,
			"source-language": data.sourceLang || "und",
			...(data.targetLang ? { "target-language": data.targetLang } : {}),
			datatype: "plaintext",
		},
		headerChildren: [],
		bodyExtensions: [],
	};
}

function getDocumentMetadata(
	document: NeutralDocument,
): Xliff12DocumentMetadata | undefined {
	const value = document.metadata?.xliff12 as
		| Xliff12DocumentMetadata
		| undefined;
	return value?.kind === "xliff-1.2" ? value : undefined;
}

function getUnitMetadata(
	unit: TranslationUnit,
): Xliff12UnitMetadata | undefined {
	const value = unit.metadata?.xliff12 as Xliff12UnitMetadata | undefined;
	return value?.kind === "xliff-1.2-unit" ? value : undefined;
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

	const textIndexes = content.fragments.flatMap((fragment, index) =>
		fragment.kind === "text" ? [index] : [],
	);
	if (textIndexes.length === 0) return content;
	const previousLength = textIndexes.reduce((total, index) => {
		const fragment = content.fragments[index];
		return total + (fragment.kind === "text" ? fragment.text.length : 0);
	}, 0);
	let previousOffset = 0;
	let nextOffset = 0;
	const fragments = content.fragments.map((fragment) => ({ ...fragment }));
	for (const [position, index] of textIndexes.entries()) {
		const fragment = content.fragments[index];
		if (fragment.kind !== "text") continue;
		previousOffset += fragment.text.length;
		const end =
			position === textIndexes.length - 1 || previousLength === 0
				? text.length
				: nearestTextBoundary(
						text,
						Math.round((previousOffset / previousLength) * text.length),
						nextOffset,
					);
		fragments[index] = { kind: "text", text: text.slice(nextOffset, end) };
		nextOffset = end;
	}
	return { ...content, fragments };
}

function nearestTextBoundary(
	text: string,
	preferred: number,
	minimum: number,
): number {
	let best = Math.max(minimum, Math.min(text.length, preferred));
	let distance = Number.POSITIVE_INFINITY;
	for (let index = minimum; index <= text.length; index++) {
		const left = text[index - 1] ?? "";
		const right = text[index] ?? "";
		if (
			index !== minimum &&
			index !== text.length &&
			!(/\s/u.test(left) || /\s/u.test(right))
		)
			continue;
		const candidateDistance = Math.abs(index - preferred);
		if (candidateDistance < distance) {
			best = index;
			distance = candidateDistance;
		}
	}
	return best;
}

function renderContent(content: SegmentContent): string {
	return content.fragments
		.map((fragment) =>
			fragment.kind === "text"
				? escapeXml(fragment.text)
				: fragment.id.startsWith("html-")
					? escapeXml(fragment.originalData ?? "")
					: fragment.originalData ||
						`<x id="${escapeXmlAttribute(fragment.id)}"/>`,
		)
		.join("");
}

function withContentProperties(
	content: SegmentContent,
	elementAttributes: Record<string, string>,
	fileAttributes: Record<string, string>,
	language: string | undefined,
): SegmentContent {
	return {
		...content,
		...(elementAttributes["xml:lang"] || language
			? { language: elementAttributes["xml:lang"] || language }
			: {}),
		preserveWhitespace:
			elementAttributes["xml:space"] === "preserve" ||
			(elementAttributes["xml:space"] === undefined &&
				fileAttributes["xml:space"] === "preserve"),
	};
}

function stateFromXliff(
	approved: string | undefined,
	state: string | undefined,
): TranslationState {
	if (state === "final") return "final";
	if (approved === "yes" || state === "signed-off") return "reviewed";
	if (state?.startsWith("needs-review")) return "needs-review";
	if (state === "translated") return "translated";
	return "initial";
}

function stateToXliff(state: TranslationState): string {
	switch (state) {
		case "translated":
			return "translated";
		case "needs-review":
			return "needs-review-translation";
		case "reviewed":
			return "signed-off";
		case "final":
			return "final";
		default:
			return "new";
	}
}

function inlineCodeType(element: Element): "standalone" | "start" | "end" {
	switch (localName(element)) {
		case "bpt":
		case "bx":
			return "start";
		case "ept":
		case "ex":
			return "end";
		case "it":
			// <it> is an isolated boundary whose mate is intentionally outside the
			// current content. Keep it atomic so the neutral model remains balanced.
			return "standalone";
		default:
			return "standalone";
	}
}

function validateInlineElements(
	unit: Element,
	unitId: string,
	issues: string[],
): void {
	for (const container of [
		...directChildren(unit, "source"),
		...directChildren(unit, "seg-source"),
		...directChildren(unit, "target"),
	]) {
		const starts = new Map<string, number>();
		const ends = new Map<string, number>();
		for (const inline of allElements(container)) {
			const name = localName(inline);
			if (["g", "x", "bx", "ex", "bpt", "ept", "it", "ph"].includes(name)) {
				if (!inline.getAttribute("id"))
					issues.push(`Inline ${name} in trans-unit “${unitId}” needs id.`);
			}
			if (["bpt", "bx"].includes(name)) {
				const key =
					inline.getAttribute("rid") ?? inline.getAttribute("id") ?? "";
				starts.set(key, (starts.get(key) ?? 0) + 1);
			}
			if (["ept", "ex"].includes(name)) {
				const key =
					inline.getAttribute("rid") ?? inline.getAttribute("id") ?? "";
				ends.set(key, (ends.get(key) ?? 0) + 1);
			}
		}
		for (const [key, count] of starts)
			if (ends.get(key) !== count)
				issues.push(
					`Inline pair “${key}” in trans-unit “${unitId}” is unbalanced.`,
				);
		for (const [key, count] of ends)
			if (starts.get(key) !== count && !starts.has(key))
				issues.push(
					`Inline pair “${key}” in trans-unit “${unitId}” is unbalanced.`,
				);
	}
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
	first: string[] = [],
): string {
	const entries = Object.entries(attributes).filter(
		(entry): entry is [string, string] =>
			entry[1] !== undefined && entry[1] !== "",
	);
	entries.sort(([left], [right]) => {
		const leftIndex = first.indexOf(left);
		const rightIndex = first.indexOf(right);
		if (leftIndex >= 0 || rightIndex >= 0)
			return (
				(leftIndex < 0 ? first.length : leftIndex) -
				(rightIndex < 0 ? first.length : rightIndex)
			);
		return left.localeCompare(right);
	});
	return entries
		.map(([name, value]) => ` ${name}="${escapeXmlAttribute(value)}"`)
		.join("");
}

function mergeSchemaLocation(existing: string | undefined): string {
	const pairs = (existing ?? "").trim().split(/\s+/).filter(Boolean);
	const output = new Map<string, string>();
	for (let index = 0; index + 1 < pairs.length; index += 2)
		output.set(pairs[index], pairs[index + 1]);
	output.set(XLIFF_12_NAMESPACE, XLIFF_12_SCHEMA);
	return Array.from(
		output,
		([namespace, location]) => `${namespace} ${location}`,
	).join(" ");
}

function isXliffCoreXml(xml: string): boolean {
	try {
		return (
			safeParseXml(xml).documentElement.namespaceURI === XLIFF_12_NAMESPACE
		);
	} catch {
		return false;
	}
}

function directElementChildren(element: Element): Element[] {
	return Array.from(element.childNodes).filter(
		(node): node is Element => node.nodeType === 1,
	);
}

function directChildren(element: Element, name: string): Element[] {
	return directElementChildren(element).filter(
		(child) =>
			localName(child) === name &&
			(!child.namespaceURI || child.namespaceURI === XLIFF_12_NAMESPACE),
	);
}

function directChild(element: Element, name: string): Element | undefined {
	return directChildren(element, name)[0];
}

function allDescendants(element: Element, name: string): Element[] {
	return allElements(element).filter((child) => localName(child) === name);
}

function allElements(element: Element): Element[] {
	return Array.from(element.getElementsByTagName("*"));
}

function segmentMarkers(element: Element): Element[] {
	return allDescendants(element, "mrk").filter(
		(marker) => marker.getAttribute("mtype") === "seg",
	);
}

function closestAncestor(element: Element, name: string): Element | undefined {
	let current = parentElementOf(element);
	while (current) {
		if (localName(current) === name) return current;
		current = parentElementOf(current);
	}
	return undefined;
}

function ancestorGroups(element: Element, stop: Element): Element[] {
	const groups: Element[] = [];
	let current = parentElementOf(element);
	while (current && current !== stop) {
		if (localName(current) === "group") groups.unshift(current);
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
		element.getAttributeNS?.(XML_NAMESPACE, "lang") ??
		undefined
	);
}

function inheritedXmlSpace(element: Element): string | undefined {
	let current: Element | null = element;
	while (current) {
		const value =
			current.getAttribute("xml:space") ??
			current.getAttributeNS?.(XML_NAMESPACE, "space");
		if (value) return value;
		current = parentElementOf(current);
	}
	return undefined;
}

function parentElementOf(element: Element): Element | null {
	const parent = element.parentNode;
	return parent?.nodeType === 1 ? (parent as Element) : null;
}

function noteAppliesTo(value: string | null): "source" | "target" | "unit" {
	return value === "source" || value === "target" ? value : "unit";
}

function positiveInteger(value: string | null): number | undefined {
	const number = Number(value);
	return Number.isInteger(number) && number > 0 ? number : undefined;
}

function uniqueUnitId(requested: string, used: Set<string>): string {
	let candidate = requested;
	let suffix = 2;
	while (!candidate || used.has(candidate))
		candidate = `${requested}-${suffix++}`;
	used.add(candidate);
	return candidate;
}

function serializeNode(node: Node): string {
	return new XMLSerializer().serializeToString(node);
}

function openingTag(xml: string): string {
	const close = xml.indexOf(">");
	return close < 0 ? xml : xml.slice(0, close + 1);
}

function indent(xml: string, depth: number): string {
	const prefix = "  ".repeat(depth);
	return xml
		.split(/\r?\n/)
		.map((line) => `${prefix}${line}`)
		.join("\n");
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

function malformed(message: string): SafeInputError {
	return new SafeInputError("XML_MALFORMED", message);
}
