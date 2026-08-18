import JSZip from "jszip";
import type { UserData } from "$lib/types/types";
import {
	contentToPlainText,
	createTextContent,
	type NeutralDocument,
	type TranslationUnit,
} from "./documentModel";
import { normalizeImportOptions, parseList } from "./options";
import {
	decodeTextBytes,
	readSafeZipPackage,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import {
	createPackageSkeleton,
	type DocumentSkeleton,
	type PackageSkeletonPayload,
} from "./skeleton";
import { importXliffProjectStreaming } from "./streamingImporters";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import { buildXliff12 } from "./xliff12";
import { buildXliff2, type Xliff2Version } from "./xliff2";
import { assertProjectExportQuality } from "./qualityAssurance";

export const CAT_PACKAGE_EXTENSIONS = [
	"sdlppx",
	"sdlrpx",
	"wsxz",
	"mqout",
	"mqback",
	"mqxlz",
] as const;

export const CAT_PACKAGE_MIME_TYPES = [
	"application/zip",
	"application/x-sdl-project-package",
	"application/x-sdl-return-package",
	"application/x-worldserver-package",
	"application/x-memoq-package",
] as const;

const XLIFF_MEMBER = /\.(?:xlf|xliff|sdlxliff|mqxliff|mxliff)$/i;

export interface CatPackageProfile {
	id: "trados" | "worldserver" | "memoq";
	label: string;
	vendor: string;
	extensions: readonly string[];
	exportPolicy: "return-package";
	exportVerification: "assumed-compatible";
}

const CAT_PROFILES: readonly CatPackageProfile[] = [
	{
		id: "trados",
		label: "Trados Studio project/return package",
		vendor: "RWS Trados Studio",
		extensions: ["sdlppx", "sdlrpx"],
		exportPolicy: "return-package",
		exportVerification: "assumed-compatible",
	},
	{
		id: "worldserver",
		label: "WorldServer project package",
		vendor: "RWS WorldServer",
		extensions: ["wsxz"],
		exportPolicy: "return-package",
		exportVerification: "assumed-compatible",
	},
	{
		id: "memoq",
		label: "memoQ handoff/archive package",
		vendor: "memoQ",
		extensions: ["mqout", "mqback", "mqxlz"],
		exportPolicy: "return-package",
		exportVerification: "assumed-compatible",
	},
];

function extensionOf(fileName: string): string {
	return fileName.toLowerCase().split(".").at(-1) ?? "";
}

export function detectCatPackageProfile(
	fileName: string,
	paths: readonly string[],
): CatPackageProfile | undefined {
	const extension = extensionOf(fileName);
	const lowerPaths = paths.map((path) => path.toLowerCase());
	const hasSdlXliff = lowerPaths.some((path) => path.endsWith(".sdlxliff"));
	const hasMemoqXliff = lowerPaths.some((path) => path.endsWith(".mqxliff"));
	const hasXliff = lowerPaths.some((path) => XLIFF_MEMBER.test(path));
	const hasTradosMarker = lowerPaths.some(
		(path) =>
			path.endsWith(".sdlproj") ||
			path.includes("sdlpackage") ||
			path === "package.xml",
	);
	const hasMemoqMarker = lowerPaths.some(
		(path) =>
			path.includes("memoq") ||
			path.endsWith("document.mqxliff") ||
			path.endsWith("packageinfo.xml"),
	);

	if (
		hasSdlXliff &&
		(CAT_PROFILES[0].extensions.includes(extension) || hasTradosMarker)
	)
		return CAT_PROFILES[0];
	if (
		hasMemoqXliff &&
		(CAT_PROFILES[2].extensions.includes(extension) || hasMemoqMarker)
	)
		return CAT_PROFILES[2];
	if (extension === "wsxz" && hasXliff) return CAT_PROFILES[1];
	return undefined;
}

export function catPackageWorkflow(profile: CatPackageProfile): {
	primaryAction: string;
	steps: string[];
	fidelityWarning: string;
} {
	return {
		primaryAction: "Import, translate, and write a return package",
		steps: [
			`Import the original ${profile.label}; it remains retained locally as the package skeleton.`,
			"Open TLC safely inspects the ZIP and imports selected XLIFF-family members while retaining every package entry in the project skeleton.",
			"Translate and review the imported units; locked vendor units remain protected where their XLIFF profile exposes that state.",
			"Export the translated return package; all non-bilingual and unselected entries are copied unchanged.",
		],
		fidelityWarning: `The writer preserves ${profile.vendor} package entries and rebuilds translated XLIFF-family members. Vendor-specific workflow data outside those members is retained unchanged.`,
	};
}

async function partText(part: string | Blob): Promise<string> {
	if (typeof part === "string") return part.replace(/^\ufeff/, "");
	return decodeTextBytes(new Uint8Array(await part.arrayBuffer())).text.replace(
		/^\ufeff/,
		"",
	);
}

function globMatches(path: string, pattern: string): boolean {
	let expression = "^";
	for (let index = 0; index < pattern.length; index++) {
		const character = pattern[index];
		if (character === "*" && pattern[index + 1] === "*") {
			expression += ".*";
			index++;
		} else if (character === "*") expression += "[^/]*";
		else if (character === "?") expression += "[^/]";
		else expression += character.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`${expression}$`, "i").test(path);
}

function selectMembers(paths: readonly string[], selection: string): string[] {
	const candidates = paths.filter((path) => XLIFF_MEMBER.test(path)).sort();
	const patterns = parseList(selection).filter(
		(pattern) => pattern.toLowerCase() !== "all",
	);
	if (patterns.length === 0) return candidates;
	return candidates.filter((path) =>
		patterns.some((pattern) => globMatches(path, pattern)),
	);
}

export async function importCatPackageFile(
	file: File,
	options: Readonly<FormatOptionValues> = {},
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const normalized = normalizeImportOptions("cat-package", options);
	const archive = await readSafeZipPackage(file, context);
	const paths = Object.keys(archive.parts);
	const profile = detectCatPackageProfile(file.name, paths);
	if (!profile)
		throw new SafeInputError(
			"CAT_PACKAGE_INVALID",
			"The ZIP does not contain a recognized Trados, WorldServer, or memoQ package structure.",
		);
	const members = selectMembers(paths, String(normalized.memberPaths));
	if (members.length === 0)
		throw new SafeInputError(
			"CAT_PACKAGE_NO_TRANSLATABLE_MEMBERS",
			"No supported XLIFF-family member matched the package selection.",
		);

	const includeTargets = Boolean(normalized.includeExistingTargets);
	const sourceSegments: string[] = [];
	const targetSegments: string[] = [];
	const units: TranslationUnit[] = [];
	const memberReports: Array<Record<string, unknown>> = [];
	let sourceLanguage = "";
	let targetLanguage = "";

	for (const [memberIndex, path] of members.entries()) {
		throwIfAborted(context?.signal);
		try {
			const xml = await partText(archive.parts[path]);
			const imported = await importXliffProjectStreaming(
				new File([xml], path, { type: "application/xliff+xml" }),
				context,
			);
			const project = imported.data.translationData;
			const model = project.documentModel;
			if (!model || model.units.length !== project.seg1.length)
				throw new SafeInputError(
					"CAT_PACKAGE_INVALID",
					`Package member “${path}” has no aligned XLIFF document model.`,
				);
			sourceLanguage ||= project.sourceLang;
			targetLanguage ||= project.targetLang;
			for (const [unitIndex, unit] of model.units.entries()) {
				const source = project.seg1[unitIndex] ?? "";
				const target = includeTargets ? (project.seg2[unitIndex] ?? "") : "";
				sourceSegments.push(source);
				targetSegments.push(target);
				units.push({
					...unit,
					id: `member-${memberIndex + 1}:${unit.id}`,
					target: includeTargets
						? unit.target
						: createTextContent("", unit.target.language),
					state: includeTargets ? unit.state : "initial",
					contexts: [
						...unit.contexts,
						{ type: "cat-package-member", value: path },
					],
					sourceLocation: {
						...unit.sourceLocation,
						part: path,
						segmentIndex: sourceSegments.length - 1,
						metadata: {
							...unit.sourceLocation?.metadata,
							memberUnitId: unit.id,
						},
					},
				});
			}
			memberReports.push({
				path,
				status: "imported",
				units: model.units.length,
				xliffProfile: model.metadata?.xliffProfile ?? null,
			});
		} catch (error) {
			if (error instanceof SafeInputError && error.code === "ABORTED")
				throw error;
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				`Could not import package member “${path}”: ${error instanceof Error ? error.message : "invalid XLIFF"}`,
			);
		}
	}

	if (sourceSegments.length === 0)
		throw new SafeInputError(
			"CAT_PACKAGE_NO_TRANSLATABLE_MEMBERS",
			"The selected package members contain no translation units.",
		);

	const document: NeutralDocument = {
		schemaVersion: 1,
		id: `cat-package:${file.name}`,
		format: "cat-package",
		...(sourceLanguage ? { sourceLanguage } : {}),
		...(targetLanguage ? { targetLanguage } : {}),
		units,
		metadata: {
			catPackage: {
				profile,
				members: memberReports,
				entryCount: paths.length,
				unknownEntriesPreserved: paths.filter((path) => !members.includes(path))
					.length,
				exportPolicy: "return-package",
			},
		},
	};

	return {
		kind: "segments",
		segments: sourceSegments,
		targetSegments,
		document,
		skeleton: await createPackageSkeleton(
			file,
			"cat-package",
			archive.parts,
			[],
			archive.source,
		),
		filterOptions: normalized,
		typeRef: {
			packageProfile: profile.id,
			packageVendor: profile.vendor,
			packageMembers: memberReports,
			exportPolicy: "return-package",
			returnExtension: returnExtensionFor(file.name),
			workflowWarnings: catPackageWorkflow(profile).steps,
		},
	};
}

