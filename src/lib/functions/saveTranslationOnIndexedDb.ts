import type { Type, TypeRef, UserData } from "$lib/types/types";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateTranslationOnIndexedDB,
} from "./saveData/indexedDb";
import {
	translationIdSelected,
	seg1WordCount,
	seg2WordCount,
	openMenu,
	singleUserData,
} from "./saveData/stores.svelte";
import {
	saveNewTranslationToUserDataFromText,
	saveNewTranslationToUserDataFromArrayOfStrings,
	saveNewTranslationToUserDataFromSaveFile,
} from "./saveFileModsIndexedDb";
import { getTotalWordCount } from "./statistics";

export async function saveAndOpenNewFileWithTextString(
	temporarySaveName: string,
	sourceLang: string,
	targetLang: string,
	date: string,
	fullText: string,
	fileType: Type,
	fileTypeRef?: TypeRef,
) {
	let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
	await saveNewTranslationToUserDataFromText(
		data,
		temporarySaveName,
		sourceLang,
		targetLang,
		date,
		fullText,
		fileType,
		fileTypeRef,
	);
	data = await loadTranslationsUserDataFromIndexedDB();
	const singleData = data[data.length - 1];
	if (!singleData) throw new Error("No data found");
	singleUserData.set(singleData);
	translationIdSelected.set(singleData.id!);
	seg1WordCount.set(getTotalWordCount(singleData.translationData.seg1));
	seg2WordCount.set(getTotalWordCount(singleData.translationData.seg2));
	openMenu.set(false);
}

export async function saveAndOpenNewFileWithStringArray(
	temporarySaveName: string,
	sourceLang: string,
	targetLang: string,
	creationDate: string,
	arrayOfStrings: string[],
	fileType: Type,
	fileTypeRef?: TypeRef,
	segmentsMeta?: any[],
) {
	let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
	await saveNewTranslationToUserDataFromArrayOfStrings(
		data,
		temporarySaveName,
		sourceLang,
		targetLang,
		creationDate,
		arrayOfStrings,
		fileType,
		fileTypeRef,
		segmentsMeta,
	);
	data = await loadTranslationsUserDataFromIndexedDB();
	const singleData = data[data.length - 1];
	if (!singleData) throw new Error("No data found");
	singleUserData.set(singleData);
	translationIdSelected.set(singleData.id!);
	seg1WordCount.set(getTotalWordCount(singleData.translationData.seg1));
	seg2WordCount.set(getTotalWordCount(singleData.translationData.seg2));
	openMenu.set(false);
}

export async function saveAndOpenNewFileWithStringArrayFromSaveFile(
	fullData: UserData[],
	userData: UserData,
) {
	await saveNewTranslationToUserDataFromSaveFile(fullData, userData);
	const data = await loadTranslationsUserDataFromIndexedDB();
	const singleData = data[data.length - 1];
	if (!singleData) throw new Error("No data found");
	singleUserData.set(singleData);
	translationIdSelected.set(singleData.id!);
	seg1WordCount.set(getTotalWordCount(singleData.translationData.seg1));
	seg2WordCount.set(getTotalWordCount(singleData.translationData.seg2));
	openMenu.set(false);
}

export async function updateAndOpenNewFileWithStringArray(userData: UserData) {
	await updateTranslationOnIndexedDB(userData);
	singleUserData.set(userData);
	translationIdSelected.set(userData.id!);
	seg1WordCount.set(getTotalWordCount(userData.translationData.seg1));
	seg2WordCount.set(getTotalWordCount(userData.translationData.seg2));
	openMenu.set(false);
}
