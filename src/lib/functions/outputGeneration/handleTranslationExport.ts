import type { UserData } from "../../types/types";
import { getFormatAdapter } from "$lib/formats/registry";

export async function functionCreateExportFile(translationData: UserData) {
	const adapter = getFormatAdapter(translationData.translationData.type);
	if (!adapter.capabilities.export)
		throw new Error(
			`${adapter.label} is import-only. Export the Open TLC JSON or standard XLIFF project instead; the proprietary source package is never rewritten.`,
		);
	return await adapter.exportFile(translationData);
}
