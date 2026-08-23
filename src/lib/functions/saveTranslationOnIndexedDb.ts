import type { Type, TypeRef, UserData } from "$lib/types/types";
import {
	loadTranslationsUserDataFromIndexedDB,
	replaceTranslationOnIndexedDB,
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
import type { NeutralDocument } from "$lib/formats/documentModel";
import type { DocumentSkeleton } from "$lib/formats/skeleton";
import type { FormatOptionValues } from "$lib/formats/types";

export async function saveAndOpenNewFileWithTextString(
	temporarySaveName: string,
	sourceLang: string,
	targetLang: string,
	date: string,
	fullText: string,
	fileType: Type,
	fileTypeRef?: TypeRef,
	documentModel?: NeutralDocument,
	skeleton?: DocumentSkeleton,
	filterOptions?: FormatOptionValues,
) {
	const data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
	const singleData = await saveNewTranslationToUserDataFromText(
		data,
		temporarySaveName,
		sourceLang,
		targetLang,
		date,
		fullText,
		fileType,
		fileTypeRef,
		documentModel,
		skeleton,
		filterOptions,
	);
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
	documentModel?: NeutralDocument,
	skeleton?: DocumentSkeleton,
	filterOptions?: FormatOptionValues,
	initialTargetSegments?: readonly string[],
) {
	const data: UserData[] = await loadTranslationsUserDataFromIndexedDB();
	const singleData = await saveNewTranslationToUserDataFromArrayOfStrings(
		data,
		temporarySaveName,
		sourceLang,
		targetLang,
		creationDate,
		arrayOfStrings,
		fileType,
		fileTypeRef,
		segmentsMeta,
		documentModel,
		skeleton,
		filterOptions,
		initialTargetSegments,
	);
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
	const singleData = await saveNewTranslationToUserDataFromSaveFile(
		fullData,
		userData,
	);
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

export async function replaceAndOpenProjectFromSaveFile(userData: UserData) {
	await replaceTranslationOnIndexedDB(userData);
	singleUserData.set(userData);
	translationIdSelected.set(userData.id!);
	seg1WordCount.set(getTotalWordCount(userData.translationData.seg1));
	seg2WordCount.set(getTotalWordCount(userData.translationData.seg2));
	openMenu.set(false);
}
