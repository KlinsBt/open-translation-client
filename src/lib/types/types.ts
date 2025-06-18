export interface Sgmt {
	segment: string;
	checked: boolean;
}

export type TypeRef = string | { [key: string]: string | Blob };
export type Type = "text" | "json" | "docx" | "xlsx" | "html";

export interface UserData {
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
		segSpec?: {
			deepSeg: boolean;
			segTrack: number[];
		};
	};
}

export interface TmData {
	id?: number;
	name?: string;
	terms: {
		// id: number;
		source: {
			lang: string;
			segment: string;
		};
		target: {
			lang: string;
			segment: string;
		}[];
	}[];
}

export interface TmEntry {
	source: string;
	match: number;
	target: string;
}

export interface TbData {
	id?: number;
	name?: string;
	entries: {
		// id: number;
		terms: {
			lang: string;
			term: string;
			notes:
				| string[]
				| {
						type: string;
						text: string;
				  }[];
		}[];
	}[];
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
