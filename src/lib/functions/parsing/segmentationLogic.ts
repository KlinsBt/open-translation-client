import type {
	DocxFragmentMeta,
	DocxSegmentMeta,
	HtmlSegmentMeta,
	JsonSegmentMeta,
	SegmentJoinState,
	SegmentMeta,
	UserData,
} from "$lib/types/types";
import {
	combineNeutralDocumentUnits,
	splitNeutralDocumentUnit,
	synchronizeNeutralDocument,
} from "$lib/formats/documentModel";
import { synchronizeSkeletonReplacements } from "$lib/formats/skeleton";

type TranslationData = UserData["translationData"];

export interface SegmentEditResult {
	data: TranslationData;
	error?: string;
	restoredJoinBoundary?: boolean;
}

export type SplitResult = SegmentEditResult;
export type CombineResult = SegmentEditResult;

const XLSX_EDIT_ERROR =
	"XLSX segments cannot be split or joined because worksheet cell alignment must be preserved.";
const PPTX_EDIT_ERROR =
	"PPTX segments cannot be split or joined because slide shape and run alignment must be preserved.";
const CSV_EDIT_ERROR =
	"CSV/TSV segments cannot be split or joined because row and column alignment must be preserved.";
const LOCJSON_EDIT_ERROR =
	"LocJSON units cannot be split or joined because each ordered source/target array is one format-level unit.";
const YAML_EDIT_ERROR =
	"YAML scalars cannot be split or joined because scalar style, chomping, anchors, and syntax ranges must remain aligned.";
const PO_EDIT_ERROR =
	"Gettext entries cannot be split or joined because msgid/msgstr and plural-form alignment must be preserved.";
const XML_EDIT_ERROR =
	"XML values cannot be split or joined because text, CDATA, attribute, namespace, and ITS ranges must remain aligned.";
const ANDROID_EDIT_ERROR =
	"Android resources cannot be split or joined because keys, arrays, plurals, and inline markup must remain aligned.";
const APPLE_EDIT_ERROR =
	"Apple localization units cannot be split or joined because keys, catalog languages, and variation paths must remain aligned.";
const PROPERTIES_EDIT_ERROR =
	"Properties values cannot be split or joined because keys and physical continuation lines must remain aligned.";
const RESX_EDIT_ERROR =
	"RESX values cannot be split or joined because data names, comments, and XML value ranges must remain aligned.";
const QT_TS_EDIT_ERROR =
	"Qt TS messages cannot be split or joined because contexts, numerus forms, variants, and translation ranges must remain aligned.";
const INI_EDIT_ERROR =
	"INI resource values cannot be split or joined because sections, keys, locale suffixes, and line ranges must remain aligned.";
const PHP_EDIT_ERROR =
	"PHP localization values cannot be split or joined because array paths and string ranges must remain aligned.";
const MARKUP_EDIT_ERROR =
	"Markdown and AsciiDoc prose spans cannot be split or joined because protected inline syntax and source ranges must remain aligned.";
const SUBTITLE_EDIT_ERROR =
	"Subtitle cues cannot be split or joined because cue IDs, timings, settings, and text ranges must remain aligned.";
const ODF_EDIT_ERROR =
	"OpenDocument text runs cannot be split or joined because package parts, styles, and XML ranges must remain aligned.";
const EPUB_EDIT_ERROR =
	"EPUB text runs cannot be split or joined because spine documents, navigation, inline markup, and package XML ranges must remain aligned.";
const SVG_EDIT_ERROR =
	"SVG text runs cannot be split or joined because text paths, accessibility attributes, and XML ranges must remain aligned.";
const DITA_EDIT_ERROR =
	"DITA text runs cannot be split or joined because topic, map, inline-element, and package XML ranges must remain aligned.";
const DOCBOOK_EDIT_ERROR =
	"DocBook text runs cannot be split or joined because block, inline, cross-reference, and XML ranges must remain aligned.";
const IDML_EDIT_ERROR =
	"IDML/ICML text runs cannot be split or joined because story order, style ranges, and package XML mappings must remain aligned.";
const LATEX_EDIT_ERROR =
	"TeX/LaTeX prose ranges cannot be split or joined because command, math, environment, and source mappings must remain aligned.";
const TTML_EDIT_ERROR =
	"TTML text runs cannot be split or joined because cue timing, nested spans, styles, and XML mappings must remain aligned.";
