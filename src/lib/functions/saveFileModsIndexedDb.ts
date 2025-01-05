import type { Type, TypeRef, UserData } from "../types/types";
import { createTextSegmentsWithRegexGeneralTextAlgo } from "./parsing/parsingText";
import { updateTranslationOnIndexedDB } from "./saveData/indexedDb";
import { userData } from "./saveData/stores.svelte";

export async function saveNewTranslationToUserDataFromText(
	fullData: UserData[],
	saveName: string,
	sourceLang: string,
	targetLang: string,
	creationDate: string,
	fullText: string,
	fileType: Type,
	fileTypeRef?: TypeRef,
) {
	let generatedText = createTextSegmentsWithRegexGeneralTextAlgo(fullText);
	let data: UserData = {
		translationData: {
			name: saveName,
			sourceLang: sourceLang,
			targetLang: targetLang,
			creationDate: creationDate,
			seg1: generatedText[0],
			seg2: generatedText[1],
			checked: generatedText[2],
			type: fileType,
			typeRef: fileTypeRef || {},
			tm: {
				id: null,
				name: null,
				active: false,
			},
			tb: {
				id: null,
				name: null,
				active: false,
			},
		},
	};
	fullData.push(data);
	await updateTranslationOnIndexedDB(data);
	userData.set(fullData);
}

export async function saveNewTranslationToUserDataFromArrayOfStrings(
	fullData: UserData[],
	saveName: string,
	sourceLang: string,
	targetLang: string,
	creationDate: string,
	stringArray: string[],
	fileType: Type,
	fileTypeRef?: TypeRef,
) {
	let data: UserData = {
		translationData: {
			name: saveName,
			sourceLang: sourceLang,
			targetLang: targetLang,
			creationDate: creationDate,
			seg1: stringArray,
			seg2: new Array(stringArray.length).fill(""),
			checked: new Array(stringArray.length).fill(false),
			type: fileType,
			typeRef: fileTypeRef || {},
			tm: {
				id: null,
				name: null,
				active: false,
			},
			tb: {
				id: null,
				name: null,
				active: false,
			},
		},
	};
	fullData.push(data);
	await updateTranslationOnIndexedDB(data);
	userData.set(fullData);
}

export async function saveNewTranslationToUserDataFromSaveFile(
	fullData: UserData[],
	data: UserData,
) {
	fullData.push(data);
	await updateTranslationOnIndexedDB(data);
	userData.set(fullData);
}
