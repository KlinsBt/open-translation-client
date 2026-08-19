import JSZip from "jszip";
import type { FormatId } from "./formatIds";
import {
	assertSafeFileSize,
	decodeTextBytes,
	inspectSafeZipFile,
	throwIfAborted,
	type SafeArchiveInspection,
	type SafeInputContext,
} from "./safeInput";
import type { FormatAdapter } from "./types";
import {
	detectExternalMediaCandidate,
	externalExtractionDisclosure,
} from "./externalExtraction";
import {
	detectXliffVendorProfile,
	type XliffVendorProfileId,
} from "./xliffProfiles";
import { catPackageWorkflow, detectCatPackageProfile } from "./catPackage";
import {
	inspectZipProjectManifest,
	ZIP_PROJECT_MANIFEST_PATH,
} from "./zipProject";

export type DetectionConfidence = "high" | "medium" | "low";

export type DetectionEvidence =
	| "package"
	| "signature"
	| "content"
	| "extension"
	| "mime";

export interface FormatDetection {
	formatId: FormatId | null;
	label: string;
	supported: boolean;
	confidence: DetectionConfidence;
	evidence: readonly DetectionEvidence[];
	reason: string;
	workflow?: ConstrainedFormatWorkflow;
	adapter?: FormatAdapter;
}

export interface ConstrainedFormatWorkflow {
	kind:
		| "convert-before-import"
		| "source-only"
		| "external-service-required"
		| "read-only-package"
		| "return-package"
		| "manifest-required";
	primaryAction: string;
	steps: readonly string[];
	targetFormats?: readonly string[];
	privacyWarning?: string;
	fidelityWarning?: string;
}

export interface ProjectFileDetection {
	format: "json" | "xliff";
	label: string;
	confidence: DetectionConfidence;
	evidence: readonly DetectionEvidence[];
	reason: string;
	profileId?: XliffVendorProfileId;
	exportPolicy?: "import-only";
}

const XLIFF_PROJECT_EXTENSIONS = new Set([
	"xlf",
	"xliff",
	"sdlxliff",
	"mqxliff",
	"mxliff",
]);

export function getFileExtension(fileName: string): string | undefined {
	const baseName = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
	const lastDot = baseName.lastIndexOf(".");
	if (lastDot <= 0 || lastDot === baseName.length - 1) return undefined;
	return baseName.slice(lastDot + 1).toLowerCase();
}

export function normalizeMimeType(mimeType: string): string {
	return mimeType.toLowerCase().split(";", 1)[0].trim();
}

