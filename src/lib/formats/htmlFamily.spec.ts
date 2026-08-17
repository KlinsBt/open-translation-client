// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { makeUserData } from "../../test/fixtures";
import {
	combineSegmentData,
	splitSegmentData,
} from "$lib/functions/parsing/segmentationLogic";
import {
	applyTranslationsToHtml,
	segmentHtmlContent,
	type HtmlMeta,
} from "$lib/functions/parsing/parsingHtml";
import {
	buildHtmlTranslation,
	getHtmlOutputFormat,
} from "$lib/functions/outputGeneration/outputGenerationHtml";
import { importHtmlFile, validateHtmlFile } from "./importers";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

function projectFromImport(result: Awaited<ReturnType<typeof importHtmlFile>>) {
	if (result.kind !== "segments") throw new Error("Expected HTML segments");
	return makeUserData({
		type: "html",
		typeRef: result.typeRef!,
		seg1: result.segments,
		seg2: [...result.segments],
		checked: result.segments.map(() => false),
		segmentsMeta: result.segmentsMeta,
		documentModel: result.document,
		skeleton: result.skeleton,
		filterOptions: result.filterOptions,
	});
}

describe("loss-minimizing HTML extraction", () => {
	it("patches only the selected raw range and retains lexical markup", () => {
		const source =
			"<!DOCTYPE HTML>\n<HTML lang=en><BODY><!-- keep --><P title='Tom &amp; Jerry'>  Tom&nbsp;&amp; <EM data-x=1>Jerry</EM>!  </P><BR/></BODY></HTML>";
		const parsed = segmentHtmlContent(source, []);
		expect(parsed.allSegments).toEqual([
			"Tom & Jerry",
			"Tom & ",
			"Jerry",
			"!  ",
		]);
		const targets = [...parsed.allSegments];
		targets[2] = "Jérôme";
		const output = applyTranslationsToHtml(source, targets, [], parsed.meta);
		expect(output).toBe(source.replace(">Jerry</EM>", ">Jérôme</EM>"));
	});

	it("decodes entities for translators and escapes changed quoted and unquoted attributes", () => {
		const source = `<input title='A &amp; B' placeholder=YourName>`;
		const parsed = segmentHtmlContent(source, []);
		expect(parsed.allSegments).toEqual(["A & B", "YourName"]);
		const output = applyTranslationsToHtml(
			source,
			['C " D & E', "Your name=now"],
			[],
			parsed.meta,
		);
		expect(output).toBe(
			`<input title='C " D &amp; E' placeholder=Your&#32;name&#61;now>`,
		);
	});

	it("preserves whitespace, inline tags, comments, and raw script/style content", () => {
		const source = `<p>  Hello <strong>world</strong>!  </p><!-- note --><script>const x = "Hello";</script><style>.x{content:"world"}</style>`;
		const parsed = segmentHtmlContent(source, []);
		expect(parsed.allSegments).toEqual(["Hello ", "world", "!  "]);
		const output = applyTranslationsToHtml(
			source,
			["Hallo ", "Welt", "!  "],
			[],
			parsed.meta,
		);
		expect(output).toBe(
			`<p>  Hallo <strong>Welt</strong>!  </p><!-- note --><script>const x = "Hello";</script><style>.x{content:"world"}</style>`,
		);
	});

	it("honors inherited HTML and local ITS translate metadata with explicit overrides", () => {
		const source = `<div translate=no title="Protected">Hidden <span translate=yes title="Allowed">Visible</span></div><p its:translate="no">ITS hidden</p><p>Normal</p>`;
		expect(segmentHtmlContent(source, []).allSegments).toEqual([
			"Allowed",
			"Visible",
			"Normal",
		]);
		expect(
			segmentHtmlContent(source, [], { respectTranslateMetadata: false })
				.allSegments,
		).toEqual([
			"Protected",
			"Hidden ",
			"Allowed",
			"Visible",
			"ITS hidden",
			"Normal",
		]);
	});

	it("applies common inline ITS global translate rules without extracting the rules script", () => {
		const source = `<html><head><script type="application/its+xml"><its:rules version="2.0" xmlns:its="http://www.w3.org/2005/11/its" xmlns:h="http://www.w3.org/1999/xhtml"><its:translateRule selector="//h:span[@class='brand']" translate="no"/></its:rules></script></head><body><p>Keep <span class="brand">Open TLC</span> visible.</p></body></html>`;
		expect(segmentHtmlContent(source, []).allSegments).toEqual([
			"Keep ",
			"visible.",
		]);
	});

	it("protects script and style unconditionally and makes code exclusion configurable", () => {
		const source = `<script translate=yes>unsafe()</script><style translate=yes>.x{}</style><code>API_KEY</code><p>Visible</p>`;
		expect(segmentHtmlContent(source, []).allSegments).toEqual(["Visible"]);
		expect(
			segmentHtmlContent(source, [], { excludedElements: [] }).allSegments,
		).toEqual(["API_KEY", "Visible"]);
	});

	it("recovers optional paragraph endings without leaking translate=no state", () => {
		const source = `<p>One<p translate=no>Two<p>Three`;
		expect(segmentHtmlContent(source, []).allSegments).toEqual([
			"One",
			"Three",
		]);
	});

	it("treats malformed literal less-than text as content without normalizing it", () => {
		const source = `<p>2 < 3 &amp; 4</p>`;
		const parsed = segmentHtmlContent(source, []);
		expect(parsed.allSegments).toEqual(["2 ", "< 3 & 4"]);
		expect(
			applyTranslationsToHtml(source, parsed.allSegments, [], parsed.meta),
		).toBe(source);
	});

	it("keeps raw range, prefix, and suffix metadata aligned through split and join", () => {
		const source = `<p>  Hello world.  </p>`;
		const parsed = segmentHtmlContent(source, []);
		const data = makeUserData({
			type: "html",
			typeRef: source,
			seg1: parsed.allSegments,
			seg2: [...parsed.allSegments],
			checked: [false],
			segmentsMeta: parsed.meta,
		}).translationData;
		const split = splitSegmentData(data, 0, 5);
		expect(split.error).toBeUndefined();
		split.data.seg2 = ["Hallo", " Welt.  "];
		expect(
			applyTranslationsToHtml(
				source,
				split.data.seg2,
				[],
				split.data.segmentsMeta as HtmlMeta[],
			),
		).toBe(`<p>  Hallo Welt.  </p>`);
		const joined = combineSegmentData(split.data, 0);
		expect(joined.error).toBeUndefined();
		expect(
			applyTranslationsToHtml(
				source,
				joined.data.seg2,
				[],
				joined.data.segmentsMeta as HtmlMeta[],
			),
		).toBe(`<p>  Hallo Welt.  </p>`);
	});
});

