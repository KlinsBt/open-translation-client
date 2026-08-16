import type { FormatId } from "./formatIds";

export const NEUTRAL_DOCUMENT_VERSION = 1 as const;

export type TranslationState =
	| "initial"
	| "translated"
	| "needs-review"
	| "reviewed"
	| "final";

export interface TextFragment {
	kind: "text";
	text: string;
}

export interface InlineCodeFragment {
	kind: "code";
	id: string;
	codeType: "standalone" | "start" | "end";
	pairId?: string;
	originalData?: string;
	displayText?: string;
	canCopy?: boolean;
	canDelete?: boolean;
	canReorder?: boolean;
}

export type ContentFragment = TextFragment | InlineCodeFragment;

export interface SegmentContent {
	fragments: ContentFragment[];
	language?: string;
	direction?: "ltr" | "rtl" | "auto";
	preserveWhitespace?: boolean;
}

export interface UnitContext {
	type: string;
	value: string;
}

export interface UnitNote {
	id?: string;
	category?: string;
	text: string;
	appliesTo?: "source" | "target" | "unit";
	priority?: number;
}

export interface UnitRelationships {
	plural?: {
		groupId: string;
		category: string;
	};
	variant?: {
		groupId: string;
		key: string;
	};
}

export interface SourceLocation {
	part?: string;
	path?: Array<string | number>;
	line?: number;
	column?: number;
	page?: number;
	paragraph?: number;
	sheet?: string;
	cell?: string;
	segmentIndex?: number;
	metadata?: Record<string, unknown>;
}

export interface TranslationUnit {
	id: string;
	source: SegmentContent;
	target: SegmentContent;
	state: TranslationState;
	translatable: boolean;
	contexts: UnitContext[];
	notes: UnitNote[];
	relationships?: UnitRelationships;
	sourceLocation?: SourceLocation;
	metadata?: Record<string, unknown>;
}

export interface NeutralDocument {
	schemaVersion: typeof NEUTRAL_DOCUMENT_VERSION;
	id: string;
	format: FormatId;
	sourceLanguage?: string;
	targetLanguage?: string;
	units: TranslationUnit[];
	metadata?: Record<string, unknown>;
}

export interface NeutralDocumentValidationIssue {
	path: string;
	message: string;
}

export interface NeutralDocumentValidationResult {
	valid: boolean;
	issues: NeutralDocumentValidationIssue[];
}

export interface CreateNeutralDocumentOptions {
	format: FormatId;
	sourceSegments: readonly string[];
	targetSegments?: readonly string[];
	checked?: readonly boolean[];
	sourceLanguage?: string;
	targetLanguage?: string;
	documentId?: string;
	unitIds?: readonly string[];
	sourceLocations?: readonly (SourceLocation | undefined)[];
}

export function createTextContent(
	text: string,
	language?: string,
	preserveWhitespace = true,
): SegmentContent {
	return {
		fragments: [{ kind: "text", text }],
		...(language ? { language } : {}),
		preserveWhitespace,
	};
}

export function hasInlineCodes(content: SegmentContent): boolean {
	return content.fragments.some((fragment) => fragment.kind === "code");
}

/**
 * Returns the editable text only when no protected inline codes would be lost.
 */
export function contentToPlainText(
	content: SegmentContent,
): string | undefined {
	if (hasInlineCodes(content)) return undefined;
	return content.fragments
		.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
		.join("");
}

function stateFromLegacy(target: string, checked: boolean): TranslationState {
	if (checked) return "reviewed";
	return target.length > 0 ? "translated" : "initial";
}

export function createNeutralDocument(
	options: CreateNeutralDocumentOptions,
): NeutralDocument {
	const targetSegments = options.targetSegments ?? [];
	const checked = options.checked ?? [];
	const seenIds = new Set<string>();

	const units = options.sourceSegments.map((source, index) => {
		const requestedId = options.unitIds?.[index] ?? `unit-${index + 1}`;
		let id = requestedId;
		let suffix = 2;
		while (!id || seenIds.has(id)) id = `${requestedId || "unit"}-${suffix++}`;
		seenIds.add(id);
		const target = targetSegments[index] ?? "";
		const isChecked = checked[index] ?? false;

		return {
			id,
			source: createTextContent(source, options.sourceLanguage),
			target: createTextContent(target, options.targetLanguage),
			state: stateFromLegacy(target, isChecked),
			translatable: true,
			contexts: [],
			notes: [],
			sourceLocation: options.sourceLocations?.[index] ?? {
				segmentIndex: index,
			},
		} satisfies TranslationUnit;
	});

	return {
		schemaVersion: NEUTRAL_DOCUMENT_VERSION,
		id: options.documentId || "document-1",
		format: options.format,
		...(options.sourceLanguage
			? { sourceLanguage: options.sourceLanguage }
			: {}),
		...(options.targetLanguage
			? { targetLanguage: options.targetLanguage }
			: {}),
		units,
	};
}

