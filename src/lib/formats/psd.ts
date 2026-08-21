import type { Layer, Psd } from "ag-psd";
import type {
	PackageXmlSegmentMeta,
	TypeRef,
	UserData,
} from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import { assertProjectExportQuality } from "./qualityAssurance";
import {
	readSafeFileBytes,
	SafeInputError,
	throwIfAborted,
	type SafeInputContext,
} from "./safeInput";
import { createPackageSkeleton, skeletonHasIdentityTargets } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";

export const PSD_MIME_TYPES = [
	"image/vnd.adobe.photoshop",
	"image/x-photoshop",
	"application/octet-stream",
] as const;

interface PsdTextLayer {
	path: number[];
	name: string;
	text: string;
	hidden: boolean;
	left: number;
	top: number;
	right: number;
	bottom: number;
	fontSize: number;
	color: string;
}

interface PsdSource {
	bytes: Uint8Array;
	psd: Psd;
	layers: PsdTextLayer[];
}

function invalidPsd(message: string): SafeInputError {
	return new SafeInputError("PSD_INVALID", message);
}

function uint16(bytes: Uint8Array, offset: number): number {
	return new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getUint16(offset, false);
}

function uint32(bytes: Uint8Array, offset: number): number {
	return new DataView(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength,
	).getUint32(offset, false);
}

function validatePsdHeader(bytes: Uint8Array): void {
	if (bytes.length < 26) throw invalidPsd("The Photoshop header is truncated.");
	if (String.fromCharCode(...bytes.slice(0, 4)) !== "8BPS")
		throw invalidPsd("Photoshop documents must begin with the 8BPS signature.");
	if (uint16(bytes, 4) !== 1)
		throw invalidPsd(
			"Only PSD version 1 is supported; PSB is not accepted as PSD.",
		);
	if (bytes.slice(6, 12).some((value) => value !== 0))
		throw invalidPsd("The reserved Photoshop header bytes must be zero.");
	const channels = uint16(bytes, 12);
	const height = uint32(bytes, 14);
	const width = uint32(bytes, 18);
	const depth = uint16(bytes, 22);
	const colorMode = uint16(bytes, 24);
	if (channels < 1 || channels > 56)
		throw invalidPsd(`Photoshop channel count ${channels} is outside 1–56.`);
	if (!width || !height || width > 30_000 || height > 30_000)
		throw invalidPsd(`Photoshop dimensions ${width}×${height} are invalid.`);
	if (width * height > 250_000_000)
		throw invalidPsd("The Photoshop canvas exceeds the safe pixel limit.");
	if (![1, 8, 16, 32].includes(depth))
		throw invalidPsd(`Unsupported Photoshop bit depth ${depth}.`);
	if (colorMode > 9)
		throw invalidPsd(`Unsupported Photoshop color mode ${colorMode}.`);
}

function numberOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function layerColor(layer: Layer): string {
	const color = layer.text?.style?.fillColor;
	if (!color || !("r" in color) || !("g" in color) || !("b" in color))
		return "#173f50";
	const component = (value: number) =>
		Math.max(0, Math.min(255, Math.round(value)))
			.toString(16)
			.padStart(2, "0");
	return `#${component(color.r)}${component(color.g)}${component(color.b)}`;
}

function collectTextLayers(
	layers: readonly Layer[] | undefined,
	path: number[] = [],
	ancestorHidden = false,
): PsdTextLayer[] {
	const output: PsdTextLayer[] = [];
	for (const [index, layer] of (layers ?? []).entries()) {
		const layerPath = [...path, index];
		const hidden = ancestorHidden || layer.hidden === true;
		if (typeof layer.text?.text === "string" && layer.text.text.trim()) {
			const transform = layer.text.transform ?? [];
			const left = numberOr(layer.left, numberOr(transform[4], 0));
			const top = numberOr(layer.top, numberOr(transform[5], 0));
			const fontSize = Math.max(1, numberOr(layer.text.style?.fontSize, 16));
			output.push({
				path: layerPath,
				name: layer.name?.trim() || `Text layer ${output.length + 1}`,
				text: layer.text.text.replaceAll("\r", "\n"),
				hidden,
				left,
				top,
				right: numberOr(layer.right, left + 1),
				bottom: numberOr(layer.bottom, top + fontSize),
				fontSize,
				color: layerColor(layer),
			});
		}
		output.push(...collectTextLayers(layer.children, layerPath, hidden));
	}
	return output;
}

async function readPsdSource(
	file: File,
	context?: SafeInputContext,
): Promise<PsdSource> {
	const bytes = await readSafeFileBytes(file, context);
	validatePsdHeader(bytes);
	throwIfAborted(context?.signal);
	try {
		const { readPsd } = await import("ag-psd");
		const psd = readPsd(bytes, {
			skipLayerImageData: true,
			skipCompositeImageData: true,
			skipThumbnail: true,
			skipLinkedFilesData: true,
			totalMemoryLimit: 32 * 1024 * 1024,
			throwForMissingFeatures: true,
			strict: true,
		});
		throwIfAborted(context?.signal);
		return { bytes, psd, layers: collectTextLayers(psd.children) };
	} catch (error) {
		if (error instanceof SafeInputError) throw error;
		throw invalidPsd(
			`The Photoshop layer structure could not be parsed safely: ${error instanceof Error ? error.message : "unknown parser error"}`,
		);
	}
}

export async function validatePsdFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		await readPsdSource(file, context);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: {
					valid: false,
					reason: "The file is not a safe, valid Photoshop PSD.",
				};
	}
}

