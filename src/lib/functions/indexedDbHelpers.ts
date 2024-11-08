// $lib/functions/indexedDbHelpers.ts

export async function saveBlobToIndexedDb(
	key: string,
	blob: Blob,
): Promise<void> {
	const dbRequest = indexedDB.open("myDatabase", 1);

	dbRequest.onupgradeneeded = (event) => {
		const db = dbRequest.result;
		if (!db.objectStoreNames.contains("media")) {
			db.createObjectStore("media");
		}
	};

	dbRequest.onsuccess = () => {
		const db = dbRequest.result;
		const transaction = db.transaction("media", "readwrite");
		const store = transaction.objectStore("media");

		store.put(blob, key);

		transaction.oncomplete = () => {
			console.log(`Saved ${key} to IndexedDB`);
		};

		transaction.onerror = (error) => {
			console.error(`Error saving ${key} to IndexedDB`, error);
		};
	};

	dbRequest.onerror = (error) => {
		console.error("IndexedDB error:", error);
	};
}
