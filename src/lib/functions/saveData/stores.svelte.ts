import { writable, type Writable } from "svelte/store";
import type { TbData, TmData, UserData } from "../../types/types";

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

// export const openModal: Writable<boolean> = writable(true);
// export const openSaveFileExportModal: Writable<boolean> = writable(true);
export const openMenu: Writable<boolean> = writable(true);

export const showLoading: Writable<boolean> = writable(false);

////////////////////////////////////////////////////////////////////////////
//// Translation Memory stores /////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
export const tmData: Writable<TmData[]> = writable([]);
export const singleTmData: Writable<TmData> = writable({} as TmData);
export const tmIdSelected: Writable<number> = writable(0);
export const showTmxModal: Writable<boolean> = writable(false);
export const editTm: Writable<boolean> = writable(false);

export const tmMatches: Writable<
	{ segment: string; match: string; percentage: string }[]
> = writable([]);
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////
//// Term Base stores //////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
export const tbData: Writable<TbData[]> = writable([]);
export const singleTbData: Writable<TbData> = writable({} as TbData);
export const tbIdSelected: Writable<number> = writable(0);
export const showTbxModal: Writable<boolean> = writable(false);
export const editTb: Writable<boolean> = writable(false);

export const tbMatches: Writable<
	{ searchEntry: string; foundEntry: string; notes: string[] }[]
> = writable([]);
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////