const MIF_EDIT_ERROR =
	"MIF strings cannot be split or joined because tag nesting, catalogs, conditions, and source ranges must remain aligned.";
const WINDOWS_RC_EDIT_ERROR =
	"Windows RC strings cannot be split or joined because resource blocks, identifiers, and source ranges must remain aligned.";
const QML_EDIT_ERROR =
	"QML translation literals cannot be split or joined because function arguments, bindings, and source ranges must remain aligned.";
const PDF_EDIT_ERROR =
	"PDF source units cannot be split or joined because page and bounding-box review context must remain aligned.";
const LEGACY_BILINGUAL_EDIT_ERROR =
	"Legacy bilingual CAT units cannot be split or joined because native unit IDs, delimiters, inline codes, workflow state, and target ranges must remain aligned.";

function arraysAreAligned(translation: TranslationData): boolean {
	return (
		translation.seg1.length === translation.seg2.length &&
		translation.seg1.length === translation.checked.length
	);
}

function isDocxMetaEntry(
	entry: SegmentMeta | undefined,
): entry is DocxSegmentMeta {
	return (
		!!entry &&
		typeof entry === "object" &&
		"fragments" in entry &&
		Array.isArray(entry.fragments)
	);
}

function isJsonMetaEntry(
	entry: SegmentMeta | undefined,
): entry is JsonSegmentMeta {
	return (
		!!entry &&
		typeof entry === "object" &&
		!("kind" in entry) &&
		"path" in entry &&
		Array.isArray(entry.path) &&
		entry.path.every((part) => typeof part === "string")
	);
}

function isHtmlMetaEntry(
	entry: SegmentMeta | undefined,
): entry is HtmlSegmentMeta {
	return (
		!!entry &&
		typeof entry === "object" &&
		"kind" in entry &&
		(entry.kind === "text" || entry.kind === "attribute") &&
		"path" in entry &&
		Array.isArray(entry.path) &&
		entry.path.every((part) => typeof part === "number") &&
		(entry.kind === "text" || typeof entry.attribute === "string")
	);
}

function validateForStructuralEdit(
	translation: TranslationData,
): string | undefined {
	if (!arraysAreAligned(translation)) {
		return "Segment source, target, and confirmation arrays are out of sync.";
	}

	if (translation.type === "xlsx") return XLSX_EDIT_ERROR;
	if (translation.type === "pptx") return PPTX_EDIT_ERROR;
	if (translation.type === "csv") return CSV_EDIT_ERROR;
	if (translation.type === "yaml") return YAML_EDIT_ERROR;
	if (translation.type === "po") return PO_EDIT_ERROR;
	if (translation.type === "android") return ANDROID_EDIT_ERROR;
	if (translation.type === "apple") return APPLE_EDIT_ERROR;
	if (translation.type === "properties") return PROPERTIES_EDIT_ERROR;
	if (translation.type === "resx") return RESX_EDIT_ERROR;
	if (translation.type === "qt-ts") return QT_TS_EDIT_ERROR;
	if (translation.type === "ini") return INI_EDIT_ERROR;
	if (translation.type === "php") return PHP_EDIT_ERROR;
	if (translation.type === "markup") return MARKUP_EDIT_ERROR;
	if (translation.type === "subtitles") return SUBTITLE_EDIT_ERROR;
	if (translation.type === "odf") return ODF_EDIT_ERROR;
	if (translation.type === "epub") return EPUB_EDIT_ERROR;
	if (translation.type === "svg") return SVG_EDIT_ERROR;
	if (translation.type === "dita") return DITA_EDIT_ERROR;
	if (translation.type === "docbook") return DOCBOOK_EDIT_ERROR;
	if (translation.type === "idml") return IDML_EDIT_ERROR;
	if (translation.type === "latex") return LATEX_EDIT_ERROR;
	if (translation.type === "ttml") return TTML_EDIT_ERROR;
	if (translation.type === "mif") return MIF_EDIT_ERROR;
	if (translation.type === "windows-rc") return WINDOWS_RC_EDIT_ERROR;
	if (translation.type === "qml") return QML_EDIT_ERROR;
	if (translation.type === "pdf") return PDF_EDIT_ERROR;
	if (translation.type === "legacy-bilingual")
		return LEGACY_BILINGUAL_EDIT_ERROR;
	if (translation.type === "xml") return XML_EDIT_ERROR;
	if (
		translation.type === "json" &&
		translation.segmentsMeta?.some(
			(entry) => "profile" in entry && entry.profile === "locjson",
		)
	)
		return LOCJSON_EDIT_ERROR;
	if (translation.type === "text") return undefined;

	if (
		!translation.segmentsMeta ||
		translation.segmentsMeta.length !== translation.seg1.length
	) {
		return `Cannot edit ${translation.type.toUpperCase()} segmentation because its structural metadata is missing or out of sync.`;
	}

	const metaIsValid = translation.segmentsMeta.every((entry) => {
		if (translation.type === "json") return isJsonMetaEntry(entry);
		if (translation.type === "html") return isHtmlMetaEntry(entry);
		if (translation.type === "docx") {
			return isDocxMetaEntry(entry) && entry.fragments.length > 0;
		}
		return false;
	});

	if (!metaIsValid) {
		return `Cannot edit ${translation.type.toUpperCase()} segmentation because its structural metadata is invalid.`;
	}

	return undefined;
}

