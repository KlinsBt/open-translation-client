import { createDocxFromModifiedXmlText } from "$lib/functions/outputGeneration/outputGenerationDocx";
import { createHtmlFromModifiedText } from "$lib/functions/outputGeneration/outputGenerationHtml";
import { generateJsonTranslation } from "$lib/functions/outputGeneration/outputGenerationJson";
import { generateTextTranslation } from "$lib/functions/outputGeneration/outputGenerationText";
import { generateCsvTranslation } from "$lib/functions/outputGeneration/outputGenerationCsv";
import { generateYamlTranslation } from "$lib/functions/outputGeneration/outputGenerationYaml";
import { createXlsxFromModifiedXmlText } from "$lib/functions/outputGeneration/outputGenerationXlsx";
import { createPptxFromModifiedXmlText } from "$lib/functions/outputGeneration/outputGenerationPptx";
import {
	importDocxFile,
	importHtmlFile,
	importJsonFile,
	importTextFile,
	importCsvFile,
	importXlsxFile,
	validateDocxFile,
	validateHtmlFile,
	validateJsonFile,
	validateTextFile,
	validateCsvFile,
	validateXlsxFile,
	importPptxFile,
	validatePptxFile,
} from "./importers";
import { FORMAT_IDS, type FormatId } from "./formatIds";
import type { FormatAdapter } from "./types";
import { FORMAT_IMPORT_OPTIONS } from "./options";
import { decodeTextBytes, type SafeInputContext } from "./safeInput";
import { detectFileFormat, type FormatDetection } from "./detect";
import { DOCX_FAMILY_EXTENSIONS, DOCX_FAMILY_MIME_TYPES } from "./docxPackage";
import { XLSX_FAMILY_EXTENSIONS, XLSX_FAMILY_MIME_TYPES } from "./xlsxPackage";
import { PPTX_FAMILY_EXTENSIONS, PPTX_FAMILY_MIME_TYPES } from "./pptxPackage";
import { importYamlFile, validateYamlFile } from "./yamlFamily";

const READ_WRITE_CAPABILITIES = {
	import: true,
	export: true,
	roundTrip: true,
} as const;

async function sniffText(
	file: File,
	pattern: RegExp,
	context?: SafeInputContext,
): Promise<boolean> {
	try {
		const bytes = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
		if (context?.signal?.aborted) return false;
		return pattern.test(decodeTextBytes(bytes).text.trimStart());
	} catch {
		return false;
	}
}

const adapters = [
	{
		id: "text",
		label: "TXT",
		extensions: ["txt"],
		mimeTypes: ["text/plain"],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.text,
		sniff: async () => false,
		validate: validateTextFile,
		importFile: importTextFile,
		exportFile: generateTextTranslation,
	},
	{
		id: "csv",
		label: "CSV/TSV",
		extensions: ["csv", "tsv"],
		mimeTypes: ["text/csv", "text/tab-separated-values"],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.csv,
		sniff: async () => false,
		validate: validateCsvFile,
		importFile: importCsvFile,
		exportFile: generateCsvTranslation,
	},
	{
		id: "json",
		label: "JSON families",
		extensions: ["json", "arb", "locjson"],
		mimeTypes: ["application/json", "text/json"],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.json,
		sniff: (file, context) => sniffText(file, /^(?:\{|\[)/, context),
		validate: validateJsonFile,
		importFile: importJsonFile,
		exportFile: generateJsonTranslation,
	},
	{
		id: "yaml",
		label: "YAML 1.2",
		extensions: ["yaml", "yml"],
		mimeTypes: ["application/yaml", "text/yaml", "application/x-yaml"],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.yaml,
		sniff: async () => false,
		validate: validateYamlFile,
		importFile: importYamlFile,
		exportFile: generateYamlTranslation,
	},
	{
		id: "docx",
		label: "DOCX",
		extensions: DOCX_FAMILY_EXTENSIONS,
		mimeTypes: Object.values(DOCX_FAMILY_MIME_TYPES),
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.docx,
		sniff: async (file, context) =>
			(await validateDocxFile(file, context)).valid,
		validate: validateDocxFile,
		importFile: importDocxFile,
		exportFile: createDocxFromModifiedXmlText,
	},
	{
		id: "xlsx",
		label: "XLSX",
		extensions: XLSX_FAMILY_EXTENSIONS,
		mimeTypes: Object.values(XLSX_FAMILY_MIME_TYPES),
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.xlsx,
		sniff: async (file, context) =>
			(await validateXlsxFile(file, context)).valid,
		validate: validateXlsxFile,
		importFile: importXlsxFile,
		exportFile: createXlsxFromModifiedXmlText,
	},
	{
		id: "pptx",
		label: "PPTX",
		extensions: PPTX_FAMILY_EXTENSIONS,
		mimeTypes: Object.values(PPTX_FAMILY_MIME_TYPES),
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.pptx,
		sniff: async (file, context) =>
			(await validatePptxFile(file, context)).valid,
		validate: validatePptxFile,
		importFile: importPptxFile,
		exportFile: createPptxFromModifiedXmlText,
	},
	{
		id: "html",
		label: "HTML",
		extensions: ["html", "htm", "xhtml"],
		mimeTypes: ["text/html", "application/xhtml+xml"],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.html,
		sniff: (file, context) =>
			sniffText(file, /^<(?:!doctype\s+html|html|head|body)(?:\s|>)/i, context),
		validate: validateHtmlFile,
		importFile: importHtmlFile,
		exportFile: createHtmlFromModifiedText,
	},
] as const satisfies readonly FormatAdapter[];

const adapterById = new Map<FormatId, FormatAdapter>(
	adapters.map((adapter) => [adapter.id, adapter]),
);

export const FORMAT_ADAPTERS: readonly FormatAdapter[] = adapters;

export function getFormatAdapter(id: FormatId): FormatAdapter {
	const adapter = adapterById.get(id);
	if (!adapter) throw new Error(`No format adapter is registered for ${id}.`);
	return adapter;
}

export async function detectFormat(
	file: File,
	context?: SafeInputContext,
): Promise<FormatAdapter | undefined> {
	return (await detectFormatWithConfidence(file, context))?.adapter;
}

export async function detectFormatWithConfidence(
	file: File,
	context?: SafeInputContext,
): Promise<FormatDetection | undefined> {
	return detectFileFormat(file, adapters, context);
}

export function getFormatAcceptValue(): string {
	return adapters
		.flatMap((adapter) =>
			adapter.extensions.map((extension) => `.${extension}`),
		)
		.join(",");
}

export function getSupportedFormatLabels(): string {
	return adapters.map((adapter) => adapter.label).join(", ");
}

if (
	adapterById.size !== FORMAT_IDS.length ||
	FORMAT_IDS.some((id) => !adapterById.has(id))
) {
	throw new Error("The format adapter registry does not match FORMAT_IDS.");
}
