// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildDocBookTranslation,
	buildDocBookTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationDocBook";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { importDocBookFile, validateDocBookFile } from "./docbook";
import { decodeTextBytes } from "./safeInput";
import type { FormatOptionValues } from "./types";

const XMLLINT_AVAILABLE =
	spawnSync("xmllint", ["--version"], { timeout: 5_000 }).status === 0;

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "manual.dbk", {
		type: "application/docbook+xml",
	});
	const result = await importDocBookFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected DocBook segments");
	return {
		result,
		project: makeUserData({
			type: "docbook",
			name: "manual.dbk",
			seg1: result.segments,
			seg2: targets ?? [...result.segments],
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("DocBook 4/5 workflow", () => {
	it("supports fixed DocBook 4 doctypes and safe named entities without resolving external DTDs", async () => {
		const source = `<?xml version="1.0"?>
<!DOCTYPE book PUBLIC "-//OASIS//DTD DocBook XML V4.5//EN" "http://www.oasis-open.org/docbook/xml/4.5/docbookx.dtd">
<book id="manual"><bookinfo><title>Guide &mdash; Edition</title></bookinfo><chapter id="intro"><title>Introduction</title><para>Hello <emphasis>world</emphasis>.</para></chapter></book>`;
		const { result, project } = await importProject(source);
		expect(result.document.metadata).toMatchObject({ profile: "DocBook 4" });
		expect(result.segments).toEqual([
			"Guide — Edition",
			"Introduction",
			"Hello",
			"world",
			".",
		]);
		project.translationData.seg2 = [
			"Handbuch — Ausgabe",
			"Einführung",
			"Hallo",
			"Welt",
			"!",
		];
		const output = buildDocBookTranslation(project);
		expect(output).toContain("<!DOCTYPE book PUBLIC");
		expect(output).toContain('<chapter id="intro">');
		expect(output).toContain("<para>Hallo <emphasis>Welt</emphasis>!</para>");
	});

	it("validates DocBook 5 namespaces, IDs/xrefs, schema declarations, and extension preservation", async () => {
		const source = `<book xmlns="http://docbook.org/ns/docbook" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:ext="urn:example" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" version="5.2" xsi:schemaLocation="http://docbook.org/ns/docbook https://docbook.org/xml/5.2/xsd/docbook.xsd" xml:id="book"><title>Guide</title><chapter xml:id="intro"><title>Intro</title><para>See <xref linkend="details"/>.</para><section xml:id="details"><title>Details</title><ext:widget ext:mode="keep"><para>Extension text</para></ext:widget></section></chapter></book>`;
		const { result, project } = await importProject(source);
		expect(result.document.metadata).toMatchObject({
			profile: "DocBook 5",
			ids: 3,
		});
		project.translationData.seg2 = result.segments.map((value) =>
			value === "Extension text" ? "Erweiterungstext" : value,
		);
		const output = buildDocBookTranslation(project);
		expect(output).toContain('xref linkend="details"');
		expect(output).toContain('<ext:widget ext:mode="keep">');
		expect(output).toContain("Erweiterungstext");
		await expect(
			validateDocBookFile(new File([output], "manual.dbk")),
		).resolves.toEqual({ valid: true });
	});

	it("applies metadata, code, index, attribute, and translate controls", async () => {
		const source = `<article xmlns="http://docbook.org/ns/docbook" version="5.0"><info><title>Metadata title</title><author><personname>Writer</personname></author></info><title>Main title</title><para translate="no">Locked</para><para>Open</para><programlisting>const code = true;</programlisting><indexterm><primary>Index word</primary></indexterm><mediaobject><textobject title="Accessible title"><phrase>Alternative</phrase></textobject></mediaobject></article>`;
		const defaults = await importDocBookFile(new File([source], "article.dbk"));
		const expanded = await importDocBookFile(
			new File([source], "article.dbk"),
			{
				includeMetadata: false,
				includeCode: true,
				includeIndexTerms: true,
				respectTranslateMetadata: false,
				attributeSelectors: "title",
			},
		);
		if (defaults.kind !== "segments" || expanded.kind !== "segments")
			throw new Error("Expected DocBook segments");
		expect(defaults.segments).toEqual([
			"Metadata title",
			"Writer",
			"Main title",
			"Open",
			"Accessible title",
			"Alternative",
		]);
		expect(expanded.segments).toEqual([
			"Main title",
			"Locked",
			"Open",
			"const code = true;",
			"Index word",
			"Accessible title",
			"Alternative",
		]);
	});

	it("rejects unresolved xrefs, duplicate IDs, version/schema conflicts, unknown entities, and unsafe doctypes", async () => {
		const invalid = [
			'<book xmlns="http://docbook.org/ns/docbook" version="5.0" xml:id="b"><xref linkend="missing"/></book>',
			'<book xmlns="http://docbook.org/ns/docbook" xmlns:xlink="http://www.w3.org/1999/xlink" xml:id="b"><link xlink:href="#missing">link</link></book>',
			'<book xmlns="http://docbook.org/ns/docbook" xml:id="same"><chapter xml:id="same"/></book>',
			'<book xmlns="http://docbook.org/ns/docbook" version="4.5"/>',
			'<book xmlns="http://docbook.org/ns/docbook" version="5.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:wrong wrong.xsd"/>',
			'<book xmlns="http://docbook.org/ns/docbook"><title>&password;</title></book>',
			'<!DOCTYPE book [<!ENTITY x SYSTEM "file:///etc/passwd">]><book><title>&x;</title></book>',
			'<!DOCTYPE book SYSTEM "evil.dtd"><book/>',
			"<html><p>Not DocBook</p></html>",
		];
		for (const content of invalid)
			await expect(
				validateDocBookFile(new File([content], "bad.dbk")),
			).resolves.toMatchObject({
				valid: false,
			});
	});

	it("preserves UTF-16 identity bytes and XML-escapes translated values", async () => {
		const bytes = encodeTextBytes(
			'<article xmlns="http://docbook.org/ns/docbook"><title>Café</title></article>',
			"utf-16be",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(await buildDocBookTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ['Tea & <"coffee">'];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildDocBookTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16be", hasBom: true });
		expect(decoded.text).toContain('Tea &amp; &lt;"coffee"&gt;');
	});

	it("round-trips sentence segmentation without duplication", async () => {
		const { result, project } = await importProject(
			'<article xmlns="http://docbook.org/ns/docbook"><para>First sentence. Second sentence.</para></article>',
			{ segmentationMode: "sentences" },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = buildDocBookTranslation(project);
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
	});

	it("blocks placeholder loss, structural edits, and stale mappings", async () => {
		const { project } = await importProject(
			'<article xmlns="http://docbook.org/ns/docbook"><title>Hello {name}</title></article>',
			{},
			["Hallo"],
		);
		expect(() => buildDocBookTranslation(project)).toThrow(/Export blocked/);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		project.translationData.seg2 = ["Hallo {name}"];
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 8;
		expect(() => buildDocBookTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it.skipIf(!XMLLINT_AVAILABLE)(
		"imports 1,000 paragraphs deterministically and passes independent XML validation",
		async () => {
			const source = `<book xmlns="http://docbook.org/ns/docbook" version="5.2"><title>Large</title><chapter xml:id="chapter"><title>Chapter</title>${Array.from(
				{ length: 1_000 },
				(_, index) => `<para xml:id="p${index}">Message ${index}</para>`,
			).join("")}</chapter></book>`;
			const first = await importDocBookFile(new File([source], "large.dbk"));
			const second = await importDocBookFile(new File([source], "large.dbk"));
			if (first.kind !== "segments" || second.kind !== "segments")
				throw new Error("Expected DocBook segments");
			expect(first.segments).toHaveLength(1_002);
			expect(second.segmentsMeta).toEqual(first.segmentsMeta);
			const { project } = await importProject(source);
			const directory = mkdtempSync(join(tmpdir(), "opentlc-docbook-"));
			try {
				const path = join(directory, "translated.dbk");
				writeFileSync(path, buildDocBookTranslation(project));
				const checked = spawnSync("xmllint", ["--noout", "--nonet", path], {
					encoding: "utf8",
					timeout: 5_000,
				});
				expect(checked.status, checked.stderr).toBe(0);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