describe("HTML/XHTML import and validation", () => {
	it("retains HTML, HTM, and XHTML output families", () => {
		expect(getHtmlOutputFormat("page.html")).toEqual({
			extension: "html",
			mimeType: "text/html",
		});
		expect(getHtmlOutputFormat("legacy.HTM")).toEqual({
			extension: "htm",
			mimeType: "text/html",
		});
		expect(getHtmlOutputFormat("page", "application/xhtml+xml")).toEqual({
			extension: "xhtml",
			mimeType: "application/xhtml+xml",
		});
	});
	it("attaches inherited language, direction, and ITS localization notes", async () => {
		const source = `<html lang="ar" dir="rtl"><body><p its-loc-note="Greeting shown on home page">مرحبا</p></body></html>`;
		const result = await importHtmlFile(
			new File([source], "page.html", { type: "text/html" }),
		);
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.document.units[0]).toMatchObject({
			source: { language: "ar", direction: "rtl" },
			contexts: [
				{ type: "html-language", value: "ar" },
				{ type: "html-direction", value: "rtl" },
			],
			notes: [
				{
					category: "its-localization-note",
					text: "Greeting shown on home page",
				},
			],
		});
	});

	it("accepts well-formed XHTML with the HTML5 doctype and rejects malformed XHTML", async () => {
		const valid = new File(
			[
				`<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hello &amp; welcome.</p></body></html>`,
			],
			"page.xhtml",
			{ type: "application/xhtml+xml" },
		);
		await expect(validateHtmlFile(valid)).resolves.toEqual({ valid: true });
		const result = await importHtmlFile(valid);
		expect(result).toMatchObject({
			kind: "segments",
			segments: ["Hello & welcome."],
		});
		const project = projectFromImport(result);
		project.translationData.seg2 = ["Hallo & willkommen."];
		const translated = buildHtmlTranslation(project);
		expect(translated).toContain("<!DOCTYPE html>");
		expect(translated).toContain("Hallo &amp; willkommen.");
		await expect(
			validateHtmlFile(
				new File([translated], "translated.xhtml", {
					type: "application/xhtml+xml",
				}),
			),
		).resolves.toEqual({ valid: true });
		await expect(
			validateHtmlFile(
				new File(["<html><body><p>Broken</body></html>"], "broken.xhtml", {
					type: "application/xhtml+xml",
				}),
			),
		).resolves.toMatchObject({ valid: false });
	});

	it("accepts malformed but recoverable HTML while preserving its source syntax", async () => {
		const source = `<P class=test>One<P>Two &amp; three`;
		const file = new File([source], "fragment.html", { type: "text/html" });
		await expect(validateHtmlFile(file)).resolves.toEqual({ valid: true });
		const project = projectFromImport(await importHtmlFile(file));
		project.translationData.seg2[1] = "Zwei & drei";
		expect(buildHtmlTranslation(project)).toBe(
			`<P class=test>One<P>Zwei &amp; drei`,
		);
	});

	it("translates a real repository fixture without changing its script or surrounding bytes", async () => {
		const source = await readFile(
			"Test files/html_test_file_with_css_and_js.html",
			"utf8",
		);
		const result = await importHtmlFile(
			new File([source], "fixture.html", { type: "text/html" }),
		);
		const project = projectFromImport(result);
		const index = project.translationData.seg1.findIndex((entry) =>
			entry.includes("Contact Us"),
		);
		expect(index).toBeGreaterThanOrEqual(0);
		project.translationData.seg2[index] = "Kontakt";
		const output = buildHtmlTranslation(project);
		expect(output).toBe(source.replace("Contact Us", "Kontakt"));
		expect(output).toContain(
			`alert("Thank you for contacting us! We will get back to you soon.");`,
		);
	});
});
