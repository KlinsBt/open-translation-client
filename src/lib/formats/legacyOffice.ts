import type {
	LegacyOfficeSegmentMeta,
	TypeRef,
	UserData,
} from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	readSafeFileBytes,
	readSafeZipPackage,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createPackageSkeleton, skeletonHasIdentityTargets } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import { assertProjectExportQuality } from "./qualityAssurance";

export const LEGACY_OFFICE_EXTENSIONS = [
	"doc",
	"dot",
	"bak",
	"xls",
	"xlt",
	"xlsb",
	"ppt",
	"pps",
	"pot",
] as const;
export const LEGACY_OFFICE_MIME_TYPES = [
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/vnd.ms-excel.sheet.binary.macroenabled.12",
	"application/x-ole-storage",
] as const;

type LegacySubtype = "doc" | "xls" | "ppt";
type LegacyOfficeExtension = (typeof LEGACY_OFFICE_EXTENSIONS)[number];

interface TextRun {
	text: string;
}

interface ParagraphReference {
	runs: TextRun[];
	text: string;
}

function extensionOf(name: string): string {
	return name.toLowerCase().split(".").at(-1) ?? "";
}

function sourceExtensionOf(file: File): LegacyOfficeExtension | undefined {
	const extension = extensionOf(file.name) as LegacyOfficeExtension;
	return LEGACY_OFFICE_EXTENSIONS.includes(extension) ? extension : undefined;
}

function subtypeOfExtension(extension: LegacyOfficeExtension): LegacySubtype {
	if (["doc", "dot", "bak"].includes(extension)) return "doc";
	if (["xls", "xlt", "xlsb"].includes(extension)) return "xls";
	return "ppt";
}

function hasOleSignature(bytes: Uint8Array): boolean {
	return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every(
		(value, index) => bytes[index] === value,
	);
}

export function collectLegacyParagraphs(root: unknown): ParagraphReference[] {
	const output: ParagraphReference[] = [];
	const visit = (value: unknown) => {
		if (!value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		const paragraph = record.paragraph;
		if (paragraph && typeof paragraph === "object") {
			const runs = (paragraph as Record<string, unknown>).runs;
			if (Array.isArray(runs)) {
				const textRuns = runs.filter(
					(run): run is TextRun =>
						!!run &&
						typeof run === "object" &&
						typeof (run as TextRun).text === "string",
				);
				const text = textRuns
					.map((run) => run.text)
					.join("")
					.trim();
				if (text) output.push({ runs: textRuns, text });
			}
			return;
		}
		if (Array.isArray(value)) for (const child of value) visit(child);
		else for (const child of Object.values(record)) visit(child);
	};
	visit(root);
	return output;
}

async function importLegacySpreadsheet(
	file: File,
	bytes: Uint8Array,
	includeNumbers: boolean,
	sourceExtension: LegacyOfficeExtension,
): Promise<{
	segments: string[];
	meta: LegacyOfficeSegmentMeta[];
}> {
	const XLSX = await import("xlsx");
	const workbook = XLSX.read(bytes, {
		type: "array",
		cellDates: false,
		bookVBA: true,
	});
	const segments: string[] = [];
	const meta: LegacyOfficeSegmentMeta[] = [];
	for (const sheetName of workbook.SheetNames) {
		const sheet = workbook.Sheets[sheetName];
		if (!sheet?.["!ref"]) continue;
		const range = XLSX.utils.decode_range(sheet["!ref"]);
		for (let row = range.s.r; row <= range.e.r; row++) {
			for (let column = range.s.c; column <= range.e.c; column++) {
				const address = XLSX.utils.encode_cell({ r: row, c: column });
				const cell = sheet[address];
				if (!cell || cell.f || cell.v === undefined || cell.v === null)
					continue;
				if (
					cell.t !== "s" &&
					cell.t !== "str" &&
					!(includeNumbers && cell.t === "n")
				)
					continue;
				const text = String(cell.v).trim();
				if (!text) continue;
				segments.push(text);
				meta.push({
					profile: "legacy-office-browser",
					subtype: "xls",
					sourceExtension,
					sheet: sheetName,
					cell: address,
				});
			}
		}
	}
	if (!segments.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			`${file.name} contains no selected spreadsheet cells.`,
		);
	return { segments, meta };
}

async function validateXlsbPackage(
	file: File,
	context?: SafeInputContext,
): Promise<Uint8Array> {
	const archive = await readSafeZipPackage(file, context);
	const workbook = archive.parts["xl/workbook.bin"];
	const contentTypes = archive.parts["[Content_Types].xml"];
	if (!(workbook instanceof Blob))
		throw new SafeInputError(
			"LEGACY_OFFICE_INVALID",
			"The XLSB package has no xl/workbook.bin binary workbook part.",
		);
	if (
		typeof contentTypes !== "string" ||
		!/application\/vnd\.ms-excel\.(?:sheet|template)\.binary\.macroEnabled\.main/i.test(
			contentTypes,
		)
	)
		throw new SafeInputError(
			"LEGACY_OFFICE_INVALID",
			"The package does not declare an XLSB binary workbook content type.",
		);
	return archive.bytes;
}

export async function validateLegacyOfficeFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const sourceExtension = sourceExtensionOf(file);
		if (!sourceExtension)
			return {
				valid: false,
				reason:
					"A supported legacy or binary Office filename is required before its internal structure can be verified.",
			};
		const subtype = subtypeOfExtension(sourceExtension);
		const bytes =
			sourceExtension === "xlsb"
				? await validateXlsbPackage(file, context)
				: await readSafeFileBytes(file, context);
		if (sourceExtension !== "xlsb" && !hasOleSignature(bytes))
			return {
				valid: false,
				reason: `.${sourceExtension} requires a matching OLE compound-document signature.`,
			};
		if (subtype === "xls") {
			const XLSX = await import("xlsx");
			const workbook = XLSX.read(bytes, {
				type: "array",
				bookSheets: true,
				bookVBA: true,
			});
			if (!workbook.SheetNames.length)
				return { valid: false, reason: "The workbook has no worksheets." };
		} else {
			const { Ream } = await import("reamkit");
			const parsed = Ream.parse(bytes);
			if (parsed.format !== subtype)
				return {
					valid: false,
					reason: `The OLE streams do not contain a legacy ${subtype.toUpperCase()} document.`,
				};
		}
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			reason:
				error instanceof Error
					? error.message
					: "Unsupported legacy Office document.",
		};
	}
}

