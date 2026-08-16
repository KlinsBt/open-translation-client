import { buildXliff2 } from "$lib/formats/xliff2";
import type { UserData } from "$lib/types/types";
import { notifyError } from "$lib/components/notifications/toastStore";

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
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export async function generateXliffSaveFile2_0(userData: UserData) {
	try {
		await generateXliffFileDownload(
			buildXliff2_0(userData),
			userData.translationData.name,
			"2.0",
		);
	} catch (error) {
		notifyError(
			error instanceof Error ? error.message : "Failed to export XLIFF 2.0.",
		);
		console.error("Failed to generate XLIFF 2.0 save file:", error);
	}
}

export async function generateXliffSaveFile2_1(userData: UserData) {
	try {
		await generateXliffFileDownload(
			buildXliff2_1(userData),
			userData.translationData.name,
			"2.1",
		);
	} catch (error) {
		notifyError(
			error instanceof Error ? error.message : "Failed to export XLIFF 2.1.",
		);
		console.error("Failed to generate XLIFF 2.1 save file:", error);
	}
}
