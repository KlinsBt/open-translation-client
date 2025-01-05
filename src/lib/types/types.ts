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
	};
}

export interface TmData {
	id?: number;
	name?: string;
	terms: {
		id: number;
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
		id: number;
		terms: {
			lang: string;
			term: string;
			notes: string[];
		}[];
	}[];
}
