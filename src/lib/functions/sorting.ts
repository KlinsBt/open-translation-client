import type { UserData } from "$lib/types/types";

export function sortUserDataByDateAscending(userData: UserData[]) {
	return userData.sort((a, b) => {
		return (
			parseInt(a.translationData.creationDate) -
			parseInt(b.translationData.creationDate)
		);
	});
}

export function sortUserDataByDateDescending(userData: UserData[]) {
	return userData.sort((a, b) => {
		return (
			parseInt(b.translationData.creationDate) -
			parseInt(a.translationData.creationDate)
		);
	});
}

export function sortUserDataByNameAscending(userData: UserData[]) {
	return userData.sort((a, b) => {
		return a.translationData.name.localeCompare(b.translationData.name);
	});
}

export function sortUserDataByNameDescending(userData: UserData[]) {
	return userData.sort((a, b) => {
		return b.translationData.name.localeCompare(a.translationData.name);
	});
}
