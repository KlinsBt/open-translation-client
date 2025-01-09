import { type TbData, type TmData, type UserData } from "../../types/types.js";
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

let db: IDBDatabase | null = null;

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
			const result = (event.target as IDBRequest).result as UserData[];
			userData.set(result);
			resolve(result);
			return result;
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
	checkedSegments: string[],
	fileType: string,
	fileTypeRef: string,
): Promise<void> {
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_USER_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_USER_STORE_NAME);
		const newUserData = {
			name: tempSaveName,
			targetLang: targetLang,
			sourceLang: sourceLang,
			creationDate: creationDate,
			seg1: textSegments1,
			seg2: textSegments2,
			checked: checkedSegments,
			type: fileType,
			typeRef: fileTypeRef as any,
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
		};
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
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(DB_USER_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_USER_STORE_NAME);

		const updatePromises = fullUserData.map((data) => {
			return new Promise<void>((res, rej) => {
				const request = store.put(data);

				request.onsuccess = () => res();
				request.onerror = (event) => rej((event.target as IDBRequest).error);
			});
		});

		Promise.all(updatePromises)
			.then(() => {
				loadTranslationsUserDataFromIndexedDB();
				resolve();
			})
			.catch(reject);
	});
}

// Update translation in IndexedDB
export async function updateTranslationOnIndexedDB(
	userData: UserData,
): Promise<void> {
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
			const result = (event.target as IDBRequest).result as TmData[];
			resolve(result);
			tmData.set(result);
			return result;
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
			const result = (event.target as IDBRequest).result as TmData | undefined;
			resolve(result || null);
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
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		// Create a clean, serializable copy of `tm`
		const cleanTm = JSON.parse(JSON.stringify(tm));

		console.log("cleanTm", cleanTm);

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
			const result = (event.target as IDBRequest).result as TbData[];
			resolve(result);
			tbData.set(result);
			return result;
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
			const result = (event.target as IDBRequest).result as TbData | undefined;
			resolve(result || null);
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
	const db = await openDatabase();
	return new Promise((resolve, reject) => {
		// Create a clean, serializable copy of `tm`
		const cleanTb = JSON.parse(JSON.stringify(tb));

		console.log("cleanTb", cleanTb);

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
