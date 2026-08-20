import JSZip from "jszip";
import type { FormatId } from "./formatIds";
import {
	assertSafeFileSize,
	decodeTextBytes,
	inspectSafeZipFile,
	safeParseXml,
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
	detectSpecialistXmlProfile,
	specialistXmlProfileLabel,
} from "./specialistXml";
import { detectAuxiliaryResourceProfile } from "./auxiliaryResources";
import { detectSubtitleFileProfile } from "./subtitles";
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
	exportPolicy?: "same-profile";
}

const XLIFF_PROJECT_EXTENSIONS = new Set([
	"xlf",
	"xlif",
	"xliff",
	"sdlxliff",
	"mqxlf",
	"mqxliff",
	"mxliff",
	"xliffdoc",
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
		const outlook = adapters.find(
			(candidate) => candidate.id === "outlook-msg",
		);
		if (outlook) {
			const validation = await outlook.validate(file, context);
			if (validation.valid) {
				const detection = supportedContent(outlook, extension, mimeType);
				detection.reason =
					"The OLE compound structure contains a top-level Outlook MAPI property stream and message class. Attachments and unknown properties remain opaque, and active or external content is never rendered or fetched.";
				detection.workflow = {
					kind: "source-only",
					primaryAction: "Import protected Outlook text and deliver safe EML",
					steps: [
						"Read sender, recipients, subject, the selected body representation, metadata context, and optional attachment display names locally.",
						"Translate text without opening attachments, executing MAPI objects, rendering HTML, or fetching external resources.",
						"Export an interoperable EML delivery; an unchanged project retains the exact original MSG bytes.",
					],
					fidelityWarning:
						"Edited delivery is EML rather than a rewritten proprietary MSG. Original attachments and opaque MAPI properties remain in the retained source MSG and are explicitly omitted from EML.",
				};
				return detection;
			}
			if (extension === "msg")
				return unsupported(
					"Invalid Outlook MSG item",
					"high",
					["signature", "extension"],
					validation.reason ??
						"The compound file does not contain a valid top-level Outlook message structure.",
				);
		}
		const visio = adapters.find((candidate) => candidate.id === "visio");
		if (
			visio &&
			extension !== undefined &&
			visio.extensions.includes(extension) &&
			(await visio.validate(file, context)).valid
		) {
			const detection = supportedContent(visio, extension, mimeType);
			detection.reason =
				"The OLE compound structure contains Visio document or web-drawing streams. Active content and embedded objects remain inert; edited legacy output is delivered as Visio XML (VDX).";
			detection.workflow = {
				kind: "source-only",
				primaryAction: "Import protected Visio text and deliver VDX",
				steps: [
					"Extract defensibly identified local text without executing VBA, formulas, links, or embedded objects.",
					"Translate the protected units in Open TLC.",
					"Export an interoperable VDX delivery; unchanged projects retain the exact original compound file.",
				],
				fidelityWarning:
					"The proprietary legacy binary layout cannot be rewritten safely in-browser. Use VDX/VSDX input when exact edited layout retention is required.",
			};
			return detection;
		}
		const bilingual = adapters.find(
			(candidate) => candidate.id === "legacy-bilingual",
		);
		if (
			bilingual &&
			extension !== undefined &&
			bilingual.extensions.includes(extension) &&
			(await bilingual.validate(file, context)).valid
		) {
			const detection = supportedContent(bilingual, extension, mimeType);
			detection.reason =
				"The OLE Word streams contain Trados Workbench bilingual delimiters. The file is read locally; edited output is delivered as a safe bilingual RTF.";
			detection.workflow = {
				kind: "source-only",
				primaryAction: "Import Workbench DOC and deliver bilingual RTF",
				steps: [
					"Extract the bilingual units locally without running macros or embedded objects.",
					"Translate protected target units in Open TLC.",
					"Export an interoperable bilingual RTF containing the original sources and translated targets.",
				],
				fidelityWarning:
					"Unchanged files retain their exact OLE bytes. Edited output uses bilingual RTF because arbitrary Word binary stream rewriting is not safely specified.",
			};
			return detection;
		}
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
		if (adapter) {
			const validation = await adapter.validate(file, context);
			throwIfAborted(context?.signal);
			if (validation.valid)
				return supportedContent(adapter, extension, mimeType);
			return unsupported(
				"Invalid PDF document",
				"high",
				[
					"signature",
					...metadataEvidence(
						extension,
						mimeType,
						adapter.extensions,
						adapter.mimeTypes,
					),
				],
				validation.reason ??
					"The PDF header is present, but the document structure is unreadable or unsafe.",
			);
		}
	}

	const psdCandidate = adapters.find((candidate) => candidate.id === "psd");
	if (
		psdCandidate &&
		prefix[0] === 0x38 &&
		prefix[1] === 0x42 &&
		prefix[2] === 0x50 &&
		prefix[3] === 0x53
	) {
		const validation = await psdCandidate.validate(file, context);
		return validation.valid
			? supportedContent(psdCandidate, extension, mimeType)
			: unsupported(
					"Invalid Photoshop PSD",
					"high",
					["signature"],
					validation.reason ?? "The PSD structure is invalid.",
				);
	}
	if (
		psdCandidate &&
		(extension === "psd" ||
			(mimeType !== "application/octet-stream" &&
				psdCandidate.mimeTypes.includes(mimeType)))
	)
		return unsupported(
			"Unrecognized Photoshop document",
			"low",
			metadataEvidence(
				extension,
				mimeType,
				psdCandidate.extensions,
				psdCandidate.mimeTypes,
			),
			"The extension or MIME type claims Photoshop PSD, but the 8BPS signature and internal structure do not match.",
		);

	const externalCandidate = detectExternalMediaCandidate(prefix);
	if (externalCandidate) {
		const localAdapter = adapters.find((adapter) =>
			externalCandidate.modality === "ocr"
				? adapter.id === "image-ocr"
				: adapter.id === "media-transcription",
		);
		if (localAdapter) {
			const validation = await localAdapter.validate(file, context);
			return validation.valid
				? supportedContent(localAdapter, extension, mimeType)
				: unsupported(
						`Invalid ${externalCandidate.label}`,
						"high",
						["signature"],
						validation.reason ?? "The media structure is invalid.",
					);
		}
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
	const subtitleCandidate = adapters.find(
		(candidate) => candidate.id === "subtitles",
	);
	const subtitlePrefix = decodeTextPrefix(prefix) ?? "";
	const subtitleClaim =
		extension !== undefined &&
		["srt", "vtt", "sbv", "ass", "ssa", "stl"].includes(extension);
	const subtitleSignature =
		/^\ufeff?WEBVTT(?:[ \t].*)?(?:\r?\n|$)/.test(subtitlePrefix) ||
		(/\[Script Info\]/i.test(subtitlePrefix) &&
			/ScriptType\s*:\s*v4\.00(?:\+\+?)?/i.test(subtitlePrefix)) ||
		/(?:^|\r?\n)(?:\$[^\r\n]*\r?\n|\/\/[^\r\n]*\r?\n|\s*\r?\n)*\d{2}:\d{2}:\d{2}:\d{2}\s*,\s*\d{2}:\d{2}:\d{2}:\d{2}\s*,/.test(
			subtitlePrefix,
		) ||
		/(?:^|\r?\n)(?:[^\r\n]+\r?\n)?\d{2,}:[0-5]\d:[0-5]\d,\d{3}\s+-->/.test(
			subtitlePrefix,
		) ||
		/(?:^|\r?\n)\d+:[0-5]\d:[0-5]\d\.\d{3},\d+:[0-5]\d:[0-5]\d\.\d{3}/.test(
			subtitlePrefix,
		);
	if (subtitleCandidate && (subtitleClaim || subtitleSignature)) {
		try {
			const profile = await detectSubtitleFileProfile(file, context);
			const validation = await subtitleCandidate.validate(file, context);
			if (!validation.valid) throw new Error(validation.reason);
			const detection = supportedContent(
				subtitleCandidate,
				extension,
				mimeType,
			);
			detection.label =
				profile === "stl"
					? "Spruce STL subtitles"
					: `${profile.toUpperCase()} subtitles`;
			detection.reason =
				"Subtitle timing syntax and format headers match the detected profile; timing, positioning, styles, comments, and protected markup remain inert and are preserved.";
			return detection;
		} catch (error) {
			return unsupported(
				subtitleClaim && extension === "stl"
					? "Invalid Spruce STL subtitle"
					: "Invalid subtitle document",
				subtitleClaim ? "low" : "medium",
				subtitleClaim ? ["extension"] : ["content"],
				error instanceof Error
					? error.message
					: "The subtitle content signature or timing structure is invalid.",
			);
		}
	}
	const quarkCandidate = adapters.find((candidate) => candidate.id === "quark");
	if (
		quarkCandidate &&
		(/^\ufeff?<v\d+(?:\.\d+)?><e\d+>/.test(decodeTextPrefix(prefix) ?? "") ||
			(extension !== undefined &&
				quarkCandidate.extensions.includes(extension)))
	) {
		const validation = await quarkCandidate.validate(file, context);
		return validation.valid
			? supportedContent(quarkCandidate, extension, mimeType)
			: unsupported(
					"Invalid QuarkXPress Tags document",
					"low",
					["extension"],
					validation.reason ??
						"The native XPress Tags version/encoding header is missing or malformed.",
				);
	}
	const auxiliaryCandidate = adapters.find(
		(candidate) => candidate.id === "auxiliary-resources",
	);
	const auxiliaryText =
		decodeTextPrefix(prefix)
			?.replace(/^\ufeff/, "")
			.trimStart() ?? "";
	const auxiliaryClaim =
		extension !== undefined && ["inf", "reg", "mm"].includes(extension);
	const auxiliarySignature =
		/^(?:Windows Registry Editor Version 5\.00|REGEDIT4)(?:\r?\n|$)/.test(
			auxiliaryText,
		) ||
		(/^\[Version\]/im.test(auxiliaryText) &&
			/^\s*Signature\s*=\s*["']?\$(?:Windows NT|Chicago)\$/im.test(
				auxiliaryText,
			)) ||
		/^\s*(?:<\?xml[^?]*\?>\s*)?<map\b/i.test(auxiliaryText);
	if (auxiliaryCandidate && (auxiliaryClaim || auxiliarySignature)) {
		const profile = await detectAuxiliaryResourceProfile(file, context);
		if (profile) {
			const detection = supportedContent(
				auxiliaryCandidate,
				extension,
				mimeType,
			);
			detection.label =
				profile === "inf"
					? "Windows INF string resources"
					: profile === "reg"
						? "Windows Registry string resources"
						: "FreeMind mind map";
			detection.reason =
				profile === "reg"
					? "The Registry Editor header and typed value syntax match; Open TLC edits string data without applying the file to the operating system registry."
					: profile === "inf"
						? "The INF Version signature and localized Strings sections match; setup directives remain protected and are never interpreted."
						: "The XML root, versioned map structure, and node content match FreeMind; IDs, links, hooks, and active markup remain inert.";
			return detection;
		}
		return unsupported(
			"Invalid auxiliary resource",
			auxiliaryClaim ? "low" : "medium",
			auxiliaryClaim ? ["extension"] : ["content"],
			"The file does not match a safe Windows INF, Registry, or FreeMind structure.",
		);
	}
	const specialistCandidate = adapters.find(
		(candidate) => candidate.id === "specialist-xml",
	);
	if (specialistCandidate) {
		const profile = await detectSpecialistXmlProfile(file, context);
		if (profile) {
			const detection = supportedContent(
				specialistCandidate,
				extension,
				mimeType,
			);
			detection.label = specialistXmlProfileLabel(profile);
			detection.reason =
				"The root, namespace, vocabulary structure, and protected-content policy match this specialist profile; external entities, schemas, scripts, and formulas are never evaluated.";
			return detection;
		}
		if (
			extension !== undefined &&
			["its", "mulix", "sgm", "sgml"].includes(extension)
		)
			return unsupported(
				"Invalid specialist XML/SGML document",
				"low",
				["extension"],
				"The filename claims a specialist vocabulary, but its content signature and required structure do not match.",
			);
	}
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
		const bilingual = adapters.find(
			(candidate) => candidate.id === "legacy-bilingual",
		);
		if (bilingual && (await bilingual.sniff(file, context)))
			return supportedContent(bilingual, extension, mimeType);
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

	const serverHtmlCandidates = adapters.filter(
		(adapter) =>
			(adapter.id === "html" || adapter.id === "php") &&
			((extension !== undefined && adapter.extensions.includes(extension)) ||
				(mimeType !== "" && adapter.mimeTypes.includes(mimeType))),
	);
	for (const candidate of serverHtmlCandidates)
		if (await candidate.sniff(file, context))
			return supportedContent(candidate, extension, mimeType);
	if (
		serverHtmlCandidates.length > 0 &&
		serverHtmlCandidates.some((candidate) => candidate.id === "html")
	)
		return unsupported(
			"Unrecognized server-side HTML document",
			"low",
			metadataEvidence(
				extension,
				mimeType,
				serverHtmlCandidates.flatMap((candidate) => candidate.extensions),
				serverHtmlCandidates.flatMap((candidate) => candidate.mimeTypes),
			),
			"The filename claims an HTML, server-page, or HTML Help format, but the content has no matching markup signature.",
		);

	const extensionMatch = extension
		? adapters.find((adapter) => adapter.extensions.includes(extension))
		: undefined;
	const mimeMatch = mimeType
		? adapters.find((adapter) => adapter.mimeTypes.includes(mimeType))
		: undefined;
	const metadataCandidates = [...new Set([extensionMatch, mimeMatch])].filter(
		(candidate): candidate is FormatAdapter => candidate !== undefined,
	);
	for (const candidate of metadataCandidates) {
		throwIfAborted(context?.signal);
		if (
			(await candidate.sniff(file, context)) ||
			(await candidate.validate(file, context)).valid
		)
			return supportedContent(candidate, extension, mimeType);
	}
	if (metadataCandidates.length > 0) {
		const claimed = metadataCandidates[0];
		const unrecognizedLabel =
			claimed.id === "image-ocr"
				? "Unrecognized image"
				: claimed.id === "media-transcription"
					? "Unrecognized media"
					: claimed.id === "legacy-office"
						? "Unrecognized legacy Office file"
						: claimed.id === "legacy-bilingual"
							? "Unrecognized legacy bilingual file"
							: `Unrecognized ${claimed.label} file`;
		return unsupported(
			unrecognizedLabel,
			"low",
			metadataEvidence(
				extension,
				mimeType,
				claimed.extensions,
				claimed.mimeTypes,
			),
			"The extension or MIME type claims a supported format, but its content signature or structural validation does not match.",
		);
	}

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
				? `${profile.label} markers were detected; the file can be edited and exported through its dedicated same-profile workflow.`
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
		const bilingual = adapters.find(
			(candidate) => candidate.id === "legacy-bilingual",
		);
		if (bilingual) {
			const candidate = new File([inspection.bytes], fileName, {
				type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			});
			const validation = await bilingual.validate(candidate, context);
			throwIfAborted(context?.signal);
			if (validation.valid)
				return supportedPackage(
					adapters,
					"legacy-bilingual",
					"a Workbench bilingual DOCX signature",
				);
		}
		return validateDetectedOpcPackage(
			inspection,
			packageDetails,
			adapters,
			"docx",
			"word/document.xml and a valid WordprocessingML package structure",
			"word/document.xml",
			/(?:wordprocessingml|ms-word)/i,
			fileName,
			context,
		);
	}
	if (paths.has("xl/workbook.xml")) {
		return validateDetectedOpcPackage(
			inspection,
			packageDetails,
			adapters,
			"xlsx",
			"xl/workbook.xml and a valid SpreadsheetML package structure",
			"xl/workbook.xml",
			/(?:spreadsheetml|ms-excel)/i,
			fileName,
			context,
		);
	}
	if (paths.has("xl/workbook.bin")) {
		return validateDetectedOpcPackage(
			inspection,
			packageDetails,
			adapters,
			"legacy-office",
			"xl/workbook.bin and a valid binary workbook package structure",
			"xl/workbook.bin",
			/(?:ms-excel|spreadsheetml)/i,
			fileName,
			context,
		);
	}
	if (paths.has("ppt/presentation.xml")) {
		return validateDetectedOpcPackage(
			inspection,
			packageDetails,
			adapters,
			"pptx",
			"ppt/presentation.xml and a valid PresentationML package structure",
			"ppt/presentation.xml",
			/(?:presentationml|ms-powerpoint)/i,
			fileName,
			context,
		);
	}
	if (paths.has("visio/document.xml")) {
		const adapter = adapters.find((candidate) => candidate.id === "visio");
		if (!adapter)
			throw new Error("No adapter is registered for detected Visio packages.");
		const candidate = new File([inspection.bytes], fileName, {
			type: "application/vnd.visio",
		});
		const validation = await adapter.validate(candidate, context);
		if (!validation.valid)
			return unsupported(
				"Invalid Microsoft Visio package",
				"high",
				["package", "signature"],
				validation.reason ??
					"The ZIP contains visio/document.xml but its OPC relationships or content types are invalid.",
			);
		return supportedPackage(
			adapters,
			"visio",
			"visio/document.xml and matching OPC content types",
		);
	}
	const standaloneSlide = packageDetails.rootRelationships.match(
		/<(?:[\w.-]+:)?Relationship\b(?=[^>]*\bType=["'][^"']*\/officeDocument["'])(?=[^>]*\bTarget=["']\/?(ppt\/slides\/[^"']+\.xml)["'])[^>]*\/?>/i,
	)?.[1];
	if (standaloneSlide && paths.has(standaloneSlide))
		return validateDetectedOpcPackage(
			inspection,
			packageDetails,
			adapters,
			"pptx",
			`${standaloneSlide} and a valid standalone PresentationML relationship`,
			standaloneSlide,
			/(?:presentationml|ms-powerpoint)/i,
			fileName,
			context,
		);

	const odf = odfLabel(packageDetails.mimetype);
	if (odf) {
		const adapter = adapters.find((candidate) => candidate.id === "odf");
		if (!adapter)
			throw new Error("No adapter is registered for detected ODF packages.");
		const validation = await adapter.validate(
			new File([inspection.bytes], fileName, {
				type: packageDetails.mimetype,
			}),
			context,
		);
		if (!validation.valid)
			return unsupported(
				`Invalid ${odf} package`,
				"high",
				["package", "signature"],
				validation.reason ??
					`The package declares ${odf}, but its manifest or document structure is invalid.`,
			);
		return supportedPackage(adapters, "odf", `the ${odf} mimetype declaration`);
	}
	if (
		packageDetails.mimetype === "application/epub+zip" ||
		paths.has("META-INF/container.xml")
	) {
		return validateDetectedPackage(
			inspection,
			adapters,
			"epub",
			"a valid EPUB mimetype, container, package document, manifest, and spine",
			fileName,
			context,
			"application/epub+zip",
		);
	}
	const catProfile = detectCatPackageProfile(fileName, [...paths]);
	if (catProfile) {
		const adapter = adapters.find(
			(candidate) => candidate.id === "cat-package",
		);
		if (!adapter)
			throw new Error("No adapter is registered for detected CAT packages.");
		const candidate = new File([inspection.bytes], fileName, {
			type: "application/zip",
		});
		const validation = await adapter.validate(candidate, context);
		if (!validation.valid)
			return unsupported(
				`Invalid ${catProfile.label}`,
				"high",
				["package", "signature"],
				validation.reason ??
					"The package signature was recognized, but its manifest or bilingual members are invalid.",
			);
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
			return validateDetectedPackage(
				inspection,
				adapters,
				"zip-project",
				`a valid ${ZIP_PROJECT_MANIFEST_PATH} and validated declared members`,
				fileName,
				context,
			);
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
		throwIfAborted(context?.signal);
	}
	return {
		mimetype: values.get("mimetype")?.trim() ?? "",
		contentTypes: values.get("[Content_Types].xml") ?? "",
		rootRelationships: values.get("_rels/.rels") ?? "",
		openTlcManifest: values.get(ZIP_PROJECT_MANIFEST_PATH) ?? "",
	};
}

