import * as CFB from "cfb";

export interface OutlookMsgFixtureOptions {
	name?: string;
	subject?: string;
	body?: string;
	htmlBody?: string;
	senderName?: string;
	senderEmail?: string;
	recipients?: Array<{
		name: string;
		email: string;
		type?: "to" | "cc" | "bcc";
	}>;
	attachments?: Array<{
		name: string;
		content?: Uint8Array;
	}>;
	includeNestedMessage?: boolean;
	omitPropertyStream?: boolean;
	omitMessageClass?: boolean;
}

function utf16le(value: string): Uint8Array {
	const output = new Uint8Array((value.length + 1) * 2);
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		output[index * 2] = code & 0xff;
		output[index * 2 + 1] = code >>> 8;
	}
	return output;
}

function propertyRecord(tag: number, value: number): Uint8Array {
	const output = new Uint8Array(16);
	const view = new DataView(output.buffer);
	view.setUint32(0, tag, true);
	view.setUint32(4, 0, true);
	view.setUint32(8, value, true);
	return output;
}

function concat(...parts: Uint8Array[]): Uint8Array {
	const output = new Uint8Array(
		parts.reduce((total, part) => total + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

function addUnicode(
	container: CFB.CFB$Container,
	path: string,
	tag: string,
	value: string | undefined,
): void {
	if (value !== undefined)
		CFB.utils.cfb_add(
			container,
			`${path}/__substg1.0_${tag}001F`,
			utf16le(value),
		);
}

export function createOutlookMsgFixture(
	options: OutlookMsgFixtureOptions = {},
): File {
	const container = CFB.utils.cfb_new({ root: "Root Entry" });
	if (!options.omitPropertyStream)
		CFB.utils.cfb_add(
			container,
			"/__properties_version1.0",
			new Uint8Array(32),
		);
	if (!options.omitMessageClass) addUnicode(container, "", "001A", "IPM.Note");
	addUnicode(
		container,
		"",
		"0037",
		options.subject ?? "Project update — مرحبا",
	);
	if (options.body !== undefined || options.htmlBody === undefined)
		addUnicode(
			container,
			"",
			"1000",
			options.body ?? "First paragraph.\r\n\r\nSecond paragraph 👩🏽‍💻.",
		);
	if (options.htmlBody !== undefined)
		addUnicode(container, "", "1013", options.htmlBody);
	addUnicode(container, "", "0C1A", options.senderName ?? "Sender Example");
	addUnicode(
		container,
		"",
		"0C1F",
		options.senderEmail ?? "sender@example.test",
	);
	for (const [index, recipient] of (
		options.recipients ?? [
			{
				name: "Recipient Example",
				email: "recipient@example.test",
				type: "to",
			},
		]
	).entries()) {
		const path = `/__recip_version1.0_#${index.toString(16).padStart(8, "0")}`;
		const type = recipient.type === "cc" ? 2 : recipient.type === "bcc" ? 3 : 1;
		CFB.utils.cfb_add(
			container,
			`${path}/__properties_version1.0`,
			concat(new Uint8Array(8), propertyRecord(0x0c150003, type)),
		);
		addUnicode(container, path, "3001", recipient.name);
		addUnicode(container, path, "3003", recipient.email);
		addUnicode(container, path, "39FE", recipient.email);
	}
	for (const [index, attachment] of (options.attachments ?? []).entries()) {
		const path = `/__attach_version1.0_#${index.toString(16).padStart(8, "0")}`;
		CFB.utils.cfb_add(
			container,
			`${path}/__properties_version1.0`,
			new Uint8Array(8),
		);
		addUnicode(container, path, "3707", attachment.name);
		CFB.utils.cfb_add(
			container,
			`${path}/__substg1.0_37010102`,
			attachment.content ?? new TextEncoder().encode("opaque attachment"),
		);
		if (options.includeNestedMessage && index === 0) {
			const nested = `${path}/__substg1.0_3701000D`;
			CFB.utils.cfb_add(
				container,
				`${nested}/__properties_version1.0`,
				new Uint8Array(32),
			);
			addUnicode(container, nested, "001A", "IPM.Note");
			addUnicode(container, nested, "0037", "Nested message");
		}
	}
	const bytes = Uint8Array.from(
		CFB.write(container, { type: "array", fileType: "cfb" }) as number[],
	);
	return new File([bytes], options.name ?? "message.msg", {
		type: "application/vnd.ms-outlook",
	});
}

export function createMalformedOutlookCompound(name = "malformed.msg"): File {
	return createOutlookMsgFixture({
		name,
		omitPropertyStream: true,
	});
}
