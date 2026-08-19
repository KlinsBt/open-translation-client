import PostalMime from "postal-mime";
import { describe, expect, it } from "vitest";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { makeUserData } from "../../test/fixtures";
import { createOutlookMsgFixture } from "../../test/outlookMsgFixture";
import { buildOutlookMsgDelivery, importOutlookMsgFile } from "./outlookMsg";

describe("FF-512 browser persistence and safe EML delivery", () => {
	it("persists an opaque MSG source, restores it, and exports independently parsed EML", async () => {
		const name = `ff512-${Date.now()}.msg`;
		const imported = await importOutlookMsgFile(
			createOutlookMsgFixture({
				name,
				subject: "Browser subject",
				body: "Browser body مرحبا.",
				attachments: [
					{
						name: "browser-note.txt",
						content: new TextEncoder().encode("opaque browser payload"),
					},
				],
			}),
			{ includeAttachmentNames: false },
		);
		if (imported.kind !== "segments") throw new Error("Expected MSG segments");
		const project = makeUserData({
			type: "outlook-msg",
			name,
			seg1: imported.segments,
			seg2: ["Browser-Betreff", "Browser-Inhalt שלום."],
			checked: [true, true],
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored?.translationData.type).toBe("outlook-msg");
		expect(restored?.translationData.filterOptions).toMatchObject({
			bodyPreference: "prefer-plain",
			includeAttachmentNames: false,
		});
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);

		const delivery = await buildOutlookMsgDelivery(restored!);
		expect(delivery.extension).toBe("eml");
		const parsed = await PostalMime.parse(await delivery.blob.arrayBuffer());
		expect(parsed.subject).toBe("Browser-Betreff");
		expect(parsed.text).toContain("Browser-Inhalt שלום.");
		expect(parsed.attachments).toEqual([]);
	});
});
