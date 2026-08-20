import { buildXliff2 } from "$lib/formats/xliff2";
import type { UserData } from "$lib/types/types";

export function buildXliff2_0(userData: UserData): string {
	return buildXliff2(userData, "2.0");
}

export function buildXliff2_1(userData: UserData): string {
	return buildXliff2(userData, "2.1");
}

async function generateXliffFileDownload(
	xliffData: string,
	name: string,
	version: "2.0" | "2.1",
) {
	const blob = new Blob([xliffData], { type: "application/xliff+xml" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${name}-${version}.xliff`;
	try {
		document.body.appendChild(anchor);
		anchor.click();
	} finally {
		anchor.remove();
		URL.revokeObjectURL(url);
	}
}

export async function generateXliffSaveFile2_0(userData: UserData) {
	await generateXliffFileDownload(
		buildXliff2_0(userData),
		userData.translationData.name,
		"2.0",
	);
}

export async function generateXliffSaveFile2_1(userData: UserData) {
	await generateXliffFileDownload(
		buildXliff2_1(userData),
		userData.translationData.name,
		"2.1",
	);
}
