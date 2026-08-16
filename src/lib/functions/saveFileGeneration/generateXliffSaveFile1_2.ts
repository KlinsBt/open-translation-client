import type { UserData } from "$lib/types/types";
import { migrateProjectData } from "$lib/formats/persistenceMigrations";
import { buildXliff12 } from "$lib/formats/xliff12";

export function buildXliff1_2(userData: UserData): string {
	return buildXliff12(migrateProjectData(userData));
}

async function generateXliffFileDownload(xliffData: string, name: string) {
	const blob = new Blob([xliffData], { type: "application/xliff+xml" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${name}.xliff`;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}

export async function generateXliffSaveFile1_2(userData: UserData) {
	try {
		const xliffContent = buildXliff1_2(userData);
		await generateXliffFileDownload(
			xliffContent,
			userData.translationData.name,
		);
	} catch (error) {
		console.error("Failed to generate XLIFF save file:", error);
	}
}