export async function detectFileFormat(
	file: File,
	adapters: readonly FormatAdapter[],
	context?: SafeInputContext,
): Promise<FormatDetection | undefined> {
	assertSafeFileSize(file);
	throwIfAborted(context?.signal);
	const extension = getFileExtension(file.name);
	const mimeType = normalizeMimeType(file.type);
	const prefix = new Uint8Array(
		await file.slice(0, Math.min(file.size, 16 * 1024)).arrayBuffer(),
	);
	throwIfAborted(context?.signal);

	if (hasZipSignature(prefix)) {
		const inspection = await inspectSafeZipFile(file, context);
		return detectZipPackage(inspection, adapters, file.name, context);
	}

	if (hasOleSignature(prefix)) {
		const adapter = adapters.find(
			(candidate) => candidate.id === "legacy-office",
		);
		if (
			adapter &&
			extension !== undefined &&
			adapter.extensions.includes(extension)
		) {
			const validation = await adapter.validate(file, context);
			if (validation.valid)
				return supportedContent(adapter, extension, mimeType);
			return unsupported(
				"Invalid legacy Office document",
				"high",
				["signature", "extension"],
				validation.reason ??
					"The OLE signature is present, but its internal application streams do not match the requested Office family.",
			);
		}
		const legacy = legacyOfficeLabel(extension);
		return unsupported(
			legacy ?? "OLE compound document",
			legacy ? "high" : "medium",
			legacy ? ["signature", "extension"] : ["signature"],
			legacy
				? `${legacy} is a legacy binary Office format. Convert it locally to the corresponding modern Open XML format before import.`
				: "The binary compound-document signature is recognized, but its application format is ambiguous.",
			legacy ? legacyOfficeWorkflow(extension) : undefined,
		);
	}

	if (hasPdfSignature(prefix)) {
		const adapter = adapters.find((candidate) => candidate.id === "pdf");
		if (adapter) return supportedContent(adapter, extension, mimeType);
	}

	const externalCandidate = detectExternalMediaCandidate(prefix);
	if (externalCandidate) {
		const localAdapter = adapters.find((adapter) =>
			externalCandidate.modality === "ocr"
				? adapter.id === "image-ocr"
				: adapter.id === "media-transcription",
		);
		if (localAdapter)
			return supportedContent(localAdapter, extension, mimeType);
		const metadata = metadataEvidence(
			extension,
			mimeType,
			externalCandidate.extensions,
			externalCandidate.mimeTypes,
		);
		const disclosure = externalExtractionDisclosure(externalCandidate);
		return unsupported(
			externalCandidate.label,
			metadata.length > 0 ? "high" : "medium",
			["signature", ...metadata],
			externalCandidate.reason,
			{
				kind: "external-service-required",
				primaryAction: disclosure.primaryAction,
				steps: disclosure.steps,
				privacyWarning: disclosure.privacyWarning,
				fidelityWarning: disclosure.fidelityWarning,
			},
		);
	}

	const textKind = sniffTextKind(prefix);
	if (textKind === "json") {
		for (const candidate of adapters.filter(
			(adapter) =>
				adapter.id !== "json" && adapter.mimeTypes.includes("application/json"),
		))
			if (await candidate.sniff(file, context))
				return supportedContent(candidate, extension, mimeType);
		const adapter = adapters.find((candidate) => candidate.id === "json");
		if (adapter && (await adapter.validate(file, context)).valid)
			return supportedContent(adapter, extension, mimeType);
	}
	if (textKind === "html") {
		const adapter = adapters.find((candidate) => candidate.id === textKind);
		if (adapter) return supportedContent(adapter, extension, mimeType);
	}
	if (textKind === "xml") {
		for (const candidate of adapters.filter(
			(adapter) =>
				adapter.id !== "xml" &&
				adapter.id !== "html" &&
				(adapter.mimeTypes.some((type) => isGenericXmlMime(type)) ||
					(extension !== undefined && adapter.extensions.includes(extension)) ||
					(mimeType !== "" && adapter.mimeTypes.includes(mimeType))),
		))
			if (await candidate.sniff(file, context))
				return supportedContent(candidate, extension, mimeType);
		const adapter = adapters.find((candidate) => candidate.id === "xml");
		if (adapter) {
			const detection = supportedContent(adapter, extension, mimeType);
			const text = decodeTextPrefix(prefix) ?? "";
			if (
				/<(?:[\w.-]+:)?Workbook\b[^>]*\bxmlns(?::[\w.-]+)?=["']urn:schemas-microsoft-com:office:spreadsheet["']/i.test(
					text,
				)
			) {
				detection.label = "SpreadsheetML 2003 XML";
				detection.reason =
					"The XML root and namespace identify an Excel 2003 SpreadsheetML workbook; workbook formulas and control markup remain protected.";
			}
			return detection;
		}
		const metadata = metadataEvidence(
			extension,
			mimeType,
			["xml"],
			["application/xml", "text/xml"],
		);
		return unsupported(
			"Generic XML",
			metadata.length > 0 ? "high" : "medium",
			["content", ...metadata],
			"XML content was detected, but no supported XML vocabulary matched this source-file importer.",
		);
	}
	if (textKind === "rtf") {
		const adapter = adapters.find((candidate) => candidate.id === "rtf");
		if (adapter) return supportedContent(adapter, extension, mimeType);
		return unsupported(
			"RTF",
			extension === "rtf" ? "high" : "medium",
			extension === "rtf" ? ["signature", "extension"] : ["signature"],
			"Rich Text Format is recognized as a conversion-only legacy document. Convert it locally to DOCX before import.",
			legacyOfficeWorkflow("rtf"),
		);
	}

	const extensionMatch = extension
		? adapters.find((adapter) => adapter.extensions.includes(extension))
		: undefined;
	const mimeMatch = mimeType
		? adapters.find((adapter) => adapter.mimeTypes.includes(mimeType))
		: undefined;
	const unverifiedLocalMedia = [extensionMatch?.id, mimeMatch?.id].find(
		(id) =>
			id === "image-ocr" ||
			id === "media-transcription" ||
			id === "legacy-office",
	);
	if (unverifiedLocalMedia) {
		return unsupported(
			unverifiedLocalMedia === "legacy-office"
				? "Unrecognized legacy Office file"
				: unverifiedLocalMedia === "image-ocr"
					? "Unrecognized image"
					: "Unrecognized media",
			"low",
			metadataEvidence(
				extension,
				mimeType,
				extensionMatch?.extensions ?? mimeMatch?.extensions ?? [],
				extensionMatch?.mimeTypes ?? mimeMatch?.mimeTypes ?? [],
			),
			"The extension or MIME type claims a supported local format, but its content signature does not match.",
		);
	}
	if (extensionMatch && mimeMatch?.id === extensionMatch.id) {
		return supportedMetadata(extensionMatch, "medium", ["extension", "mime"]);
	}
	if (extensionMatch)
		return supportedMetadata(extensionMatch, "low", ["extension"]);
	if (mimeMatch) return supportedMetadata(mimeMatch, "low", ["mime"]);

	if (isGenericXmlMime(mimeType)) {
		return unsupported(
			"Generic XML",
			"low",
			["mime"],
			"The browser reported a generic XML MIME type, but the content has no recognized supported vocabulary.",
		);
	}
	return undefined;
}