function splitDocxMetaEntry(
	metaEntry: DocxSegmentMeta,
	splitPoint: number,
): { first: DocxSegmentMeta; second: DocxSegmentMeta } | undefined {
	const firstFragments: DocxFragmentMeta[] = [];
	const secondFragments: DocxFragmentMeta[] = [];
	let consumed = 0;

	for (const fragment of metaEntry.fragments) {
		const length = fragment.end - fragment.start;
		const nextConsumed = consumed + length;

		if (nextConsumed <= splitPoint) {
			firstFragments.push({ ...fragment });
		} else if (consumed >= splitPoint) {
			secondFragments.push({ ...fragment });
		} else {
			const cut = splitPoint - consumed;
			firstFragments.push({ ...fragment, end: fragment.start + cut });
			secondFragments.push({ ...fragment, start: fragment.start + cut });
		}

		consumed = nextConsumed;
	}

	if (
		consumed < splitPoint ||
		firstFragments.length === 0 ||
		secondFragments.length === 0
	) {
		return undefined;
	}

	return {
		first: {
			...(metaEntry.part ? { part: metaEntry.part } : {}),
			separator: "",
			fragments: firstFragments,
		},
		second: {
			...(metaEntry.part ? { part: metaEntry.part } : {}),
			separator: metaEntry.separator ?? "",
			fragments: secondFragments,
		},
	};
}

function splitMetaEntry(
	translation: TranslationData,
	idx: number,
	splitAt: number,
): { first: SegmentMeta; second: SegmentMeta } | undefined {
	const entry = translation.segmentsMeta?.[idx];
	if (!entry) return undefined;

	if (translation.type === "json" && isJsonMetaEntry(entry)) {
		return {
			first: { ...entry, path: [...entry.path], separator: "" },
			second: {
				...entry,
				path: [...entry.path],
				separator: entry.separator ?? "",
			},
		};
	}

	if (translation.type === "html" && isHtmlMetaEntry(entry)) {
		const targeted =
			typeof entry.sourceText === "string" &&
			Number.isInteger(entry.start) &&
			Number.isInteger(entry.end);
		return {
			first: {
				...entry,
				path: [...entry.path],
				separator: "",
				...(targeted
					? {
							sourceText: translation.seg1[idx].slice(0, splitAt),
							suffix: "",
						}
					: {}),
			},
			second: {
				...entry,
				path: [...entry.path],
				separator: entry.separator ?? "",
				...(targeted
					? {
							sourceText: translation.seg1[idx].slice(splitAt),
							prefix: "",
						}
					: {}),
			},
		};
	}

	if (translation.type === "docx" && isDocxMetaEntry(entry)) {
		return splitDocxMetaEntry(entry, splitAt);
	}

	return undefined;
}

function stripOwnedSeparator(value: string, entry: SegmentMeta | undefined) {
	const separator = entry?.separator ?? "";
	return separator && value.endsWith(separator)
		? value.slice(0, -separator.length)
		: value;
}

function cloneSegmentMeta(
	entry: SegmentMeta | undefined,
): SegmentMeta | undefined {
	if (!entry) return undefined;
	if (isDocxMetaEntry(entry)) {
		return {
			...entry,
			fragments: entry.fragments.map((fragment) => ({ ...fragment })),
		};
	}
	if (isJsonMetaEntry(entry)) return { ...entry, path: [...entry.path] };
	if (isHtmlMetaEntry(entry)) return { ...entry, path: [...entry.path] };
	return undefined;
}

