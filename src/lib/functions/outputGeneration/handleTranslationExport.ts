import type { UserData } from "../../types/types";
import { getFormatAdapter } from "$lib/formats/registry";

export async function functionCreateExportFile(translationData: UserData) {
	console.log("userData: ", translationData);
	await getFormatAdapter(translationData.translationData.type).exportFile(
		translationData,
	);
}