export async function importLegacyOfficeFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const sourceExtension = sourceExtensionOf(file);
	if (!sourceExtension)
		throw new SafeInputError(
			"LEGACY_OFFICE_INVALID",
			"The filename is not a supported legacy or binary Office variant.",
		);
	const subtype = subtypeOfExtension(sourceExtension);
	const bytes =
		sourceExtension === "xlsb"
			? await validateXlsbPackage(file, context)
			: await readSafeFileBytes(file, context);
	if (sourceExtension !== "xlsb" && !hasOleSignature(bytes))
		throw new SafeInputError(
			"LEGACY_OFFICE_INVALID",
			`.${sourceExtension} does not have a valid OLE compound-document signature.`,
		);
	const normalized = normalizeImportOptions("legacy-office", options);
	let segments: string[];
	let meta: LegacyOfficeSegmentMeta[];
	let losses: unknown[] = [];
	if (subtype === "xls") {
		({ segments, meta } = await importLegacySpreadsheet(
			file,
			bytes,
			Boolean(normalized.includeNumbers),
			sourceExtension,
		));
	} else {
		const { Ream } = await import("reamkit");
		const parsed = Ream.parse(bytes);
		if (parsed.format !== subtype)
			throw new SafeInputError(
				"LEGACY_OFFICE_INVALID",
				"The extension does not match the OLE document streams.",
			);
		const paragraphs = collectLegacyParagraphs(parsed.flow);
		segments = paragraphs.map((paragraph) => paragraph.text);
		meta = paragraphs.map((_, paragraph) => ({
			profile: "legacy-office-browser",
			subtype,
			sourceExtension,
			paragraph,
		}));
		losses = [...parsed.losses];
		if (!segments.length)
			throw new SafeInputError(
				"EMPTY_CONTENT",
				`No translatable text was found in this ${subtype.toUpperCase()} file.`,
			);
	}
	const documentModel = createNeutralDocument({
		format: "legacy-office",
		sourceSegments: segments,
		sourceLocations: meta.map((entry, segmentIndex) => ({
			segmentIndex,
			paragraph: entry.paragraph,
			sheet: entry.sheet,
			cell: entry.cell,
		})),
	});
	documentModel.metadata = {
		profile: "Legacy Office browser-native best effort",
		subtype,
		sourceExtension,
		processing: "on-device",
		fileUploaded: false,
		losses,
		exportPolicy:
			subtype === "xls"
				? "identity-in-source-format-or-translated-xlsx/xlsm-conversion"
				: subtype === "doc"
					? "modern-docx"
					: "translated-html",
	};
	return {
		kind: "segments",
		segments,
		document: documentModel,
		skeleton: await createPackageSkeleton(file, "legacy-office", {}, []),
		filterOptions: normalized,
		typeRef: {
			profile: "legacy-office-browser",
			subtype,
			sourceExtension,
		} as TypeRef,
		segmentsMeta: meta,
	};
}