async function validateDetectedPackage(
	inspection: SafeArchiveInspection,
	adapters: readonly FormatAdapter[],
	id: FormatId,
	marker: string,
	fileName: string,
	context?: SafeInputContext,
	mimeType = "application/zip",
): Promise<FormatDetection> {
	const adapter = adapters.find((candidate) => candidate.id === id);
	if (!adapter) throw new Error(`No adapter is registered for detected ${id}.`);
	const candidate = new File([inspection.bytes], fileName, { type: mimeType });
	const validation = await adapter.validate(candidate, context);
	throwIfAborted(context?.signal);
	if (!validation.valid)
		return unsupported(
			`Invalid ${adapter.label}`,
			"high",
			["package", "signature"],
			validation.reason ??
				`The ZIP marker resembles ${adapter.label}, but the package structure is invalid.`,
		);
	const detection = supportedPackage(adapters, id, marker);
	return id === "zip-project"
		? { ...detection, evidence: ["package", "signature", "content"] }
		: detection;
}

async function validateDetectedOpcPackage(
	inspection: SafeArchiveInspection,
	packageDetails: Awaited<ReturnType<typeof readSmallPackageDetails>>,
	adapters: readonly FormatAdapter[],
	id: FormatId,
	marker: string,
	mainPart: string,
	contentTypePattern: RegExp,
	fileName: string,
	context?: SafeInputContext,
): Promise<FormatDetection> {
	const adapter = adapters.find((candidate) => candidate.id === id);
	if (!adapter) throw new Error(`No adapter is registered for detected ${id}.`);
	const declarationError = validateOpcDeclarations(
		packageDetails,
		mainPart,
		contentTypePattern,
		context,
	);
	throwIfAborted(context?.signal);
	if (declarationError)
		return unsupported(
			`Invalid ${adapter.label}`,
			"high",
			["package", "signature"],
			declarationError,
		);
	return validateDetectedPackage(
		inspection,
		adapters,
		id,
		marker,
		fileName,
		context,
	);
}

