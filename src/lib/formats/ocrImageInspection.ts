import { SafeInputError } from "./safeInput";

export type OcrImageProfile = "png" | "jpeg" | "tiff" | "bmp" | "dib" | "gif";

export interface OcrImageInspection {
	profile: OcrImageProfile;
	width: number;
	height: number;
	frameCount: number;
	animated: boolean;
	orientation: number;
	hasAlpha: boolean;
	hasColorProfile: boolean;
	bitsPerPixel?: number;
	topDown?: boolean;
}

export const OCR_MAX_IMAGE_SIDE = 16_384;
export const OCR_MAX_IMAGE_PIXELS = 40_000_000;
export const OCR_MAX_DECODED_BYTES = OCR_MAX_IMAGE_PIXELS * 4;

function invalid(message: string): never {
	throw new SafeInputError("OCR_INVALID", message);
}

function u16(bytes: Uint8Array, offset: number, little = true): number {
	if (offset < 0 || offset + 2 > bytes.length)
		invalid("The image header is truncated.");
	return little
		? bytes[offset] | (bytes[offset + 1] << 8)
		: (bytes[offset] << 8) | bytes[offset + 1];
}

function u32(bytes: Uint8Array, offset: number, little = true): number {
	if (offset < 0 || offset + 4 > bytes.length)
		invalid("The image header is truncated.");
	const value = little
		? bytes[offset] |
			(bytes[offset + 1] << 8) |
			(bytes[offset + 2] << 16) |
			(bytes[offset + 3] << 24)
		: (bytes[offset] << 24) |
			(bytes[offset + 1] << 16) |
			(bytes[offset + 2] << 8) |
			bytes[offset + 3];
	return value >>> 0;
}