export function withDocumentLanguages(
	document: NeutralDocument,
	sourceLanguage: string,
	targetLanguage: string,
): NeutralDocument {
	return {
		...document,
		sourceLanguage,
		targetLanguage,
		units: document.units.map((unit) => ({
			...unit,
			source: { ...unit.source, language: sourceLanguage },
			target: { ...unit.target, language: targetLanguage },
		})),
	};
}

function validateContent(
	content: SegmentContent,
	path: string,
	issues: NeutralDocumentValidationIssue[],
) {
	if (!content || typeof content !== "object") {
		issues.push({ path, message: "Content is required." });
		return;
	}
	if (!Array.isArray(content.fragments)) {
		issues.push({ path: `${path}.fragments`, message: "Must be an array." });
		return;
	}

	const codeIds = new Set<string>();
	const openPairs: string[] = [];
	for (const [index, fragment] of content.fragments.entries()) {
		const fragmentPath = `${path}.fragments[${index}]`;
		if (fragment.kind === "text") {
			if (typeof fragment.text !== "string") {
				issues.push({ path: fragmentPath, message: "Text must be a string." });
			}
			continue;
		}

		if (fragment.kind !== "code") {
			issues.push({ path: fragmentPath, message: "Unknown fragment kind." });
			continue;
		}
		if (
			!(["standalone", "start", "end"] as const).includes(fragment.codeType)
		) {
			issues.push({
				path: `${fragmentPath}.codeType`,
				message: "Unknown inline code type.",
			});
			continue;
		}
		if (!fragment.id || codeIds.has(fragment.id)) {
			issues.push({
				path: `${fragmentPath}.id`,
				message: "Inline code IDs must be non-empty and unique per content.",
			});
		}
		codeIds.add(fragment.id);
		if (fragment.codeType === "standalone") {
			if (fragment.pairId) {
				issues.push({
					path: `${fragmentPath}.pairId`,
					message: "Standalone codes cannot have a pair ID.",
				});
			}
			continue;
		}
		if (!fragment.pairId) {
			issues.push({
				path: `${fragmentPath}.pairId`,
				message: "Paired code boundaries require a pair ID.",
			});
			continue;
		}
		if (fragment.codeType === "start") {
			openPairs.push(fragment.pairId);
		} else if (openPairs.pop() !== fragment.pairId) {
			issues.push({
				path: fragmentPath,
				message: "Paired inline codes must be balanced and properly nested.",
			});
		}
	}
	if (openPairs.length > 0) {
		issues.push({
			path,
			message: "Paired inline codes must be balanced and properly nested.",
		});
	}
}

export function validateNeutralDocument(
	document: NeutralDocument,
): NeutralDocumentValidationResult {
	const issues: NeutralDocumentValidationIssue[] = [];
	if (document.schemaVersion !== NEUTRAL_DOCUMENT_VERSION) {
		issues.push({
			path: "schemaVersion",
			message: "Unsupported model version.",
		});
	}
	if (!document.id)
		issues.push({ path: "id", message: "Document ID is required." });
	if (!Array.isArray(document.units)) {
		issues.push({ path: "units", message: "Units must be an array." });
		return { valid: false, issues };
	}

	const unitIds = new Set<string>();
	for (const [index, unit] of document.units.entries()) {
		const path = `units[${index}]`;
		if (!unit.id || unitIds.has(unit.id)) {
			issues.push({
				path: `${path}.id`,
				message: "Unit IDs must be non-empty and unique.",
			});
		}
		unitIds.add(unit.id);
		validateContent(unit.source, `${path}.source`, issues);
		validateContent(unit.target, `${path}.target`, issues);
		if (!Array.isArray(unit.contexts)) {
			issues.push({ path: `${path}.contexts`, message: "Must be an array." });
		}
		if (!Array.isArray(unit.notes)) {
			issues.push({ path: `${path}.notes`, message: "Must be an array." });
		}
	}

	return { valid: issues.length === 0, issues };
}