export async function importPsdFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("psd", options);
	const source = await readPsdSource(file, context);
	const layers = source.layers.filter(
		(layer) => filterOptions.includeHiddenText || !layer.hidden,
	);
	if (!layers.length)
		throw new SafeInputError(
			"EMPTY_CONTENT",
			"The PSD contains no eligible editable text layers. Raster pixels are not sent through OCR by this adapter.",
		);
	const segments = layers.map((layer) => layer.text);
	const meta: PackageXmlSegmentMeta[] = layers.map((layer) => ({
		profile: "psd-text-layer",
		part: file.name,
		path: ["layers", ...layer.path.map(String), layer.name],
		location: "text",
		start: 0,
		end: layer.text.length,
		originalValue: layer.text,
	}));
	const document = createNeutralDocument({
		format: "psd",
		sourceSegments: segments,
		unitIds: layers.map((layer) => `psd-layer-${layer.path.join("-")}`),
		sourceLocations: layers.map((layer, segmentIndex) => ({
			part: file.name,
			path: ["layers", ...layer.path, layer.name],
			segmentIndex,
			metadata: {
				left: layer.left,
				top: layer.top,
				right: layer.right,
				bottom: layer.bottom,
			},
		})),
	});
	for (const [index, layer] of layers.entries()) {
		document.units[index].contexts.push({
			type: "photoshop-layer",
			value: layer.name,
		});
		if (layer.hidden)
			document.units[index].notes.push({
				category: "visibility",
				text: "This source text layer is hidden in the PSD.",
			});
	}
	document.metadata = {
		profile: "Photoshop PSD text-layer source",
		width: source.psd.width,
		height: source.psd.height,
		textLayers: layers.length,
		security:
			"Only validated text descriptors are read. Pixels, effects, linked files, smart objects, annotations, scripts, and unknown resources remain inert in the retained original PSD.",
	};
	return {
		kind: "segments",
		segments,
		document,
		skeleton: await createPackageSkeleton(file, "psd", {}, []),
		filterOptions,
		typeRef: {
			profile: "psd-text-layers",
			outputPolicy: "identity-or-svg-conversion",
			width: source.psd.width,
			height: source.psd.height,
			layers,
		} as unknown as TypeRef,
		segmentsMeta: meta,
	};
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function psdTypeRef(project: UserData): {
	width: number;
	height: number;
	layers: PsdTextLayer[];
} {
	const value = project.translationData.typeRef;
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("PSD export metadata is missing.");
	const record = value as Record<string, unknown>;
	const validLayer = (entry: unknown): entry is PsdTextLayer => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry))
			return false;
		const layer = entry as Record<string, unknown>;
		return (
			Array.isArray(layer.path) &&
			layer.path.every(
				(part) => Number.isInteger(part) && (part as number) >= 0,
			) &&
			typeof layer.name === "string" &&
			typeof layer.text === "string" &&
			typeof layer.hidden === "boolean" &&
			["left", "top", "right", "bottom", "fontSize"].every(
				(key) => typeof layer[key] === "number" && Number.isFinite(layer[key]),
			) &&
			typeof layer.color === "string" &&
			/^#[0-9a-f]{6}$/i.test(layer.color)
		);
	};
	if (
		record.profile !== "psd-text-layers" ||
		typeof record.width !== "number" ||
		typeof record.height !== "number" ||
		!Array.isArray(record.layers) ||
		!record.layers.every(validLayer)
	)
		throw new Error("PSD text-layer export metadata is invalid.");
	return {
		width: record.width,
		height: record.height,
		layers: record.layers as PsdTextLayer[],
	};
}

export function buildPsdSvgConversion(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const metadata = psdTypeRef(project);
	if (metadata.layers.length !== data.seg2.length)
		throw new Error(
			"PSD text-layer metadata no longer aligns with the project segments.",
		);
	const elements = metadata.layers.map((layer, index) => {
		const x = Math.max(0, numberOr(layer.left, 0));
		const y = Math.max(layer.fontSize, numberOr(layer.top, 0) + layer.fontSize);
		const lines = (data.seg2[index] ?? "").split("\n");
		const rtl = /[\u0590-\u08ff]/.test(data.seg2[index] ?? "");
		const tspans = lines
			.map(
				(line, lineIndex) =>
					`<tspan x="${x}" dy="${lineIndex ? layer.fontSize * 1.2 : 0}">${escapeXml(line)}</tspan>`,
			)
			.join("");
		return `<g data-psd-layer="${escapeXml(layer.name)}" data-psd-path="${layer.path.join("/")}"><text x="${x}" y="${y}" font-size="${layer.fontSize}" fill="${escapeXml(layer.color)}" direction="${rtl ? "rtl" : "ltr"}" xml:space="preserve">${tspans}</text></g>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${metadata.width}" height="${metadata.height}" viewBox="0 0 ${metadata.width} ${metadata.height}"><metadata>Open TLC translated text-layer conversion from ${escapeXml(data.skeleton?.source.name ?? "PSD")}; the retained project still contains the unchanged original PSD.</metadata>${elements.join("")}</svg>`;
}

export function buildPsdTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	return new Blob([buildPsdSvgConversion(project)], {
		type: "image/svg+xml;charset=utf-8",
	});
}

export async function generatePsdTranslation(project: UserData): Promise<void> {
	const data = project.translationData;
	const identity = skeletonHasIdentityTargets(data.seg1, data.seg2);
	const requested = data.name || data.skeleton?.source.name || "design.psd";
	const base = requested.replace(/\.psd$/i, "");
	const name =
		identity && data.skeleton?.source.originalFile
			? `${base}.psd`
			: `${base}.translated.svg`;
	const url = URL.createObjectURL(buildPsdTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
