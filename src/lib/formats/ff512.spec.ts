// @vitest-environment happy-dom

import * as CFB from "cfb";
import PostalMime from "postal-mime";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	createMalformedOutlookCompound,
	createOutlookMsgFixture,
} from "../../test/outlookMsgFixture";
import { detectFormatWithConfidence } from "./registry";
import {
	buildOutlookMsgDelivery,
	importOutlookMsgFile,
	inspectOutlookMsgFile,
	validateOutlookMsgFile,
} from "./outlookMsg";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

async function importedProject(file: File, targets?: string[], options = {}) {
	const imported = await importOutlookMsgFile(file, options);
	if (imported.kind !== "segments") throw new Error("Expected MSG segments");
	return {
		imported,
		project: makeUserData({
			type: "outlook-msg",
			name: file.name,
			seg1: imported.segments,
			seg2: targets ?? [...imported.segments],
			checked: imported.segments.map(() => false),
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		}),
	};
}

describe("FF-512 Outlook MSG protected import", () => {
	it("detects a renamed Outlook item from CFB and MAPI structure", async () => {
		const original = createOutlookMsgFixture({ name: "renamed.data" });
		await expect(validateOutlookMsgFile(original)).resolves.toEqual({
			valid: true,
		});
		await expect(detectFormatWithConfidence(original)).resolves.toMatchObject({
			formatId: "outlook-msg",
			label: "Outlook MSG → safe EML",
			supported: true,
			confidence: "high",
			workflow: { kind: "source-only" },
		});
	});

	it("imports subject, plain body paragraphs, recipients, metadata context, and selected attachment names", async () => {
		const file = createOutlookMsgFixture({
			subject: "Quarterly update — مرحبا",
			body: "First paragraph.\r\n\r\nSecond café é 👩🏽‍💻.",
			senderName: "مدير المشروع",
			senderEmail: "sender@example.test",
			recipients: [
				{ name: "Alice", email: "alice@example.test", type: "to" },
				{ name: "בוב", email: "bob@example.test", type: "cc" },
			],
			attachments: [
				{
					name: "../../Release notes مرحبا.pdf",
					content: new Uint8Array([1, 2, 3]),
				},
			],
		});
		const { imported } = await importedProject(file);
		expect(imported.segments).toEqual([
			"Quarterly update — مرحبا",
			"First paragraph.",
			"Second café é 👩🏽‍💻.",
			"Release notes مرحبا",
		]);
		expect(imported.document.units[0].contexts).toContainEqual({
			type: "outlook-message-class",
			value: "IPM.Note",
		});
		expect(imported.document.units[0].contexts).toContainEqual({
			type: "outlook-recipients",
			value: "to: Alice; cc: בוב",
		});
		expect(imported.document.units[3].notes[0]?.text).toContain("opaque");
		expect(imported.skeleton.payload).toEqual({ kind: "package", parts: {} });
		expect(imported.skeleton.source.originalFile).toBeInstanceOf(Blob);
		expect(imported.document.metadata).toMatchObject({
			profile: "MS-OXMSG source-only",
			attachmentCount: 1,
			exportPolicy: "exact-msg-identity-or-safe-eml-delivery",
		});
	});

	it("extracts inert HTML text without scripts, forms, embedded objects, or external-resource attributes", async () => {
		const file = createOutlookMsgFixture({
			body: undefined,
			htmlBody:
				'<html><body><p>Visible <b>שלום</b></p><img src="https://tracker.invalid/pixel" alt="secret"><script>steal()</script><form>Never submit</form><object>Never load</object></body></html>',
		});
		const { imported } = await importedProject(file, undefined, {
			bodyPreference: "html-only",
			includeAttachmentNames: false,
		});
		const text = imported.segments.join(" ");
		expect(text).toContain("Visible");
		expect(text).toContain("שלום");
		expect(text).not.toMatch(/steal|Never submit|Never load|tracker|secret/);
		expect(imported.document.metadata?.security).toContain("never executed");
	});

	it("retains exact compound bytes for an identity round trip", async () => {
		const file = createOutlookMsgFixture({
			attachments: [
				{ name: "opaque.bin", content: new Uint8Array([0, 255, 17, 9]) },
			],
		});
		const source = new Uint8Array(await file.arrayBuffer());
		const { project } = await importedProject(file);
		const output = await buildOutlookMsgDelivery(project);
		expect(output.extension).toBe("msg");
		expect(output.blob.type).toBe("application/vnd.ms-outlook");
		expect(new Uint8Array(await output.blob.arrayBuffer())).toEqual(source);
		const reopened = CFB.parse(new Uint8Array(await output.blob.arrayBuffer()));
		expect(reopened.FullPaths.some((path) => path.includes("37010102"))).toBe(
			true,
		);
	});

	it("exports translated content as independently parsed safe EML and omits opaque payloads", async () => {
		const file = createOutlookMsgFixture({
			subject: "Original subject",
			body: "Original body.",
			attachments: [
				{
					name: "secret.bin",
					content: new TextEncoder().encode("DO-NOT-COPY-OPAQUE-PAYLOAD"),
				},
			],
		});
		const { project } = await importedProject(file, [
			"Übersetzter Betreff مرحبا\r\nBcc: attacker@example.test",
			"Übersetzter Inhalt 👩🏽‍💻.",
			"sichere-anlage",
		]);
		const output = await buildOutlookMsgDelivery(project);
		expect(output.extension).toBe("eml");
		expect(output.blob.type).toBe("message/rfc822");
		const raw = await output.blob.text();
		expect(raw).not.toContain("DO-NOT-COPY-OPAQUE-PAYLOAD");
		expect(raw).not.toContain("\r\nBcc: attacker@example.test");
		expect(raw).toContain("X-OpenTLC-Attachments-Omitted: 1");
		const parsed = await PostalMime.parse(await output.blob.arrayBuffer());
		expect(parsed.subject).toBe(
			"Übersetzter Betreff مرحبا Bcc: attacker@example.test",
		);
		expect(parsed.text).toContain("Übersetzter Inhalt 👩🏽‍💻.");
		expect(parsed.text).toContain("sichere-anlage.bin");
		expect(parsed.attachments).toEqual([]);
	});

	it.each([
		[createMalformedOutlookCompound(), /property stream/i],
		[
			new File(
				[new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
				"short.msg",
			),
			/malformed/i,
		],
		[
			createOutlookMsgFixture({
				attachments: [{ name: "nested.msg" }],
				includeNestedMessage: true,
			}),
			/embedded or nested/i,
		],
	] as const)("rejects malformed or nested MSG input", async (file, reason) => {
		const validation = await validateOutlookMsgFile(file);
		expect(validation.valid).toBe(false);
		expect(validation.reason).toMatch(reason);
		await expect(detectFormatWithConfidence(file)).resolves.toMatchObject({
			supported: false,
		});
	});

	it("rejects an adversarial attachment-count explosion", async () => {
		const file = createOutlookMsgFixture({
			attachments: Array.from({ length: 257 }, (_, index) => ({
				name: `attachment-${index}.bin`,
				content: new Uint8Array([index & 0xff]),
			})),
		});
		await expect(inspectOutlookMsgFile(file)).rejects.toMatchObject({
			code: "OUTLOOK_MSG_INVALID",
		});
	});

	it("honors cancellation before parsing MAPI streams", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			importOutlookMsgFile(createOutlookMsgFixture(), undefined, {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("generates and imports a large 3,000-paragraph message without a committed fixture", async () => {
		const body = Array.from(
			{ length: 3_000 },
			(_, index) => `Message ${index} — مرحبا`,
		).join("\r\n\r\n");
		const started = performance.now();
		const imported = await importOutlookMsgFile(
			createOutlookMsgFixture({ subject: "Large", body }),
			{ includeSubject: false, includeAttachmentNames: false },
		);
		const duration = performance.now() - started;
		expect(imported.kind === "segments" ? imported.segments.length : 0).toBe(
			3_000,
		);
		expect(duration).toBeLessThan(10_000);
	});

	it("blocks split/join edits across protected delivery mappings", async () => {
		const { project } = await importedProject(createOutlookMsgFixture());
		const split = splitSegmentData(project.translationData, 0, 3);
		expect(split.data).toBe(project.translationData);
		expect(split.error).toContain(
			"Outlook message units cannot be split or joined",
		);
	});
});