function replaceUnprotectedText(
	content: SegmentContent,
	text: string,
	language?: string,
): SegmentContent {
	if (hasInlineCodes(content)) return content;
	return createTextContent(
		text,
		language ?? content.language,
		content.preserveWhitespace ?? true,
	);
}

export interface LegacyProjection {
	seg1: string[];
	seg2: string[];
	checked: boolean[];
}

export function projectNeutralDocument(
	document: NeutralDocument,
): LegacyProjection {
	const seg1: string[] = [];
	const seg2: string[] = [];
	const checked: boolean[] = [];
	for (const unit of document.units) {
		const source = contentToPlainText(unit.source);
		const target = contentToPlainText(unit.target);
		if (source === undefined || target === undefined) {
			throw new Error(
				`Unit ${unit.id} contains protected inline codes and cannot be flattened into legacy segment arrays.`,
			);
		}
		seg1.push(source);
		seg2.push(target);
		checked.push(unit.state === "reviewed" || unit.state === "final");
	}
	return { seg1, seg2, checked };
}

export function synchronizeNeutralDocument(
	document: NeutralDocument,
	projection: LegacyProjection,
	sourceLanguage?: string,
	targetLanguage?: string,
): NeutralDocument {
	if (
		document.units.length !== projection.seg1.length ||
		projection.seg1.length !== projection.seg2.length ||
		projection.seg1.length !== projection.checked.length
	) {
		if (
			document.units.some(
				(unit) => hasInlineCodes(unit.source) || hasInlineCodes(unit.target),
			)
		) {
			// A positional reconciliation requires a format-aware adapter. Retain the
			// rich model rather than silently discarding protected content.
			return document;
		}
		return createNeutralDocument({
			format: document.format,
			documentId: document.id,
			sourceSegments: projection.seg1,
			targetSegments: projection.seg2,
			checked: projection.checked,
			unitIds: projection.seg1.map(
				(_, index) => document.units[index]?.id ?? `unit-${index + 1}`,
			),
			sourceLocations: projection.seg1.map(
				(_, index) => document.units[index]?.sourceLocation,
			),
			sourceLanguage: sourceLanguage ?? document.sourceLanguage,
			targetLanguage: targetLanguage ?? document.targetLanguage,
		});
	}

	return {
		...document,
		...(sourceLanguage ? { sourceLanguage } : {}),
		...(targetLanguage ? { targetLanguage } : {}),
		units: document.units.map((unit, index) => ({
			...unit,
			source: replaceUnprotectedText(
				unit.source,
				projection.seg1[index],
				sourceLanguage,
			),
			target: replaceUnprotectedText(
				unit.target,
				projection.seg2[index],
				targetLanguage,
			),
			state: stateFromLegacy(projection.seg2[index], projection.checked[index]),
		})),
	};
}

function uniqueSplitId(document: NeutralDocument, baseId: string): string {
	const ids = new Set(document.units.map((unit) => unit.id));
	let suffix = 2;
	let candidate = `${baseId}~${suffix}`;
	while (ids.has(candidate)) candidate = `${baseId}~${++suffix}`;
	return candidate;
}

function splitContentAtTextOffset(
	content: SegmentContent,
	offset: number,
): [SegmentContent, SegmentContent] | undefined {
	const plain = contentToPlainText(content);
	if (plain !== undefined) {
		return [
			createTextContent(
				plain.slice(0, offset),
				content.language,
				content.preserveWhitespace,
			),
			createTextContent(
				plain.slice(offset),
				content.language,
				content.preserveWhitespace,
			),
		];
	}

	let textOffset = 0;
	let openPairs = 0;
	for (const fragment of content.fragments) {
		if (fragment.kind === "code") {
			if (fragment.codeType === "start") openPairs += 1;
			if (fragment.codeType === "end") openPairs -= 1;
			if (textOffset === offset) return undefined;
			continue;
		}
		const nextOffset = textOffset + fragment.text.length;
		if (offset > textOffset && offset < nextOffset) {
			// Splitting across an open pair would create invalid fragments.
			if (openPairs !== 0) return undefined;
			const cut = offset - textOffset;
			const fragmentIndex = content.fragments.indexOf(fragment);
			const firstFragments = content.fragments.slice(0, fragmentIndex);
			const secondFragments = content.fragments.slice(fragmentIndex + 1);
			if (cut > 0)
				firstFragments.push({
					kind: "text",
					text: fragment.text.slice(0, cut),
				});
			if (cut < fragment.text.length)
				secondFragments.unshift({
					kind: "text",
					text: fragment.text.slice(cut),
				});
			return [
				{ ...content, fragments: firstFragments },
				{ ...content, fragments: secondFragments },
			];
		}
		textOffset = nextOffset;
	}
	return undefined;
}

