import JSZip from "jszip";
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
	safeParseXml,
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
	"pxf",
	"ppf",
	"txf",
	"tpf",
	"tipp",
	"coti",
	"xlz",
] as const;

export const CAT_PACKAGE_MIME_TYPES = [
	"application/zip",
	"application/x-sdl-project-package",
	"application/x-sdl-return-package",
	"application/x-worldserver-package",
	"application/x-memoq-package",
	"application/x-star-transit-package",
	"application/x-tipp-package",
	"application/x-coti-package",
] as const;

const XLIFF_MEMBER = /\.(?:xlf|xliff|sdlxliff|mqxliff|mxliff)$/i;

export interface CatPackageProfile {
	id:
		| "trados"
		| "worldserver"
		| "worldserver-xlz"
		| "memoq"
		| "star-transit"
		| "tipp"
		| "coti";
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
	{
		id: "star-transit",
		label: "STAR Transit project/translation package",
		vendor: "STAR Transit",
		extensions: ["pxf", "ppf", "txf", "tpf"],
		exportPolicy: "return-package",
		exportVerification: "assumed-compatible",
	},
	{
		id: "tipp",
		label: "TIPP request/response package",
		vendor: "TIPP / Interoperability Now",
		extensions: ["tipp"],
		exportPolicy: "return-package",
		exportVerification: "assumed-compatible",
	},
	{
		id: "coti",
		label: "COTI translation package",
		vendor: "DERCOM COTI",
		extensions: ["coti", "zip"],
		exportPolicy: "return-package",
		exportVerification: "assumed-compatible",
	},
	{
		id: "worldserver-xlz",
		label: "WorldServer legacy XLZ package",
		vendor: "RWS WorldServer",
		extensions: ["xlz"],
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
	const hasTransitProject = lowerPaths.some((path) => path.endsWith(".prj"));
	const hasTransitPair = lowerPaths.some((path) => {
		const candidate = extensionOf(path);
		return (
			/^[a-z]{3}$/.test(candidate) &&
			!TRANSIT_RESERVED_EXTENSIONS.has(candidate)
		);
	});
	const hasTippEnvelope =
		lowerPaths.includes("manifest.xml") && lowerPaths.includes("resources.zip");
	const cotiManifest = lowerPaths.find(
		(path) => path === "coti.xml" || path.endsWith("/coti.xml"),
	);
	const hasCotiTranslationFolder = lowerPaths.some(
		(path) =>
			path.includes("translation files/") ||
			path.includes("translation_files/"),
	);
	const hasWorldServerSkeleton = lowerPaths.some((path) =>
		path.endsWith(".skl"),
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
	if (
		["pxf", "ppf", "txf", "tpf"].includes(extension) &&
		hasTransitProject &&
		(hasTransitPair || hasXliff)
	)
		return CAT_PROFILES[3];
	if (extension === "tipp" && hasTippEnvelope) return CAT_PROFILES[4];
	if (
		cotiManifest &&
		hasCotiTranslationFolder &&
		(extension === "coti" || extension === "zip")
	)
		return CAT_PROFILES[5];
	if (extension === "xlz" && hasXliff && hasWorldServerSkeleton)
		return CAT_PROFILES[6];
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

const NESTED_MEMBER_SEPARATOR = "!/";
const TRANSIT_RESERVED_EXTENSIONS = new Set([
	"prj",
	"cod",
	"ffd",
	"txe",
	"fck",
	"pdf",
	"doc",
	"docx",
	"rtf",
	"xml",
	"xlf",
	"xliff",
]);

interface PackageMember {
	path: string;
	outerPath: string;
	innerPath?: string;
	kind: "xliff" | "transit";
	sourcePath?: string;
}

function xmlRootName(document: Document): string {
	return document.documentElement?.localName?.toLowerCase() ?? "";
}

async function validateProfileManifest(
	profile: CatPackageProfile,
	parts: Readonly<Record<string, string | Blob>>,
	context?: SafeInputContext,
): Promise<void> {
	if (profile.id === "tipp") {
		const manifest = parts["manifest.xml"];
		if (!manifest)
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				"The TIPP package is missing manifest.xml.",
			);
		const document = safeParseXml(await partText(manifest), context);
		const root = document.documentElement;
		const signature = `${root?.localName ?? ""} ${root?.namespaceURI ?? ""} ${root?.getAttribute("version") ?? ""}`;
		if (!/tipp|package/i.test(signature))
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				"manifest.xml does not contain a recognized TIPP package signature.",
			);
	}
	if (profile.id === "coti") {
		const path = Object.keys(parts).find((candidate) =>
			/(^|\/)coti\.xml$/i.test(candidate),
		);
		if (!path)
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				"The COTI package is missing coti.xml.",
			);
		const document = safeParseXml(await partText(parts[path]), context);
		if (xmlRootName(document) !== "coti")
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				"coti.xml does not have the required COTI root element.",
			);
		const root = document.documentElement;
		if (!root.querySelector("project, translation"))
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				"coti.xml contains no project or translation declaration.",
			);
	}
}

