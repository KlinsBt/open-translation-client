// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import complexFixture from "../../test/fixtures/tmx14/level2-multilingual.tmx?raw";
import unbalancedFixture from "../../test/fixtures/tmx14/malformed-unbalanced.tmx?raw";
import missingSourceFixture from "../../test/fixtures/tmx14/malformed-missing-source.tmx?raw";
import officialDtd from "../../test/fixtures/tmx14/tmx14.dtd?raw";
import { importTmxStreaming } from "./streamingImporters";
import { migrateTmData } from "./persistenceMigrations";
import {
	buildTmx14,
	mergeTmxData,
	validateTmxDocument,
	type TmxMergePolicy,
} from "./tmx14";

function tmxFile(xml: string, name = "memory.tmx"): File {
	return new File([xml], name, { type: "application/x-tmx+xml" });
}

function validateWithOfficialDtd(xml: string) {
	expect(officialDtd).toContain("<!ELEMENT tu ((note|prop)*, tuv+)>");
	expect(officialDtd).toContain(
		"<!ELEMENT seg (#PCDATA|bpt|ept|ph|it|hi|ut)*>",
	);
	const document = new DOMParser().parseFromString(xml, "application/xml");
	const result = validateTmxDocument(document);
	return { valid: result.valid, rawOutput: result.issues.join("\n") };
}