export interface SplitNeutralUnitOptions {
	firstTarget: string;
	secondTarget: string;
	firstChecked: boolean;
	secondChecked: boolean;
	firstId?: string;
	secondId?: string;
}

export function splitNeutralDocumentUnit(
	document: NeutralDocument,
	unitIndex: number,
	sourceOffset: number,
	options: SplitNeutralUnitOptions,
): { document?: NeutralDocument; error?: string } {
	const unit = document.units[unitIndex];
	if (!unit) return { error: "The neutral document unit is missing." };
	if (hasInlineCodes(unit.target)) {
		return {
			error:
				"Cannot split this unit through the legacy editor because its target contains protected inline codes.",
		};
	}
	const splitSource = splitContentAtTextOffset(unit.source, sourceOffset);
	if (!splitSource) {
		return {
			error:
				"Cannot split at this position because it would separate or discard a protected inline code.",
		};
	}
	const firstId = options.firstId || unit.id;
	const secondId = options.secondId || uniqueSplitId(document, unit.id);
	const first: TranslationUnit = {
		...unit,
		id: firstId,
		source: splitSource[0],
		target: createTextContent(options.firstTarget, unit.target.language),
		state: stateFromLegacy(options.firstTarget, options.firstChecked),
	};
	const second: TranslationUnit = {
		...unit,
		id: secondId,
		source: splitSource[1],
		target: createTextContent(options.secondTarget, unit.target.language),
		state: stateFromLegacy(options.secondTarget, options.secondChecked),
	};
	const units = [...document.units];
	units.splice(unitIndex, 1, first, second);
	return { document: { ...document, units } };
}

function mergeContent(
	first: SegmentContent,
	second: SegmentContent,
): SegmentContent {
	const fragments = [...first.fragments, ...second.fragments];
	const merged: ContentFragment[] = [];
	for (const fragment of fragments) {
		const previous = merged[merged.length - 1];
		if (fragment.kind === "text" && previous?.kind === "text") {
			previous.text += fragment.text;
		} else {
			merged.push({ ...fragment });
		}
	}
	return { ...first, fragments: merged };
}

function uniqueObjects<T>(values: readonly T[]): T[] {
	const seen = new Set<string>();
	return values.filter((value) => {
		const key = JSON.stringify(value);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function combineNeutralDocumentUnits(
	document: NeutralDocument,
	unitIndex: number,
): { document?: NeutralDocument; error?: string } {
	const first = document.units[unitIndex];
	const second = document.units[unitIndex + 1];
	if (!first || !second)
		return { error: "The neutral document units are missing." };
	const relationships =
		JSON.stringify(first.relationships) === JSON.stringify(second.relationships)
			? first.relationships
			: undefined;
	const combined: TranslationUnit = {
		...first,
		source: mergeContent(first.source, second.source),
		target: mergeContent(first.target, second.target),
		state:
			first.state === "reviewed" && second.state === "reviewed"
				? "reviewed"
				: "translated",
		translatable: first.translatable && second.translatable,
		contexts: uniqueObjects([...first.contexts, ...second.contexts]),
		notes: uniqueObjects([...first.notes, ...second.notes]),
		...(relationships ? { relationships } : { relationships: undefined }),
		metadata: {
			...first.metadata,
			joinedUnitIds: [
				...((first.metadata?.joinedUnitIds as string[] | undefined) ?? [
					first.id,
				]),
				...((second.metadata?.joinedUnitIds as string[] | undefined) ?? [
					second.id,
				]),
			],
		},
	};
	const units = [...document.units];
	units.splice(unitIndex, 2, combined);
	return { document: { ...document, units } };
}
