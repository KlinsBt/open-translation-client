import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { UserData } from "$lib/types/types";

import { buildConvertedTranslation } from "./convertedExport";

const project: UserData = {
	translationData: {
		name: "Customer / guide.docx",
		sourceLang: "English (en)",
		targetLang: "German (de)",
		creationDate: "2026-08-18",
		seg1: ["Hello, world", "Use <safe> & sound"],
		seg2: ["Hallo, Welt", "Sicher <gut> & schön"],
		checked: [true, false],
		type: "docx",
		typeRef: {},
		tm: null,
		tb: { id: null, name: null, active: false },
	},
};

describe("converted translation exports", () => {
	it("builds target-only TXT and escaped HTML delivery files", async () => {
		const txt = await buildConvertedTranslation(project, "txt");
		expect(txt.fileName).toBe("Customer - guide.txt");
		expect(await txt.blob.text()).toBe("Hallo, Welt\n\nSicher <gut> & schön");

		const html = await buildConvertedTranslation(project, "html");
		const markup = await html.blob.text();
		expect(markup).toContain('<html lang="de">');
		expect(markup).toContain("Sicher &lt;gut&gt; &amp; schön");
	});

	it("builds a bilingual CSV with status and escaped cells", async () => {
		const result = await buildConvertedTranslation(project, "csv");
		const csv = await result.blob.text();
		expect(csv).toContain('"Segment","Source","Target","Status"');
		expect(csv).toContain('"1","Hello, world","Hallo, Welt","confirmed"');
		expect(csv).toContain(
			'"2","Use <safe> & sound","Sicher <gut> & schön","draft"',
		);
	});

	it("builds Unicode-safe RTF", async () => {
		const result = await buildConvertedTranslation(project, "rtf");
		const rtf = await result.blob.text();
		expect(rtf).toMatch(/^\{\\rtf1/);
		expect(rtf).toContain("\\u246?");
		expect(rtf).toContain("\\par");
	});

	it("builds a valid DOCX package containing translated text", async () => {
		const result = await buildConvertedTranslation(project, "docx");
		const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
		const documentXml = await zip.file("word/document.xml")!.async("string");
		expect(documentXml).toContain("Hallo, Welt");
		expect(documentXml).toContain("Sicher &lt;gut&gt; &amp; schön");
	});
});
