import type { UserData } from "$lib/types/types";
import { buildTextTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationText";
import { buildCsvTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationCsv";
import { buildJsonTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationJson";
import { buildYamlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationYaml";
import { buildPoTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationPo";
import { buildAndroidResourcesTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationAndroid";
import { buildAppleLocalizationTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationApple";
import { buildPropertiesTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationProperties";
import { buildResxTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationResx";
import { buildQtTsTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationQtTs";
import { buildIniTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationIni";
import { buildPhpTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationPhp";
import { buildLightweightMarkupTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationMarkup";
import { buildSubtitleTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationSubtitles";
import { buildOdfTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationOdf";
import { buildEpubTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationEpub";
import { buildSvgTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationSvg";
import { buildDitaTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationDita";
import { buildDocBookTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationDocBook";
import { buildInDesignTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationIdml";
import { buildLatexTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationLatex";
import { buildTtmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationTtml";
import { buildMifTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationMif";
import { buildWindowsRcTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationWindowsRc";
import { buildQmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationQml";
import { buildXmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationXml";
import { buildHtmlTranslation } from "$lib/functions/outputGeneration/outputGenerationHtml";
import { buildDocxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationDocx";
import { buildXlsxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationXlsx";
import { buildPptxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationPptx";
import { buildRtfTranslationBlob } from "./rtf";
import { buildCatReturnPackage } from "./catPackage";

/** Builds only native, same-format round-trip output. */
export async function buildRoundTripFormatOutputBlob(
	project: UserData,
): Promise<Blob> {
	switch (project.translationData.type) {
		case "text":
			return buildTextTranslationBlob(project);
		case "csv":
			return buildCsvTranslationBlob(project);
		case "json":
			return buildJsonTranslationBlob(project);
		case "yaml":
			return buildYamlTranslationBlob(project);
		case "po":
			return buildPoTranslationBlob(project);
		case "android":
			return buildAndroidResourcesTranslationBlob(project);
		case "apple":
			return buildAppleLocalizationTranslationBlob(project);
		case "properties":
			return buildPropertiesTranslationBlob(project);
		case "resx":
			return buildResxTranslationBlob(project);
		case "qt-ts":
			return buildQtTsTranslationBlob(project);
		case "ini":
			return buildIniTranslationBlob(project);
		case "php":
			return buildPhpTranslationBlob(project);
		case "markup":
			return buildLightweightMarkupTranslationBlob(project);
		case "subtitles":
			return buildSubtitleTranslationBlob(project);
		case "odf":
			return buildOdfTranslationPackage(project);
		case "epub":
			return buildEpubTranslationPackage(project);
		case "svg":
			return buildSvgTranslationBlob(project);
		case "dita":
			return buildDitaTranslationBlob(project);
		case "docbook":
			return buildDocBookTranslationBlob(project);
		case "idml":
			return buildInDesignTranslationBlob(project);
		case "latex":
			return buildLatexTranslationBlob(project);
		case "ttml":
			return buildTtmlTranslationBlob(project);
		case "mif":
			return buildMifTranslationBlob(project);
		case "windows-rc":
			return buildWindowsRcTranslationBlob(project);
		case "qml":
			return buildQmlTranslationBlob(project);
		case "xml":
			return buildXmlTranslationBlob(project);
		case "html":
			return new Blob([buildHtmlTranslation(project)], { type: "text/html" });
		case "docx":
			return buildDocxTranslationPackage(project);
		case "xlsx":
			return buildXlsxTranslationPackage(project);
		case "pptx":
			return buildPptxTranslationPackage(project);
		case "pdf":
		case "image-ocr":
		case "media-transcription":
		case "legacy-office":
		case "zip-project":
			throw new Error(
				`${project.translationData.type} does not provide same-format round-trip output.`,
			);
		case "rtf":
			return buildRtfTranslationBlob(project);
		case "cat-package":
			return (await buildCatReturnPackage(project)).blob;
	}
}