function cloneJoinState(
	state: SegmentJoinState | null,
): SegmentJoinState | null {
	return state
		? {
				targetSnapshot: state.targetSnapshot,
				boundaries: state.boundaries.map((boundary) => ({
					...boundary,
					firstMeta: cloneSegmentMeta(boundary.firstMeta),
					secondMeta: cloneSegmentMeta(boundary.secondMeta),
				})),
			}
		: null;
}

function isValidJoinState(
	state: SegmentJoinState | null | undefined,
	source: string,
): state is SegmentJoinState {
	return (
		!!state &&
		typeof state.targetSnapshot === "string" &&
		Array.isArray(state.boundaries) &&
		state.boundaries.every(
			(boundary) =>
				!!boundary &&
				typeof boundary === "object" &&
				Number.isInteger(boundary.sourceOffset) &&
				boundary.sourceOffset > 0 &&
				boundary.sourceOffset < source.length &&
				(boundary.targetOffset === null ||
					(Number.isInteger(boundary.targetOffset) &&
						boundary.targetOffset >= 0 &&
						boundary.targetOffset <= state.targetSnapshot.length)),
		)
	);
}

function normalizedJoinStates(
	translation: TranslationData,
): Array<SegmentJoinState | null> {
	if (translation.segmentJoinStates?.length === translation.seg1.length) {
		return translation.segmentJoinStates.map((state, index) =>
			isValidJoinState(state, translation.seg1[index])
				? cloneJoinState(state)
				: null,
		);
	}
	return new Array(translation.seg1.length).fill(null);
}

export function getSegmentJoinBoundaryOffsets(
	translation: TranslationData,
	idx: number,
): number[] {
	const state = translation.segmentJoinStates?.[idx];
	return isValidJoinState(state, translation.seg1[idx] ?? "")
		? state.boundaries.map((boundary) => boundary.sourceOffset)
		: [];
}

function shiftedJoinBoundaries(
	state: SegmentJoinState | null,
	currentTarget: string,
	sourceOffset: number,
	targetOffset: number,
) {
	if (!state) return [];
	const targetOffsetsAreCurrent = state.targetSnapshot === currentTarget;
	return state.boundaries.map((boundary) => ({
		...boundary,
		sourceOffset: boundary.sourceOffset + sourceOffset,
		targetOffset:
			targetOffsetsAreCurrent && boundary.targetOffset !== null
				? boundary.targetOffset + targetOffset
				: null,
	}));
}

function splitJoinState(
	state: SegmentJoinState,
	sourceSplitAt: number,
	targetSplitAt: number,
	firstTarget: string,
	secondTarget: string,
): [SegmentJoinState | null, SegmentJoinState | null] {
	const firstBoundaries = state.boundaries
		.filter((boundary) => boundary.sourceOffset < sourceSplitAt)
		.map((boundary) => ({
			...boundary,
			firstMeta: cloneSegmentMeta(boundary.firstMeta),
			secondMeta: cloneSegmentMeta(boundary.secondMeta),
		}));
	const secondBoundaries = state.boundaries
		.filter((boundary) => boundary.sourceOffset > sourceSplitAt)
		.map((boundary) => ({
			...boundary,
			sourceOffset: boundary.sourceOffset - sourceSplitAt,
			targetOffset:
				boundary.targetOffset === null
					? null
					: boundary.targetOffset - targetSplitAt,
			firstMeta: cloneSegmentMeta(boundary.firstMeta),
			secondMeta: cloneSegmentMeta(boundary.secondMeta),
		}));

	return [
		firstBoundaries.length > 0
			? { targetSnapshot: firstTarget, boundaries: firstBoundaries }
			: null,
		secondBoundaries.length > 0
			? { targetSnapshot: secondTarget, boundaries: secondBoundaries }
			: null,
	];
}

function samePath(
	first: readonly (string | number)[],
	second: readonly (string | number)[],
) {
	return (
		first.length === second.length &&
		first.every((part, index) => part === second[index])
	);
}

function sameHtmlDestination(first: HtmlSegmentMeta, second: HtmlSegmentMeta) {
	return (
		first.kind === second.kind &&
		samePath(first.path, second.path) &&
		(first.kind !== "attribute" ||
			(second.kind === "attribute" && first.attribute === second.attribute))
	);
}

