import type { FormatId } from "$lib/formats/formatIds";

import type {
	NeutralDocument,
	SegmentContent,
} from "$lib/formats/documentModel";
import type { DocumentSkeleton } from "$lib/formats/skeleton";
import type { FormatOptionValues } from "$lib/formats/types";

export interface Sgmt {
	segment: string;
	checked: boolean;
}

export type TypeRef = string | { [key: string]: string | Blob | any[] };
export type Type = FormatId;

export interface DocxFragmentMeta {
	paragraphIndex: number;
	textNodeIndex: number;
	start: number;
	end: number;
}

export interface DocxSegmentMeta {
	part?: string;
	separator?: string;
	fragments: DocxFragmentMeta[];
}

export type PptxSegmentMeta =
	| {
			kind: "text";
			part: string;
			separator?: string;
			fragments: DocxFragmentMeta[];
	  }
	| {
			kind: "attribute";
			part: string;
			elementIndex: number;
			attribute: "title" | "descr";
			separator?: string;
	  };

export interface JsonSegmentMeta {
	path: string[];
	separator?: string;
}

export interface CsvSegmentMeta {
	row: number;
	column: number;
	sourceColumn: number;
	separator?: string;
	key?: string;
	context?: string;
}

export type HtmlSegmentMeta =
	| {
			kind: "text";
			path: number[];
			separator?: string;
			start?: number;
			end?: number;
			sourceText?: string;
			prefix?: string;
			suffix?: string;
			language?: string;
			direction?: "ltr" | "rtl" | "auto";
			note?: string;
	  }
	| {
			kind: "attribute";
			path: number[];
			attribute: string;
			separator?: string;
			start?: number;
			end?: number;
			sourceText?: string;
			prefix?: string;
			suffix?: string;
			quote?: '"' | "'" | "unquoted";
			language?: string;
			direction?: "ltr" | "rtl" | "auto";
			note?: string;
	  };

export type SegmentMeta =
	| DocxSegmentMeta
	| PptxSegmentMeta
	| CsvSegmentMeta
	| JsonSegmentMeta
	| HtmlSegmentMeta;

export interface SegmentJoinBoundary {
	sourceOffset: number;
	targetOffset: number | null;
	firstUnitId?: string;
	secondUnitId?: string;
	firstMeta?: SegmentMeta;
	secondMeta?: SegmentMeta;
	firstChecked?: boolean;
	secondChecked?: boolean;
}

export interface SegmentJoinState {
	targetSnapshot: string;
	boundaries: SegmentJoinBoundary[];
}

export interface UserData {
	schemaVersion?: number;
	id?: number;
	translationData: {
		name: string;
		targetLang: string;
		sourceLang: string;
		creationDate: string;
		seg1: string[];
		seg2: string[];
		checked: boolean[];
		type: Type;
		typeRef: TypeRef;
		segmentsMeta?: SegmentMeta[];
		segmentJoinStates?: Array<SegmentJoinState | null>;
		documentModel?: NeutralDocument;
		skeleton?: DocumentSkeleton;
		filterOptions?: FormatOptionValues;
		tm: null | {
			id: null | number;
			name: null | string;
			active: boolean;
		};
		tb: {
			id: null | number;
			name: null | string;
			active: boolean;
		};
		parsingTokens?: string[];
		segSpec?: {
			deepSeg: boolean;
			segTrack: number[];
		};
	};
}

export interface TmxTextMetadata {
	text: string;
	language?: string;
	originalEncoding?: string;
}

export interface TmxProperty extends TmxTextMetadata {
	type: string;
}

export interface TmxUserDefinedEncoding {
	name: string;
	base?: string;
	maps: Record<string, string>[];
}

export interface TmxDocumentMetadata {
	version: "1.4";
	level: 1 | 2;
	headerAttributes: Record<string, string>;
	notes: TmxTextMetadata[];
	properties: TmxProperty[];
	userDefinedEncodings: TmxUserDefinedEncoding[];
	doctype?: string;
}

