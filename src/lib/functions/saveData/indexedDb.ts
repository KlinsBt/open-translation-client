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
import {
	migrateProjectData,
	migrateTbData,
	migrateTmData,
	PROJECT_SCHEMA_VERSION,
} from "$lib/formats/persistenceMigrations";
import {
	tbData,
	tmData,
	userData,
} from "$lib/functions/saveData/stores.svelte";
import { reportProductionError } from "$lib/functions/productionDiagnostics";
import {
	tbDataValidationError,
	tmDataValidationError,
} from "$lib/components/resources/resourceDataValidation";

const DB_NAME = "OPEN_TLC_5432_DB";
const DB_VERSION = 3; // No floats
const DB_USER_STORE_NAME = "UserData";
const DB_TM_NAME = "TMData";
const DB_TB_NAME = "TBData";
const DURABILITY = "relaxed"; // "strict" or "relaxed"
export const INDEXED_DB_WRITE_BATCH_SIZE = 100;

let db: IDBDatabase | null = null;
let databasePromise: Promise<IDBDatabase> | null = null;
let writeQueue: Promise<unknown> = Promise.resolve();

export class PersistenceConflictError extends Error {
	readonly name = "PersistenceConflictError";

	constructor(recordLabel = "project") {
		super(
			`This ${recordLabel} was changed in another tab or was deleted there. Reload it before saving so newer work is not overwritten.`,
		);
	}
}

type RevisionedResource = Pick<TmData | TbData, "id" | "persistenceRevision">;

function writeRevisionedResource<T extends RevisionedResource>(
	database: IDBDatabase,
	storeName: typeof DB_TM_NAME | typeof DB_TB_NAME,
	record: T,
	mode: "add" | "update",
	recordLabel: string,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = database.transaction(storeName, "readwrite", {
			durability: DURABILITY,
		});
		const store = transaction.objectStore(storeName);
		let conflict: PersistenceConflictError | null = null;
		let operationError: unknown;
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(
				conflict ??
					operationError ??
					transaction.error ??
					new Error("IndexedDB transaction failed."),
			);
		transaction.onabort = transaction.onerror;

		if (mode === "add") {
			record.persistenceRevision = 1;
			try {
				const request = store.add(record);
				request.onsuccess = () => {
					record.id = request.result as number;
				};
			} catch (error) {
				operationError = error;
				transaction.abort();
			}
			return;
		}

		if (record.id === undefined) {
			operationError = new Error(
				`The ${recordLabel} has no storage identifier.`,
			);
			transaction.abort();
			return;
		}
		const expectedRevision = record.persistenceRevision ?? 0;
		const request = store.get(record.id);
		request.onsuccess = () => {
			const current = request.result as RevisionedResource | undefined;
			const currentRevision = current?.persistenceRevision ?? 0;
			if (!current || currentRevision !== expectedRevision) {
				conflict = new PersistenceConflictError(recordLabel);
				transaction.abort();
				return;
			}
			record.persistenceRevision = currentRevision + 1;
			try {
				store.put(record);
			} catch (error) {
				operationError = error;
				transaction.abort();
			}
		};
	});
}

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
	const result = writeQueue.catch(() => undefined).then(operation);
	writeQueue = result.catch(() => undefined);
	return result;
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(transaction.error ?? new Error("IndexedDB transaction failed."));
		transaction.onabort = () =>
			reject(
				transaction.error ?? new Error("IndexedDB transaction was aborted."),
			);
	});
}

export function storageError(error: unknown): Error {
	if (error instanceof DOMException && error.name === "QuotaExceededError")
		return new Error(
			"This project exceeds the browser's available local storage. Free browser storage or import a smaller file, then try again.",
		);
	if (error instanceof DOMException && error.name === "AbortError")
		return new Error(
			"The browser cancelled the local storage operation. Your previous data is unchanged; please try again.",
		);
	return error instanceof Error
		? error
		: new Error("The browser could not save this data locally.");
}

export async function assertLocalStorageCapacity(
	inputBytes: number,
): Promise<void> {
	if (typeof navigator === "undefined" || !navigator.storage?.estimate) return;
	const estimate = await navigator.storage.estimate();
	if (estimate.quota === undefined || estimate.usage === undefined) return;
	const available = Math.max(0, estimate.quota - estimate.usage);
	const projected = inputBytes * 2.5 + 5 * 1024 * 1024;
	if (projected > available)
		throw new Error(
			`This import may require about ${Math.ceil(projected / 1024 / 1024)} MB of local storage, but only ${Math.floor(available / 1024 / 1024)} MB is available. Free browser storage or choose a smaller file.`,
		);
}

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
	if (db) return Promise.resolve(db);
	if (databasePromise) return databasePromise;
	const attempt = new Promise<IDBDatabase>((resolve, reject) => {
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
			db.onversionchange = () => {
				db?.close();
				db = null;
				databasePromise = null;
			};
			resolve(db);
		};

		request.onerror = (event) => {
			reportProductionError(
				"IndexedDB open failed",
				(event.target as IDBOpenDBRequest).error,
			);
			reject((event.target as IDBOpenDBRequest).error);
		};
	});
	databasePromise = attempt.catch((error) => {
		databasePromise = null;
		throw storageError(error);
	});
	return databasePromise;
}

