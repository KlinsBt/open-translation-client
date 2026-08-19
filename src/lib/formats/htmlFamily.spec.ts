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
	buildHtmlTranslationBlob,
	buildHtmlTranslation,
	getHtmlOutputFormat,
} from "$lib/functions/outputGeneration/outputGenerationHtml";
import { importHtmlFile, validateHtmlFile } from "./importers";
import { detectFormatWithConfidence } from "./registry";
import { decodeTextBytes } from "./safeInput";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { inspectOpaqueTemplateRanges } from "./serverHtml";

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

describe("FF-502 server-side and compiled-help HTML profiles", () => {
	const fixtures = [
		{
			extension: "shtml",
			profile: "shtml",
			source:
				'<!doctype html>\r\n<!--#include virtual="/nav.inc" -->\r\n<p>Welcome 世界</p>',
		},
		{
			extension: "jsp",
			profile: "jsp",
			source:
				'<%@ page contentType="text/html" %><p>Welcome ${user.name}</p><jsp:scriptlet>danger()</jsp:scriptlet>',
		},
		{
			extension: "asp",
			profile: "asp",
			source: '<% secret = Request("token") %><p>Welcome <%= secret %></p>',
		},
		{
			extension: "aspx",
			profile: "aspx",
			source:
				'<%@ Page Language="C#" %><script runat="server">throw new Error()</script><p>Welcome مرحبا</p>',
		},
		{
			extension: "ascx",
			profile: "ascx",
			source:
				'<%@ Control Language="C#" %><asp:Label runat="server" Text="Welcome" /><p>Account</p>',
		},
		{
			extension: "inc",
			profile: "inc",
			source: '<?php $secret = getenv("TOKEN"); ?><span>Welcome שלום</span>',
		},
		{
			extension: "php",
			profile: "php-template",
			source:
				'<?php $secret = "?> inside a string"; ?>\n<main title="Welcome">Visible مرحبا</main>',
		},
	] as const;

	it.each(fixtures)(
		"detects, imports, and retains executable regions for .$extension",
		async ({ extension, profile, source }) => {
			(globalThis as Record<string, unknown>).__ff502Executed = false;
			const file = new File([source], `page.${extension}`, { type: "" });
			await expect(validateHtmlFile(file)).resolves.toEqual({ valid: true });
			await expect(detectFormatWithConfidence(file)).resolves.toMatchObject({
				formatId: "html",
				supported: true,
			});
			const imported = await importHtmlFile(file, {
				translatableAttributes:
					extension === "ascx"
						? "placeholder,value,alt,title,text"
						: "placeholder,value,alt,title",
			});
			if (imported.kind !== "segments") throw new Error("Expected segments");
			expect(imported.typeRef).toMatchObject({
				profile,
				sourceExtension: extension,
			});
			expect(imported.segments.join(" ")).not.toMatch(
				/Request|secret|getenv|danger|throw new Error|contentType|Language="C#"/,
			);
			expect((globalThis as Record<string, unknown>).__ff502Executed).toBe(
				false,
			);

			const project = projectFromImport(imported);
			project.translationData.name = `translated.${extension}`;
			project.translationData.seg2 = imported.segments.map((segment) =>
				segment.replace(/Welcome|Visible|Account/g, "Translated"),
			);
			const output = buildHtmlTranslation(project);
			for (const protectedToken of source.match(
				/<%[\s\S]*?%>|<\?php[\s\S]*?\?>|\$\{[\s\S]*?\}|<script[\s\S]*?<\/script>/gi,
			) ?? [])
				expect(output).toContain(protectedToken);
			expect(
				getHtmlOutputFormat(file.name, file.type, extension),
			).toMatchObject({
				extension,
			});
		},
	);

	it.each(["hhc", "hhk"] as const)(
		"extracts display labels but protects local targets in .%s",
		async (extension) => {
			const source = `<!DOCTYPE HTML><UL><LI><OBJECT type="text/sitemap"><param name="Name" value="Welcome 世界"><param name="Local" value="topics/welcome.htm"><param name="ImageNumber" value="4"></OBJECT></LI></UL>`;
			const imported = await importHtmlFile(
				new File([source], `help.${extension}`, { type: "text/html" }),
			);
			if (imported.kind !== "segments") throw new Error("Expected segments");
			expect(imported.segments).toEqual(["Welcome 世界"]);
			const project = projectFromImport(imported);
			project.translationData.seg2 = ["Willkommen 世界"];
			expect(buildHtmlTranslation(project)).toBe(
				source.replace("Welcome 世界", "Willkommen 世界"),
			);
		},
	);

	it("keeps JSP/ASP/PHP/template expressions opaque under adversarial quoting and nesting", () => {
		const source = `<p>Hello ${"${user.format({ nested: '}' })}"} {{ formatter("}}") }} world</p><% if (x > 1) { %><b>Conditional</b><% } %><?php $x = "?>"; ?>`;
		expect(inspectOpaqueTemplateRanges(source, "jsp").ranges).toHaveLength(5);
		const parsed = segmentHtmlContent(source, [], { profile: "jsp" });
		expect(parsed.allSegments).toEqual(["Hello ", "world", "Conditional"]);
		const output = applyTranslationsToHtml(
			source,
			["Hallo ", "Welt", "Bedingt"],
			[],
			parsed.meta,
			{ profile: "jsp" },
		);
		expect(output).toContain("${user.format({ nested: '}' })}");
		expect(output).toContain('{{ formatter("}}") }}');
		expect(output).toContain("<% if (x > 1) { %>");
		expect(output).toContain('<?php $x = "?>"; ?>');
	});

	it("rejects extension-only impostors and malformed server/template blocks", async () => {
		await expect(
			validateHtmlFile(new File(["plain text only"], "fake.jsp")),
		).resolves.toMatchObject({ valid: false });
		await expect(
			validateHtmlFile(new File(["<% if (true) { <p>Hello</p>"], "broken.jsp")),
		).resolves.toMatchObject({
			valid: false,
			reason: expect.stringMatching(/not closed/i),
		});
		await expect(
			validateHtmlFile(new File(["<p>Hello ${user.name</p>"], "broken.jsp")),
		).resolves.toMatchObject({
			valid: false,
			reason: expect.stringMatching(/not closed/i),
		});
	});

	it("preserves UTF-16LE BOM and CRLF bytes for identity and translated JSP output", async () => {
		const source =
			'<%@ page contentType="text/html" %>\r\n<p>مرحبا 世界</p>\r\n';
		const bytes = encodeTextBytes(source, "utf-16le", true);
		const imported = await importHtmlFile(
			new File([bytes], "unicode.jsp", { type: "text/x-jsp" }),
		);
		const project = projectFromImport(imported);
		const identity = new Uint8Array(
			await buildHtmlTranslationBlob(project).arrayBuffer(),
		);
		expect(identity).toEqual(bytes);
		project.translationData.seg2 = ["שלום 🌍"];
		const translated = decodeTextBytes(
			new Uint8Array(await buildHtmlTranslationBlob(project).arrayBuffer()),
		);
		expect(translated).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(translated.text).toContain("\r\n<p>שלום 🌍</p>\r\n");
	});

	it("handles generated large JSP input deterministically and honors cancellation", async () => {
		const source = `<%@ page contentType="text/html" %>${Array.from(
			{ length: 1_500 },
			(_, index) => `<p>Row ${index} 世界 ${"${user.name}"}</p>`,
		).join("\n")}`;
		const file = new File([source], "large.jsp", { type: "text/x-jsp" });
		const imported = await importHtmlFile(file);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments).toHaveLength(1_500);
		expect(imported.segments[1_499]).toContain("Row 1499 世界");
		const controller = new AbortController();
		controller.abort();
		await expect(
			importHtmlFile(file, undefined, { signal: controller.signal }),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("reopens translated server HTML with an independent browser parser", async () => {
		const source =
			'<%@ Page Language="C#" %><main><h1>Welcome</h1><p>مرحبا 世界</p></main>';
		const imported = await importHtmlFile(new File([source], "page.aspx"));
		const project = projectFromImport(imported);
		project.translationData.seg2 = ["Willkommen", "שלום 世界"];
		const output = buildHtmlTranslation(project);
		const reopened = new DOMParser().parseFromString(output, "text/html");
		expect(reopened.querySelector("h1")?.textContent).toBe("Willkommen");
		expect(reopened.querySelector("p")?.textContent).toBe("שלום 世界");
		expect(output).toContain('<%@ Page Language="C#" %>');
	});
});
