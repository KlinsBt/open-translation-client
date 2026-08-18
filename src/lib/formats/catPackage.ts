import type { UserData } from "$lib/types/types";
import {
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
import { createPackageSkeleton } from "./skeleton";
import { importXliffProjectStreaming } from "./streamingImporters";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

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
	exportPolicy: "import-only";
	exportVerification: "not-tested-in-originating-tool";
}

const CAT_PROFILES: readonly CatPackageProfile[] = [
	{
		id: "trados",
		label: "Trados Studio project/return package",
		vendor: "RWS Trados Studio",
		extensions: ["sdlppx", "sdlrpx"],
		exportPolicy: "import-only",
		exportVerification: "not-tested-in-originating-tool",
	},
	{
		id: "worldserver",
		label: "WorldServer project package",
		vendor: "RWS WorldServer",
		extensions: ["wsxz"],
		exportPolicy: "import-only",
		exportVerification: "not-tested-in-originating-tool",
	},
	{
		id: "memoq",
		label: "memoQ handoff/archive package",
		vendor: "memoQ",
		extensions: ["mqout", "mqback", "mqxlz"],
		exportPolicy: "import-only",
		exportVerification: "not-tested-in-originating-tool",
	},
];

export class CatPackageReadOnlyError extends Error {
	readonly name = "CatPackageReadOnlyError";

	constructor() {
		super(
			"Proprietary CAT packages are supported for protected import only. Export Open TLC JSON or standard XLIFF; package export remains disabled until origin-tool round trips and licensing are verified.",
		);
	}
}

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
		primaryAction: "Import supported bilingual members read-only",
		steps: [
			`Keep the original ${profile.label} as the authoritative package.`,
			"Open TLC safely inspects the ZIP and imports selected XLIFF-family members while retaining every package entry in the project skeleton.",
			"Translate and review the imported units; locked vendor units remain protected where their XLIFF profile exposes that state.",
			"Export Open TLC JSON or standard XLIFF for handoff. Rebuild the proprietary package only in its owning CAT tool.",
		],
		fidelityWarning: `Open TLC does not write ${profile.vendor} packages. Vendor workflow databases, checksums, manifests, task state, and unknown binary entries are retained only for inspection/project persistence.`,
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
				exportPolicy: "import-only",
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
			exportPolicy: "import-only",
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

export async function rejectCatPackageExport(
	_translation: UserData,
): Promise<void> {
	throw new CatPackageReadOnlyError();
}
