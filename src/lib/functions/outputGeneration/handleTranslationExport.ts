import type { UserData } from "../../types/types";
import { generateTextTranslation } from "./outputGenerationText";
import { generateJsonTranslation } from "./outputGenerationJson";
import { createDocxFromModifiedXmlText } from "./outputGenerationDocx";
import { createXlsxFromModifiedXmlText } from "./outputGenerationXlsx";
import { createHtmlFromModifiedText } from "./outputGenerationHtml";

export function functionCreateExportFile(translationData: UserData) {
	console.log("userData: ", translationData);
	if (translationData.translationData.type === "text") {
		generateTextTranslation(translationData);
	} else if (translationData.translationData.type === "json") {
		generateJsonTranslation(translationData);
	} else if (translationData.translationData.type === "docx") {
		createDocxFromModifiedXmlText(translationData);
	} else if (translationData.translationData.type === "xlsx") {
		createXlsxFromModifiedXmlText(translationData);
	} else if (translationData.translationData.type === "html") {
		createHtmlFromModifiedText(translationData);
	} else {
		return;
	}
}
