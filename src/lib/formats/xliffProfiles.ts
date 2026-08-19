import {
	contentToPlainText,
	type ContentFragment,
	type NeutralDocument,
	type SegmentContent,
	type TranslationState,
	type TranslationUnit,
} from "./documentModel";
import { safeParseXml } from "./safeInput";

export type XliffVendorProfileId =
	| "sdl-trados"
	| "memoq"
	| "phrase-mxliff"
	| "worldserver-wsxliff"
	| "wordpress-wpml"
	| "drupal-tmgmt"
	| "articulate-rise"
	| "articulate-storyline";

export type XliffProfileEvidence =
	| "namespace"
	| "tool"
	| "structure"
	| "extension";

export interface XliffVendorProfile {
	id: XliffVendorProfileId;
	label: string;
	vendor: string;
	xliffVersion: string;
	sourceExtension?: string;
	evidence: XliffProfileEvidence[];
	exportPolicy: "same-profile";
	exportVerification: "automated-round-trip";
	warnings: string[];
}

export interface XliffUnitProfileMetadata {
	profileId: XliffVendorProfileId;
	status?: string;
	locked: boolean;
	embeddedMarkupProtected: boolean;
}

interface ProfileDefinition {
	id: XliffVendorProfileId;
	label: string;
	vendor: string;
	extensions: readonly string[];
	namespacePatterns?: readonly RegExp[];
	toolPatterns?: readonly RegExp[];
	structurePatterns?: readonly RegExp[];
	protectEmbeddedMarkup?: boolean;
}

