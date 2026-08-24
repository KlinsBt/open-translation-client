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
		locked: [false, true],
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

	it("neutralizes every spreadsheet formula prefix in converted source and target cells", async () => {
		const prefixes = [
			"=",
			"+",
			"-",
			"@",
			"\t",
			"\r",
			"\n",
			"＝",
			"＋",
			"－",
			"＠",
		];
		const unsafe = structuredClone(project);
		unsafe.translationData.seg1 = prefixes.map(
			(prefix, index) => `${prefix}SOURCE_${index}`,
		);
		unsafe.translationData.seg2 = prefixes.map(
			(prefix, index) => `${prefix}TARGET_${index}`,
		);
		unsafe.translationData.checked = prefixes.map(() => true);

		const result = await buildConvertedTranslation(unsafe, "csv");
		const csv = await result.blob.text();
		for (const [index, prefix] of prefixes.entries()) {
			expect(csv).toContain(`'${prefix}SOURCE_${index}`);
			expect(csv).toContain(`'${prefix}TARGET_${index}`);
		}
		expect(csv).toContain('"1","\'=SOURCE_0","\'=TARGET_0"');
	});

	it("builds Unicode-safe RTF", async () => {
		const result = await buildConvertedTranslation(project, "rtf");
		const rtf = await result.blob.text();
		expect(rtf).toMatch(/^\{\\rtf1/);
		expect(rtf).toContain("\\u246?");
		expect(rtf).toContain("\\par");
	});

	it("normalizes CRLF and lone carriage returns in RTF text", async () => {
		const multiline = structuredClone(project);
		multiline.translationData.seg2 = ["First\r\nSecond\rThird"];
		const result = await buildConvertedTranslation(multiline, "rtf");
		const rtf = await result.blob.text();
		expect(rtf.match(/\\line /g)).toHaveLength(2);
		expect(rtf).not.toContain("\\u13?");
	});

	it("always creates a portable non-empty converted export filename", async () => {
		const extensionOnly = structuredClone(project);
		extensionOnly.translationData.name = ".txt";
		expect(
			(await buildConvertedTranslation(extensionOnly, "txt")).fileName,
		).toBe("translation.txt");

		const windowsReserved = structuredClone(project);
		windowsReserved.translationData.name = "CON.docx";
		expect(
			(await buildConvertedTranslation(windowsReserved, "rtf")).fileName,
		).toBe("translation-CON.rtf");

		const trailingPunctuation = structuredClone(project);
		trailingPunctuation.translationData.name = "Delivery. ";
		expect(
			(await buildConvertedTranslation(trailingPunctuation, "html")).fileName,
		).toBe("Delivery.html");
	});

	it("builds a valid DOCX package containing translated text", async () => {
		const result = await buildConvertedTranslation(project, "docx");
		const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
		const documentXml = await zip.file("word/document.xml")!.async("string");
		expect(documentXml).toContain("Hallo, Welt");
		expect(documentXml).toContain("Sicher &lt;gut&gt; &amp; schön");
	});
});
