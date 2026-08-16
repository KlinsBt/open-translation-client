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
	adapter?: FormatAdapter;
}

export interface ProjectFileDetection {
	format: "json" | "xliff";
	label: string;
	confidence: DetectionConfidence;
	evidence: readonly DetectionEvidence[];
	reason: string;
}

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
		return detectZipPackage(inspection, extension, adapters, context);
	}

	if (hasOleSignature(prefix)) {
		const legacy = legacyOfficeLabel(extension);
		return unsupported(
			legacy ?? "OLE compound document",
			legacy ? "high" : "medium",
			legacy ? ["signature", "extension"] : ["signature"],
			legacy
				? `${legacy} is a legacy binary Office format and is not imported directly.`
				: "The binary compound-document signature is recognized, but its application format is ambiguous.",
		);
	}

	const textKind = sniffTextKind(prefix);
	if (textKind === "json" || textKind === "html") {
		const adapter = adapters.find((candidate) => candidate.id === textKind);
		if (adapter) return supportedContent(adapter, extension, mimeType);
	}
	if (textKind === "xml") {
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
		return unsupported(
			"RTF",
			extension === "rtf" ? "high" : "medium",
			extension === "rtf" ? ["signature", "extension"] : ["signature"],
			"Rich Text Format is recognized but is not implemented yet.",
		);
	}

	const extensionMatch = extension
		? adapters.find((adapter) => adapter.extensions.includes(extension))
		: undefined;
	const mimeMatch = mimeType
		? adapters.find((adapter) => adapter.mimeTypes.includes(mimeType))
		: undefined;
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
		if (extension === "xlf" || extension === "xliff")
			evidence.push("extension");
		if (isGenericXmlMime(mimeType)) evidence.push("mime");
		return {
			format: "xliff",
			label: version ? `XLIFF ${version}` : "XLIFF",
			confidence: evidence.length > 1 ? "high" : "medium",
			evidence,
			reason:
				"The XML document has an XLIFF root element; its Open TLC metadata will be validated during import.",
		};
	}
	if (/^<(?:\?xml\b|[A-Za-z_][\w.:-]*(?:\s|\/?>))/i.test(text))
		return undefined;
	if (extension === "json")
		return projectMetadataDetection("json", "Open TLC JSON", "extension");
	if (extension === "xlf" || extension === "xliff")
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
	extension: string | undefined,
	adapters: readonly FormatAdapter[],
	context?: SafeInputContext,
): Promise<FormatDetection> {
	const paths = new Set(inspection.entries.map((entry) => entry.path));
	const packageDetails = await readSmallPackageDetails(inspection, context);
	if (paths.has("word/document.xml")) {
		if (
			paths.has("word/vbaProject.bin") ||
			/macroEnabled\.main\+xml/i.test(packageDetails.contentTypes)
		) {
			return unsupported(
				"DOCM",
				"high",
				["package", "signature"],
				"A macro-enabled Word OOXML package was detected; DOCM import is not enabled because macro preservation is not implemented.",
			);
		}
		if (["dotx", "dotm"].includes(extension ?? ""))
			return unsupported(
				extension!.toUpperCase(),
				"high",
				["package", "extension"],
				"A Word template package was detected, but template round trips are not implemented.",
			);
		return supportedPackage(adapters, "docx", "word/document.xml");
	}
	if (paths.has("xl/workbook.xml")) {
		if (
			paths.has("xl/vbaProject.bin") ||
			/macroEnabled\.main\+xml/i.test(packageDetails.contentTypes)
		) {
			return unsupported(
				"XLSM",
				"high",
				["package", "signature"],
				"A macro-enabled Excel OOXML package was detected; XLSM import is not enabled because macro preservation is not implemented.",
			);
		}
		if (["xltx", "xltm"].includes(extension ?? ""))
			return unsupported(
				extension!.toUpperCase(),
				"high",
				["package", "extension"],
				"An Excel template package was detected, but template round trips are not implemented.",
			);
		return supportedPackage(adapters, "xlsx", "xl/workbook.xml");
	}
	if (paths.has("ppt/presentation.xml")) {
		return unsupported(
			paths.has("ppt/vbaProject.bin") ? "PPTM" : "PPTX",
			"high",
			["package", "signature"],
			"A PowerPoint OOXML package was detected, but presentation import is not implemented yet.",
		);
	}

	const odf = odfLabel(packageDetails.mimetype);
	if (odf) {
		return unsupported(
			odf,
			"high",
			["package", "signature"],
			`The package declares the ${odf} OpenDocument media type, which is recognized but not implemented yet.`,
		);
	}
	if (
		packageDetails.mimetype === "application/epub+zip" ||
		paths.has("META-INF/container.xml")
	) {
		return unsupported(
			"EPUB",
			"high",
			["package", "signature"],
			"An EPUB package was detected, but EPUB import is not implemented yet.",
		);
	}
	return unsupported(
		"ZIP archive",
		"medium",
		["signature", "package"],
		"The ZIP container is valid, but it does not contain a supported DOCX or XLSX package structure.",
	);
}

async function readSmallPackageDetails(
	inspection: SafeArchiveInspection,
	context?: SafeInputContext,
): Promise<{ mimetype: string; contentTypes: string }> {
	const wanted = new Set(["mimetype", "[Content_Types].xml"]);
	const readable = inspection.entries.filter(
		(entry) => wanted.has(entry.path) && entry.uncompressedSize <= 1024 * 1024,
	);
	if (readable.length === 0) return { mimetype: "", contentTypes: "" };
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
): FormatDetection {
	return {
		formatId: null,
		label,
		supported: false,
		confidence,
		evidence,
		reason,
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
	if (/^(?:\{|\[)/.test(text)) return "json";
	if (/^\{\\rtf(?:\d|\s)/i.test(text)) return "rtf";
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