function validateOpcDeclarations(
	packageDetails: Awaited<ReturnType<typeof readSmallPackageDetails>>,
	mainPart: string,
	contentTypePattern: RegExp,
	context?: SafeInputContext,
): string | undefined {
	if (!packageDetails.contentTypes)
		return "The package has a main document marker but no [Content_Types].xml declaration.";
	if (!packageDetails.rootRelationships)
		return "The package has a main document marker but no root office-document relationship.";
	try {
		const contentTypes = safeParseXml(packageDetails.contentTypes, context);
		if (contentTypes.documentElement.localName !== "Types")
			return "[Content_Types].xml has no package Types root element.";
		const normalizedPart = `/${mainPart.replace(/^\/+/, "")}`;
		const declared = Array.from(contentTypes.getElementsByTagName("*")).some(
			(element) => {
				if (element.localName === "Override")
					return (
						`/${(element.getAttribute("PartName") ?? "").replace(/^\/+/, "")}` ===
							normalizedPart &&
						contentTypePattern.test(element.getAttribute("ContentType") ?? "")
					);
				if (element.localName !== "Default") return false;
				const extension = mainPart.split(".").at(-1) ?? "";
				return (
					(element.getAttribute("Extension") ?? "").toLowerCase() ===
						extension.toLowerCase() &&
					contentTypePattern.test(element.getAttribute("ContentType") ?? "")
				);
			},
		);
		if (!declared)
			return `The package does not declare a matching content type for ${normalizedPart}.`;

		const relationships = safeParseXml(
			packageDetails.rootRelationships,
			context,
		);
		if (relationships.documentElement.localName !== "Relationships")
			return "_rels/.rels has no package Relationships root element.";
		const linked = Array.from(relationships.getElementsByTagName("*")).some(
			(element) =>
				element.localName === "Relationship" &&
				/\/officeDocument$/i.test(element.getAttribute("Type") ?? "") &&
				(element.getAttribute("TargetMode") ?? "").toLowerCase() !==
					"external" &&
				(element.getAttribute("Target") ?? "")
					.replaceAll("\\", "/")
					.replace(/^\/+/, "") === mainPart,
		);
		if (!linked)
			return `The root relationships do not link to the declared main part ${mainPart}.`;
	} catch (error) {
		return error instanceof Error
			? `The OPC package declarations are invalid: ${error.message}`
			: "The OPC package declarations are invalid.";
	}
	return undefined;
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
	if (mimetype === "application/vnd.oasis.opendocument.text-template")
		return "OTT";
	if (mimetype === "application/vnd.oasis.opendocument.text-master")
		return "ODM";
	if (mimetype === "application/vnd.oasis.opendocument.spreadsheet")
		return "ODS";
	if (mimetype === "application/vnd.oasis.opendocument.spreadsheet-template")
		return "OTS";
	if (mimetype === "application/vnd.oasis.opendocument.presentation")
		return "ODP";
	if (mimetype === "application/vnd.oasis.opendocument.presentation-template")
		return "OTP";
	if (mimetype === "application/vnd.oasis.opendocument.formula") return "ODF";
	return undefined;
}

function isGenericXmlMime(mimeType: string): boolean {
	return (
		mimeType === "application/xml" ||
		mimeType === "text/xml" ||
		mimeType.endsWith("+xml")
	);
}