function docxParagraph(entry: DocxSegmentMeta): number | undefined {
	const paragraphs = new Set(
		entry.fragments.map((fragment) => fragment.paragraphIndex),
	);
	return paragraphs.size === 1 ? entry.fragments[0]?.paragraphIndex : undefined;
}

function combineMetaEntries(
	translation: TranslationData,
	idx: number,
): { entry?: SegmentMeta; error?: string } {
	if (translation.type === "text") return {};

	const current = translation.segmentsMeta?.[idx];
	const next = translation.segmentsMeta?.[idx + 1];

	if (
		translation.type === "json" &&
		isJsonMetaEntry(current) &&
		isJsonMetaEntry(next)
	) {
		if (!samePath(current.path, next.path)) {
			return { error: "Cannot join segments from different JSON fields." };
		}
		if (
			current.start !== next.start ||
			current.end !== next.end ||
			JSON.stringify(current.address ?? []) !==
				JSON.stringify(next.address ?? [])
		) {
			return { error: "Cannot join segments from different JSON values." };
		}
		return {
			entry: {
				...current,
				path: [...current.path],
				separator: next.separator ?? "",
			},
		};
	}

	if (
		translation.type === "html" &&
		isHtmlMetaEntry(current) &&
		isHtmlMetaEntry(next)
	) {
		if (!sameHtmlDestination(current, next)) {
			return {
				error: "Cannot join segments from different HTML nodes or attributes.",
			};
		}
		return {
			entry: {
				...current,
				path: [...current.path],
				separator: next.separator ?? "",
				...(typeof current.sourceText === "string" &&
				typeof next.sourceText === "string"
					? {
							sourceText: `${current.sourceText}${next.sourceText}`,
							suffix: next.suffix,
						}
					: {}),
			},
		};
	}

	if (
		translation.type === "docx" &&
		isDocxMetaEntry(current) &&
		isDocxMetaEntry(next)
	) {
		const currentPart = current.part ?? "word/document.xml";
		const nextPart = next.part ?? "word/document.xml";
		if (currentPart !== nextPart) {
			return {
				error: "Cannot join DOCX segments from different document parts.",
			};
		}
		const currentParagraph = docxParagraph(current);
		const nextParagraph = docxParagraph(next);
		if (
			currentParagraph === undefined ||
			nextParagraph === undefined ||
			currentParagraph !== nextParagraph
		) {
			return {
				error: "Cannot join DOCX segments across paragraph boundaries.",
			};
		}
		return {
			entry: {
				...(current.part || next.part ? { part: currentPart } : {}),
				separator: next.separator ?? "",
				fragments: [
					...current.fragments.map((fragment) => ({ ...fragment })),
					...next.fragments.map((fragment) => ({ ...fragment })),
				],
			},
		};
	}

	return {
		error: `Cannot join ${translation.type.toUpperCase()} segments with incompatible structural metadata.`,
	};
}