export interface TmxUnitMetadata {
	attributes: Record<string, string>;
	notes: TmxTextMetadata[];
	properties: TmxProperty[];
	variantOrder: string[];
}

export interface TmxVariantMetadata {
	attributes: Record<string, string>;
	notes: TmxTextMetadata[];
	properties: TmxProperty[];
}

export interface TmVariant {
	[key: string]: unknown;
	lang: string;
	segment: string;
	content?: SegmentContent;
	tmx?: TmxVariantMetadata;
}

export interface TmTerm {
	[key: string]: unknown;
	tuid?: string;
	source: TmVariant;
	target: TmVariant[];
	tmx?: TmxUnitMetadata;
}

export interface TmData {
	schemaVersion?: number;
	id?: number;
	name?: string;
	terms: TmTerm[];
	tmx?: TmxDocumentMetadata;
}

export interface TmEntry {
	source: string;
	match: number;
	target: string;
}

export type TbxDialect = "TBX-Core" | "TBX-Min" | "TBX-Basic";
export type TbxStyle = "dca" | "dct";

export interface TbxDataCategory {
	/** XML qualified name; DCT prefixes and unknown extension names are retained. */
	name: string;
	localName: string;
	namespace?: string;
	type?: string;
	text: string;
	attributes: Record<string, string>;
	children: TbxDataCategory[];
}

export interface TbxLanguageSectionMetadata {
	index: number;
	name: "langSec" | "langSet";
	language: string;
	attributes: Record<string, string>;
	dataCategories: TbxDataCategory[];
}

export interface TbxTermMetadata {
	id?: string;
	containerName: "termSec" | "tig" | "ntig" | "bare";
	containerAttributes: Record<string, string>;
	languageSectionIndex: number;
	dataCategories: TbxDataCategory[];
	termMarker: string;
	originalTerm: string;
	originalTermXml: string;
}

export interface TbxEntryMetadata {
	id?: string;
	recordName: "conceptEntry" | "termEntry";
	attributes: Record<string, string>;
	dataCategories: TbxDataCategory[];
	languageSections: TbxLanguageSectionMetadata[];
	version?: 2 | 3;
	dialect?: TbxDialect;
	style?: TbxStyle;
	/** Native entry XML with numbered term-value markers for lossless rebuilding. */
	skeletonXml?: string;
}

export interface TbxDocumentMetadata {
	version: 2 | 3;
	dialect: TbxDialect;
	style: TbxStyle;
	rootName: "tbx" | "martif";
	rootAttributes: Record<string, string>;
	/** Document XML outside streamed entries, with numbered entry placeholders. */
	documentSkeletonXml?: string;
	schemaAssets: string[];
}

export interface TbTerm {
	[key: string]: unknown;
	lang: string;
	term: string;
	notes: string[] | { type: string; text: string }[];
	status?: string;
	partOfSpeech?: string;
	definition?: string;
	tbx?: TbxTermMetadata;
}

export interface TbEntry {
	[key: string]: unknown;
	terms: TbTerm[];
	tbx?: TbxEntryMetadata;
}

export interface TbData {
	schemaVersion?: number;
	id?: number;
	name?: string;
	entries: TbEntry[];
	tbx?: TbxDocumentMetadata;
}

export interface ParagraphData {
	runs: RunData[]; // The combined text of all runs in this paragraph
	fullText: string; // Possibly store offsets for each run
}

export interface RunData {
	element: Element; // The <w:r> DOM element
	textNodes: TextNodeData[]; // Each <w:t> inside
	start: number; // Start offset in the paragraph's fullText
	end: number; // End offset in the paragraph's fullText
}

export interface TextNodeData {
	node: Element; // The <w:t> element
	start: number; // Start offset in the run's text
	end: number; // End offset in the run's text
	text: string; // Original text content
}
