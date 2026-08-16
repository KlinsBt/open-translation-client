import JSZip from "jszip";
import type { FormatId } from "$lib/formats/formatIds";
import type {
	FormatImportResult,
	FormatOptionValues,
} from "$lib/formats/types";
import type { UserData } from "$lib/types/types";
import { PROJECT_SCHEMA_VERSION } from "$lib/formats/persistenceMigrations";
import { buildTextTranslationFromProject } from "$lib/functions/outputGeneration/outputGenerationText";
import { buildJsonTranslation } from "$lib/functions/outputGeneration/outputGenerationJson";
import { buildHtmlTranslation } from "$lib/functions/outputGeneration/outputGenerationHtml";
import { buildDocxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationDocx";
import { buildXlsxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationXlsx";

export const CONFORMANCE_UNICODE_SOURCE = "Café e\u0301 — مرحبا 👩🏽‍💻 𐍈.";
export const CONFORMANCE_UNICODE_TARGET =
	"Übersetzt: Café e\u0301 — مرحبا 👩🏽‍💻 𐍈.";
export const CONFORMANCE_PERFORMANCE_UNITS = 250;

export interface ExtractionSnapshot {
	segments: string[];
	filterOptions: FormatOptionValues;
	skeleton: {
		kind: "text" | "package";
		replacementKinds: string[];
	};
	units: Array<{
		id: string;
		part: string | null;
		path: Array<string | number> | null;
	}>;
}

export interface FormatConformanceFixture {
	id: FormatId;
	fileName: string;
	mimeType: string;
	importOptions?: Readonly<FormatOptionValues>;
	createValidFile(): Promise<File>;
	createMalformedFile(): Promise<File>;
	expectMalformedImportFailure: boolean;
	extractionSnapshot: ExtractionSnapshot;
	translatedSegments: string[];
	createPerformanceFile(units: number): Promise<File>;
	performanceOptions?: Readonly<FormatOptionValues>;
	expectedPackageChanges?: string[];
}

export interface SemanticPackageDiff {
	changed: string[];
	unchanged: string[];
	added: string[];
	removed: string[];
}

export function snapshotExtraction(
	result: FormatImportResult,
): ExtractionSnapshot {
	const segments =
		result.kind === "segments"
			? result.segments
			: result.document.units.map((unit) =>
					unit.source.fragments
						.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
						.join(""),
				);
	return {
		segments: [...segments],
		filterOptions: { ...result.filterOptions },
		skeleton: {
			kind: result.skeleton.payload.kind,
			replacementKinds: result.skeleton.replacements.map(
				(replacement) => replacement.kind,
			),
		},
		units: result.document.units.map((unit) => ({
			id: unit.id,
			part: unit.sourceLocation?.part ?? null,
			path: unit.sourceLocation?.path ? [...unit.sourceLocation.path] : null,
		})),
	};
}

export function projectFromConformanceImport(
	fixture: FormatConformanceFixture,
	result: FormatImportResult,
	targetSegments: readonly string[],
): UserData {
	const segments = snapshotExtraction(result).segments;
	if (targetSegments.length !== segments.length)
		throw new Error(
			`${fixture.id} target fixture has ${targetSegments.length} segments; expected ${segments.length}.`,
		);
	const fallbackTypeRef =
		result.skeleton.payload.kind === "text"
			? result.skeleton.payload.content
			: result.skeleton.payload.parts;
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		translationData: {
			name: `conformance-${fixture.id}`,
			targetLang: "de",
			sourceLang: "en",
			creationDate: "0",
			seg1: segments,
			seg2: [...targetSegments],
			checked: segments.map(() => false),
			type: fixture.id,
			typeRef: result.typeRef ?? fallbackTypeRef,
			segmentsMeta:
				result.kind === "segments" ? result.segmentsMeta : undefined,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

export async function buildConformanceOutput(project: UserData): Promise<Blob> {
	switch (project.translationData.type) {
		case "text":
			return new Blob([buildTextTranslationFromProject(project)], {
				type: "text/plain",
			});
		case "json":
			return new Blob([buildJsonTranslation(project)], {
				type: "application/json",
			});
		case "html":
			return new Blob([buildHtmlTranslation(project)], { type: "text/html" });
		case "docx":
			return buildDocxTranslationPackage(project);
		case "xlsx":
			return buildXlsxTranslationPackage(project);
	}
}

export function outputFile(
	fixture: FormatConformanceFixture,
	output: Blob,
): File {
	return new File([output], fixture.fileName, { type: fixture.mimeType });
}

export async function blobBytes(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blob.arrayBuffer());
}

export async function diffZipPackages(
	source: Blob,
	output: Blob,
): Promise<SemanticPackageDiff> {
	const [sourceZip, outputZip] = await Promise.all([
		JSZip.loadAsync(await source.arrayBuffer()),
		JSZip.loadAsync(await output.arrayBuffer()),
	]);
	const sourcePaths = Object.values(sourceZip.files)
		.filter((entry) => !entry.dir)
		.map((entry) => entry.name)
		.sort();
	const outputPaths = Object.values(outputZip.files)
		.filter((entry) => !entry.dir)
		.map((entry) => entry.name)
		.sort();
	const sourceSet = new Set(sourcePaths);
	const outputSet = new Set(outputPaths);
	const added = outputPaths.filter((path) => !sourceSet.has(path));
	const removed = sourcePaths.filter((path) => !outputSet.has(path));
	const changed: string[] = [];
	const unchanged: string[] = [];
	for (const path of sourcePaths.filter((entry) => outputSet.has(entry))) {
		const [before, after] = await Promise.all([
			sourceZip.file(path)!.async("uint8array"),
			outputZip.file(path)!.async("uint8array"),
		]);
		(bytesEqual(before, after) ? unchanged : changed).push(path);
	}
	return { changed, unchanged, added, removed };
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
	return (
		first.length === second.length &&
		first.every((value, index) => value === second[index])
	);
}
