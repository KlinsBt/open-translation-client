import {
	type TbData,
	type TmData,
	type Type,
	type TypeRef,
	type UserData,
} from "../../types/types.js";
import { getDefaultTokens } from "$lib/functions/parsing/parsingPreferences";
import { segmentDocxXml } from "$lib/functions/parsing/parsingDocx";
import {
	createNeutralDocument,
	synchronizeNeutralDocument,
} from "$lib/formats/documentModel";
import {
	createSkeletonFromLegacy,
	synchronizeSkeletonReplacements,
	validateDocumentSkeleton,
} from "$lib/formats/skeleton";
import { normalizeImportOptions } from "$lib/formats/options";
import { processInBatches } from "$lib/formats/streaming";
import {
	migrateProjectData,
	migrateTbData,
	migrateTmData,
} from "$lib/formats/persistenceMigrations";
import {
	tbData,
	tmData,
	userData,
} from "$lib/functions/saveData/stores.svelte";

const DB_NAME = "OPEN_TLC_5432_DB";
const DB_VERSION = 3; // No floats
const DB_USER_STORE_NAME = "UserData";
const DB_TM_NAME = "TMData";
const DB_TB_NAME = "TBData";
const DURABILITY = "relaxed"; // "strict" or "relaxed"
export const INDEXED_DB_WRITE_BATCH_SIZE = 100;

let db: IDBDatabase | null = null;

export function ensureProjectModels(userData: UserData): UserData {
	Object.assign(userData, migrateProjectData(userData));
	const translation = userData.translationData;
	translation.filterOptions = normalizeImportOptions(
		translation.type,
		translation.filterOptions,
	);
	const document =
		translation.documentModel ??
		createNeutralDocument({
			format: translation.type,
			documentId: `project-${translation.creationDate}`,
			sourceSegments: translation.seg1,
			targetSegments: translation.seg2,
			checked: translation.checked,
			sourceLanguage: translation.sourceLang,
			targetLanguage: translation.targetLang,
		});
	translation.documentModel = synchronizeNeutralDocument(
		document,
		{
			seg1: translation.seg1,
			seg2: translation.seg2,
			checked: translation.checked,
		},
		translation.sourceLang,
		translation.targetLang,
	);
	if (
		!translation.skeleton ||
		!validateDocumentSkeleton(translation.skeleton).valid
	) {
		translation.skeleton = createSkeletonFromLegacy({
			format: translation.type,
			name: translation.name,
			typeRef: translation.typeRef,
			segments: translation.seg1,
			segmentsMeta: translation.segmentsMeta,
		});
	}
	translation.skeleton = synchronizeSkeletonReplacements(
		translation.skeleton,
		translation.seg1,
		translation.segmentsMeta,
	);
	return userData;
}

// Open (or create) the IndexedDB database
function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(DB_USER_STORE_NAME)) {
				db.createObjectStore(DB_USER_STORE_NAME, {
					keyPath: "id",
					autoIncrement: true,
				});
			}
			if (!db.objectStoreNames.contains(DB_TM_NAME)) {
				db.createObjectStore(DB_TM_NAME, {
					keyPath: "id",
					autoIncrement: true,
				});
			}
			if (!db.objectStoreNames.contains(DB_TB_NAME)) {
				db.createObjectStore(DB_TB_NAME, {
					keyPath: "id",
					autoIncrement: true,
				});
			}
		};

		request.onsuccess = (event) => {
			db = (event.target as IDBOpenDBRequest).result;
			resolve(db);
		};

		request.onerror = (event) => {
			console.error(
				"IndexedDB error:",
				(event.target as IDBOpenDBRequest).error,
			);
			reject((event.target as IDBOpenDBRequest).error);
		};
	});
}

// Load translations from IndexedDB
export async function loadTranslationsUserDataFromIndexedDB(): Promise<
	UserData[]
> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_USER_STORE_NAME, "readonly");
		const store = transaction.objectStore(DB_USER_STORE_NAME);
		const request = store.getAll();

		request.onsuccess = (event) => {
			try {
				let result = (event.target as IDBRequest).result as unknown[];
				result = result.map((storedItem) => {
					const item = migrateProjectData(storedItem);
					if (!item.translationData.parsingTokens) {
						item.translationData.parsingTokens = getDefaultTokens();
					}
					if (!item.translationData.segmentsMeta) {
						item.translationData.segmentsMeta = [];
					}
					// Recompute docx segmentsMeta if missing but document.xml available
					if (
						item.translationData.type === "docx" &&
						Array.isArray(item.translationData.segmentsMeta) &&
						item.translationData.segmentsMeta.length === 0 &&
						item.translationData.typeRef &&
						(item.translationData.typeRef as any)["word/document.xml"]
					) {
						const docXml = (item.translationData.typeRef as any)[
							"word/document.xml"
						] as string;
						try {
							const { meta, segments } = segmentDocxXml(
								docXml,
								item.translationData.parsingTokens,
							);
							if (segments.length === item.translationData.seg1.length) {
								item.translationData.segmentsMeta = meta;
							}
						} catch (e) {
							console.error("Failed to regenerate docx meta", e);
						}
					}
					return ensureProjectModels(item);
				});
				userData.set(result as UserData[]);
				resolve(result as UserData[]);
			} catch (error) {
				reject(error);
			}
		};

		request.onerror = (event) => {
			console.error("Request error:", (event.target as IDBRequest).error);
			reject((event.target as IDBRequest).error);
		};
	});
}

// Save a new translation to IndexedDB
export async function saveNewTranslationToIndexedDB(
	// oldUserData: UserData[],
	tempSaveName: string,
	targetLang: string,
	sourceLang: string,
	creationDate: string,
	textSegments1: string[],
	textSegments2: string[],
	checkedSegments: boolean[],
	fileType: Type,
	fileTypeRef: TypeRef,
): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_USER_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_USER_STORE_NAME);
		const newUserData = ensureProjectModels(
			migrateProjectData({
				translationData: {
					name: tempSaveName,
					targetLang,
					sourceLang,
					creationDate,
					seg1: textSegments1,
					seg2: textSegments2,
					checked: checkedSegments,
					type: fileType,
					typeRef: fileTypeRef,
					parsingTokens: getDefaultTokens(),
					tm: { id: null, name: null, active: false },
					tb: { id: null, name: null, active: false },
				},
			}),
		);
		const request = store.add(newUserData);

		request.onsuccess = () => {
			loadTranslationsUserDataFromIndexedDB(); // Reload data after saving
			resolve();
		};

		request.onerror = (event) => {
			console.error("Transaction error:", (event.target as IDBRequest).error);
			reject((event.target as IDBRequest).error);
		};
	});
}

// Update all translation data in IndexedDB
export async function updateAllTranslationsOnIndexedDB(
	fullUserData: UserData[],
): Promise<void> {
	const db = await openDatabase();
	await processInBatches(
		fullUserData,
		async (batch) => {
			for (const data of batch) ensureProjectModels(data);
			await writeTranslationBatch(db, batch);
		},
		{ batchSize: INDEXED_DB_WRITE_BATCH_SIZE },
	);
	await loadTranslationsUserDataFromIndexedDB();
}

function writeTranslationBatch(
	database: IDBDatabase,
	batch: readonly UserData[],
): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(DB_USER_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_USER_STORE_NAME);
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed."));
		transaction.onabort = () =>
			reject(
				transaction.error ?? new Error("IndexedDB transaction was aborted."),
			);
		for (const data of batch) store.put(data);
	});
}

// Update translation in IndexedDB
export async function updateTranslationOnIndexedDB(
	userData: UserData,
): Promise<void> {
	ensureProjectModels(userData);
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_USER_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_USER_STORE_NAME);
		const request = store.put(userData);

		request.onsuccess = () => {
			loadTranslationsUserDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function deleteTranslationFromIndexedDB(
	id: number,
): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_USER_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_USER_STORE_NAME);
		const request = store.delete(id);

		request.onsuccess = () => {
			loadTranslationsUserDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			reject((event.target as IDBRequest).error);
		};
	});
}

