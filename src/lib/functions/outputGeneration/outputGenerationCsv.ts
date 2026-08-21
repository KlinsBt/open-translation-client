import { encodeCsvField, isCsvFormulaInjection } from "$lib/formats/csv";
import { normalizeImportOptions } from "$lib/formats/options";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type CsvFieldReplacement,
} from "$lib/formats/skeleton";
import type { SupportedTextEncoding } from "$lib/formats/safeInput";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

function csvReplacements(project: UserData): CsvFieldReplacement[] {
	return (
		project.translationData.skeleton?.replacements.filter(
			(replacement): replacement is CsvFieldReplacement =>
				replacement.kind === "csv-field",
		) ?? []
	);
}

function hasIdentityTargets(project: UserData): boolean {
	const replacements = csvReplacements(project);
	return (
		replacements.length === project.translationData.seg2.length &&
		replacements.every(
			(replacement) =>
				project.translationData.seg2[replacement.unitIndex] ===
				replacement.originalValue,
		)
	);
}

export function buildCsvTranslation(project: UserData): string {
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "csv");
	const replacements = csvReplacements(project);
	const mappingsAlign =
		replacements.length === data.seg2.length &&
		new Set(replacements.map((replacement) => replacement.unitIndex)).size ===
			replacements.length &&
		replacements.every(
			(replacement) =>
				replacement.unitIndex >= 0 && replacement.unitIndex < data.seg2.length,
		);
	if (content !== undefined && mappingsAlign) {
		let output = content;
		for (const replacement of [...replacements].sort(
			(first, second) => second.start - first.start,
		)) {
			const target = data.seg2[replacement.unitIndex] ?? "";
			if (target === replacement.originalValue) continue;
			const encoded = encodeCsvField(target, replacement);
			output = `${output.slice(0, replacement.start)}${encoded}${output.slice(replacement.end)}`;
		}
		return output;
	}
	if (content !== undefined)
		throw new Error(
			`CSV/TSV export cannot continue because its ${replacements.length} field mappings do not align uniquely with ${data.seg2.length} target segments.`,
		);
	const options = normalizeImportOptions("csv", data.filterOptions);
	const delimiter =
		options.delimiter === "tab"
			? "\t"
			: options.delimiter === "semicolon"
				? ";"
				: options.delimiter === "pipe"
					? "|"
					: ",";
	return data.seg2
		.map((target) =>
			encodeCsvField(target, {
				delimiter,
				quote: '"',
				escapeMode: "double",
				quoted: false,
			}),
		)
		.join("\r\n");
}

function outputPolicy(project: UserData): {
	encoding: SupportedTextEncoding;
	hasBom: boolean;
} {
	const data = project.translationData;
	const options = normalizeImportOptions("csv", data.filterOptions);
	const sourceEncoding = data.skeleton?.source.encoding ?? "utf-8";
	const requested = String(options.outputEncoding);
	const encoding =
		requested === "source"
			? sourceEncoding
			: (requested as SupportedTextEncoding);
	const bom = String(options.byteOrderMark);
	return {
		encoding,
		hasBom:
			bom === "always"
				? true
				: bom === "never"
					? false
					: (data.skeleton?.source.hasBom ?? false),
	};
}

export function getCsvFormulaInjectionWarnings(project: UserData): number[] {
	return project.translationData.seg2.flatMap((target, index) =>
		isCsvFormulaInjection(target) ? [index] : [],
	);
}

export function buildCsvTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const options = normalizeImportOptions("csv", data.filterOptions);
	if (
		options.outputEncoding === "source" &&
		options.byteOrderMark === "preserve" &&
		hasIdentityTargets(project) &&
		data.skeleton?.source.originalFile
	)
		return data.skeleton.source.originalFile;
	const policy = outputPolicy(project);
	const bytes = encodeTextBytes(
		buildCsvTranslation(project),
		policy.encoding,
		policy.hasBom,
	);
	const sourceName = data.skeleton?.source.name ?? data.name;
	const type = sourceName.toLowerCase().endsWith(".tsv")
		? "text/tab-separated-values"
		: "text/csv";
	return new Blob([bytes], { type: `${type};charset=${policy.encoding}` });
}

export async function generateCsvTranslation(project: UserData): Promise<void> {
	assertProjectExportQuality(project);
	const warnings = getCsvFormulaInjectionWarnings(project);
	if (warnings.length > 0)
		console.warn(
			`CSV/TSV export contains ${warnings.length} target field(s) that spreadsheet software may interpret as formulas.`,
		);
	const data = project.translationData;
	const sourceName = data.skeleton?.source.name ?? "translation.csv";
	const extension = sourceName.toLowerCase().endsWith(".tsv") ? ".tsv" : ".csv";
	const requestedName = data.name || sourceName;
	const name = /\.(?:csv|tsv)$/i.test(requestedName)
		? requestedName
		: `${requestedName}${extension}`;
	const url = URL.createObjectURL(buildCsvTranslationBlob(project));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
