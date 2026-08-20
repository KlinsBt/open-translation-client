import JSZip from "jszip";
import type { TypeRef, UserData } from "$lib/types/types";
import {
	contentToPlainText,
	synchronizeNeutralDocument,
	type NeutralDocument,
	type TranslationUnit,
} from "./documentModel";
import { FORMAT_IDS, type FormatId } from "./formatIds";
import { buildRoundTripFormatOutputBlob } from "./formatOutput";
import { normalizeImportOptions } from "./options";
import { PROJECT_SCHEMA_VERSION } from "./persistenceMigrations";
import { assertProjectExportQuality } from "./qualityAssurance";
import {
	decodeTextBytes,
	parseSafeJson,
	readSafeZipPackage,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import { createPackageSkeleton, getPackageSkeleton } from "./skeleton";
import type {
	FormatAdapter,
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export const ZIP_PROJECT_MANIFEST_PATH = "opentlc-project.json";
export const ZIP_PROJECT_SCHEMA_VERSION = 1 as const;
export const ZIP_PROJECT_KIND = "open-tlc-format-batch" as const;
export const ZIP_PROJECT_MAX_MEMBERS = 100;
export const ZIP_PROJECT_MAX_NESTED_ARCHIVES = 25;

export interface ZipProjectManifestMember {
	path: string;
	format: FormatId;
	mimeType?: string;
	required?: boolean;
	options?: FormatOptionValues;
}

export interface ZipProjectManifest {
	schemaVersion: typeof ZIP_PROJECT_SCHEMA_VERSION;
	kind: typeof ZIP_PROJECT_KIND;
	members: ZipProjectManifestMember[];
}

export interface ZipProjectMemberReport {
	path: string;
	format: FormatId | string;
	status: "imported" | "skipped" | "failed";
	units?: number;
	reason?: string;
}

interface StoredZipProjectMember {
	path: string;
	format: FormatId;
	mimeType: string;
	segmentStart: number;
	segmentCount: number;
	sourceSegments: string[];
	initialTargetSegments: string[];
	checked: boolean[];
	typeRef: TypeRef;
	segmentsMeta?: UserData["translationData"]["segmentsMeta"];
	document: NeutralDocument;
	skeleton: FormatImportResult["skeleton"];
	filterOptions: FormatOptionValues;
}

export interface ZipProjectManifestInspection {
	valid: boolean;
	reason: string;
	manifest?: ZipProjectManifest;
}

export class ZipProjectMemberError extends SafeInputError {
	constructor(readonly reports: ZipProjectMemberReport[]) {
		super(
			"ZIP_PROJECT_MEMBER_FAILED",
			`Manifest ZIP import failed: ${reports
				.filter((report) => report.status === "failed")
				.map((report) => `${report.path}: ${report.reason}`)
				.join("; ")}`,
		);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validOptions(value: unknown): value is FormatOptionValues {
	return (
		value === undefined ||
		(isPlainObject(value) &&
			Object.values(value).every((item) =>
				["string", "number", "boolean"].includes(typeof item),
			))
	);
}

export function inspectZipProjectManifest(
	text: string,
	availablePaths?: ReadonlySet<string>,
): ZipProjectManifestInspection {
	let value: unknown;
	try {
		value = parseSafeJson(text);
	} catch (error) {
		return {
			valid: false,
			reason:
				error instanceof Error ? error.message : "Manifest JSON is invalid.",
		};
	}
	if (!isPlainObject(value))
		return {
			valid: false,
			reason: "The ZIP project manifest must be an object.",
		};
	if (value.schemaVersion !== ZIP_PROJECT_SCHEMA_VERSION)
		return {
			valid: false,
			reason: `The manifest schemaVersion must be ${ZIP_PROJECT_SCHEMA_VERSION}.`,
		};
	if (value.kind !== ZIP_PROJECT_KIND)
		return {
			valid: false,
			reason: `The manifest kind must be “${ZIP_PROJECT_KIND}”.`,
		};
	if (!Array.isArray(value.members) || value.members.length === 0)
		return {
			valid: false,
			reason: "The manifest needs at least one declared member.",
		};
	if (value.members.length > ZIP_PROJECT_MAX_MEMBERS)
		return {
			valid: false,
			reason: `The manifest exceeds the ${ZIP_PROJECT_MAX_MEMBERS}-member batch limit.`,
		};

	const members: ZipProjectManifestMember[] = [];
	const seenPaths = new Set<string>();
	for (const [index, raw] of value.members.entries()) {
		if (!isPlainObject(raw))
			return {
				valid: false,
				reason: `Manifest member ${index + 1} is invalid.`,
			};
		const path = typeof raw.path === "string" ? raw.path : "";
		const format = typeof raw.format === "string" ? raw.format : "";
		if (
			!path ||
			path === ZIP_PROJECT_MANIFEST_PATH ||
			path.startsWith("/") ||
			path.includes("\\") ||
			path.split("/").some((part) => !part || part === "." || part === "..")
		)
			return {
				valid: false,
				reason: `Manifest member ${index + 1} has an unsafe or reserved path.`,
			};
		if (seenPaths.has(path))
			return {
				valid: false,
				reason: `Manifest member path “${path}” is duplicated.`,
			};
		seenPaths.add(path);
		if (!FORMAT_IDS.includes(format as FormatId))
			return {
				valid: false,
				reason: `Manifest member “${path}” declares unknown format “${format}”.`,
			};
		if (["zip-project", "cat-package", "pdf"].includes(format))
			return {
				valid: false,
				reason: `Manifest member “${path}” uses constrained or recursive format “${format}”.`,
			};
		if (availablePaths && !availablePaths.has(path))
			return {
				valid: false,
				reason: `Declared member “${path}” is missing from the ZIP.`,
			};
		if (!validOptions(raw.options))
			return {
				valid: false,
				reason: `Manifest member “${path}” has non-primitive import options.`,
			};
		if (raw.mimeType !== undefined && typeof raw.mimeType !== "string")
			return {
				valid: false,
				reason: `Manifest member “${path}” has an invalid MIME type.`,
			};
		if (raw.required !== undefined && typeof raw.required !== "boolean")
			return {
				valid: false,
				reason: `Manifest member “${path}” has an invalid required flag.`,
			};
		members.push({
			path,
			format: format as FormatId,
			...(typeof raw.mimeType === "string" ? { mimeType: raw.mimeType } : {}),
			...(typeof raw.required === "boolean" ? { required: raw.required } : {}),
			...(raw.options ? { options: raw.options as FormatOptionValues } : {}),
		});
	}
	return {
		valid: true,
		reason: `Manifest declares ${members.length} explicit format member${members.length === 1 ? "" : "s"}.`,
		manifest: {
			schemaVersion: ZIP_PROJECT_SCHEMA_VERSION,
			kind: ZIP_PROJECT_KIND,
			members,
		},
	};
}

async function partText(part: string | Blob): Promise<string> {
	if (typeof part === "string") return part;
	return decodeTextBytes(new Uint8Array(await part.arrayBuffer())).text;
}

function sourceSegments(result: FormatImportResult): string[] {
	if (result.kind === "segments") return [...result.segments];
	return result.document.units.map((unit) =>
		unit.source.fragments
			.map((fragment) =>
				fragment.kind === "text"
					? fragment.text
					: (fragment.displayText ?? fragment.originalData ?? ""),
			)
			.join(""),
	);
}

function targetSegments(
	result: FormatImportResult,
	sources: readonly string[],
): string[] {
	if (
		result.kind === "segments" &&
		result.targetSegments?.length === sources.length
	)
		return [...result.targetSegments];
	return sources.map(() => "");
}

async function partBlob(part: string | Blob, mimeType: string): Promise<Blob> {
	return typeof part === "string"
		? new Blob([part], { type: mimeType })
		: new Blob([await part.arrayBuffer()], { type: mimeType });
}

async function hasZipSignature(part: string | Blob): Promise<boolean> {
	const blob = await partBlob(part, "application/octet-stream");
	const bytes = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
	return (
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		((bytes[2] === 0x03 && bytes[3] === 0x04) ||
			(bytes[2] === 0x05 && bytes[3] === 0x06) ||
			(bytes[2] === 0x07 && bytes[3] === 0x08))
	);
}

export type FormatAdapterResolver = (format: FormatId) => FormatAdapter;

export async function importZipProjectFile(
	file: File,
	options: Readonly<FormatOptionValues> = {},
	context: SafeInputContext | undefined,
	resolveAdapter: FormatAdapterResolver,
): Promise<FormatImportResult> {
	const normalized = normalizeImportOptions("zip-project", options);
	const failurePolicy = String(normalized.failurePolicy);
	const archive = await readSafeZipPackage(file, context);
	const manifestPart = archive.parts[ZIP_PROJECT_MANIFEST_PATH];
	if (!manifestPart)
		throw new SafeInputError(
			"ZIP_PROJECT_INVALID",
			`Generic ZIP projects require ${ZIP_PROJECT_MANIFEST_PATH}.`,
		);
	const inspection = inspectZipProjectManifest(
		await partText(manifestPart),
		new Set(Object.keys(archive.parts)),
	);
	if (!inspection.valid || !inspection.manifest)
		throw new SafeInputError("ZIP_PROJECT_INVALID", inspection.reason);

	const reports: ZipProjectMemberReport[] = [];
	const storedMembers: StoredZipProjectMember[] = [];
	const sources: string[] = [];
	const targets: string[] = [];
	const units: TranslationUnit[] = [];
	let nestedArchives = 0;

	for (const [memberIndex, member] of inspection.manifest.members.entries()) {
		throwIfAborted(context?.signal);
		const part = archive.parts[member.path];
		const adapter = resolveAdapter(member.format);
		if (!adapter.capabilities.roundTrip) {
			reports.push({
				path: member.path,
				format: member.format,
				status: "failed",
				reason:
					"The declared adapter does not provide same-format round trips.",
			});
			continue;
		}
		try {
			if (await hasZipSignature(part)) {
				nestedArchives++;
				if (nestedArchives > ZIP_PROJECT_MAX_NESTED_ARCHIVES)
					throw new SafeInputError(
						"ZIP_PROJECT_INVALID",
						`The batch exceeds the ${ZIP_PROJECT_MAX_NESTED_ARCHIVES}-member nested-package limit.`,
					);
			}
			const mimeType = member.mimeType || adapter.mimeTypes[0];
			const childFile = new File(
				[await partBlob(part, mimeType)],
				member.path,
				{
					type: mimeType,
				},
			);
			const validation = await adapter.validate(childFile, context);
			if (!validation.valid)
				throw new Error(
					validation.reason ?? `Invalid ${adapter.label} member.`,
				);
			const childOptions = normalizeImportOptions(
				member.format,
				member.options ?? {},
			);
			const imported = await adapter.importFile(
				childFile,
				childOptions,
				context,
			);
			const childSources = sourceSegments(imported);
			const childTargets = targetSegments(imported, childSources);
			if (childSources.length === 0)
				throw new Error("The member contains no translatable units.");
			if (imported.document.units.length !== childSources.length)
				throw new Error(
					"The member document model is not aligned with extraction.",
				);
			const start = sources.length;
			sources.push(...childSources);
			targets.push(...childTargets);
			for (const [unitIndex, unit] of imported.document.units.entries()) {
				units.push({
					...unit,
					id: `member-${memberIndex + 1}:${unit.id}`,
					contexts: [
						...unit.contexts,
						{ type: "zip-project-member", value: member.path },
					],
					sourceLocation: {
						...unit.sourceLocation,
						part: member.path,
						segmentIndex: start + unitIndex,
						metadata: {
							...unit.sourceLocation?.metadata,
							memberFormat: member.format,
							memberUnitId: unit.id,
						},
					},
				});
			}
			const fallbackTypeRef =
				imported.skeleton.payload.kind === "text"
					? imported.skeleton.payload.content
					: imported.skeleton.payload.parts;
			storedMembers.push({
				path: member.path,
				format: member.format,
				mimeType,
				segmentStart: start,
				segmentCount: childSources.length,
				sourceSegments: childSources,
				initialTargetSegments: childTargets,
				checked: childSources.map(() => false),
				typeRef: imported.typeRef ?? fallbackTypeRef,
				segmentsMeta:
					imported.kind === "segments" ? imported.segmentsMeta : undefined,
				document: imported.document,
				skeleton: imported.skeleton,
				filterOptions: imported.filterOptions,
			});
			reports.push({
				path: member.path,
				format: member.format,
				status: "imported",
				units: childSources.length,
			});
		} catch (error) {
			if (error instanceof SafeInputError && error.code === "ABORTED")
				throw error;
			reports.push({
				path: member.path,
				format: member.format,
				status: "failed",
				reason:
					error instanceof Error ? error.message : "Member import failed.",
			});
		}
	}

	const failures = reports.filter((report) => report.status === "failed");
	const requiredFailures = failures.filter((failure) => {
		const member = inspection.manifest!.members.find(
			(candidate) => candidate.path === failure.path,
		);
		return member?.required !== false;
	});
	if (
		requiredFailures.length > 0 ||
		(failures.length > 0 && failurePolicy === "reject-batch")
	)
		throw new ZipProjectMemberError(reports);
	for (const failure of failures) failure.status = "skipped";
	if (sources.length === 0)
		throw new SafeInputError(
			"ZIP_PROJECT_MEMBER_FAILED",
			"No manifest member produced translatable content.",
		);

	const document: NeutralDocument = {
		schemaVersion: 1,
		id: `zip-project:${file.name}`,
		format: "zip-project",
		units,
		metadata: {
			zipProject: {
				schemaVersion: inspection.manifest.schemaVersion,
				reports,
				entryCount: Object.keys(archive.parts).length,
				nestedArchives,
			},
		},
	};

	return {
		kind: "segments",
		segments: sources,
		targetSegments: targets,
		document,
		skeleton: await createPackageSkeleton(
			file,
			"zip-project",
			archive.parts,
			[],
			archive.source,
		),
		filterOptions: normalized,
		typeRef: {
			manifestPath: ZIP_PROJECT_MANIFEST_PATH,
			manifestSchemaVersion: String(ZIP_PROJECT_SCHEMA_VERSION),
			batchMembers: storedMembers,
			memberReports: reports,
		},
	};
}

export async function validateZipProjectFile(
	file: File,
	context: SafeInputContext | undefined,
	resolveAdapter: FormatAdapterResolver,
): Promise<FormatValidationResult> {
	try {
		await importZipProjectFile(file, undefined, context, resolveAdapter);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			reason:
				error instanceof Error
					? error.message
					: "Invalid manifest ZIP project.",
			...(error instanceof SafeInputError ? { errorCode: error.code } : {}),
		};
	}
}

function storedMembers(project: UserData): StoredZipProjectMember[] {
	const values = (project.translationData.typeRef as { batchMembers?: unknown })
		?.batchMembers;
	if (!Array.isArray(values) || values.length === 0)
		throw new Error("ZIP project member state is missing.");
	for (const value of values) {
		if (
			!isPlainObject(value) ||
			typeof value.path !== "string" ||
			typeof value.format !== "string" ||
			!Number.isSafeInteger(value.segmentStart) ||
			!Number.isSafeInteger(value.segmentCount) ||
			!Array.isArray(value.sourceSegments) ||
			!Array.isArray(value.initialTargetSegments)
		)
			throw new Error("ZIP project member state is malformed.");
	}
	return values as unknown as StoredZipProjectMember[];
}

function arraysEqual(
	first: readonly string[],
	second: readonly string[],
): boolean {
	return (
		first.length === second.length &&
		first.every((value, index) => value === second[index])
	);
}

function childProject(
	parent: UserData,
	member: StoredZipProjectMember,
	targets: string[],
): UserData {
	const checked = parent.translationData.checked.slice(
		member.segmentStart,
		member.segmentStart + member.segmentCount,
	);
	const document = synchronizeNeutralDocument(
		member.document,
		{ seg1: member.sourceSegments, seg2: targets, checked },
		parent.translationData.sourceLang,
		parent.translationData.targetLang,
	);
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		translationData: {
			name: member.path.split("/").at(-1) ?? member.path,
			targetLang: parent.translationData.targetLang,
			sourceLang: parent.translationData.sourceLang,
			creationDate: parent.translationData.creationDate,
			seg1: [...member.sourceSegments],
			seg2: targets,
			checked,
			locked: parent.translationData.locked.slice(
				member.segmentStart,
				member.segmentStart + member.segmentCount,
			),
			type: member.format,
			typeRef: member.typeRef,
			segmentsMeta: member.segmentsMeta,
			documentModel: document,
			skeleton: member.skeleton,
			filterOptions: member.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

export async function buildZipProjectTranslationPackage(
	project: UserData,
): Promise<Blob> {
	const data = project.translationData;
	let members: StoredZipProjectMember[];
	try {
		members = storedMembers(project);
	} catch (error) {
		assertProjectExportQuality(project);
		throw error;
	}
	const expectedCount = members.reduce(
		(total, member) => total + member.segmentCount,
		0,
	);
	const originalSources = members.flatMap((member) => member.sourceSegments);
	const originalTargets = members.flatMap(
		(member) => member.initialTargetSegments,
	);
	if (
		data.seg1.length !== expectedCount ||
		data.seg2.length !== expectedCount ||
		!arraysEqual(data.seg1, originalSources)
	)
		throw new Error(
			"ZIP project members no longer align with the manifest. Undo cross-member split/join or re-import the batch before export.",
		);
	assertProjectExportQuality(project);
	const skeleton = getPackageSkeleton(data.skeleton, "zip-project");
	if (!skeleton?.source.originalFile)
		throw new Error(
			"ZIP project export requires the original package skeleton.",
		);
	if (arraysEqual(data.seg2, originalTargets))
		return skeleton.source.originalFile;

	const zip = await JSZip.loadAsync(
		await skeleton.source.originalFile.arrayBuffer(),
	);
	for (const member of members) {
		const targets = data.seg2.slice(
			member.segmentStart,
			member.segmentStart + member.segmentCount,
		);
		if (arraysEqual(targets, member.initialTargetSegments)) continue;
		zip.file(
			member.path,
			await buildRoundTripFormatOutputBlob(
				childProject(project, member, targets),
			),
		);
	}
	return zip.generateAsync({
		type: "blob",
		mimeType: "application/zip",
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});
}

export async function generateZipProjectTranslation(
	project: UserData,
): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"translation-project.zip";
	const name = /\.zip$/i.test(requested) ? requested : `${requested}.zip`;
	const url = URL.createObjectURL(
		await buildZipProjectTranslationPackage(project),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