export function closeIndexedDbConnection(): void {
	db?.close();
	db = null;
	databasePromise = null;
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
							reportProductionError("DOCX metadata regeneration failed", e);
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
			reportProductionError(
				"Project storage request failed",
				(event.target as IDBRequest).error,
			);
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
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			const transaction = database.transaction(
				DB_USER_STORE_NAME,
				"readwrite",
				{
					durability: DURABILITY,
				},
			);
			const store = transaction.objectStore(DB_USER_STORE_NAME);
			const newUserData = ensureProjectModels(
				migrateProjectData({
					schemaVersion: PROJECT_SCHEMA_VERSION,
					translationData: {
						name: tempSaveName,
						targetLang,
						sourceLang,
						creationDate,
						seg1: textSegments1,
						seg2: textSegments2,
						checked: checkedSegments,
						locked: checkedSegments.map(() => false),
						type: fileType,
						typeRef: fileTypeRef,
						parsingTokens: getDefaultTokens(),
						tm: { id: null, name: null, active: false },
						tb: { id: null, name: null, active: false },
					},
				}),
			);
			store.add(newUserData);
			await completeTransaction(transaction);
			await loadTranslationsUserDataFromIndexedDB();
		} catch (error) {
			throw storageError(error);
		}
	});
}

// Update all translation data in IndexedDB
export async function updateAllTranslationsOnIndexedDB(
	fullUserData: UserData[],
): Promise<void> {
	const snapshot = structuredClone(fullUserData);
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			for (const data of snapshot) {
				const isUnpersisted = data.persistenceRevision === undefined;
				ensureProjectModels(data);
				// Portable imports and newly constructed bulk records must not claim a
				// coincidentally matching key from another browser database.
				if (isUnpersisted) {
					delete data.id;
					data.persistenceRevision = 0;
				}
			}
			for (
				let offset = 0;
				offset < snapshot.length;
				offset += INDEXED_DB_WRITE_BATCH_SIZE
			)
				await writeTranslationBatch(
					database,
					snapshot.slice(offset, offset + INDEXED_DB_WRITE_BATCH_SIZE),
				);
			await loadTranslationsUserDataFromIndexedDB();
		} catch (error) {
			throw storageError(error);
		}
	});
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
		let conflict: PersistenceConflictError | null = null;
		let operationError: unknown;
		transaction.oncomplete = () => resolve();
		transaction.onerror = () =>
			reject(
				conflict ??
					operationError ??
					transaction.error ??
					new Error("IndexedDB transaction failed."),
			);
		transaction.onabort = () =>
			reject(
				conflict ??
					operationError ??
					transaction.error ??
					new Error("IndexedDB transaction was aborted."),
			);
		for (const data of batch) {
			const expectedRevision = data.persistenceRevision ?? 0;
			if (data.id === undefined) {
				data.persistenceRevision = 1;
				try {
					const request = store.add(data);
					request.onsuccess = () => {
						data.id = request.result as number;
					};
				} catch (error) {
					operationError = error;
					transaction.abort();
				}
				continue;
			}
			const request = store.get(data.id);
			request.onsuccess = () => {
				if (conflict) return;
				const current = request.result as UserData | undefined;
				const currentRevision = current?.persistenceRevision ?? 0;
				if (
					(current && currentRevision !== expectedRevision) ||
					(!current && expectedRevision !== 0)
				) {
					conflict = new PersistenceConflictError();
					transaction.abort();
					return;
				}
				data.persistenceRevision = currentRevision + 1;
				try {
					store.put(data);
				} catch (error) {
					operationError = error;
					transaction.abort();
				}
			};
		}
	});
}

// Update translation in IndexedDB
export async function updateTranslationOnIndexedDB(
	userData: UserData,
): Promise<void> {
	const snapshot = structuredClone(userData);
	ensureProjectModels(snapshot);
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			await writeTranslationBatch(database, [snapshot]);
			userData.persistenceRevision = snapshot.persistenceRevision;
			if (userData.id === undefined) userData.id = snapshot.id;
		} catch (error) {
			throw storageError(error);
		}
	});
}

