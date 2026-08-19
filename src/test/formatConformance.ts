import JSZip from "jszip";
import type { FormatId } from "$lib/formats/formatIds";
import type {
	FormatImportResult,
	FormatOptionValues,
} from "$lib/formats/types";
import type { UserData } from "$lib/types/types";
import { PROJECT_SCHEMA_VERSION } from "$lib/formats/persistenceMigrations";
import { buildTextTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationText";
import { buildJsonTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationJson";
import { buildHtmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationHtml";
import { buildDocxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationDocx";
import { buildXlsxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationXlsx";
import { buildPptxTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationPptx";
import { buildCsvTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationCsv";
import { buildYamlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationYaml";
import { buildPoTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationPo";
import { buildXmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationXml";
import { buildAndroidResourcesTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationAndroid";
import { buildAppleLocalizationTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationApple";
import { buildPropertiesTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationProperties";
import { buildResxTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationResx";
import { buildQtTsTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationQtTs";
import { buildIniTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationIni";
import { buildPhpTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationPhp";
import { buildLightweightMarkupTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationMarkup";
import { buildSubtitleTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationSubtitles";
import { buildOdfTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationOdf";
import { buildEpubTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationEpub";
import { buildSvgTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationSvg";
import { buildDitaTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationDita";
import { buildDocBookTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationDocBook";
import { buildInDesignTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationIdml";
import { buildLatexTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationLatex";
import { buildTtmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationTtml";
import { buildMifTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationMif";
import { buildWindowsRcTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationWindowsRc";
import { buildQmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationQml";
import { buildPdfBilingualReviewBlob } from "$lib/functions/outputGeneration/outputGenerationPdfReview";
import { buildZipProjectTranslationPackage } from "$lib/formats/zipProject";
import { buildRtfTranslationBlob } from "$lib/formats/rtf";
import { buildLegacyOfficeTranslation } from "$lib/formats/legacyOffice";
import { buildCatReturnPackage } from "$lib/formats/catPackage";
import {
	buildOcrBilingualReview,
	buildTranslatedWebVtt,
} from "$lib/functions/outputGeneration/outputGenerationLocalMedia";

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
	identityTargetSegments?: string[];
	identityOutputMayEqualSource?: boolean;
	translatedSegments: string[];
	expectTranslatedTargetSegments?: boolean;
	createPerformanceFile(units: number): Promise<File>;
	performanceOptions?: Readonly<FormatOptionValues>;
	importFile?: (
		file: File,
		options?: Readonly<FormatOptionValues>,
	) => Promise<FormatImportResult>;
	expectedPackageChanges?: string[];
	unicodeExpectations?: string[];
	derivedOutput?: {
		mimeType: string;
		translatedMarkers: string[];
		downloadSuffix: string;
	};
	browserDerivedOutput?: {
		mimeType: string;
		translatedMarkers: string[];
		downloadSuffix: string;
	};
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
			return buildTextTranslationBlob(project);
		case "csv":
			return buildCsvTranslationBlob(project);
		case "json":
			return buildJsonTranslationBlob(project);
		case "yaml":
			return buildYamlTranslationBlob(project);
		case "po":
			return buildPoTranslationBlob(project);
		case "android":
			return buildAndroidResourcesTranslationBlob(project);
		case "apple":
			return buildAppleLocalizationTranslationBlob(project);
		case "properties":
			return buildPropertiesTranslationBlob(project);
		case "resx":
			return buildResxTranslationBlob(project);
		case "qt-ts":
			return buildQtTsTranslationBlob(project);
		case "ini":
			return buildIniTranslationBlob(project);
		case "php":
			return buildPhpTranslationBlob(project);
		case "markup":
			return buildLightweightMarkupTranslationBlob(project);
		case "subtitles":
			return buildSubtitleTranslationBlob(project);
		case "odf":
			return buildOdfTranslationPackage(project);
		case "epub":
			return buildEpubTranslationPackage(project);
		case "svg":
			return buildSvgTranslationBlob(project);
		case "dita":
			return buildDitaTranslationBlob(project);
		case "docbook":
			return buildDocBookTranslationBlob(project);
		case "idml":
			return buildInDesignTranslationBlob(project);
		case "latex":
			return buildLatexTranslationBlob(project);
		case "ttml":
			return buildTtmlTranslationBlob(project);
		case "mif":
			return buildMifTranslationBlob(project);
		case "windows-rc":
			return buildWindowsRcTranslationBlob(project);
		case "qml":
			return buildQmlTranslationBlob(project);
		case "pdf":
			return buildPdfBilingualReviewBlob(project);
		case "image-ocr":
			return new Blob([buildOcrBilingualReview(project)], {
				type: "text/html;charset=utf-8",
			});
		case "media-transcription":
			return new Blob([buildTranslatedWebVtt(project)], {
				type: "text/vtt;charset=utf-8",
			});
		case "rtf":
			return buildRtfTranslationBlob(project);
		case "legacy-office":
			return (await buildLegacyOfficeTranslation(project)).blob;
		case "cat-package":
			return (await buildCatReturnPackage(project)).blob;
		case "zip-project":
			return buildZipProjectTranslationPackage(project);
		case "xml":
			return buildXmlTranslationBlob(project);
		case "html":
			return buildHtmlTranslationBlob(project);
		case "docx":
			return buildDocxTranslationPackage(project);
		case "xlsx":
			return buildXlsxTranslationPackage(project);
		case "pptx":
			return buildPptxTranslationPackage(project);
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
