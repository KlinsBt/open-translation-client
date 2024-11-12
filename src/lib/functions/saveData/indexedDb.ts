import { type UserData } from "../../types/types.js";
import { userData } from "$lib/functions/saveData/stores.svelte";

const DB_NAME = "OPEN_TLC_5432_DB";
const DB_VERSION = 1; // No floats
const DB_STORE_NAME = "UserData";
const DURABILITY = "relaxed"; // "strict" or "relaxed"

let db: IDBDatabase | null = null;

// Open (or create) the IndexedDB database
function openDatabase(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(DB_STORE_NAME)) {
				db.createObjectStore(DB_STORE_NAME, {
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
		const transaction = db.transaction(DB_STORE_NAME, "readonly");
		const store = transaction.objectStore(DB_STORE_NAME);
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
		const transaction = db.transaction(DB_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_STORE_NAME);
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
		const transaction = db.transaction(DB_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_STORE_NAME);

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
		const transaction = db.transaction(DB_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_STORE_NAME);
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
		const transaction = db.transaction(DB_STORE_NAME, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(DB_STORE_NAME);
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