export async function validateCatPackageFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await importCatPackageFile(file, undefined, context);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			reason:
				error instanceof Error
					? error.message
					: "Invalid proprietary CAT package.",
			...(error instanceof SafeInputError ? { errorCode: error.code } : {}),
		};
	}
}

function returnExtensionFor(fileName: string): string {
	const extension = extensionOf(fileName);
	if (extension === "sdlppx") return "sdlrpx";
	if (extension === "mqout") return "mqback";
	return CAT_PACKAGE_EXTENSIONS.includes(
		extension as (typeof CAT_PACKAGE_EXTENSIONS)[number],
	)
		? extension
		: "zip";
}

function packageSkeleton(
	project: UserData,
): DocumentSkeleton & { payload: PackageSkeletonPayload } {
	const skeleton = project.translationData.skeleton;
	if (
		!skeleton ||
		skeleton.format !== "cat-package" ||
		skeleton.payload.kind !== "package"
	)
		throw new Error(
			"CAT package export requires its retained package skeleton.",
		);
	return skeleton as DocumentSkeleton & { payload: PackageSkeletonPayload };
}

function profileUnlockedDocument(project: UserData): UserData {
	const document = project.translationData.documentModel;
	if (!document) return project;
	const { xliffProfile: _profile, ...metadata } = document.metadata ?? {};
	return {
		...project,
		translationData: {
			...project.translationData,
			documentModel: { ...document, metadata },
		},
	};
}

