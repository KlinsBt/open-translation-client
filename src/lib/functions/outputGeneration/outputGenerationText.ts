import type { UserData } from "$lib/types/types";
import {
	applyTextSkeleton,
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type TextRangeReplacement,
} from "$lib/formats/skeleton";
import { normalizeImportOptions } from "$lib/formats/options";
import type { SupportedTextEncoding } from "$lib/formats/safeInput";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";

type UnicodeNormalizationOption = "preserve" | "nfc" | "nfd" | "nfkc" | "nfkd";

export interface TextOutputPolicy {
	encoding: SupportedTextEncoding;
	hasBom: boolean;
	normalization: UnicodeNormalizationOption;
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			if (index + 1 >= value.length) return true;
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

export function encodeTextBytes(
	value: string,
	encoding: SupportedTextEncoding,
	hasBom: boolean,
): Uint8Array {
	if (hasUnpairedSurrogate(value)) {
		throw new Error(
			"TXT output contains an unpaired Unicode surrogate and cannot be encoded safely.",
		);
	}
	const text = value.startsWith("\ufeff") ? value.slice(1) : value;
	let encoded: Uint8Array;
	if (encoding === "utf-8") {
		encoded = new TextEncoder().encode(text);
	} else if (encoding === "iso-8859-1" || encoding === "windows-1252") {
		encoded = encodeSingleByte(text, encoding);
	} else {
		encoded = new Uint8Array(text.length * 2);
		const view = new DataView(encoded.buffer);
		const littleEndian = encoding === "utf-16le";
		for (let index = 0; index < text.length; index++) {
			view.setUint16(index * 2, text.charCodeAt(index), littleEndian);
		}
	}
	if (!hasBom) return encoded;
	if (encoding === "iso-8859-1" || encoding === "windows-1252")
		throw new Error(`${encoding.toUpperCase()} output cannot contain a BOM.`);
	const bom =
		encoding === "utf-8"
			? new Uint8Array([0xef, 0xbb, 0xbf])
			: encoding === "utf-16le"
				? new Uint8Array([0xff, 0xfe])
				: new Uint8Array([0xfe, 0xff]);
	const output = new Uint8Array(bom.length + encoded.length);
	output.set(bom);
	output.set(encoded, bom.length);
	return output;
}

const WINDOWS_1252_BYTES = new Map<number, number>([
	[0x20ac, 0x80],
	[0x201a, 0x82],
	[0x0192, 0x83],
	[0x201e, 0x84],
	[0x2026, 0x85],
	[0x2020, 0x86],
	[0x2021, 0x87],
	[0x02c6, 0x88],
	[0x2030, 0x89],
	[0x0160, 0x8a],
	[0x2039, 0x8b],
	[0x0152, 0x8c],
	[0x017d, 0x8e],
	[0x2018, 0x91],
	[0x2019, 0x92],
	[0x201c, 0x93],
	[0x201d, 0x94],
	[0x2022, 0x95],
	[0x2013, 0x96],
	[0x2014, 0x97],
	[0x02dc, 0x98],
	[0x2122, 0x99],
	[0x0161, 0x9a],
	[0x203a, 0x9b],
	[0x0153, 0x9c],
	[0x017e, 0x9e],
	[0x0178, 0x9f],
]);

function encodeSingleByte(
	value: string,
	encoding: "iso-8859-1" | "windows-1252",
): Uint8Array {
	const bytes: number[] = [];
	for (const character of value) {
		const codePoint = character.codePointAt(0)!;
		const byte =
			codePoint <= 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff)
				? codePoint
				: encoding === "iso-8859-1" && codePoint <= 0xff
					? codePoint
					: WINDOWS_1252_BYTES.get(codePoint);
		if (byte === undefined)
			throw new Error(
				`The character “${character}” cannot be represented in ${encoding.toUpperCase()} output.`,
			);
		bytes.push(byte);
	}
	return Uint8Array.from(bytes);
}

export function getTextOutputPolicy(translation: UserData): TextOutputPolicy {
	const data = translation.translationData;
	const options = normalizeImportOptions("text", data.filterOptions);
	const sourceEncoding = data.skeleton?.source.encoding ?? "utf-8";
	const requestedEncoding = String(options.outputEncoding);
	const encoding: SupportedTextEncoding =
		requestedEncoding === "source"
			? sourceEncoding
			: (requestedEncoding as SupportedTextEncoding);
	const bomOption = String(options.byteOrderMark);
	const hasBom =
		bomOption === "always"
			? true
			: bomOption === "never"
				? false
				: (data.skeleton?.source.hasBom ?? false);
	return {
		encoding,
		hasBom,
		normalization: options.unicodeNormalization as UnicodeNormalizationOption,
	};
}

function normalizeTargets(
	targets: readonly string[],
	policy: UnicodeNormalizationOption,
): string[] {
	if (policy === "preserve") return [...targets];
	return targets.map((target) => target.normalize(policy.toUpperCase()));
}

function legacySeparator(translation: UserData): string {
	const options = normalizeImportOptions(
		"text",
		translation.translationData.filterOptions,
	);
	switch (options.segmentationMode) {
		case "document":
			return "";
		case "lines":
			return "\n";
		case "paragraphs":
			return "\n\n";
		default:
			return " ";
	}
}

export function buildTextTranslationFromProject(translation: UserData): string {
	const data = translation.translationData;
	const policy = getTextOutputPolicy(translation);
	const targets = normalizeTargets(data.seg2, policy.normalization);
	const content = getTextSkeletonContent(data.skeleton, "text");
	if (content !== undefined) {
		if (
			policy.normalization === "preserve" &&
			skeletonHasIdentityTargets(data.seg1, targets)
		)
			return content;
		const replacements = data.skeleton!.replacements.filter(
			(replacement): replacement is TextRangeReplacement =>
				replacement.kind === "text-range",
		);
		if (replacements.length === targets.length) {
			return applyTextSkeleton(content, replacements, targets);
		}
	}
	return targets.join(legacySeparator(translation));
}

export function buildTextTranslationBlob(translation: UserData): Blob {
	const data = translation.translationData;
	const policy = getTextOutputPolicy(translation);
	const options = normalizeImportOptions("text", data.filterOptions);
	if (
		options.outputEncoding === "source" &&
		options.byteOrderMark === "preserve" &&
		policy.normalization === "preserve" &&
		skeletonHasIdentityTargets(data.seg1, data.seg2) &&
		data.skeleton?.source.originalFile
	) {
		return data.skeleton.source.originalFile;
	}
	const bytes = encodeTextBytes(
		buildTextTranslationFromProject(translation),
		policy.encoding,
		policy.hasBom,
	);
	return new Blob([bytes], {
		type: `text/plain;charset=${policy.encoding}`,
	});
}

async function generateTextFileDownload(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${name.replace(/\.txt$/i, "")}.txt`;
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
	URL.revokeObjectURL(url);
}

export async function generateTextTranslation(translation: UserData) {
	assertProjectExportQuality(translation);
	const data = translation.translationData;
	await generateTextFileDownload(
		buildTextTranslationBlob(translation),
		data.name || data.skeleton?.source.name || "translation",
	);
}

export function buildTextTranslation(segments: string[]): string {
	return segments.join(" ");
}
