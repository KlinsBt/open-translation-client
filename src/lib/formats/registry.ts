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

const READ_WRITE_CAPABILITIES = {
	import: true,
	export: true,
	roundTrip: true,
} as const;

async function sniffText(file: File, pattern: RegExp): Promise<boolean> {
	return pattern.test((await file.slice(0, 4096).text()).trimStart());
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
		sniff: (file) => sniffText(file, /^(?:\{|\[)/),
		validate: validateJsonFile,
		importFile: importJsonFile,
		exportFile: generateJsonTranslation,
	},
	{
		id: "docx",
		label: "DOCX",
		extensions: ["docx"],
		mimeTypes: [
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.docx,
		sniff: async (file) => (await validateDocxFile(file)).valid,
		validate: validateDocxFile,
		importFile: importDocxFile,
		exportFile: createDocxFromModifiedXmlText,
	},
	{
		id: "xlsx",
		label: "XLSX",
		extensions: ["xlsx", "xls"],
		mimeTypes: [
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			"application/vnd.ms-excel",
		],
		capabilities: READ_WRITE_CAPABILITIES,
		importOptions: FORMAT_IMPORT_OPTIONS.xlsx,
		sniff: async (file) => (await validateXlsxFile(file)).valid,
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
		sniff: (file) =>
			sniffText(file, /^<(?:!doctype\s+html|html|head|body)(?:\s|>)/i),
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

function getExtension(fileName: string): string | undefined {
	const lastDot = fileName.lastIndexOf(".");
	if (lastDot < 0 || lastDot === fileName.length - 1) return undefined;
	return fileName.slice(lastDot + 1).toLowerCase();
}

export async function detectFormat(
	file: File,
): Promise<FormatAdapter | undefined> {
	const mimeType = file.type.toLowerCase().split(";", 1)[0].trim();
	if (mimeType) {
		const mimeMatch = adapters.find((adapter) =>
			adapter.mimeTypes.some((candidate) => candidate === mimeType),
		);
		if (mimeMatch) return mimeMatch;
	}

	const extension = getExtension(file.name);
	if (extension) {
		const extensionMatch = adapters.find((adapter) =>
			adapter.extensions.some((candidate) => candidate === extension),
		);
		if (extensionMatch) return extensionMatch;
	}

	for (const adapter of adapters) {
		if (await adapter.sniff(file)) return adapter;
	}

	return undefined;
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