function i32(bytes: Uint8Array, offset: number, little = true): number {
	return u32(bytes, offset, little) | 0;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	if (offset < 0 || offset + length > bytes.length) return "";
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function dimensions(
	profile: OcrImageProfile,
	width: number,
	height: number,
): void {
	if (
		!Number.isInteger(width) ||
		!Number.isInteger(height) ||
		width <= 0 ||
		height <= 0
	)
		invalid(`The ${profile.toUpperCase()} image has invalid dimensions.`);
	const pixels = width * height;
	if (
		width > OCR_MAX_IMAGE_SIDE ||
		height > OCR_MAX_IMAGE_SIDE ||
		!Number.isSafeInteger(pixels) ||
		pixels > OCR_MAX_IMAGE_PIXELS ||
		pixels * 4 > OCR_MAX_DECODED_BYTES
	)
		throw new SafeInputError(
			"OCR_LIMIT_EXCEEDED",
			`The image dimensions (${width} × ${height}) exceed the safe OCR decode limit.`,
			{ width, height, maxPixels: OCR_MAX_IMAGE_PIXELS },
		);
}

function pngCrc(bytes: Uint8Array, start: number, end: number): number {
	let crc = 0xffffffff;
	for (let index = start; index < end; index++) {
		crc ^= bytes[index];
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): OcrImageInspection {
	if (
		bytes.length < 33 ||
		u32(bytes, 8, false) !== 13 ||
		ascii(bytes, 12, 4) !== "IHDR"
	)
		invalid("The PNG is missing a complete IHDR chunk.");
	const width = u32(bytes, 16, false);
	const height = u32(bytes, 20, false);
	dimensions("png", width, height);
	const bitDepth = bytes[24];
	const colorType = bytes[25];
	const validDepths: Record<number, readonly number[]> = {
		0: [1, 2, 4, 8, 16],
		2: [8, 16],
		3: [1, 2, 4, 8],
		4: [8, 16],
		6: [8, 16],
	};
	if (!validDepths[colorType]?.includes(bitDepth))
		invalid("The PNG uses an invalid color type or bit depth.");
	if (bytes[26] !== 0 || bytes[27] !== 0 || ![0, 1].includes(bytes[28]))
		invalid(
			"The PNG uses an unsupported compression, filter, or interlace method.",
		);
	let offset = 8;
	let sawEnd = false;
	let sawImageData = false;
	let hasAlpha = colorType === 4 || colorType === 6;
	let hasColorProfile = false;
	let frameCount = 1;
	let chunkCount = 0;
	while (offset + 12 <= bytes.length) {
		if (++chunkCount > 100_000) invalid("The PNG contains too many chunks.");
		const length = u32(bytes, offset, false);
		if (length > bytes.length - offset - 12)
			invalid("A PNG chunk is truncated.");
		const type = ascii(bytes, offset + 4, 4);
		if (
			pngCrc(bytes, offset + 4, offset + 8 + length) !==
			u32(bytes, offset + 8 + length, false)
		)
			invalid(`The PNG ${type || "unknown"} chunk has an invalid checksum.`);
		if (type === "tRNS") hasAlpha = true;
		if (type === "iCCP") hasColorProfile = true;
		if (type === "IDAT") sawImageData = true;
		if (type === "acTL") {
			if (length !== 8) invalid("The animated PNG control chunk is malformed.");
			frameCount = u32(bytes, offset + 8, false);
			if (frameCount < 1) invalid("The animated PNG declares no frames.");
		}
		offset += length + 12;
		if (type === "IEND") {
			if (length !== 0) invalid("The PNG IEND chunk is malformed.");
			sawEnd = true;
			break;
		}
	}
	if (!sawImageData || !sawEnd)
		invalid("The PNG is missing image data or its IEND chunk.");
	return {
		profile: "png",
		width,
		height,
		frameCount,
		animated: frameCount > 1,
		orientation: 1,
		hasAlpha,
		hasColorProfile,
		bitsPerPixel: bitDepth,
	};
}

function inspectExifOrientation(
	bytes: Uint8Array,
	offset: number,
	length: number,
): number {
	if (length < 14 || ascii(bytes, offset, 6) !== "Exif\0\0") return 1;
	const base = offset + 6;
	const order = ascii(bytes, base, 2);
	if (order !== "II" && order !== "MM") return 1;
	const little = order === "II";
	if (u16(bytes, base + 2, little) !== 42) return 1;
	const ifd = base + u32(bytes, base + 4, little);
	if (ifd + 2 > offset + length) return 1;
	const count = u16(bytes, ifd, little);
	for (let index = 0; index < Math.min(count, 4096); index++) {
		const entry = ifd + 2 + index * 12;
		if (entry + 12 > offset + length) return 1;
		if (u16(bytes, entry, little) === 0x0112) {
			const value = u16(bytes, entry + 8, little);
			return value >= 1 && value <= 8 ? value : 1;
		}
	}
	return 1;
}

function inspectJpeg(bytes: Uint8Array): OcrImageInspection {
	let offset = 2;
	let width = 0;
	let height = 0;
	let components = 0;
	let orientation = 1;
	let hasColorProfile = false;
	let markerCount = 0;
	let sawScan = false;
	while (offset < bytes.length) {
		if (++markerCount > 65_536)
			invalid("The JPEG contains too many marker segments.");
		while (offset < bytes.length && bytes[offset] === 0xff) offset++;
		if (offset >= bytes.length) break;
		const marker = bytes[offset++];
		if (marker === 0xd9) break;
		if (
			marker === 0x00 ||
			marker === 0x01 ||
			(marker >= 0xd0 && marker <= 0xd7)
		)
			continue;
		if (offset + 2 > bytes.length)
			invalid("The JPEG marker header is truncated.");
		const length = u16(bytes, offset, false);
		if (length < 2 || offset + length > bytes.length)
			invalid("A JPEG marker segment is truncated.");
		const payload = offset + 2;
		const payloadLength = length - 2;
		if (marker === 0xe1)
			orientation = inspectExifOrientation(bytes, payload, payloadLength);
		if (marker === 0xe2 && ascii(bytes, payload, 12) === "ICC_PROFILE\0")
			hasColorProfile = true;
		const sof =
			(marker >= 0xc0 && marker <= 0xc3) ||
			(marker >= 0xc5 && marker <= 0xc7) ||
			(marker >= 0xc9 && marker <= 0xcb) ||
			(marker >= 0xcd && marker <= 0xcf);
		if (sof) {
			if (payloadLength < 6) invalid("The JPEG frame header is truncated.");
			height = u16(bytes, payload + 1, false);
			width = u16(bytes, payload + 3, false);
			components = bytes[payload + 5];
		}
		offset += length;
		if (marker === 0xda) {
			sawScan = true;
			break;
		}
	}
	let sawEnd = false;
	for (let index = Math.max(2, offset); index + 1 < bytes.length; index++)
		if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) {
			sawEnd = true;
			break;
		}
	if (!width || !height || !components || !sawScan || !sawEnd)
		invalid("The JPEG has no complete frame, scan, or end marker.");
	dimensions("jpeg", width, height);
	return {
		profile: "jpeg",
		width,
		height,
		frameCount: 1,
		animated: false,
		orientation,
		hasAlpha: false,
		hasColorProfile,
		bitsPerPixel: components * 8,
	};
}

function tiffValue(
	bytes: Uint8Array,
	entry: number,
	little: boolean,
): number | undefined {
	const type = u16(bytes, entry + 2, little);
	const count = u32(bytes, entry + 4, little);
	if (count !== 1) return undefined;
	if (type === 3) return u16(bytes, entry + 8, little);
	if (type === 4) return u32(bytes, entry + 8, little);
	return undefined;
}

function inspectTiff(bytes: Uint8Array): OcrImageInspection {
	const little = ascii(bytes, 0, 2) === "II";
	if ((!little && ascii(bytes, 0, 2) !== "MM") || u16(bytes, 2, little) !== 42)
		invalid("The TIFF byte order or version marker is invalid.");
	const ifd = u32(bytes, 4, little);
	if (ifd + 2 > bytes.length)
		invalid("The TIFF image directory is outside the file.");
	const count = u16(bytes, ifd, little);
	if (count > 4096 || ifd + 2 + count * 12 + 4 > bytes.length)
		invalid("The TIFF image directory is truncated or excessive.");
	let width = 0;
	let height = 0;
	let orientation = 1;
	let samples = 1;
	let hasAlpha = false;
	let hasColorProfile = false;
	for (let index = 0; index < count; index++) {
		const entry = ifd + 2 + index * 12;
		const tag = u16(bytes, entry, little);
		const value = tiffValue(bytes, entry, little);
		if (tag === 256 && value !== undefined) width = value;
		if (tag === 257 && value !== undefined) height = value;
		if (tag === 274 && value !== undefined && value >= 1 && value <= 8)
			orientation = value;
		if (tag === 277 && value !== undefined) samples = value;
		if (tag === 338) hasAlpha = true;
		if (tag === 34675) hasColorProfile = true;
	}
	dimensions("tiff", width, height);
	return {
		profile: "tiff",
		width,
		height,
		frameCount: 1,
		animated: false,
		orientation,
		hasAlpha,
		hasColorProfile,
		bitsPerPixel: samples * 8,
	};
}

const DIB_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

function inspectDibAt(
	bytes: Uint8Array,
	dibOffset: number,
	profile: "bmp" | "dib",
): OcrImageInspection {
	const headerSize = u32(bytes, dibOffset);
	if (
		!DIB_HEADER_SIZES.has(headerSize) ||
		dibOffset + headerSize > bytes.length
	)
		invalid("The bitmap has an unsupported or truncated DIB header.");
	const core = headerSize === 12;
	const signedWidth = core
		? u16(bytes, dibOffset + 4)
		: i32(bytes, dibOffset + 4);
	const signedHeight = core
		? u16(bytes, dibOffset + 6)
		: i32(bytes, dibOffset + 8);
	const planes = u16(bytes, dibOffset + (core ? 8 : 12));
	const bitsPerPixel = u16(bytes, dibOffset + (core ? 10 : 14));
	if (planes !== 1 || ![1, 2, 4, 8, 16, 24, 32].includes(bitsPerPixel))
		invalid("The bitmap plane count or bit depth is unsupported.");
	const compression = core ? 0 : u32(bytes, dibOffset + 16);
	if (![0, 1, 2, 3, 6].includes(compression))
		invalid(
			"The bitmap uses an unsupported or embedded-image compression mode.",
		);
	if (
		(compression === 1 && bitsPerPixel !== 8) ||
		(compression === 2 && bitsPerPixel !== 4)
	)
		invalid("The bitmap RLE compression does not match its bit depth.");
	const width = Math.abs(signedWidth);
	const height = Math.abs(signedHeight);
	dimensions(profile, width, height);
	const colorsUsed = core || headerSize < 40 ? 0 : u32(bytes, dibOffset + 32);
	const paletteEntries =
		bitsPerPixel <= 8 ? colorsUsed || 2 ** bitsPerPixel : 0;
	const maskBytes =
		headerSize === 40 && (compression === 3 || compression === 6)
			? compression === 6
				? 16
				: 12
			: 0;
	const minimumPixelOffset =
		dibOffset + headerSize + maskBytes + paletteEntries * (core ? 3 : 4);
	if (minimumPixelOffset > bytes.length)
		invalid("The bitmap palette or color masks are truncated.");
	let pixelOffset = minimumPixelOffset;
	if (profile === "bmp") {
		if (bytes.length < 14 || ascii(bytes, 0, 2) !== "BM")
			invalid("The BMP file signature is invalid.");
		const declaredSize = u32(bytes, 2);
		pixelOffset = u32(bytes, 10);
		if (
			u16(bytes, 6) !== 0 ||
			u16(bytes, 8) !== 0 ||
			declaredSize > bytes.length ||
			pixelOffset < minimumPixelOffset ||
			pixelOffset >= bytes.length
		)
			invalid("The BMP file header contains invalid sizes or offsets.");
	}
	if ([0, 3, 6].includes(compression)) {
		const rowBytes = Math.ceil((width * bitsPerPixel) / 32) * 4;
		if (rowBytes * height > bytes.length - pixelOffset)
			invalid("The bitmap pixel array is truncated.");
	} else {
		const compressedSize = u32(bytes, dibOffset + 20);
		if (!compressedSize || compressedSize > bytes.length - pixelOffset)
			invalid("The bitmap compressed pixel data is truncated.");
	}
	let hasColorProfile = false;
	if (headerSize >= 124) {
		const profileOffset = u32(bytes, dibOffset + 112);
		const profileSize = u32(bytes, dibOffset + 116);
		if (profileOffset || profileSize) {
			if (
				!profileOffset ||
				!profileSize ||
				dibOffset + profileOffset + profileSize > bytes.length
			)
				invalid("The bitmap color profile is outside the file.");
			hasColorProfile = true;
		}
	}
	return {
		profile,
		width,
		height,
		frameCount: 1,
		animated: false,
		orientation: 1,
		hasAlpha: bitsPerPixel === 32,
		hasColorProfile,
		bitsPerPixel,
		topDown: signedHeight < 0,
	};
}

function skipGifSubBlocks(bytes: Uint8Array, start: number): number {
	let offset = start;
	let blocks = 0;
	while (offset < bytes.length) {
		if (++blocks > 1_000_000) invalid("The GIF contains too many data blocks.");
		const size = bytes[offset++];
		if (size === 0) return offset;
		if (offset + size > bytes.length)
			invalid("A GIF data sub-block is truncated.");
		offset += size;
	}
	invalid("The GIF data block has no terminator.");
}

function inspectGif(bytes: Uint8Array): OcrImageInspection {
	if (bytes.length < 14 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)))
		invalid("The GIF signature or logical screen descriptor is invalid.");
	const width = u16(bytes, 6);
	const height = u16(bytes, 8);
	dimensions("gif", width, height);
	const packed = bytes[10];
	let offset = 13;
	if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);
	if (offset > bytes.length)
		invalid("The GIF global color table is truncated.");
	let frameCount = 0;
	let hasAlpha = false;
	let sawTrailer = false;
	let records = 0;
	while (offset < bytes.length) {
		if (++records > 1_000_000) invalid("The GIF contains too many records.");
		const introducer = bytes[offset++];
		if (introducer === 0x3b) {
			sawTrailer = true;
			break;
		}
		if (introducer === 0x21) {
			if (offset >= bytes.length) invalid("The GIF extension is truncated.");
			const label = bytes[offset++];
			if (label === 0xf9) {
				if (
					offset + 6 > bytes.length ||
					bytes[offset] !== 4 ||
					bytes[offset + 5] !== 0
				)
					invalid("The GIF graphic control extension is malformed.");
				hasAlpha ||= (bytes[offset + 1] & 1) !== 0;
				offset += 6;
			} else offset = skipGifSubBlocks(bytes, offset);
			continue;
		}
		if (introducer !== 0x2c || offset + 9 > bytes.length)
			invalid("The GIF contains an unknown or truncated record.");
		const left = u16(bytes, offset);
		const top = u16(bytes, offset + 2);
		const frameWidth = u16(bytes, offset + 4);
		const frameHeight = u16(bytes, offset + 6);
		const framePacked = bytes[offset + 8];
		if (
			!frameWidth ||
			!frameHeight ||
			left + frameWidth > width ||
			top + frameHeight > height
		)
			invalid("A GIF frame lies outside the logical screen.");
		offset += 9;
		if (framePacked & 0x80) offset += 3 * 2 ** ((framePacked & 0x07) + 1);
		if (offset >= bytes.length || bytes[offset] < 2 || bytes[offset] > 12)
			invalid("The GIF LZW image data is malformed.");
		offset = skipGifSubBlocks(bytes, offset + 1);
		frameCount++;
	}
	if (!sawTrailer || frameCount === 0)
		invalid("The GIF is missing an image frame or trailer.");
	return {
		profile: "gif",
		width,
		height,
		frameCount,
		animated: frameCount > 1,
		orientation: 1,
		hasAlpha,
		hasColorProfile: false,
		bitsPerPixel: ((packed & 0x07) + 1) * 3,
	};
}

