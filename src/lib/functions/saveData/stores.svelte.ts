import { writable, type Writable } from "svelte/store";
import type { UserData } from "../../types/types";

export const userData: Writable<UserData[]> = writable([]);

export const singleUserData: Writable<UserData> = writable({} as UserData);
export const translationIdSelected: Writable<number> = writable(0);

export const seg1WordCount: Writable<number> = writable(0);
export const seg2WordCount: Writable<number> = writable(0);

// export const selectedTextSegments1: Writable<string[]> = writable([]);
// export const selectedTextSegments2: Writable<string[]> = writable([]);
// export const checkedSegments: Writable<string[]> = writable([]);

export const selectedSegmentId: Writable<number> = writable(0);
export const userDataStatistics: Writable<number[]> = writable([0, 0, 0, 0]);

export const openModal: Writable<boolean> = writable(true);
export const openSaveFileExportModal: Writable<boolean> = writable(true);
export const openMenu: Writable<boolean> = writable(true);

export const showLoading: Writable<boolean> = writable(false);