async function nestedTippMembers(
	parts: Readonly<Record<string, string | Blob>>,
	context?: SafeInputContext,
): Promise<{ members: PackageMember[]; parts: Record<string, string | Blob> }> {
	const payload = parts["resources.zip"];
	if (!payload)
		throw new SafeInputError(
			"CAT_PACKAGE_INVALID",
			"The TIPP package is missing resources.zip.",
		);
	const blob = typeof payload === "string" ? new Blob([payload]) : payload;
	const nested = await readSafeZipPackage(
		new File([blob], "resources.zip", { type: "application/zip" }),
		context,
	);
	const members = Object.keys(nested.parts)
		.filter((path) => XLIFF_MEMBER.test(path))
		.sort()
		.map((innerPath) => ({
			path: `resources.zip${NESTED_MEMBER_SEPARATOR}${innerPath}`,
			outerPath: "resources.zip",
			innerPath,
			kind: "xliff" as const,
		}));
	return { members, parts: nested.parts };
}

function transitLanguageMembers(paths: readonly string[]): string[] {
	return paths.filter((path) => {
		const extension = extensionOf(path);
		return (
			/^[a-z]{3}$/i.test(extension) &&
			!TRANSIT_RESERVED_EXTENSIONS.has(extension.toLowerCase())
		);
	});
}

function transitDeclaredLanguage(
	projectText: string,
	kind: "source" | "target",
): string | undefined {
	const expressions = [
		new RegExp(`${kind}(?:Language|Lang|Lng)\\s*=\\s*["']?([A-Za-z]{3})`, "i"),
		new RegExp(`<${kind}(?:Language|Lang|Lng)[^>]*>\\s*([A-Za-z]{3})`, "i"),
	];
	for (const expression of expressions) {
		const match = projectText.match(expression)?.[1];
		if (match) return match.toLowerCase();
	}
	return undefined;
}

async function transitMembers(
	parts: Readonly<Record<string, string | Blob>>,
): Promise<PackageMember[]> {
	const projectPath = Object.keys(parts).find((path) => /\.prj$/i.test(path));
	if (!projectPath) return [];
	const projectText = await partText(parts[projectPath]);
	const sourceExtension = transitDeclaredLanguage(projectText, "source");
	const targetExtension = transitDeclaredLanguage(projectText, "target");
	if (
		!sourceExtension ||
		!targetExtension ||
		sourceExtension === targetExtension
	)
		throw new SafeInputError(
			"CAT_PACKAGE_INVALID",
			"The Transit project does not declare distinct three-letter source and target language files.",
		);
	const paths = transitLanguageMembers(Object.keys(parts));
	const targets = paths.filter(
		(path) => extensionOf(path).toLowerCase() === targetExtension,
	);
	const members: PackageMember[] = [];
	for (const path of targets) {
		const stem = path.slice(0, -(targetExtension.length + 1));
		const sourcePath = paths.find(
			(candidate) =>
				candidate.toLowerCase() === `${stem}.${sourceExtension}`.toLowerCase(),
		);
		if (sourcePath)
			members.push({ path, outerPath: path, kind: "transit", sourcePath });
	}
	return members.sort((a, b) => a.path.localeCompare(b.path));
}

