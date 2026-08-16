import { createDocxFromModifiedXmlText } from "$lib/functions/outputGeneration/outputGenerationDocx";
import { createHtmlFromModifiedText } from "$lib/functions/outputGeneration/outputGenerationHtml";
import { generateJsonTranslation } from "$lib/functions/outputGeneration/outputGenerationJson";
import { generateTextTranslation } from "$lib/functions/outputGeneration/outputGenerationText";
import { createXlsxFromModifiedXmlText } from "$lib/functions/outputGeneration/outputGenerationXlsx";
import {
	importDocxFile,
	importHtmlFile,
	importJsonFile,
	importTextFile,
	importXlsxFile,
	validateDocxFile,
	validateHtmlFile,
	validateJsonFile,
	validateTextFile,
	validateXlsxFile,
} from "./importers";
import { FORMAT_IDS, type FormatId } from "./formatIds";
import type { FormatAdapter } from "./types";
import { FORMAT_IMPORT_OPTIONS } from "./options";
import { decodeTextBytes, type SafeInputContext } from "./safeInput";
import { detectFileFormat, type FormatDetection } from "./detect";
import { DOCX_FAMILY_EXTENSIONS, DOCX_FAMILY_MIME_TYPES } from "./docxPackage";

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
		id: "json",
		label: "JSON",
		extensions: ["json"],
		mimeTypes: ["application/json", "text/json"],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.json,
		sniff: (file, context) => sniffText(file, /^(?:\{|\[)/, context),
		validate: validateJsonFile,
		importFile: importJsonFile,
		exportFile: generateJsonTranslation,
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
		extensions: ["xlsx"],
		mimeTypes: [
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.xlsx,
		sniff: async (file, context) =>
			(await validateXlsxFile(file, context)).valid,
		validate: validateXlsxFile,
		importFile: importXlsxFile,
		exportFile: createXlsxFromModifiedXmlText,
	},
	{
		id: "html",
		label: "HTML",
		extensions: ["html", "htm"],
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
