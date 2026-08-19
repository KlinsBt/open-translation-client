function bytesFromBase64(value: string): Uint8Array {
	return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
	let crc = 0xffffffff;
	for (let index = start; index < end; index++) {
		crc ^= bytes[index];
		for (let bit = 0; bit < 8; bit++)
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

export function structuredPng(width = 200, height = 100): Uint8Array {
	const bytes = new Uint8Array(8 + 25 + 12 + 12);
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const view = new DataView(bytes.buffer);
	view.setUint32(8, 13);
	bytes.set([0x49, 0x48, 0x44, 0x52], 12);
	view.setUint32(16, width);
	view.setUint32(20, height);
	bytes.set([8, 6, 0, 0, 0], 24);
	view.setUint32(29, crc32(bytes, 12, 29));
	view.setUint32(33, 0);
	bytes.set([0x49, 0x44, 0x41, 0x54], 37);
	view.setUint32(41, crc32(bytes, 37, 41));
	view.setUint32(45, 0);
	bytes.set([0x49, 0x45, 0x4e, 0x44], 49);
	view.setUint32(53, crc32(bytes, 49, 53));
	return bytes;
}

export function decodablePng(): Uint8Array {
	return bytesFromBase64(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	);
}

export function gif(frames = 1): Uint8Array {
	const header = [
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 0xff,
		0xff, 0xff,
	];
	const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
	return new Uint8Array([
		...header,
		...Array.from({ length: frames }, () => frame).flat(),
		0x3b,
	]);
}

export function bmp(width = 2, height = 2, topDown = false): Uint8Array {
	const rowBytes = Math.ceil((width * 3) / 4) * 4;
	const pixelBytes = rowBytes * height;
	const bytes = new Uint8Array(54 + pixelBytes);
	const view = new DataView(bytes.buffer);
	bytes.set([0x42, 0x4d]);
	view.setUint32(2, bytes.length, true);
	view.setUint32(10, 54, true);
	view.setUint32(14, 40, true);
	view.setInt32(18, width, true);
	view.setInt32(22, topDown ? -height : height, true);
	view.setUint16(26, 1, true);
	view.setUint16(28, 24, true);
	view.setUint32(34, pixelBytes, true);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const offset = 54 + y * rowBytes + x * 3;
			bytes.set((x + y) % 2 ? [0x20, 0x80, 0xff] : [0xff, 0x80, 0x20], offset);
		}
	}
	return bytes;
}

export function dib(width = 2, height = 2): Uint8Array {
	return bmp(width, height).slice(14);
}

export function minimalTiff(width = 20, height = 10): Uint8Array {
	const bytes = new Uint8Array(8 + 2 + 3 * 12 + 4);
	const view = new DataView(bytes.buffer);
	bytes.set([0x49, 0x49, 0x2a, 0]);
	view.setUint32(4, 8, true);
	view.setUint16(8, 3, true);
	for (const [index, tag, value] of [
		[0, 256, width],
		[1, 257, height],
		[2, 274, 1],
	] as const) {
		const offset = 10 + index * 12;
		view.setUint16(offset, tag, true);
		view.setUint16(offset + 2, 4, true);
		view.setUint32(offset + 4, 1, true);
		view.setUint32(offset + 8, value, true);
	}
	return bytes;
}

export function jpegWithExifOrientation(
	width = 32,
	height = 24,
	orientation = 6,
): Uint8Array {
	const exif = [
		0x45,
		0x78,
		0x69,
		0x66,
		0,
		0,
		0x49,
		0x49,
		0x2a,
		0,
		8,
		0,
		0,
		0,
		1,
		0,
		0x12,
		0x01,
		3,
		0,
		1,
		0,
		0,
		0,
		orientation,
		0,
		0,
		0,
		0,
		0,
		0,
		0,
	];
	const app1Length = exif.length + 2;
	return new Uint8Array([
		0xff,
		0xd8,
		0xff,
		0xe1,
		app1Length >> 8,
		app1Length & 0xff,
		...exif,
		0xff,
		0xe2,
		0,
		16,
		...Array.from("ICC_PROFILE\0", (character) => character.charCodeAt(0)),
		1,
		1,
		0xff,
		0xc0,
		0,
		11,
		8,
		height >> 8,
		height & 0xff,
		width >> 8,
		width & 0xff,
		1,
		1,
		0x11,
		0,
		0xff,
		0xda,
		0,
		8,
		1,
		1,
		0,
		0,
		63,
		0,
		0xff,
		0xd9,
	]);
}