export async function detectProjectFileFormat(
	file: File,
	context?: SafeInputContext,
): Promise<ProjectFileDetection | undefined> {
	assertSafeFileSize(file);
	throwIfAborted(context?.signal);
	const extension = getFileExtension(file.name);
	const mimeType = normalizeMimeType(file.type);
	const prefix = new Uint8Array(
		await file.slice(0, Math.min(file.size, 16 * 1024)).arrayBuffer(),
	);
	throwIfAborted(context?.signal);
	const text = decodeTextPrefix(prefix)?.trimStart() ?? "";
	if (!text) return undefined;
	if (/^(?:\{|\[)/.test(text)) {
		const evidence: DetectionEvidence[] = ["content"];
		if (extension === "json") evidence.push("extension");
		if (["application/json", "text/json"].includes(mimeType))
			evidence.push("mime");
		return {
			format: "json",
			label: "Open TLC JSON",
			confidence: evidence.length > 1 ? "high" : "medium",
			evidence,
			reason:
				"JSON content was detected; the Open TLC project schema will be validated before import.",
		};
	}
	const withoutDeclaration = text
		.replace(/^<\?xml[^?]*\?>\s*/i, "")
		.replace(/^(?:<!--[^]*?-->\s*)+/i, "");
	const xliffRoot = withoutDeclaration.match(/^<(?:[\w.-]+:)?xliff\b([^>]*)>/i);
	if (xliffRoot) {
		const version = xliffRoot[1].match(
			/\bversion\s*=\s*["']([^"']+)["']/i,
		)?.[1];
		const evidence: DetectionEvidence[] = ["content"];
		if (extension && XLIFF_PROJECT_EXTENSIONS.has(extension))
			evidence.push("extension");
		if (isGenericXmlMime(mimeType)) evidence.push("mime");
		const profile = detectXliffVendorProfile(
			text,
			file.name,
			version ?? "unknown",
		);
		return {
			format: "xliff",
			label: profile?.label ?? (version ? `XLIFF ${version}` : "XLIFF"),
			confidence: evidence.length > 1 ? "high" : "medium",
			evidence,
			reason: profile
				? `${profile.label} markers were detected; the file will be imported with vendor XLIFF export disabled pending origin-tool verification.`
				: "The XML document has an XLIFF root element; its Open TLC metadata will be validated during import.",
			...(profile
				? { profileId: profile.id, exportPolicy: profile.exportPolicy }
				: {}),
		};
	}
	if (/^<(?:\?xml\b|[A-Za-z_][\w.:-]*(?:\s|\/?>))/i.test(text))
		return undefined;
	if (extension === "json")
		return projectMetadataDetection("json", "Open TLC JSON", "extension");
	if (extension && XLIFF_PROJECT_EXTENSIONS.has(extension))
		return projectMetadataDetection("xliff", "XLIFF", "extension");
	if (["application/json", "text/json"].includes(mimeType))
		return projectMetadataDetection("json", "Open TLC JSON", "mime");
	return undefined;
}

function projectMetadataDetection(
	format: ProjectFileDetection["format"],
	label: string,
	evidence: "extension" | "mime",
): ProjectFileDetection {
	return {
		format,
		label,
		confidence: "low",
		evidence: [evidence],
		reason: `Detected from ${evidence} metadata; project structure will be validated before import.`,
	};
}

async function detectZipPackage(
	inspection: SafeArchiveInspection,
	adapters: readonly FormatAdapter[],
	fileName: string,
	context?: SafeInputContext,
): Promise<FormatDetection> {
	const paths = new Set(inspection.entries.map((entry) => entry.path));
	const packageDetails = await readSmallPackageDetails(inspection, context);
	if (paths.has("word/document.xml")) {
		return supportedPackage(adapters, "docx", "word/document.xml");
	}
	if (paths.has("xl/workbook.xml")) {
		return supportedPackage(adapters, "xlsx", "xl/workbook.xml");
	}
	if (paths.has("xl/workbook.bin")) {
		return supportedPackage(adapters, "legacy-office", "xl/workbook.bin");
	}
	if (paths.has("ppt/presentation.xml")) {
		return supportedPackage(adapters, "pptx", "ppt/presentation.xml");
	}
	const standaloneSlide = packageDetails.rootRelationships.match(
		/<(?:[\w.-]+:)?Relationship\b(?=[^>]*\bType=["'][^"']*\/officeDocument["'])(?=[^>]*\bTarget=["']\/?(ppt\/slides\/[^"']+\.xml)["'])[^>]*\/?>/i,
	)?.[1];
	if (standaloneSlide && paths.has(standaloneSlide))
		return supportedPackage(adapters, "pptx", standaloneSlide);

	const odf = odfLabel(packageDetails.mimetype);
	if (odf) {
		return supportedPackage(adapters, "odf", `the ${odf} mimetype declaration`);
	}
	if (
		packageDetails.mimetype === "application/epub+zip" ||
		paths.has("META-INF/container.xml")
	) {
		return supportedPackage(adapters, "epub", "the EPUB container declaration");
	}
	const catProfile = detectCatPackageProfile(fileName, [...paths]);
	if (catProfile) {
		const adapter = adapters.find(
			(candidate) => candidate.id === "cat-package",
		);
		if (!adapter)
			throw new Error("No adapter is registered for detected CAT packages.");
		const workflow = catPackageWorkflow(catProfile);
		return {
			formatId: adapter.id,
			label: catProfile.label,
			supported: true,
			confidence: "high",
			evidence: ["package", "signature"],
			reason: `The safe ZIP contains a recognized ${catProfile.vendor} package structure and supported bilingual members.`,
			workflow: {
				kind: "return-package",
				primaryAction: workflow.primaryAction,
				steps: workflow.steps,
				fidelityWarning: workflow.fidelityWarning,
			},
			adapter,
		};
	}
	if (paths.has(ZIP_PROJECT_MANIFEST_PATH)) {
		const manifest = inspectZipProjectManifest(
			packageDetails.openTlcManifest,
			paths,
		);
		if (manifest.valid) {
			const adapter = adapters.find(
				(candidate) => candidate.id === "zip-project",
			);
			if (!adapter)
				throw new Error("No adapter is registered for manifest ZIP projects.");
			return {
				formatId: adapter.id,
				label: adapter.label,
				supported: true,
				confidence: "high",
				evidence: ["package", "signature", "content"],
				reason: `The safe ZIP contains a valid ${ZIP_PROJECT_MANIFEST_PATH}; every member format is declared explicitly.`,
				adapter,
			};
		}
		return unsupported(
			"Invalid manifest ZIP project",
			"high",
			["package", "signature", "content"],
			manifest.reason,
			manifestRequiredWorkflow(),
		);
	}
	return unsupported(
		"ZIP archive",
		"medium",
		["signature", "package"],
		`The ZIP container is valid, but it is neither a recognized document/CAT package nor a manifest-driven batch with ${ZIP_PROJECT_MANIFEST_PATH}.`,
		manifestRequiredWorkflow(),
	);
}

async function readSmallPackageDetails(
	inspection: SafeArchiveInspection,
	context?: SafeInputContext,
): Promise<{
	mimetype: string;
	contentTypes: string;
	rootRelationships: string;
	openTlcManifest: string;
}> {
	const wanted = new Set([
		"mimetype",
		"[Content_Types].xml",
		"_rels/.rels",
		ZIP_PROJECT_MANIFEST_PATH,
	]);
	const readable = inspection.entries.filter(
		(entry) => wanted.has(entry.path) && entry.uncompressedSize <= 1024 * 1024,
	);
	if (readable.length === 0)
		return {
			mimetype: "",
			contentTypes: "",
			rootRelationships: "",
			openTlcManifest: "",
		};
	throwIfAborted(context?.signal);
	const zip = await JSZip.loadAsync(inspection.bytes);
	const values = new Map<string, string>();
	for (const entry of readable) {
		throwIfAborted(context?.signal);
		values.set(entry.path, (await zip.file(entry.path)?.async("string")) ?? "");
	}
	return {
		mimetype: values.get("mimetype")?.trim() ?? "",
		contentTypes: values.get("[Content_Types].xml") ?? "",
		rootRelationships: values.get("_rels/.rels") ?? "",
		openTlcManifest: values.get(ZIP_PROJECT_MANIFEST_PATH) ?? "",
	};
}

function manifestRequiredWorkflow(): ConstrainedFormatWorkflow {
	return {
		kind: "manifest-required",
		primaryAction: `Add a valid ${ZIP_PROJECT_MANIFEST_PATH}`,
		steps: [
			"Create a new ZIP; do not modify a proprietary application package in place.",
			`Add ${ZIP_PROJECT_MANIFEST_PATH} at the archive root with schemaVersion 1, kind open-tlc-format-batch, and an explicit members array.`,
			"For each member declare its exact safe path, registered round-trip format ID, optional MIME type/import options, and whether it is required.",
			"Keep nested manifest ZIPs, source-only/read-only formats, duplicate paths, and undeclared format guessing out of the batch.",
		],
		fidelityWarning:
			"Open TLC processes only declared members. Undeclared entries are byte-preserved, and a declared member is never reclassified silently from its extension.",
	};
}

function supportedPackage(
	adapters: readonly FormatAdapter[],
	id: FormatId,
	marker: string,
): FormatDetection {
	const adapter = adapters.find((candidate) => candidate.id === id);
	if (!adapter) throw new Error(`No adapter is registered for detected ${id}.`);
	return {
		formatId: adapter.id,
		label: adapter.label,
		supported: true,
		confidence: "high",
		evidence: ["package", "signature"],
		reason: `The ZIP package contains ${marker}.`,
		adapter,
	};
}

function supportedContent(
	adapter: FormatAdapter,
	extension: string | undefined,
	mimeType: string,
): FormatDetection {
	const metadata = metadataEvidence(
		extension,
		mimeType,
		adapter.extensions,
		adapter.mimeTypes,
	);
	const conflicts: string[] = [];
	if (extension && !adapter.extensions.includes(extension))
		conflicts.push(`the .${extension} extension`);
	if (
		mimeType &&
		mimeType !== "application/octet-stream" &&
		!adapter.mimeTypes.includes(mimeType)
	)
		conflicts.push(`the ${mimeType} MIME type`);
	const conflictMessage =
		conflicts.length > 0
			? ` ${conflicts.join(" and ")} disagreed and ${conflicts.length === 1 ? "was" : "were"} ignored.`
			: "";
	return {
		formatId: adapter.id,
		label: adapter.label,
		supported: true,
		confidence: metadata.length > 0 ? "high" : "medium",
		evidence: ["content", ...metadata],
		reason:
			metadata.length > 0
				? `The file content and ${metadata.join(" and ")} agree on ${adapter.label}.${conflictMessage}`
				: `The file content matches ${adapter.label}; filename and MIME metadata were inconclusive.${conflictMessage}`,
		adapter,
	};
}

function supportedMetadata(
	adapter: FormatAdapter,
	confidence: DetectionConfidence,
	evidence: DetectionEvidence[],
): FormatDetection {
	return {
		formatId: adapter.id,
		label: adapter.label,
		supported: true,
		confidence,
		evidence,
		reason: `Detected ${adapter.label} from ${evidence.join(" and ")} metadata; validation will confirm its structure.`,
		adapter,
	};
}

function unsupported(
	label: string,
	confidence: DetectionConfidence,
	evidence: DetectionEvidence[],
	reason: string,
	workflow?: ConstrainedFormatWorkflow,
): FormatDetection {
	return {
		formatId: null,
		label,
		supported: false,
		confidence,
		evidence,
		reason,
		...(workflow ? { workflow } : {}),
	};
}

function legacyOfficeWorkflow(
	extension: string | undefined,
): ConstrainedFormatWorkflow {
	const target =
		extension === "xls" ? "XLSX" : extension === "ppt" ? "PPTX" : "DOCX";
	return {
		kind: "convert-before-import",
		primaryAction: `Convert locally to ${target}`,
		targetFormats: [target],
		steps: [
			"Open a copy in a trusted, patched desktop office application.",
			`Use Save As to create ${target}; do not merely rename the extension.`,
			"Reopen the converted file and inspect layout, formulas, macros, links, fonts, and embedded objects.",
			"Upload the converted copy to Open TLC and keep the original as the authoritative source.",
		],
		privacyWarning:
			"Open TLC does not upload this file to a converter. Avoid public conversion websites for confidential documents.",
		fidelityWarning:
			"Conversion can alter pagination, formulas, animations, macros, tracked changes, fields, fonts, and embedded objects.",
	};
}

function metadataEvidence(
	extension: string | undefined,
	mimeType: string,
	extensions: readonly string[],
	mimeTypes: readonly string[],
): DetectionEvidence[] {
	const evidence: DetectionEvidence[] = [];
	if (extension && extensions.includes(extension)) evidence.push("extension");
	if (mimeType && mimeTypes.includes(mimeType)) evidence.push("mime");
	return evidence;
}

function sniffTextKind(
	bytes: Uint8Array,
): "json" | "html" | "xml" | "rtf" | undefined {
	const text = decodeTextPrefix(bytes)?.trimStart();
	if (!text) return undefined;
	if (/^\{\\rtf(?:\d|\s)/i.test(text)) return "rtf";
	if (/^(?:\{|\[)/.test(text)) return "json";
	const withoutDeclaration = text.replace(/^<\?xml[^?]*\?>\s*/i, "");
	if (
		/^<(?:!doctype\s+html|html|head|body|a|article|aside|button|div|footer|form|h[1-6]|header|label|li|main|nav|ol|option|p|section|select|span|table|textarea|title|ul)(?:\s|>)/i.test(
			withoutDeclaration,
		)
	)
		return "html";
	if (/^<(?:\?xml\b|[A-Za-z_][\w.:-]*(?:\s|\/?>))/i.test(text)) return "xml";
	return undefined;
}

function decodeTextPrefix(bytes: Uint8Array): string | undefined {
	for (let trim = 0; trim <= Math.min(4, bytes.length); trim++) {
		try {
			return decodeTextBytes(
				trim === 0 ? bytes : bytes.subarray(0, bytes.length - trim),
			).text;
		} catch {
			// A sampled prefix may end midway through a UTF-8/UTF-16 code point.
		}
	}
	return undefined;
}

function hasZipSignature(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x50 &&
		bytes[1] === 0x4b &&
		((bytes[2] === 0x03 && bytes[3] === 0x04) ||
			(bytes[2] === 0x05 && bytes[3] === 0x06) ||
			(bytes[2] === 0x07 && bytes[3] === 0x08))
	);
}

function hasOleSignature(bytes: Uint8Array): boolean {
	const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
	return signature.every((value, index) => bytes[index] === value);
}

function hasPdfSignature(bytes: Uint8Array): boolean {
	const signature = [0x25, 0x50, 0x44, 0x46, 0x2d];
	const limit = Math.min(bytes.length - signature.length, 1_024);
	for (let start = 0; start <= limit; start++)
		if (signature.every((value, index) => bytes[start + index] === value))
			return true;
	return false;
}

function legacyOfficeLabel(extension: string | undefined): string | undefined {
	if (extension === "doc") return "Legacy Word (.doc)";
	if (extension === "xls") return "Legacy Excel (.xls)";
	if (extension === "ppt") return "Legacy PowerPoint (.ppt)";
	return undefined;
}

function odfLabel(mimetype: string): string | undefined {
	if (mimetype === "application/vnd.oasis.opendocument.text") return "ODT";
	if (mimetype === "application/vnd.oasis.opendocument.spreadsheet")
		return "ODS";
	if (mimetype === "application/vnd.oasis.opendocument.presentation")
		return "ODP";
	return undefined;
}

function isGenericXmlMime(mimeType: string): boolean {
	return (
		mimeType === "application/xml" ||
		mimeType === "text/xml" ||
		mimeType.endsWith("+xml")
	);
}