export function inspectOcrImage(bytes: Uint8Array): OcrImageInspection {
	if (
		[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every(
			(value, index) => bytes[index] === value,
		)
	)
		return inspectPng(bytes);
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
		return inspectJpeg(bytes);
	if (
		(ascii(bytes, 0, 2) === "II" && bytes[2] === 42 && bytes[3] === 0) ||
		(ascii(bytes, 0, 2) === "MM" && bytes[2] === 0 && bytes[3] === 42)
	)
		return inspectTiff(bytes);
	if (ascii(bytes, 0, 2) === "BM") return inspectDibAt(bytes, 14, "bmp");
	if (DIB_HEADER_SIZES.has(bytes.length >= 4 ? u32(bytes, 0) : 0))
		return inspectDibAt(bytes, 0, "dib");
	if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6)))
		return inspectGif(bytes);
	invalid(
		"The file is not a supported PNG, JPEG, TIFF, BMP, DIB, or GIF image.",
	);
}

export function wrapDibAsBmp(bytes: Uint8Array): Uint8Array {
	const headerSize = u32(bytes, 0);
	if (!DIB_HEADER_SIZES.has(headerSize))
		invalid("The DIB header is unsupported.");
	const core = headerSize === 12;
	const bitsPerPixel = u16(bytes, core ? 10 : 14);
	const colorsUsed = core || headerSize < 40 ? 0 : u32(bytes, 32);
	const paletteEntries =
		bitsPerPixel <= 8 ? colorsUsed || 2 ** bitsPerPixel : 0;
	const paletteBytes = paletteEntries * (core ? 3 : 4);
	const compression = core ? 0 : u32(bytes, 16);
	const maskBytes =
		headerSize === 40 && (compression === 3 || compression === 6)
			? compression === 6
				? 16
				: 12
			: 0;
	const pixelOffset = 14 + headerSize + maskBytes + paletteBytes;
	if (pixelOffset - 14 > bytes.length)
		invalid("The DIB palette or bit masks are truncated.");
	const output = new Uint8Array(bytes.length + 14);
	output[0] = 0x42;
	output[1] = 0x4d;
	const view = new DataView(output.buffer);
	view.setUint32(2, output.length, true);
	view.setUint32(10, pixelOffset, true);
	output.set(bytes, 14);
	return output;
}