////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
/////////////// TM Section /////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
export async function loadTmDataFromIndexedDB(): Promise<TmData[]> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_TM_NAME, "readonly");
		const store = transaction.objectStore(DB_TM_NAME);
		const request = store.getAll();

		request.onsuccess = (event) => {
			try {
				const result = ((event.target as IDBRequest).result as unknown[]).map(
					migrateTmData,
				);
				resolve(result);
				tmData.set(result);
			} catch (error) {
				reject(error);
			}
		};

		request.onerror = (event) => {
			console.error("Request error:", (event.target as IDBRequest).error);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function getTmNamesAndIds(): Promise<
	{ id: number; name: string }[]
> {
	try {
		// Load all TMData from IndexedDB
		const tmDataList = await loadTmDataFromIndexedDB();

		// Map over the data to extract only id and name
		const namesAndIds = tmDataList.map((tm) => ({
			id: tm.id || 0, // Fallback to 0 if id is undefined
			name: tm.name || "Unnamed TM", // Fallback to a default name
		}));

		return namesAndIds;
	} catch (error) {
		console.error("Error fetching TM Names and IDs:", error);
		return [];
	}
}

export async function getTmDataById(id: number): Promise<TmData | null> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_TM_NAME, "readonly");
		const store = transaction.objectStore(DB_TM_NAME);
		const request = store.get(id);

		request.onsuccess = (event) => {
			try {
				const result = (event.target as IDBRequest).result as unknown;
				resolve(result === undefined ? null : migrateTmData(result));
			} catch (error) {
				reject(error);
			}
		};

		request.onerror = (event) => {
			console.error(
				"Error fetching TMData by ID:",
				(event.target as IDBRequest).error,
			);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function saveNewTmToIndexedDB(tm: TmData): Promise<void> {
	Object.assign(tm, migrateTmData(tm));
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		// Create a clean, serializable copy of `tm`
		const cleanTm = JSON.parse(JSON.stringify(tm));

		const transaction = db.transaction(DB_TM_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_TM_NAME);
		const request = store.add(cleanTm);

		request.onsuccess = () => {
			loadTmDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			console.error("Transaction error:", (event.target as IDBRequest).error);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function updateTmOnIndexedDB(tm: TmData): Promise<void> {
	Object.assign(tm, migrateTmData(tm));
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		// Create a clean, serializable copy of `tm`
		const cleanTm = JSON.parse(JSON.stringify(tm));

		const transaction = db.transaction(DB_TM_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_TM_NAME);
		const request = store.put(cleanTm);

		request.onsuccess = () => {
			loadTmDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function deleteTmFromIndexedDB(id: number): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_TM_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_TM_NAME);
		const request = store.delete(id);

		request.onsuccess = () => {
			loadTmDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			reject((event.target as IDBRequest).error);
		};
	});
}
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
/////////////// TB Section /////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
export async function loadTbDataFromIndexedDB(): Promise<TbData[]> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_TB_NAME, "readonly");
		const store = transaction.objectStore(DB_TB_NAME);
		const request = store.getAll();

		request.onsuccess = (event) => {
			try {
				const result = ((event.target as IDBRequest).result as unknown[]).map(
					migrateTbData,
				);
				resolve(result);
				tbData.set(result);
			} catch (error) {
				reject(error);
			}
		};

		request.onerror = (event) => {
			console.error("Request error:", (event.target as IDBRequest).error);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function getTbNamesAndIds(): Promise<
	{ id: number; name: string }[]
> {
	try {
		// Load all TMData from IndexedDB
		const tbDataList = await loadTbDataFromIndexedDB();

		// Map over the data to extract only id and name
		const namesAndIds = tbDataList.map((tb) => ({
			id: tb.id || 0, // Fallback to 0 if id is undefined
			name: tb.name || "Unnamed TB", // Fallback to a default name
		}));

		return namesAndIds;
	} catch (error) {
		console.error("Error fetching TB Names and IDs:", error);
		return [];
	}
}

export async function getTbDataById(id: number): Promise<TbData | null> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_TB_NAME, "readonly");
		const store = transaction.objectStore(DB_TB_NAME);
		const request = store.get(id);

		request.onsuccess = (event) => {
			try {
				const result = (event.target as IDBRequest).result as unknown;
				resolve(result === undefined ? null : migrateTbData(result));
			} catch (error) {
				reject(error);
			}
		};

		request.onerror = (event) => {
			console.error(
				"Error fetching TBData by ID:",
				(event.target as IDBRequest).error,
			);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function saveNewTbToIndexedDB(tb: TbData): Promise<void> {
	Object.assign(tb, migrateTbData(tb));
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		// Create a clean, serializable copy of `tm`
		const cleanTb = JSON.parse(JSON.stringify(tb));

		const transaction = db.transaction(DB_TB_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_TB_NAME);
		const request = store.add(cleanTb);

		request.onsuccess = () => {
			loadTbDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			console.error("Transaction error:", (event.target as IDBRequest).error);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function updateTbOnIndexedDB(tb: TbData): Promise<void> {
	Object.assign(tb, migrateTbData(tb));
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		// Create a clean, serializable copy of `tm`
		const cleanTb = JSON.parse(JSON.stringify(tb));

		const transaction = db.transaction(DB_TB_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_TB_NAME);
		const request = store.put(cleanTb);

		request.onsuccess = () => {
			loadTbDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function deleteTbFromIndexedDB(id: number): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_TB_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_TB_NAME);
		const request = store.delete(id);

		request.onsuccess = () => {
			loadTbDataFromIndexedDB();
			resolve();
		};

		request.onerror = (event) => {
			reject((event.target as IDBRequest).error);
		};
	});
}
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