export async function deleteTranslationFromIndexedDB(
	id: number,
): Promise<void> {
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			const transaction = database.transaction(
				DB_USER_STORE_NAME,
				"readwrite",
				{
					durability: DURABILITY,
				},
			);
			transaction.objectStore(DB_USER_STORE_NAME).delete(id);
			await completeTransaction(transaction);
			await loadTranslationsUserDataFromIndexedDB();
		} catch (error) {
			throw storageError(error);
		}
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
			reportProductionError(
				"Translation-memory storage request failed",
				(event.target as IDBRequest).error,
			);
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
		reportProductionError("Translation-memory index read failed", error);
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
			reportProductionError(
				"Translation-memory record read failed",
				(event.target as IDBRequest).error,
			);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function saveNewTmToIndexedDB(tm: TmData): Promise<void> {
	const cleanTm = structuredClone(migrateTmData(tm));
	const validationError = tmDataValidationError(cleanTm);
	if (validationError) throw new Error(validationError);
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			await writeRevisionedResource(
				database,
				DB_TM_NAME,
				cleanTm,
				"add",
				"translation memory",
			);
			tm.id = cleanTm.id;
			tm.persistenceRevision = cleanTm.persistenceRevision;
			await loadTmDataFromIndexedDB();
		} catch (error) {
			throw storageError(error);
		}
	});
}

export async function updateTmOnIndexedDB(tm: TmData): Promise<void> {
	const cleanTm = structuredClone(migrateTmData(tm));
	const validationError = tmDataValidationError(cleanTm);
	if (validationError) throw new Error(validationError);
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			await writeRevisionedResource(
				database,
				DB_TM_NAME,
				cleanTm,
				"update",
				"translation memory",
			);
			tm.persistenceRevision = cleanTm.persistenceRevision;
			await loadTmDataFromIndexedDB();
		} catch (error) {
			throw storageError(error);
		}
	});
}

export async function deleteTmFromIndexedDB(id: number): Promise<void> {
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			const transaction = database.transaction(
				[DB_TM_NAME, DB_USER_STORE_NAME],
				"readwrite",
				{
					durability: DURABILITY,
				},
			);
			transaction.objectStore(DB_TM_NAME).delete(id);
			const projects = transaction.objectStore(DB_USER_STORE_NAME);
			const request = projects.getAll();
			request.onsuccess = () => {
				for (const project of request.result as UserData[]) {
					if (project.translationData.tm?.id !== id) continue;
					project.translationData.tm = { id: null, name: null, active: false };
					project.persistenceRevision = (project.persistenceRevision ?? 0) + 1;
					projects.put(project);
				}
			};
			await completeTransaction(transaction);
			await Promise.all([
				loadTmDataFromIndexedDB(),
				loadTranslationsUserDataFromIndexedDB(),
			]);
		} catch (error) {
			throw storageError(error);
		}
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
			reportProductionError(
				"Term-base storage request failed",
				(event.target as IDBRequest).error,
			);
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
		reportProductionError("Term-base index read failed", error);
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
			reportProductionError(
				"Term-base record read failed",
				(event.target as IDBRequest).error,
			);
			reject((event.target as IDBRequest).error);
		};
	});
}

export async function saveNewTbToIndexedDB(tb: TbData): Promise<void> {
	const cleanTb = structuredClone(migrateTbData(tb));
	const validationError = tbDataValidationError(cleanTb);
	if (validationError) throw new Error(validationError);
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			await writeRevisionedResource(
				database,
				DB_TB_NAME,
				cleanTb,
				"add",
				"term base",
			);
			tb.id = cleanTb.id;
			tb.persistenceRevision = cleanTb.persistenceRevision;
			await loadTbDataFromIndexedDB();
		} catch (error) {
			throw storageError(error);
		}
	});
}

export async function updateTbOnIndexedDB(tb: TbData): Promise<void> {
	const cleanTb = structuredClone(migrateTbData(tb));
	const validationError = tbDataValidationError(cleanTb);
	if (validationError) throw new Error(validationError);
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			await writeRevisionedResource(
				database,
				DB_TB_NAME,
				cleanTb,
				"update",
				"term base",
			);
			tb.persistenceRevision = cleanTb.persistenceRevision;
			await loadTbDataFromIndexedDB();
		} catch (error) {
			throw storageError(error);
		}
	});
}

export async function deleteTbFromIndexedDB(id: number): Promise<void> {
	return enqueueWrite(async () => {
		try {
			const database = await openDatabase();
			const transaction = database.transaction(
				[DB_TB_NAME, DB_USER_STORE_NAME],
				"readwrite",
				{
					durability: DURABILITY,
				},
			);
			transaction.objectStore(DB_TB_NAME).delete(id);
			const projects = transaction.objectStore(DB_USER_STORE_NAME);
			const request = projects.getAll();
			request.onsuccess = () => {
				for (const project of request.result as UserData[]) {
					if (project.translationData.tb?.id !== id) continue;
					project.translationData.tb = { id: null, name: null, active: false };
					project.persistenceRevision = (project.persistenceRevision ?? 0) + 1;
					projects.put(project);
				}
			};
			await completeTransaction(transaction);
			await Promise.all([
				loadTbDataFromIndexedDB(),
				loadTranslationsUserDataFromIndexedDB(),
			]);
		} catch (error) {
			throw storageError(error);
		}
	});
}
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////