function originalBlob(project: UserData): Blob {
	const source = project.translationData.skeleton?.source.originalFile;
	if (!(source instanceof Blob))
		throw new Error(
			"Legacy Office export requires the original file retained in IndexedDB.",
		);
	return source;
}

function projectSubtype(project: UserData): LegacySubtype {
	const subtype =
		typeof project.translationData.typeRef === "object"
			? project.translationData.typeRef.subtype
			: undefined;
	if (subtype !== "doc" && subtype !== "xls" && subtype !== "ppt")
		throw new Error("Legacy Office subtype metadata is missing.");
	return subtype;
}

function projectSourceExtension(project: UserData): LegacyOfficeExtension {
	const extension =
		typeof project.translationData.typeRef === "object"
			? project.translationData.typeRef.sourceExtension
			: undefined;
	if (
		typeof extension === "string" &&
		LEGACY_OFFICE_EXTENSIONS.includes(extension as LegacyOfficeExtension)
	)
		return extension as LegacyOfficeExtension;
	return projectSubtype(project);
}

export async function buildLegacyOfficeTranslation(project: UserData): Promise<{
	blob: Blob;
	extension: LegacyOfficeExtension | "docx" | "xlsx" | "xlsm" | "html";
}> {
	assertProjectExportQuality(project);
	const subtype = projectSubtype(project);
	const sourceExtension = projectSourceExtension(project);
	const original = originalBlob(project);
	if (
		skeletonHasIdentityTargets(
			project.translationData.seg1,
			project.translationData.seg2,
		)
	)
		return { blob: original, extension: sourceExtension };
	const bytes = new Uint8Array(await original.arrayBuffer());
	const translations = project.translationData.seg2.map(
		(target, index) => target || project.translationData.seg1[index] || "",
	);
	if (subtype === "xls") {
		const XLSX = await import("xlsx");
		const workbook = XLSX.read(bytes, {
			type: "array",
			cellDates: false,
			cellStyles: true,
			bookVBA: true,
		});
		const meta =
			project.translationData.segmentsMeta?.filter(
				(entry): entry is LegacyOfficeSegmentMeta =>
					"profile" in entry &&
					entry.profile === "legacy-office-browser" &&
					"subtype" in entry &&
					entry.subtype === "xls",
			) ?? [];
		for (const [index, entry] of meta.entries()) {
			if (
				!entry.sheet ||
				!entry.cell ||
				!workbook.Sheets[entry.sheet]?.[entry.cell]
			)
				continue;
			const cell = workbook.Sheets[entry.sheet][entry.cell];
			cell.v = translations[index];
			cell.t = "s";
			delete cell.w;
		}
		const hasVba = Boolean(
			(workbook as typeof workbook & { vbaraw?: Uint8Array }).vbaraw,
		);
		const extension = hasVba ? "xlsm" : "xlsx";
		const output = XLSX.write(workbook, {
			type: "array",
			bookType: extension,
			cellStyles: true,
			bookVBA: true,
		}) as Uint8Array;
		return {
			blob: new Blob([output], {
				type: hasVba
					? "application/vnd.ms-excel.sheet.macroenabled.12"
					: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			}),
			extension,
		};
	}
	const { Ream } = await import("reamkit");
	const parsed = Ream.parse(bytes);
	const paragraphs = collectLegacyParagraphs(parsed.flow);
	for (const [index, paragraph] of paragraphs.entries()) {
		for (const [runIndex, run] of paragraph.runs.entries())
			run.text = runIndex === 0 ? (translations[index] ?? paragraph.text) : "";
	}
	if (subtype === "doc") {
		const output = await parsed.convert("docx");
		return {
			blob: new Blob([output], {
				type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			}),
			extension: "docx",
		};
	}
	const output = await parsed.convert("html");
	return {
		blob: new Blob([output], { type: "text/html;charset=utf-8" }),
		extension: "html",
	};
}

export async function generateLegacyOfficeTranslation(
	project: UserData,
): Promise<void> {
	const { blob, extension } = await buildLegacyOfficeTranslation(project);
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${(project.translationData.name || "translation").replace(/\.(doc|dot|bak|xls|xlt|xlsb|ppt|pps|pot)$/i, "")}.translated.${extension}`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
