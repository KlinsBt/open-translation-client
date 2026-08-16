import type { Type, TypeRef, UserData } from "../types/types";
import { createTextSegmentsWithRegexGeneralTextAlgo } from "./parsing/parsingText";
import { updateTranslationOnIndexedDB } from "./saveData/indexedDb";
import { userData } from "./saveData/stores.svelte";
import {
	getActiveTokens,
	getDefaultTokens,
} from "./parsing/parsingPreferences";
import {
	createNeutralDocument,
	synchronizeNeutralDocument,
	withDocumentLanguages,
	type NeutralDocument,
} from "$lib/formats/documentModel";
import type { DocumentSkeleton } from "$lib/formats/skeleton";
import type { FormatOptionValues } from "$lib/formats/types";
import { normalizeImportOptions } from "$lib/formats/options";

function prepareDocumentModel(
	documentModel: NeutralDocument | undefined,
	fileType: Type,
	creationDate: string,
	sourceLang: string,
	targetLang: string,
	seg1: string[],
	seg2: string[],
	checked: boolean[],
): NeutralDocument {
	const document = documentModel
		? {
				...withDocumentLanguages(documentModel, sourceLang, targetLang),
				id:
					documentModel.id === "document-1"
						? `project-${creationDate}`
						: documentModel.id,
			}
		: createNeutralDocument({
				format: fileType,
				documentId: `project-${creationDate}`,
				sourceSegments: seg1,
				targetSegments: seg2,
				checked,
				sourceLanguage: sourceLang,
				targetLanguage: targetLang,
			});
	return synchronizeNeutralDocument(
		document,
		{ seg1, seg2, checked },
		sourceLang,
		targetLang,
	);
}

export async function saveNewTranslationToUserDataFromText(
	fullData: UserData[],
	saveName: string,
	sourceLang: string,
	targetLang: string,
	creationDate: string,
	fullText: string,
	fileType: Type,
	fileTypeRef?: TypeRef,
	documentModel?: NeutralDocument,
	skeleton?: DocumentSkeleton,
	filterOptions?: FormatOptionValues,
) {
	let generatedText = createTextSegmentsWithRegexGeneralTextAlgo(fullText);
	const model = prepareDocumentModel(
		documentModel,
		fileType,
		creationDate,
		sourceLang,
		targetLang,
		generatedText[0],
		generatedText[1],
		generatedText[2],
	);
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
			segmentsMeta: [],
			documentModel: model,
			skeleton,
			filterOptions: normalizeImportOptions(fileType, filterOptions),
			parsingTokens: getActiveTokens() || getDefaultTokens(),
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
	segmentsMeta?: any[],
	documentModel?: NeutralDocument,
	skeleton?: DocumentSkeleton,
	filterOptions?: FormatOptionValues,
) {
	const targetSegments = new Array(stringArray.length).fill("");
	const checkedSegments = new Array(stringArray.length).fill(false);
	let data: UserData = {
		translationData: {
			name: saveName,
			sourceLang: sourceLang,
			targetLang: targetLang,
			creationDate: creationDate,
			seg1: stringArray,
			seg2: targetSegments,
			checked: checkedSegments,
			type: fileType,
			typeRef: fileTypeRef || {},
			segmentsMeta: segmentsMeta || [],
			documentModel: prepareDocumentModel(
				documentModel,
				fileType,
				creationDate,
				sourceLang,
				targetLang,
				stringArray,
				targetSegments,
				checkedSegments,
			),
			skeleton,
			filterOptions: normalizeImportOptions(fileType, filterOptions),
			parsingTokens: getActiveTokens() || getDefaultTokens(),
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
	data.translationData.filterOptions = normalizeImportOptions(
		data.translationData.type,
		data.translationData.filterOptions,
	);
	if (!data.translationData.parsingTokens) {
		data.translationData.parsingTokens = getDefaultTokens();
	}
	if (!data.translationData.documentModel) {
		const translation = data.translationData;
		translation.documentModel = createNeutralDocument({
			format: translation.type,
			documentId: `project-${translation.creationDate}`,
			sourceSegments: translation.seg1,
			targetSegments: translation.seg2,
			checked: translation.checked,
			sourceLanguage: translation.sourceLang,
			targetLanguage: translation.targetLang,
		});
	}
	fullData.push(data);
	await updateTranslationOnIndexedDB(data);
	userData.set(fullData);
}