function buildMemberXliff(project: UserData): string {
	const metadata = project.translationData.documentModel?.metadata;
	if (metadata?.xliff12) return buildXliff12(profileUnlockedDocument(project));
	const xliff2 = metadata?.xliff2 as { version?: Xliff2Version } | undefined;
	if (xliff2?.version)
		return buildXliff2(profileUnlockedDocument(project), xliff2.version);
	throw new Error("CAT package member has no supported XLIFF document model.");
}

function unitIsLocked(unit: TranslationUnit | undefined): boolean {
	const profile = unit?.metadata?.xliffProfile as
		| { locked?: boolean }
		| undefined;
	return profile?.locked === true || unit?.translatable === false;
}

export async function buildCatReturnPackage(project: UserData): Promise<{
	blob: Blob;
	extension: string;
}> {
	assertProjectExportQuality(project);
	const skeleton = packageSkeleton(project);
	const source = skeleton.source.originalFile;
	const zip = source
		? await JSZip.loadAsync(await source.arrayBuffer())
		: new JSZip();
	if (!source)
		for (const [path, part] of Object.entries(skeleton.payload.parts))
			zip.file(path, part);

	const combined = project.translationData.documentModel;
	if (!combined)
		throw new Error(
			"CAT package export requires its bilingual document model.",
		);
	const extensionFromTypeRef =
		typeof project.translationData.typeRef === "object" &&
		typeof project.translationData.typeRef.returnExtension === "string"
			? project.translationData.typeRef.returnExtension
			: undefined;
	const extension =
		extensionFromTypeRef ?? returnExtensionFor(project.translationData.name);
	if (
		source &&
		combined.units.every(
			(unit, index) =>
				project.translationData.seg2[index] === contentToPlainText(unit.target),
		)
	)
		return { blob: source, extension };
	const memberIndexes = new Map<string, number[]>();
	for (const [index, unit] of combined.units.entries()) {
		const path = unit.sourceLocation?.part;
		if (!path) continue;
		const indexes = memberIndexes.get(path) ?? [];
		indexes.push(index);
		memberIndexes.set(path, indexes);
	}

	for (const [path, indexes] of memberIndexes) {
		const part = skeleton.payload.parts[path];
		if (!part) throw new Error(`CAT package member “${path}” is missing.`);
		const xml = await partText(part);
		const imported = await importXliffProjectStreaming(
			new File([xml], path, { type: "application/xliff+xml" }),
		);
		const member = imported.data;
		if (member.translationData.seg1.length !== indexes.length)
			throw new Error(
				`CAT package member “${path}” no longer aligns with the imported units.`,
			);
		member.translationData.seg2 = indexes.map((globalIndex, localIndex) =>
			unitIsLocked(combined.units[globalIndex])
				? (member.translationData.seg2[localIndex] ?? "")
				: (project.translationData.seg2[globalIndex] ??
					project.translationData.seg1[globalIndex] ??
					""),
		);
		member.translationData.checked = indexes.map(
			(globalIndex) => project.translationData.checked[globalIndex] ?? false,
		);
		zip.file(path, buildMemberXliff(member));
	}

	return {
		blob: await zip.generateAsync({
			type: "blob",
			compression: "DEFLATE",
			compressionOptions: { level: 6 },
		}),
		extension,
	};
}

export async function generateCatReturnPackage(
	project: UserData,
): Promise<void> {
	const { blob, extension } = await buildCatReturnPackage(project);
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `${(project.translationData.name || "translation").replace(/\.(?:sdlppx|sdlrpx|wsxz|mqout|mqback|mqxlz)$/i, "")}.translated.${extension}`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
