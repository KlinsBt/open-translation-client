import type { TypeRef, UserData } from "$lib/types/types";
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
import { userData } from "./saveData/stores.svelte";

export async function saveAndOpenNewFileWithTextString(
	temporarySaveName: string,
	sourceLang: string,
	targetLang: string,
	date: string,
	fullText: string,
	fileType?: string,
	fileTypeRef?: TypeRef,
) {
	let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
	saveNewTranslationToUserDataFromText(
		data,
		temporarySaveName,
		sourceLang,
		targetLang,
		date,
		fullText,
		fileType,
		fileTypeRef,
	).then(async () => {
		let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
		let singleData: UserData = data.find(
			(d) => d.id === data[data.length - 1].id,
		) as UserData;
		if (!singleData) throw new Error("No data found");
		singleUserData.set(singleData);
		translationIdSelected.set(singleData.id!);
		seg1WordCount.set(getTotalWordCount(singleData.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(singleData.translationData.seg2));
		openMenu.set(false);
	});
}

export async function saveAndOpenNewFileWithStringArray(
	temporarySaveName: string,
	sourceLang: string,
	targetLang: string,
	creationDate: string,
	arrayOfStrings: string[],
	fileType?: string,
	fileTypeRef?: TypeRef,
) {
	let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
	saveNewTranslationToUserDataFromArrayOfStrings(
		data,
		temporarySaveName,
		sourceLang,
		targetLang,
		creationDate,
		arrayOfStrings,
		fileType,
		fileTypeRef,
	).then(async () => {
		let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
		let singleData: UserData = data.find(
			(d) => d.id === data[data.length - 1].id,
		) as UserData;
		if (!singleData) throw new Error("No data found");
		singleUserData.set(singleData);
		translationIdSelected.set(singleData.id!);
		seg1WordCount.set(getTotalWordCount(singleData.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(singleData.translationData.seg2));
		openMenu.set(false);
	});
}

export async function saveAndOpenNewFileWithStringArrayFromSaveFile(
	fullData: UserData[],
	userData: UserData,
) {
	let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
	saveNewTranslationToUserDataFromSaveFile(fullData, userData).then(
		async () => {
			let data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
			let singleData: UserData = data.find(
				(d) => d.id === data[data.length - 1].id,
			) as UserData;
			if (!singleData) throw new Error("No data found");
			singleUserData.set(singleData);
			translationIdSelected.set(singleData.id!);
			seg1WordCount.set(getTotalWordCount(singleData.translationData.seg1));
			seg2WordCount.set(getTotalWordCount(singleData.translationData.seg2));
			openMenu.set(false);
		},
	);
}

export async function updateAndOpenNewFileWithStringArray(userData: UserData) {
	updateTranslationOnIndexedDB(userData).then(async () => {
		singleUserData.set(userData);
		translationIdSelected.set(userData.id!);
		seg1WordCount.set(getTotalWordCount(userData.translationData.seg1));
		seg2WordCount.set(getTotalWordCount(userData.translationData.seg2));
		openMenu.set(false);
	});
}
