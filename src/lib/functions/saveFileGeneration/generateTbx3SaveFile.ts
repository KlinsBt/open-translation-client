import { buildTbxDocument, type BuildTbxOptions } from "$lib/formats/tbx";
import type { TbData } from "$lib/types/types";

export function buildTbx(
	sourceLang: string,
	tbxData: TbData,
	options?: BuildTbxOptions,
): string {
	return buildTbxDocument(sourceLang, tbxData, options);
}

async function generateTbxFileDownload(tbxData: string, name: string) {
	const blob = new Blob([tbxData], { type: "application/tbx+xml" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${name}.tbx`;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}

export async function generateTbxSaveFile(sourceLang: string, tbxData: TbData) {
	await generateTbxFileDownload(
		buildTbx(sourceLang, tbxData),
		tbxData.name || "TBX_Save_File",
	);
}
