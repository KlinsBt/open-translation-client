// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { buildXliff1_2 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile1_2";
import { buildXliff2_0 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
import { makeUserData } from "../../test/fixtures";
import {
	parseXmlRecord,
	processInBatches,
	readStreamingTextFile,
	scanXmlRecords,
	streamCsvRows,
	streamSafeTextChunks,
} from "./streaming";
import {
	importTbxStreaming,
	importTmxStreaming,
	importXliffProjectStreaming,
} from "./streamingImporters";

function textFile(text: string, name: string): File {
	return new File([text], name, { type: "application/xml" });
}

describe("incremental text and record scanning", () => {
	it("processes large collections in ordered, cooperative batches", async () => {
		const batches: number[][] = [];
		let yields = 0;
		const count = await processInBatches(
			Array.from({ length: 250 }, (_, index) => index),
			(batch) => {
				batches.push([...batch]);
			},
			{ batchSize: 100, yieldControl: async () => void yields++ },
		);
		expect(count).toBe(3);
		expect(batches.map((batch) => batch.length)).toEqual([100, 100, 50]);
		expect(batches.flat()).toEqual(
			Array.from({ length: 250 }, (_, index) => index),
		);
		expect(yields).toBe(2);
	});

	it("stops batch processing when cancelled", async () => {
		const controller = new AbortController();
		await expect(
			processInBatches(
				[1, 2, 3],
				(_batch, batchIndex) => {
					if (batchIndex === 0) controller.abort();
				},
				{ batchSize: 1, signal: controller.signal },
			),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("streams UTF-16 text across deliberately small chunks", async () => {
		const source = "alpha βeta gamma";
		const bytes = new Uint8Array(2 + source.length * 2);
		bytes.set([0xff, 0xfe]);
		for (let index = 0; index < source.length; index++) {
			const code = source.charCodeAt(index);
			bytes[2 + index * 2] = code & 0xff;
			bytes[3 + index * 2] = code >> 8;
		}
		let output = "";
		for await (const chunk of streamSafeTextChunks(
			new File([bytes], "utf16.txt"),
			undefined,
			{ chunkBytes: 5 },
		))
			output += chunk;
		expect(output).toBe(source);
		const read = await readStreamingTextFile(
			new File([bytes], "utf16.txt"),
			undefined,
			{ chunkBytes: 5 },
		);
		expect(read).toMatchObject({
			text: `\ufeff${source}`,
			encoding: "utf-16le",
			hasBom: true,
		});
	});

	it("keeps the XML buffer bounded while scanning thousands of records", async () => {
		const records = Array.from(
			{ length: 5_000 },
			(_, index) => `<item id="${index}"><value>${index}</value></item>`,
		).join("");
		const file = textFile(
			`<root xmlns="urn:test"><body>${records}</body></root>`,
			"large.xml",
		);
		let seen = 0;
		const result = await scanXmlRecords(
			file,
			{ recordNames: ["item"], chunkBytes: 1024, batchSize: 100 },
			(record, index, namespaces) => {
				const element = parseXmlRecord(record, namespaces);
				expect(element.getAttribute("id")).toBe(String(index));
				seen++;
			},
		);
		expect(seen).toBe(5_000);
		expect(result.recordCount).toBe(5_000);
		expect(result.maxBufferedChars).toBeLessThan(2_048);
		expect(result.yieldCount).toBe(50);
	});

	it("handles comments, CDATA, quoted angle brackets, and chunk boundaries", async () => {
		const file = textFile(
			'<root><!-- before --><item data=">">one<![CDATA[<two>]]></item><item>three</item></root>',
			"records.xml",
		);
		const records: string[] = [];
		await scanXmlRecords(
			file,
			{ recordNames: ["item"], chunkBytes: 7 },
			(record) => {
				records.push(record);
			},
		);
		expect(records).toEqual([
			'<item data=">">one<![CDATA[<two>]]></item>',
			"<item>three</item>",
		]);
		expect(parseXmlRecord(records[1]).textContent).toBe("three");
	});

	it("carries ancestor namespace declarations into later streamed records", async () => {
		const file = textFile(
			'<root xmlns="urn:test"><item>one</item><scope xmlns:vendor="urn:vendor"><item><vendor:data key="two"/></item></scope></root>',
			"namespaces.xml",
		);
		const values: string[] = [];
		await scanXmlRecords(
			file,
			{ recordNames: ["item"], chunkBytes: 17 },
			(record, _index, namespaces) => {
				const element = parseXmlRecord(record, namespaces);
				const vendorData = Array.from(element.getElementsByTagName("*")).find(
					(child) =>
						child.localName === "data" && child.namespaceURI === "urn:vendor",
				);
				values.push(
					vendorData?.getAttribute("key") ?? element.textContent ?? "",
				);
			},
		);
		expect(values).toEqual(["one", "two"]);
	});

	it("honors cancellation between XML batches", async () => {
		const controller = new AbortController();
		const file = textFile(
			`<root>${Array.from({ length: 20 }, (_, index) => `<item>${index}</item>`).join("")}</root>`,
			"cancel.xml",
		);
		await expect(
			scanXmlRecords(
				file,
				{ recordNames: ["item"], chunkBytes: 20 },
				(_record, index) => {
					if (index === 2) controller.abort();
				},
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("rejects unsafe declarations even when the token crosses chunks", async () => {
		const file = textFile(
			'<?xml version="1.0"?><!DOCTYPE root [<!ENTITY x "unsafe">]><root><item>&x;</item></root>',
			"unsafe.xml",
		);
		await expect(
			scanXmlRecords(
				file,
				{ recordNames: ["item"], chunkBytes: 11 },
				() => undefined,
			),
		).rejects.toMatchObject({ code: "XML_UNSAFE_DECLARATION" });
	});

	it("rejects individual records that exceed the bounded buffer policy", async () => {
		const file = textFile(
			`<root><item>${"x".repeat(100)}</item></root>`,
			"oversized-record.xml",
		);
		await expect(
			scanXmlRecords(
				file,
				{ recordNames: ["item"], chunkBytes: 16, maxRecordChars: 50 },
				() => undefined,
			),
		).rejects.toMatchObject({ code: "XML_MALFORMED" });
	});
});

describe("streaming CAT interchange importers", () => {
	it("imports TMX units without constructing a document-wide DOM", async () => {
		const tmx = `<?xml version="1.0"?><tmx version="1.4"><header creationtool="OpenTLC" creationtoolversion="1" segtype="sentence" o-tmf="OpenTLC" adminlang="en" srclang="en" datatype="plaintext"><prop type="id">7</prop><prop type="name">Memory</prop></header><body><tu tuid="1"><tuv xml:lang="en"><seg>Hello</seg></tuv><tuv xml:lang="de"><seg>Hallo</seg></tuv></tu><tu tuid="2"><tuv xml:lang="en"><seg>World</seg></tuv><tuv xml:lang="de"><seg>Welt</seg></tuv></tu></body></tmx>`;
		const result = await importTmxStreaming(textFile(tmx, "memory.tmx"));
		expect(result.data).toEqual({
			schemaVersion: 1,
			id: 7,
			name: "Memory",
			terms: [
				{
					source: { lang: "en", segment: "Hello" },
					target: [{ lang: "de", segment: "Hallo" }],
				},
				{
					source: { lang: "en", segment: "World" },
					target: [{ lang: "de", segment: "Welt" }],
				},
			],
		});
	});

	it("imports TBX-Core concept records incrementally", async () => {
		const tbx = `<?xml version="1.0"?><tbx style="dca" type="TBX-Core" xml:lang="en"><tbxHeader><fileDesc><title>Terms</title><sourceDesc>OpenTLC ID: 9</sourceDesc></fileDesc></tbxHeader><text><body><conceptEntry id="c1"><langSec xml:lang="en-US"><termSec><term>file</term><termNote type="partOfSpeech">noun</termNote></termSec></langSec><langSec xml:lang="de"><termSec><term>Datei</term></termSec></langSec></conceptEntry></body></text></tbx>`;
		const result = await importTbxStreaming(textFile(tbx, "terms.tbx"));
		expect(result.data.id).toBe(9);
		expect(result.data.schemaVersion).toBe(1);
		expect(result.data.name).toBe("Terms");
		expect(result.data.entries[0].terms).toMatchObject([
			{ lang: "en", term: "file" },
			{ lang: "de", term: "Datei" },
		]);
	});

	it("round-trips Open TLC XLIFF 1.2 and 2.0 metadata incrementally", async () => {
		const project = makeUserData({
			seg1: ["Hello", "World"],
			seg2: ["Hallo", "Welt"],
			checked: [true, false],
		});
		project.id = 42;
		for (const [name, xml] of [
			["project-1.2.xliff", buildXliff1_2(project)],
			["project-2.0.xliff", buildXliff2_0(project)],
		] as const) {
			const result = await importXliffProjectStreaming(textFile(xml, name));
			expect(result.data.schemaVersion).toBe(1);
			expect(result.data.id).toBe(42);
			expect(result.data.translationData.seg1).toEqual(["Hello", "World"]);
			expect(result.data.translationData.seg2).toEqual(["Hallo", "Welt"]);
			expect(result.data.translationData.checked).toEqual([true, false]);
		}
	});

	it.each([
		["project-1.2.xliff", buildXliff1_2(makeUserData())],
		["project-2.0.xliff", buildXliff2_0(makeUserData())],
	])("rejects a future Open TLC schema in %s", async (name, xml) => {
		const futureXml = xml
			.replace(
				"<sup:SchemaVersion>1</sup:SchemaVersion>",
				"<sup:SchemaVersion>2</sup:SchemaVersion>",
			)
			.replace("&quot;schemaVersion&quot;:1", "&quot;schemaVersion&quot;:2")
			.replace('type="schema_version">1<', 'type="schema_version">2<');

		await expect(
			importXliffProjectStreaming(textFile(futureXml, name)),
		).rejects.toMatchObject({ code: "FUTURE_VERSION", version: 2 });
	});

	it("upgrades an older XLIFF backup that has no schema marker", async () => {
		const legacyXml = buildXliff2_0(makeUserData()).replace(
			/<mda:meta type="schema_version">[^<]*<\/mda:meta>/,
			"",
		);
		const result = await importXliffProjectStreaming(
			textFile(legacyXml, "legacy.xliff"),
		);

		expect(result.data.schemaVersion).toBe(1);
		expect(result.data.translationData.seg1).toEqual(["Hello & welcome."]);
	});
});

describe("incremental CSV records", () => {
	it("parses quoted separators, escaped quotes, and embedded newlines", async () => {
		const rows: string[][] = [];
		const file = new File(
			[
				'id,source,target\r\n1,"Hello, world","Hallo"\r\n2,"line one\nline two","a ""quote"""',
			],
			"messages.csv",
		);
		const count = await streamCsvRows(
			file,
			(row) => {
				rows.push(row);
			},
			undefined,
			{ chunkBytes: 9 },
		);
		expect(count).toBe(3);
		expect(rows).toEqual([
			["id", "source", "target"],
			["1", "Hello, world", "Hallo"],
			["2", "line one\nline two", 'a "quote"'],
		]);
	});
});