export function splitSegmentData(
	translation: TranslationData,
	idx: number,
	splitAt: number,
): SplitResult {
	const validationError = validateForStructuralEdit(translation);
	if (validationError) return { data: translation, error: validationError };

	if (!Number.isInteger(idx) || idx < 0 || idx >= translation.seg1.length) {
		return { data: translation, error: "Invalid segment index." };
	}

	const source = translation.seg1[idx];
	if (!Number.isInteger(splitAt) || splitAt <= 0 || splitAt >= source.length) {
		return {
			data: translation,
			error: "Place the caret inside the source text, not at either edge.",
		};
	}

	const splitMeta =
		translation.type === "text"
			? undefined
			: splitMetaEntry(translation, idx, splitAt);
	if (translation.type !== "text" && !splitMeta) {
		return {
			data: translation,
			error: `Cannot split this ${translation.type.toUpperCase()} segment without corrupting its structural mapping.`,
		};
	}

	const newSeg1 = [...translation.seg1];
	const newSeg2 = [...translation.seg2];
	const newChecked = [...translation.checked];
	const newMeta = translation.segmentsMeta
		? [...translation.segmentsMeta]
		: undefined;
	const hasAlignedJoinStates =
		translation.segmentJoinStates?.length === translation.seg1.length;
	const newJoinStates = hasAlignedJoinStates
		? normalizedJoinStates(translation)
		: undefined;
	const currentJoinState = newJoinStates?.[idx] ?? null;
	const matchingJoinBoundary = currentJoinState?.boundaries.find(
		(boundary) => boundary.sourceOffset === splitAt,
	);
	const canRestoreJoinedTargets =
		!!currentJoinState &&
		currentJoinState.targetSnapshot === translation.seg2[idx] &&
		matchingJoinBoundary?.targetOffset !== null &&
		matchingJoinBoundary?.targetOffset !== undefined;
	const targetSplitAt = canRestoreJoinedTargets
		? matchingJoinBoundary!.targetOffset!
		: null;
	const firstTarget =
		targetSplitAt === null
			? stripOwnedSeparator(
					translation.seg2[idx],
					translation.segmentsMeta?.[idx],
				)
			: translation.seg2[idx].slice(0, targetSplitAt);
	const secondTarget =
		targetSplitAt === null ? "" : translation.seg2[idx].slice(targetSplitAt);
	const restoredMeta =
		canRestoreJoinedTargets &&
		matchingJoinBoundary?.firstMeta &&
		matchingJoinBoundary.secondMeta
			? {
					first: cloneSegmentMeta(matchingJoinBoundary.firstMeta)!,
					second: cloneSegmentMeta(matchingJoinBoundary.secondMeta)!,
				}
			: undefined;
	const effectiveSplitMeta = restoredMeta ?? splitMeta;
	const restoredChecks =
		canRestoreJoinedTargets &&
		typeof matchingJoinBoundary?.firstChecked === "boolean" &&
		typeof matchingJoinBoundary.secondChecked === "boolean"
			? [matchingJoinBoundary.firstChecked, matchingJoinBoundary.secondChecked]
			: [false, false];
	const splitDocument = translation.documentModel
		? splitNeutralDocumentUnit(translation.documentModel, idx, splitAt, {
				firstTarget,
				secondTarget,
				firstChecked: restoredChecks[0],
				secondChecked: restoredChecks[1],
				firstId: matchingJoinBoundary?.firstUnitId,
				secondId: matchingJoinBoundary?.secondUnitId,
			})
		: undefined;
	if (splitDocument?.error) {
		return { data: translation, error: splitDocument.error };
	}

	newSeg1.splice(idx, 1, source.slice(0, splitAt), source.slice(splitAt));
	// A character offset in one language is not a meaningful target split point.
	// Keep the translatable target on the first half; its structural separator is
	// owned by metadata and moves to the second half.
	newSeg2.splice(idx, 1, firstTarget, secondTarget);
	newChecked.splice(idx, 1, ...restoredChecks);
	if (newMeta && effectiveSplitMeta) {
		newMeta.splice(idx, 1, effectiveSplitMeta.first, effectiveSplitMeta.second);
	}
	if (newJoinStates) {
		const splitStates =
			canRestoreJoinedTargets && currentJoinState && targetSplitAt !== null
				? splitJoinState(
						currentJoinState,
						splitAt,
						targetSplitAt,
						firstTarget,
						secondTarget,
					)
				: ([null, null] as const);
		newJoinStates.splice(idx, 1, ...splitStates);
	}

	return {
		data: {
			...translation,
			seg1: newSeg1,
			seg2: newSeg2,
			checked: newChecked,
			segmentsMeta: newMeta,
			segmentJoinStates: newJoinStates,
			documentModel: splitDocument?.document,
			skeleton: synchronizeSkeletonReplacements(
				translation.skeleton,
				newSeg1,
				newMeta,
			),
		},
		restoredJoinBoundary: canRestoreJoinedTargets,
	};
}