function transitSegments(xml: string): Array<{
	id: string;
	text: string;
	start: number;
	end: number;
	locked: boolean;
}> {
	const syntax = parseTransitXml(xml);
	return syntax;
}

function parseTransitXml(xml: string): Array<{
	id: string;
	text: string;
	start: number;
	end: number;
	locked: boolean;
}> {
	const document = safeParseXml(xml);
	const nodes = new Map<string, Element>();
	for (const candidate of document.getElementsByTagName("*")) {
		if (candidate.localName.toLowerCase() !== "seg") continue;
		const id = candidate.getAttribute("SegID");
		if (!id) continue;
		if (nodes.has(id))
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				`Transit language file contains duplicate SegID “${id}”.`,
			);
		nodes.set(id, candidate);
	}
	const segments: Array<{
		id: string;
		text: string;
		start: number;
		end: number;
		locked: boolean;
	}> = [];
	const pattern =
		/<(?:[\w.-]+:)?Seg\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?Seg\s*>/gi;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(xml))) {
		if (/<[^!?]/.test(match[2]))
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				"Transit segments containing nested proprietary markup cannot be edited safely.",
			);
		const id = match[1].match(/\bSegID\s*=\s*["']([^"']+)["']/i)?.[1];
		if (!id)
			throw new SafeInputError(
				"CAT_PACKAGE_INVALID",
				"A Transit segment is missing its SegID.",
			);
		const raw = match[2];
		const leading = raw.match(/^\s*/)?.[0].length ?? 0;
		const trailing = raw.match(/\s*$/)?.[0].length ?? 0;
		const contentStart = match.index + match[0].indexOf(">") + 1;
		const start = contentStart + leading;
		const end = contentStart + raw.length - trailing;
		const node = nodes.get(id);
		const status = `${match[1]} ${node?.getAttribute("Status") ?? ""}`;
		segments.push({
			id,
			text: node?.textContent ?? raw,
			start,
			end,
			locked: /\b(?:locked|protected)\s*=\s*["']?(?:1|true|yes)/i.test(status),
		});
	}
	return segments;
}

