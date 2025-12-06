import { writable } from "svelte/store";

export type ToastType = "info" | "success" | "error" | "warning";

export interface Toast {
	id: string;
	message: string;
	type: ToastType;
}

function isBrowser() {
	return typeof window !== "undefined";
}

const { subscribe, update } = writable<Toast[]>([]);

function remove(id: string) {
	update((list) => list.filter((t) => t.id !== id));
}

function push(message: string, type: ToastType = "info", duration = 3000) {
	const id =
		crypto.randomUUID?.() ||
		`${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const toast: Toast = { id, message, type };
	update((list) => [...list, toast]);

	if (isBrowser()) {
		setTimeout(() => remove(id), duration);
	}

	return id;
}

export const toastStore = {
	subscribe,
	push,
	remove,
};

export const notifyInfo = (message: string) => push(message, "info");
export const notifySuccess = (message: string) => push(message, "success");
export const notifyError = (message: string) => push(message, "error");
export const notifyWarning = (message: string) => push(message, "warning");