describe("TMX 1.4b interoperability", () => {
	it("imports multilingual Level 2 units, metadata, stable IDs, and source rules", async () => {
		const result = await importTmxStreaming(tmxFile(complexFixture));
		const memory = result.data;
		expect(memory).toMatchObject({
			id: 17,
			name: "Level 2 Memory",
			tmx: {
				version: "1.4",
				level: 2,
				headerAttributes: {
					creationtool: "FixtureCAT",
					srclang: "en-US",
				},
			},
		});
		expect(memory.tmx?.notes).toEqual([
			{ text: "Document note", language: "en" },
		]);
		expect(memory.tmx?.properties).toEqual(
			expect.arrayContaining([{ type: "x-domain", text: "software" }]),
		);
		expect(memory.tmx?.userDefinedEncodings[0]).toMatchObject({
			name: "PrivateUse",
			base: "Unicode",
			maps: [{ unicode: "#xF8FF", code: "#x01", subst: "[logo]" }],
		});

		const first = memory.terms[0];
		expect(first.tuid).toBe("alpha-001");
		expect(first.source.lang).toBe("en-US");
		expect(first.source.segment).toBe("Open file.");
		expect(first.target.map((variant) => variant.lang)).toEqual([
			"fr-FR",
			"de-DE",
		]);
		expect(first.tmx).toMatchObject({
			attributes: { usagecount: "7", changeid: "reviewer" },
			variantOrder: ["fr-FR", "en-US", "de-DE"],
		});
		expect(
			first.source.content?.fragments
				.filter((fragment) => fragment.kind === "code")
				.map((fragment) => fragment.codeType),
		).toEqual(["start", "end", "standalone"]);

		const languageNeutral = memory.terms[1];
		expect(languageNeutral.source).toMatchObject({
			lang: "ja",
			segment: "設定",
		});
		expect(languageNeutral.target.map((variant) => variant.lang)).toEqual([
			"en-US",
			"de-DE",
		]);
		expect(languageNeutral.source.content?.fragments[0]).toMatchObject({
			kind: "code",
			codeType: "standalone",
		});
	});

	it("round-trips edits without losing Level 2 codes or metadata", async () => {
		const imported = (await importTmxStreaming(tmxFile(complexFixture))).data;
		imported.terms[0].source.segment = "Open document.";
		const output = buildTmx14("en-US", imported);
		const validation = validateWithOfficialDtd(output);
		expect(validation.valid, validation.rawOutput).toBe(true);
		expect(output).toContain('<bpt i="1" x="1" type="bold">');
		expect(output).toContain('<ept i="1">');
		expect(output).toContain('<ph x="2" type="lb">');
		expect(output).toContain('tuid="alpha-001"');
		expect(output).toContain('type="x-project"');
		const restored = (await importTmxStreaming(tmxFile(output))).data;
		expect(restored.terms[0].source.segment).toBe("Open document.");
		expect(restored.terms[0].source.content?.fragments).toEqual(
			imported.terms[0].source.content?.fragments.map((fragment) =>
				fragment.kind === "text"
					? expect.objectContaining({ kind: "text" })
					: fragment,
			),
		);
		expect(restored.tmx?.headerAttributes).toEqual(
			imported.tmx?.headerAttributes,
		);
	});

	it("emits new Level 1 multilingual memories accepted by the official DTD", async () => {
		const output = buildTmx14("English (en-US)", {
			id: 4,
			name: "Multilingual & deterministic",
			terms: [
				{
					tuid: "stable-A1",
					source: { lang: "en-US", segment: "Save <file>" },
					target: [
						{ lang: "de-DE", segment: "Datei speichern" },
						{ lang: "fr-FR", segment: "Enregistrer le fichier" },
					],
				},
			],
		});
		const validation = validateWithOfficialDtd(output);
		expect(validation.valid, validation.rawOutput).toBe(true);
		expect(output).toContain('srclang="en-US"');
		expect(output).toContain('tuid="stable-A1"');
		expect(output).toContain("Save &lt;file&gt;");
	});

	it.each([
		["unbalanced inline pair", unbalancedFixture],
		["missing declared source", missingSourceFixture],
	])("rejects malformed %s input", async (_label, xml) => {
		await expect(importTmxStreaming(tmxFile(xml))).rejects.toMatchObject({
			code: "XML_MALFORMED",
		});
	});

	it("rejects metadata outside the vendored TMX 1.4 DTD grammar", async () => {
		const imported = (await importTmxStreaming(tmxFile(complexFixture))).data;
		imported.tmx!.headerAttributes["vendor-attribute"] = "unsafe";
		expect(() => buildTmx14("en-US", imported)).toThrow(
			/unsupported attribute/i,
		);
		const withForeignBodyElement = complexFixture.replace(
			"</body>",
			"<foreign/></body>",
		);
		const document = new DOMParser().parseFromString(
			withForeignBodyElement,
			"application/xml",
		);
		expect(validateTmxDocument(document)).toMatchObject({ valid: false });
	});

	it("allows only the known inert TMX DTD declaration and rejects entities", async () => {
		await expect(
			importTmxStreaming(tmxFile(complexFixture)),
		).resolves.toBeTruthy();
		const unsafe = complexFixture.replace(
			'<!DOCTYPE tmx SYSTEM "tmx14.dtd">',
			'<!DOCTYPE tmx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>',
		);
		await expect(importTmxStreaming(tmxFile(unsafe))).rejects.toMatchObject({
			code: "XML_UNSAFE_DECLARATION",
		});
	});

	it.each([
		["keep-first", 1, ["de"]],
		["keep-last", 1, ["fr"]],
		["merge-targets", 1, ["de", "fr"]],
		["keep-all", 2, ["de"]],
	] as Array<[TmxMergePolicy, number, string[]]>)(
		"applies the deterministic %s merge policy",
		(policy, count, targetLanguages) => {
			const first = {
				name: "First",
				terms: [
					{
						tuid: "first",
						source: { lang: "en", segment: "File" },
						target: [{ lang: "de", segment: "Datei" }],
					},
				],
			};
			const second = {
				name: "Second",
				terms: [
					{
						tuid: "second",
						source: { lang: "en", segment: "File" },
						target: [{ lang: "fr", segment: "Fichier" }],
					},
				],
			};
			const merged = mergeTmxData(first, second, { policy });
			expect(merged.terms).toHaveLength(count);
			expect(merged.terms[0].target.map((target) => target.lang)).toEqual(
				targetLanguages,
			);
			expect(first.terms[0].target).toEqual([{ lang: "de", segment: "Datei" }]);
		},
	);

	it("persists all TMX metadata through the translation-memory schema", async () => {
		const imported = (await importTmxStreaming(tmxFile(complexFixture))).data;
		const restored = migrateTmData(JSON.parse(JSON.stringify(imported)));
		expect(restored).toEqual(imported);
	});

	it("keeps multiple variants in the same target language", async () => {
		const xml = `<?xml version="1.0"?><tmx version="1.4"><header creationtool="variants" creationtoolversion="1" segtype="sentence" o-tmf="variants" adminlang="en" srclang="en" datatype="plaintext"/><body><tu tuid="alternatives"><tuv xml:lang="en"><seg>File</seg></tuv><tuv xml:lang="de"><seg>Datei</seg></tuv><tuv xml:lang="de"><seg>Akte</seg></tuv></tu></body></tmx>`;
		const imported = (await importTmxStreaming(tmxFile(xml))).data;
		expect(imported.terms[0].target.map((variant) => variant.segment)).toEqual([
			"Datei",
			"Akte",
		]);
		const output = buildTmx14("en", imported);
		expect(validateWithOfficialDtd(output).valid).toBe(true);
		expect(
			(await importTmxStreaming(tmxFile(output))).data.terms[0].target,
		).toHaveLength(2);
	});

	it("streams a large TMX with bounded record buffering", async () => {
		const count = 1_500;
		const units = Array.from(
			{ length: count },
			(_, index) =>
				`<tu tuid="bulk-${index}"><tuv xml:lang="en"><seg>Source ${index}</seg></tuv><tuv xml:lang="de"><seg>Ziel ${index}</seg></tuv><tuv xml:lang="fr"><seg>Cible ${index}</seg></tuv></tu>`,
		).join("");
		const xml = `<?xml version="1.0"?><tmx version="1.4"><header creationtool="bulk" creationtoolversion="1" segtype="sentence" o-tmf="bulk" adminlang="en" srclang="en" datatype="plaintext"/><body>${units}</body></tmx>`;
		const result = await importTmxStreaming(tmxFile(xml, "bulk.tmx"));
		expect(result.data.terms).toHaveLength(count);
		expect(result.metrics.recordCount).toBe(count);
		expect(result.metrics.maxBufferedChars).toBeLessThan(600_000);
		expect(result.metrics.yieldCount).toBeGreaterThan(0);
	});
});
