import type {
	LegacyOfficeSegmentMeta,
	TypeRef,
	UserData,
} from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	readSafeFileBytes,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createPackageSkeleton } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import { assertProjectExportQuality } from "./qualityAssurance";

export const LEGACY_OFFICE_EXTENSIONS = ["doc", "xls", "ppt"] as const;
export const LEGACY_OFFICE_MIME_TYPES = [
	"application/msword",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/x-ole-storage",
] as const;

type LegacySubtype = "doc" | "xls" | "ppt";

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

function subtypeOf(file: File): LegacySubtype | undefined {
	const extension = extensionOf(file.name);
	return LEGACY_OFFICE_EXTENSIONS.includes(extension as LegacySubtype)
		? (extension as LegacySubtype)
		: undefined;
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
): Promise<{
	segments: string[];
	meta: LegacyOfficeSegmentMeta[];
}> {
	const XLSX = await import("xlsx");
	const workbook = XLSX.read(bytes, {
		type: "array",
		cellDates: false,
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

export async function validateLegacyOfficeFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const subtype = subtypeOf(file);
		const bytes = await readSafeFileBytes(file, context);
		if (!subtype || !hasOleSignature(bytes))
			return {
				valid: false,
				reason:
					"A DOC, XLS, or PPT extension and matching OLE signature are required.",
			};
		if (subtype === "xls") {
			const XLSX = await import("xlsx");
			XLSX.read(bytes, { type: "array", bookSheets: true });
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
	const subtype = subtypeOf(file);
	const bytes = await readSafeFileBytes(file, context);
	if (!subtype || !hasOleSignature(bytes))
		throw new SafeInputError(
			"LEGACY_OFFICE_INVALID",
			"The file is not a recognized DOC, XLS, or PPT binary document.",
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
		processing: "on-device",
		fileUploaded: false,
		losses,
		exportPolicy:
			subtype === "xls"
				? "same-format-xls"
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
		typeRef: { profile: "legacy-office-browser", subtype } as TypeRef,
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

export async function buildLegacyOfficeTranslation(project: UserData): Promise<{
	blob: Blob;
	extension: "xls" | "docx" | "html";
}> {
	assertProjectExportQuality(project);
	const subtype = projectSubtype(project);
	const bytes = new Uint8Array(await originalBlob(project).arrayBuffer());
	const translations = project.translationData.seg2.map(
		(target, index) => target || project.translationData.seg1[index] || "",
	);
	if (subtype === "xls") {
		const XLSX = await import("xlsx");
		const workbook = XLSX.read(bytes, {
			type: "array",
			cellDates: false,
			cellStyles: true,
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
		const output = XLSX.write(workbook, {
			type: "array",
			bookType: "xls",
			cellStyles: true,
		});
		return {
			blob: new Blob([output], { type: "application/vnd.ms-excel" }),
			extension: "xls",
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
	link.download = `${(project.translationData.name || "translation").replace(/\.(doc|xls|ppt)$/i, "")}.translated.${extension}`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
