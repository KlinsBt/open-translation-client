import { showLoading } from "./saveData/stores.svelte";

export async function setLoadingAndRender() {
	showLoading.set(true);
	await new Promise((resolve) => setTimeout(resolve, 5)); // Allow rendering
}