function escapeXmlText(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
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
			"The ZIP does not contain a recognized Trados, WorldServer, memoQ, Transit, TIPP, or COTI package structure.",
		);
	await validateProfileManifest(profile, archive.parts, context);
	let nestedParts: Record<string, string | Blob> | undefined;
	let availableMembers: PackageMember[];
	if (profile.id === "tipp") {
		const nested = await nestedTippMembers(archive.parts, context);
		nestedParts = nested.parts;
		availableMembers = nested.members;
	} else if (profile.id === "star-transit") {
		const nativeMembers = await transitMembers(archive.parts);
		availableMembers = nativeMembers.length
			? nativeMembers
			: selectMembers(paths, "").map((path) => ({
					path,
					outerPath: path,
					kind: "xliff" as const,
				}));
	} else {
		const selectedPaths = selectMembers(paths, "").filter(
			(path) =>
				profile.id !== "coti" ||
				/(^|\/)(?:translation[ _-]*files?|translations?)(\/|$)/i.test(path),
		);
		availableMembers = selectedPaths.map((path) => ({
			path,
			outerPath: path,
			kind: "xliff" as const,
		}));
	}
	const patterns = parseList(String(normalized.memberPaths)).filter(
		(pattern) => pattern.toLowerCase() !== "all",
	);
	const members = availableMembers.filter(
		(member) =>
			patterns.length === 0 ||
			patterns.some((pattern) => globMatches(member.path, pattern)),
	);
	if (members.length === 0)
		throw new SafeInputError(
			"CAT_PACKAGE_NO_TRANSLATABLE_MEMBERS",
			"No validated bilingual member matched the package selection. COTI payloads must contain a supported XLIFF-family file; Transit packages must contain aligned declared language-pair XML files.",
		);

	const includeTargets = Boolean(normalized.includeExistingTargets);
	const sourceSegments: string[] = [];
	const targetSegments: string[] = [];
	const units: TranslationUnit[] = [];
	const memberReports: Array<Record<string, unknown>> = [];
	let sourceLanguage = "";
	let targetLanguage = "";

	for (const [memberIndex, member] of members.entries()) {
		throwIfAborted(context?.signal);
		const path = member.path;
		try {
			if (member.kind === "transit") {
				const sourceXml = await partText(archive.parts[member.sourcePath!]);
				const targetXml = await partText(archive.parts[member.outerPath]);
				const sourceUnits = transitSegments(sourceXml);
				const targetUnits = transitSegments(targetXml);
				if (
					sourceUnits.length === 0 ||
					sourceUnits.length !== targetUnits.length ||
					sourceUnits.some((unit, index) => unit.id !== targetUnits[index]?.id)
				)
					throw new SafeInputError(
						"CAT_PACKAGE_INVALID",
						`Transit language pair “${member.sourcePath}” / “${member.outerPath}” has misaligned segment IDs.`,
					);
				for (const [unitIndex, sourceUnit] of sourceUnits.entries()) {
					const targetUnit = targetUnits[unitIndex];
					const source = sourceUnit.text;
					const target = includeTargets ? targetUnit.text : "";
					sourceSegments.push(source);
					targetSegments.push(target);
					units.push({
						id: `member-${memberIndex + 1}:${sourceUnit.id}`,
						source: createTextContent(source),
						target: createTextContent(target),
						state: target ? "translated" : "initial",
						translatable: !targetUnit.locked,
						notes: [],
						contexts: [
							{ type: "cat-package-member", value: path },
							{ type: "star-transit-segment", value: sourceUnit.id },
						],
						sourceLocation: {
							part: member.outerPath,
							segmentIndex: sourceSegments.length - 1,
							metadata: {
								memberKind: "transit",
								memberUnitId: sourceUnit.id,
								originalTarget: targetUnit.text,
								forceRewrite: !includeTargets,
								targetStart: targetUnit.start,
								targetEnd: targetUnit.end,
							},
						},
					});
				}
				memberReports.push({
					path,
					sourcePath: member.sourcePath,
					status: "imported",
					units: sourceUnits.length,
					profile: "star-transit-native-pair",
				});
				continue;
			}
			const memberPart = member.innerPath
				? nestedParts?.[member.innerPath]
				: archive.parts[member.outerPath];
			if (!memberPart)
				throw new SafeInputError(
					"CAT_PACKAGE_INVALID",
					`Package member “${path}” is missing.`,
				);
			const xml = await partText(memberPart);
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
							originalTarget: project.seg2[unitIndex] ?? "",
							forceRewrite: !includeTargets,
						},
					},
				});
			}
			memberReports.push({
				path,
				...(member.innerPath
					? { outerPath: member.outerPath, innerPath: member.innerPath }
					: {}),
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
				unknownEntriesPreserved: paths.filter(
					(path) => !members.some((member) => member.outerPath === path),
				).length,
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
	if (extension === "pxf") return "txf";
	if (extension === "ppf") return "tpf";
	if (extension === "zip" && /coti/i.test(fileName)) return "coti";
	return CAT_PACKAGE_EXTENSIONS.includes(
		extension as (typeof CAT_PACKAGE_EXTENSIONS)[number],
	)
		? extension
		: extension === "zip"
			? "coti"
			: "zip";
}

function patchTransitMember(
	xml: string,
	indexes: readonly number[],
	project: UserData,
	combined: NeutralDocument,
): string {
	const edits = indexes.map((globalIndex) => {
		const unit = combined.units[globalIndex];
		const metadata = unit.sourceLocation?.metadata as
			| { targetStart?: number; targetEnd?: number }
			| undefined;
		if (metadata?.targetStart === undefined || metadata.targetEnd === undefined)
			throw new Error("Transit segment replacement metadata is missing.");
		const value = unitIsLocked(unit)
			? xml.slice(metadata.targetStart, metadata.targetEnd)
			: escapeXmlText(
					project.translationData.seg2[globalIndex] ??
						project.translationData.seg1[globalIndex] ??
						"",
				);
		return { start: metadata.targetStart, end: metadata.targetEnd, value };
	});
	let output = xml;
	for (const edit of edits.sort((a, b) => b.start - a.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseTransitXml(output);
	return output;
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

function packageTargetsAreIdentity(
	project: UserData,
	document: NeutralDocument,
): boolean {
	return document.units.every((unit, index) => {
		const metadata = unit.sourceLocation?.metadata as
			| { originalTarget?: unknown; forceRewrite?: unknown }
			| undefined;
		return (
			metadata?.forceRewrite !== true &&
			typeof metadata?.originalTarget === "string" &&
			project.translationData.seg2[index] === metadata.originalTarget
		);
	});
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
	if (source && packageTargetsAreIdentity(project, combined))
		return { blob: source, extension };
	const memberIndexes = new Map<string, number[]>();
	for (const [index, unit] of combined.units.entries()) {
		const path = unit.sourceLocation?.part;
		if (!path) continue;
		const indexes = memberIndexes.get(path) ?? [];
		indexes.push(index);
		memberIndexes.set(path, indexes);
	}

	const nestedUpdates = new Map<string, Map<string, string>>();
	for (const [path, indexes] of memberIndexes) {
		const [outerPath, innerPath] = path.split(NESTED_MEMBER_SEPARATOR);
		const part = skeleton.payload.parts[outerPath];
		if (!part) throw new Error(`CAT package member “${path}” is missing.`);
		const kind =
			combined.units[indexes[0]]?.sourceLocation?.metadata?.memberKind;
		if (kind === "transit") {
			const xml = await partText(part);
			zip.file(outerPath, patchTransitMember(xml, indexes, project, combined));
			continue;
		}
		let memberPart = part;
		if (innerPath) {
			const blob = typeof part === "string" ? new Blob([part]) : part;
			const nested = await readSafeZipPackage(
				new File([blob], outerPath, { type: "application/zip" }),
			);
			memberPart = nested.parts[innerPath];
			if (!memberPart)
				throw new Error(`Nested CAT package member “${path}” is missing.`);
		}
		const xml = await partText(memberPart);
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
		member.translationData.locked = indexes.map(
			(globalIndex) => project.translationData.locked[globalIndex] ?? false,
		);
		const rebuilt = buildMemberXliff(member);
		if (innerPath) {
			const updates = nestedUpdates.get(outerPath) ?? new Map<string, string>();
			updates.set(innerPath, rebuilt);
			nestedUpdates.set(outerPath, updates);
		} else zip.file(outerPath, rebuilt);
	}

	for (const [outerPath, updates] of nestedUpdates) {
		const part = skeleton.payload.parts[outerPath];
		if (!part) throw new Error(`Nested package “${outerPath}” is missing.`);
		const blob = typeof part === "string" ? new Blob([part]) : part;
		const nested = await JSZip.loadAsync(await blob.arrayBuffer());
		for (const [innerPath, content] of updates) nested.file(innerPath, content);
		zip.file(
			outerPath,
			await nested.generateAsync({
				type: "uint8array",
				compression: "DEFLATE",
				compressionOptions: { level: 6 },
			}),
		);
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
	link.download = `${(project.translationData.name || "translation").replace(/\.(?:sdlppx|sdlrpx|wsxz|mqout|mqback|mqxlz|pxf|ppf|txf|tpf|tipp|coti|xlz|zip)$/i, "")}.translated.${extension}`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