export function combineSegmentData(
	translation: TranslationData,
	idx: number,
): CombineResult {
	const validationError = validateForStructuralEdit(translation);
	if (validationError) return { data: translation, error: validationError };

	if (!Number.isInteger(idx) || idx < 0 || idx >= translation.seg1.length - 1) {
		return { data: translation, error: "Invalid segment index." };
	}
	const combinedMeta = combineMetaEntries(translation, idx);
	if (combinedMeta.error) {
		return { data: translation, error: combinedMeta.error };
	}

	const newSeg1 = [...translation.seg1];
	const newSeg2 = [...translation.seg2];
	const newChecked = [...translation.checked];
	const newMeta = translation.segmentsMeta
		? [...translation.segmentsMeta]
		: undefined;
	const newJoinStates = normalizedJoinStates(translation);
	const firstUnitId = translation.documentModel?.units[idx]?.id;
	const secondUnitId = translation.documentModel?.units[idx + 1]?.id;
	const combinedDocument = translation.documentModel
		? combineNeutralDocumentUnits(translation.documentModel, idx)
		: undefined;
	if (combinedDocument?.error) {
		return { data: translation, error: combinedDocument.error };
	}
	const currentSourceLength = newSeg1[idx].length;
	const currentTargetLength = newSeg2[idx].length;
	const joinedTarget = newSeg2[idx] + newSeg2[idx + 1];
	const firstMeta = cloneSegmentMeta(newMeta?.[idx]);
	const secondMeta = cloneSegmentMeta(newMeta?.[idx + 1]);
	const joinedState: SegmentJoinState = {
		targetSnapshot: joinedTarget,
		boundaries: [
			...shiftedJoinBoundaries(newJoinStates[idx], newSeg2[idx], 0, 0),
			{
				sourceOffset: currentSourceLength,
				targetOffset: currentTargetLength,
				...(firstUnitId ? { firstUnitId } : {}),
				...(secondUnitId ? { secondUnitId } : {}),
				...(firstMeta ? { firstMeta } : {}),
				...(secondMeta ? { secondMeta } : {}),
				firstChecked: newChecked[idx],
				secondChecked: newChecked[idx + 1],
			},
			...shiftedJoinBoundaries(
				newJoinStates[idx + 1],
				newSeg2[idx + 1],
				currentSourceLength,
				currentTargetLength,
			),
		].sort((first, second) => first.sourceOffset - second.sourceOffset),
	};

	newSeg1.splice(idx, 2, newSeg1[idx] + newSeg1[idx + 1]);
	newSeg2.splice(idx, 2, joinedTarget);
	newChecked.splice(idx, 2, newChecked[idx] && newChecked[idx + 1]);
	newJoinStates.splice(idx, 2, joinedState);
	if (newMeta && combinedMeta.entry) {
		newMeta.splice(idx, 2, combinedMeta.entry);
	}
	const synchronizedDocument = combinedDocument?.document
		? synchronizeNeutralDocument(
				combinedDocument.document,
				{ seg1: newSeg1, seg2: newSeg2, checked: newChecked },
				translation.sourceLang,
				translation.targetLang,
			)
		: undefined;

	return {
		data: {
			...translation,
			seg1: newSeg1,
			seg2: newSeg2,
			checked: newChecked,
			segmentsMeta: newMeta,
			segmentJoinStates: newJoinStates,
			documentModel: synchronizedDocument,
			skeleton: synchronizeSkeletonReplacements(
				translation.skeleton,
				newSeg1,
				newMeta,
			),
		},
	};
}

export function combineSegmentRangeData(
	translation: TranslationData,
	indices: readonly number[],
): CombineResult {
	if (indices.length < 2) {
		return {
			data: translation,
			error: "Select at least two consecutive segments to join.",
		};
	}

	const selected = [...indices].sort((a, b) => a - b);
	if (
		selected.some((index) => !Number.isInteger(index)) ||
		new Set(selected).size !== selected.length ||
		selected.some((index, position) =>
			position === 0 ? false : index !== selected[position - 1] + 1,
		)
	) {
		return {
			data: translation,
			error: "Selected segments must be consecutive to join.",
		};
	}

	if (
		selected[0] < 0 ||
		selected[selected.length - 1] >= translation.seg1.length
	) {
		return { data: translation, error: "Invalid segment selection." };
	}

	let combined = translation;
	for (let count = 1; count < selected.length; count++) {
		const result = combineSegmentData(combined, selected[0]);
		if (result.error) {
			// Range joins are atomic: never return a partially joined document.
			return { data: translation, error: result.error };
		}
		combined = result.data;
	}

	return { data: combined };
}

export function findSplitPoint(text: string): number {
	if (text.length === 0) return 0;
	if (text.length === 1) return 1;
	const mid = Math.floor(text.length / 2);
	const after = text.indexOf(" ", mid);
	const before = text.lastIndexOf(" ", mid);
	if (after !== -1 && after < text.length - 1) return after + 1;
	if (before !== -1 && before > 0) return before + 1;
	return mid;
}
