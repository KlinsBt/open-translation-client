import { showLoading } from "./saveData/stores.svelte";
import { tick } from "svelte";

let loadingOperations = 0;

export function beginLoading(): () => void {
	loadingOperations += 1;
	showLoading.set(true);
	let finished = false;
	return () => {
		if (finished) return;
		finished = true;
		loadingOperations = Math.max(0, loadingOperations - 1);
		if (loadingOperations === 0) showLoading.set(false);
	};
}

export async function withLoading<T>(operation: () => Promise<T>): Promise<T> {
	const end = beginLoading();
	await tick();
	try {
		return await operation();
	} finally {
		end();
	}
}

export function activeLoadingOperations(): number {
	return loadingOperations;
}

export async function setLoadingAndRender() {
	showLoading.set(true);
	await tick();
}