const PROFILE_DEFINITIONS: readonly ProfileDefinition[] = [
	{
		id: "sdl-trados",
		label: "SDLXLIFF / Trados Studio",
		vendor: "RWS Trados Studio",
		extensions: ["sdlxliff"],
		namespacePatterns: [/http:\/\/sdl\.com\/FileTypes\/SdlXliff\/1\.0/i],
		structurePatterns: [/datatype=["']x-sdlfilterframework2["']/i],
	},
	{
		id: "memoq",
		label: "MQXLIFF / memoQ",
		vendor: "memoQ",
		extensions: ["mqxlf", "mqxliff"],
		namespacePatterns: [/["']MQXliff["']/i],
		structurePatterns: [/\bmq:(?:status|locked|versioninfos)\b/i],
	},
	{
		id: "worldserver-wsxliff",
		label: "WorldServer WsXLIFF",
		vendor: "RWS WorldServer",
		extensions: ["xlf", "xlif", "xliff"],
		namespacePatterns: [
			/https?:\/\/(?:www\.)?(?:idiominc\.com|sdl\.com)\/[^"']*(?:ws|worldserver|asset)/i,
		],
		toolPatterns: [
			/tool-(?:id|name)=["'][^"']*(?:WorldServer|Idiom)[^"']*["']/i,
		],
		structurePatterns: [
			/<(?:[\w.-]+:)?segment-metadata\b[^>]*(?:tm_score|max_segment_length)/i,
			/\b(?:x-idiom-source-ipath|x-idiom-target-ipath)\b/i,
		],
	},
	{
		id: "phrase-mxliff",
		label: "MXLIFF / Phrase",
		vendor: "Phrase TMS (formerly Memsource)",
		extensions: ["mxliff"],
		namespacePatterns: [/http:\/\/www\.memsource\.com\/mxlf\/2\.0/i],
		structurePatterns: [/\bm:(?:version|level|task-id|confirmed|locked)\b/i],
	},
	{
		id: "drupal-tmgmt",
		label: "Drupal TMGMT XLIFF",
		vendor: "Drupal Translation Management Tool",
		extensions: ["xlf", "xlif", "xliff"],
		toolPatterns: [
			/tool-id=["']tmgmt["']/i,
			/tool-name=["'][^"']*Drupal Translation Management/i,
		],
		structurePatterns: [/\bresname=["'][^"']*\]\[[^"']*["']/i],
		protectEmbeddedMarkup: true,
	},
	{
		id: "wordpress-wpml",
		label: "WordPress WPML XLIFF",
		vendor: "OnTheGoSystems WPML",
		extensions: ["xlf", "xlif", "xliff"],
		toolPatterns: [/tool-(?:id|name)=["'][^"']*WPML/i],
		structurePatterns: [
			/<file\b[^>]*\boriginal=["']\d+-[a-f\d]{20,}["'][^>]*\bdatatype=["']plaintext["']/i,
		],
		protectEmbeddedMarkup: true,
	},
	{
		id: "articulate-storyline",
		label: "Articulate Storyline XLIFF",
		vendor: "Articulate Storyline",
		extensions: ["xlf", "xlif", "xliff"],
		toolPatterns: [/tool-(?:id|name)=["'][^"']*Articulate[^"']*Storyline/i],
		structurePatterns: [/datatype=["']x-DocumentState["']/i],
		protectEmbeddedMarkup: true,
	},
	{
		id: "articulate-rise",
		label: "Articulate Rise XLIFF",
		vendor: "Articulate Rise",
		extensions: ["xlf", "xlif", "xliff"],
		toolPatterns: [/tool-(?:id|name)=["'][^"']*Articulate[^"']*Rise/i],
		structurePatterns: [
			/<file\b[^>]*\boriginal=["']course["'][^>]*\bdatatype=["']plaintext["']/i,
		],
		protectEmbeddedMarkup: true,
	},
];

export class VendorXliffRequiresSameProfileExportError extends Error {
	readonly profile: XliffVendorProfile;

	constructor(profile: XliffVendorProfile) {
		super(
			`${profile.label} must be exported with its dedicated same-profile writer so vendor namespaces, workflow data, and skeleton content remain intact. Choose “${profile.label}” in the export dialog.`,
		);
		this.name = "VendorXliffRequiresSameProfileExportError";
		this.profile = profile;
	}
}

export function detectXliffVendorProfile(
	xml: string,
	fileName: string,
	xliffVersion: string,
): XliffVendorProfile | undefined {
	const extension = fileExtension(fileName);
	for (const definition of PROFILE_DEFINITIONS) {
		const evidence: XliffProfileEvidence[] = [];
		if (definition.namespacePatterns?.some((pattern) => pattern.test(xml)))
			evidence.push("namespace");
		if (definition.toolPatterns?.some((pattern) => pattern.test(xml)))
			evidence.push("tool");
		if (definition.structurePatterns?.some((pattern) => pattern.test(xml)))
			evidence.push("structure");
		if (extension && definition.extensions.includes(extension))
			evidence.push("extension");
		const signatureEvidence = evidence.filter(
			(item) => item !== "extension",
		).length;
		if (signatureEvidence === 0) continue;
		return {
			id: definition.id,
			label: definition.label,
			vendor: definition.vendor,
			xliffVersion,
			...(extension && definition.extensions.includes(extension)
				? { sourceExtension: extension }
				: {}),
			evidence,
			exportPolicy: "same-profile",
			exportVerification: "automated-round-trip",
			warnings: [
				"Vendor namespaces, workflow attributes, identifiers, and structural skeleton are retained in the project model.",
				"Export through the dedicated same-profile action; generic XLIFF conversion is intentionally separate.",
			],
		};
	}
	return undefined;
}

export function applyXliffVendorProfile(
	document: NeutralDocument,
	profile: XliffVendorProfile | undefined,
): NeutralDocument {
	if (!profile) return document;
	const definition = PROFILE_DEFINITIONS.find(
		(candidate) => candidate.id === profile.id,
	)!;
	return {
		...document,
		metadata: { ...document.metadata, xliffProfile: profile },
		units: document.units.map((unit) =>
			applyUnitProfile(unit, profile, definition),
		),
	};
}

export function getXliffVendorProfile(
	document: NeutralDocument | undefined,
): XliffVendorProfile | undefined {
	const value = document?.metadata?.xliffProfile as
		| (Partial<XliffVendorProfile> & { id?: string })
		| undefined;
	const definition = PROFILE_DEFINITIONS.find(
		(candidate) => candidate.id === value?.id,
	);
	if (!value || !definition) return undefined;
	return {
		id: definition.id,
		label: value.label ?? definition.label,
		vendor: value.vendor ?? definition.vendor,
		xliffVersion: value.xliffVersion ?? "unknown",
		...(value.sourceExtension
			? { sourceExtension: value.sourceExtension.toLowerCase() }
			: {}),
		evidence: Array.isArray(value.evidence) ? value.evidence : ["structure"],
		exportPolicy: "same-profile",
		exportVerification: "automated-round-trip",
		warnings: [
			"Vendor namespaces, workflow attributes, identifiers, and structural skeleton are retained in the project model.",
			"Export through the dedicated same-profile action; generic XLIFF conversion is intentionally separate.",
		],
	};
}

export function assertVendorXliffExportAllowed(
	document: NeutralDocument | undefined,
): void {
	const profile = getXliffVendorProfile(document);
	if (profile) throw new VendorXliffRequiresSameProfileExportError(profile);
}

function applyUnitProfile(
	unit: TranslationUnit,
	profile: XliffVendorProfile,
	definition: ProfileDefinition,
): TranslationUnit {
	const xliff12 = unit.metadata?.xliff12 as
		| {
				segmentMid?: string;
				attributes?: Record<string, string>;
				extensions?: string[];
		  }
		| undefined;
	const attributes = xliff12?.attributes ?? {};
	const vendorState = vendorUnitState(
		profile.id,
		attributes,
		xliff12?.extensions ?? [],
		xliff12?.segmentMid,
	);
	const embeddedSource = definition.protectEmbeddedMarkup
		? protectEmbeddedMarkup(unit.source)
		: unit.source;
	const embeddedTarget = definition.protectEmbeddedMarkup
		? protectEmbeddedMarkup(unit.target)
		: unit.target;
	const embeddedMarkupProtected =
		embeddedSource !== unit.source || embeddedTarget !== unit.target;
	const locked = vendorState.locked;
	const contexts = [...unit.contexts];
	if (!contexts.some((context) => context.type === "xliff-profile"))
		contexts.push({ type: "xliff-profile", value: profile.label });
	if (profile.id === "drupal-tmgmt" && attributes.resname)
		contexts.push({ type: "drupal-path", value: attributes.resname });
	return {
		...unit,
		source: embeddedSource,
		target: embeddedTarget,
		state: vendorState.state ?? unit.state,
		translatable: locked ? false : unit.translatable,
		contexts,
		metadata: {
			...unit.metadata,
			xliffProfile: {
				profileId: profile.id,
				...(vendorState.status ? { status: vendorState.status } : {}),
				locked,
				embeddedMarkupProtected,
			} satisfies XliffUnitProfileMetadata,
		},
	};
}

function vendorUnitState(
	profile: XliffVendorProfileId,
	attributes: Record<string, string>,
	extensions: string[],
	segmentMid: string | undefined,
): { status?: string; state?: TranslationState; locked: boolean } {
	if (profile === "sdl-trados") {
		const segment = findSdlSegment(extensions, segmentMid);
		const status = segment?.conf;
		return {
			...(status ? { status, state: sdlState(status) } : {}),
			locked: yesValue(segment?.locked),
		};
	}
	if (profile === "memoq") {
		const status = attributes["mq:status"];
		return {
			...(status ? { status, state: memoqState(status) } : {}),
			locked:
				yesValue(attributes["mq:locked"]) ||
				attributes["mq:locked"]?.toLowerCase() === "locked",
		};
	}
	if (profile === "phrase-mxliff") {
		const status = attributes["m:status"] ?? attributes["m:confirmed"];
		return {
			...(status
				? {
						status,
						state: attributes["m:confirmed"] === "1" ? "reviewed" : undefined,
					}
				: {}),
			locked: yesValue(attributes["m:locked"]),
		};
	}
	if (profile === "worldserver-wsxliff") {
		const metadata = findWorldServerMetadata(extensions);
		const status = metadata?.translation_status;
		return {
			...(status ? { status, state: worldServerState(status) } : {}),
			locked: metadata?.lock_status?.toLowerCase() === "locked",
		};
	}
	return { locked: false };
}

function findWorldServerMetadata(
	extensions: string[],
): Record<string, string> | undefined {
	for (const xml of extensions) {
		if (!/(?:WorldServer|idiominc|segment-metadata)/i.test(xml)) continue;
		try {
			const root = safeParseXml(xml).documentElement;
			const status = [root, ...Array.from(root.getElementsByTagName("*"))].find(
				(element) =>
					(element.localName || element.tagName.split(":").at(-1)) === "status",
			);
			if (status)
				return Object.fromEntries(
					Array.from(status.attributes).map((attribute) => [
						attribute.name,
						attribute.value,
					]),
				);
		} catch {
			// Optional vendor metadata never weakens core XLIFF validation.
		}
	}
	return undefined;
}

function worldServerState(status: string): TranslationState {
	switch (status.toLowerCase()) {
		case "finished":
			return "reviewed";
		case "translated":
		case "in_progress":
		case "in-progress":
			return "translated";
		case "rejected":
			return "needs-review";
		default:
			return "initial";
	}
}

function findSdlSegment(
	extensions: string[],
	segmentMid: string | undefined,
): Record<string, string> | undefined {
	for (const xml of extensions) {
		if (!/SdlXliff\/1\.0/i.test(xml) || !/<(?:[\w.-]+:)?seg\b/i.test(xml))
			continue;
		try {
			const root = safeParseXml(xml).documentElement;
			const segments = [
				root,
				...Array.from(root.getElementsByTagName("*")),
			].filter(
				(element) =>
					(element.localName || element.tagName.split(":").at(-1)) === "seg",
			);
			const selected =
				segments.find((element) => element.getAttribute("id") === segmentMid) ??
				segments[0];
			if (selected)
				return Object.fromEntries(
					Array.from(selected.attributes).map((attribute) => [
						attribute.name,
						attribute.value,
					]),
				);
		} catch {
			// The core XLIFF remains importable even if optional vendor state is bad.
		}
	}
	return undefined;
}

function sdlState(status: string): TranslationState {
	switch (status.toLowerCase()) {
		case "approvedsignoff":
			return "final";
		case "approvedtranslation":
			return "reviewed";
		case "translated":
			return "translated";
		case "rejectedtranslation":
		case "rejectedsignoff":
			return "needs-review";
		default:
			return "initial";
	}
}

function memoqState(status: string): TranslationState {
	switch (status.toLowerCase()) {
		case "proofread":
			return "final";
		case "manuallyconfirmed":
		case "confirmed":
			return "reviewed";
		case "machinetranslated":
		case "partiallyedited":
		case "edited":
			return "translated";
		case "rejected":
			return "needs-review";
		default:
			return "initial";
	}
}

function yesValue(value: string | undefined): boolean {
	return value === "1" || /^(?:yes|true)$/i.test(value ?? "");
}

function fileExtension(fileName: string): string | undefined {
	const baseName = fileName.replaceAll("\\", "/").split("/").at(-1) ?? "";
	const dot = baseName.lastIndexOf(".");
	return dot > 0 && dot < baseName.length - 1
		? baseName.slice(dot + 1).toLowerCase()
		: undefined;
}

const VOID_HTML_ELEMENTS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

export function protectEmbeddedMarkup(content: SegmentContent): SegmentContent {
	const text = contentToPlainText(content);
	if (text === undefined || !/<\/?[A-Za-z][^>]*>/.test(text)) return content;
	const fragments: ContentFragment[] = [];
	const stack: Array<{ name: string; pairId: string }> = [];
	const pattern = /<!--[\s\S]*?-->|<![^>]*>|<\/?[A-Za-z][^>]*>/g;
	let offset = 0;
	let sequence = 0;
	for (const match of text.matchAll(pattern)) {
		const index = match.index ?? 0;
		if (index > offset)
			fragments.push({ kind: "text", text: text.slice(offset, index) });
		const markup = match[0];
		const closing = /^<\//.test(markup);
		const name = markup.match(/^<\/?\s*([A-Za-z][\w:-]*)/)?.[1]?.toLowerCase();
		if (!name) return content;
		sequence++;
		if (closing) {
			const opened = stack.pop();
			if (!opened || opened.name !== name) return content;
			fragments.push({
				kind: "code",
				id: `html-${sequence}-end`,
				codeType: "end",
				pairId: opened.pairId,
				originalData: markup,
				displayText: name,
				canCopy: true,
				canDelete: false,
				canReorder: false,
			});
		} else if (
			/\/>$/.test(markup) ||
			VOID_HTML_ELEMENTS.has(name) ||
			/^<!/.test(markup)
		) {
			fragments.push({
				kind: "code",
				id: `html-${sequence}`,
				codeType: "standalone",
				originalData: markup,
				displayText: name,
				canCopy: true,
				canDelete: false,
				canReorder: false,
			});
		} else {
			const pairId = `html-${sequence}-${name}`;
			stack.push({ name, pairId });
			fragments.push({
				kind: "code",
				id: `html-${sequence}-start`,
				codeType: "start",
				pairId,
				originalData: markup,
				displayText: name,
				canCopy: true,
				canDelete: false,
				canReorder: false,
			});
		}
		offset = index + markup.length;
	}
	if (stack.length > 0) return content;
	if (offset < text.length)
		fragments.push({ kind: "text", text: text.slice(offset) });
	return fragments.some((fragment) => fragment.kind === "code")
		? { ...content, fragments }
		: content;
}
