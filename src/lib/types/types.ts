export interface Sgmt {
	segment: string;
	checked: boolean;
}

export type TypeRef = string | { [key: string]: string | Blob };

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
		type: string;
		typeRef: TypeRef;
	};
}
