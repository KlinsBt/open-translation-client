// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildLightweightMarkupTranslation,
	buildLightweightMarkupTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationMarkup";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	importLightweightMarkupFile,
	parseLightweightMarkup,
	validateLightweightMarkupFile,
} from "./lightweightMarkup";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	name: string,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], name, { type: "text/plain" });
	const result = await importLightweightMarkupFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected markup segments");
	return {
		result,
		project: makeUserData({
			type: "markup",
			name,
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

describe("Markdown and AsciiDoc source-range workflow", () => {
	it("extracts Markdown prose while protecting front matter, code, URLs, references, and inline syntax", async () => {
		const source = `---
title: Protected metadata
---
# Welcome

Read **the guide** at [our site](https://example.com/a_(b)) and \`code()\`.

| Name | Description |
| --- | --- |
| Tool | Useful app |

[ref]: https://example.com "Protected title"
<span class="x">Visible HTML text</span>
Hard break  

\`\`\`js
const secret = "not prose";
\`\`\`
`;
		const { result, project } = await importProject(source, "guide.md");
		expect(result.segments).toEqual([
			"Welcome",
			"Read",
			"the guide",
			"at",
			"our site",
			"and",
			".",
			"Name",
			"Description",
			"Tool",
			"Useful app",
			"Visible HTML text",
			"Hard break",
		]);
		expect(result.segments.join(" ")).not.toContain("Protected metadata");
		expect(result.segments.join(" ")).not.toContain("https://");
		project.translationData.seg2 = result.segments.map((value) =>
			value === "Welcome" ? "Willkommen" : value,
		);
		const output = buildLightweightMarkupTranslation(project);
		expect(output).toContain("# Willkommen");
		expect(output).toContain("[our site](https://example.com/a_(b))");
		expect(output).toContain('const secret = "not prose";');
		expect(output).toContain("Hard break  \n");
	});

	it("extracts AsciiDoc prose while protecting attributes, directives, blocks, macros, and table structure", async () => {
		const source = `= User Guide
:product: OpenTLC

TIP: Translate *this text* but keep {product}.
include::chapter.adoc[]
See link:https://example.com[the site].

|===
|Name |Description
|Tool |Useful app
|===

[source,js]
----
const secret = "not prose";
----
`;
		const { result, project } = await importProject(source, "guide.adoc");
		expect(result.filterOptions.profile).toBe("asciidoc");
		expect(result.segments).toEqual([
			"User Guide",
			"Translate",
			"this text",
			"but keep",
			".",
			"See",
			".",
			"Name",
			"Description",
			"Tool",
			"Useful app",
		]);
		project.translationData.seg2 = result.segments.map((value) =>
			value === "User Guide" ? "Benutzerhandbuch" : value,
		);
		const output = buildLightweightMarkupTranslation(project);
		expect(output).toContain("= Benutzerhandbuch");
		expect(output).toContain(":product: OpenTLC");
		expect(output).toContain("link:https://example.com[the site]");
		expect(output).toContain('const secret = "not prose";');
	});

	it("can conservatively protect lines containing embedded HTML", async () => {
		const result = await importLightweightMarkupFile(
			new File(["Before\n<div>Protected HTML</div>\nAfter"], "guide.md"),
			{ includeHtmlText: false },
		);
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Before", "After"]);
	});

	it("rejects unterminated front matter, code fences, protected blocks, and raw HTML", async () => {
		const invalid = [
			["---\ntitle: never closed", "bad.md"],
			["```js\ncode", "bad.md"],
			["----\ncode", "bad.adoc"],
			["<script>\ncode", "bad.md"],
		] as const;
		for (const [content, name] of invalid)
			await expect(
				validateLightweightMarkupFile(new File([content], name)),
			).resolves.toMatchObject({ valid: false, errorCode: "MARKUP_INVALID" });
	});

	it("preserves UTF-16 identity bytes and CRLF hard breaks", async () => {
		const bytes = encodeTextBytes("# Café\r\nLine two  \r\n", "utf-16be", true);
		const { project } = await importProject(bytes, "guide.markdown");
		expect(
			new Uint8Array(
				await buildLightweightMarkupTranslationBlob(project).arrayBuffer(),
			),
		).toEqual(bytes);
		project.translationData.seg2[0] = "Kaffee";
		const decoded = decodeTextBytes(
			new Uint8Array(
				await buildLightweightMarkupTranslationBlob(project).arrayBuffer(),
			),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16be", hasBom: true });
		expect(decoded.text).toContain("# Kaffee\r\nLine two  \r\n");
	});

	it("blocks new lines, placeholders, structural edits, and stale mappings", async () => {
		const { project } = await importProject("Hello {name}", "guide.md", {}, [
			"Hallo",
		]);
		expect(() => buildLightweightMarkupTranslation(project)).toThrow(
			/Export blocked/,
		);
		project.translationData.seg2 = ["Hallo {name}\nextra"];
		expect(() => buildLightweightMarkupTranslation(project)).toThrow(
			/cannot insert a line break/,
		);
		project.translationData.seg2 = ["Hallo {name}"];
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 4;
		expect(() => buildLightweightMarkupTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 prose lines deterministically", async () => {
		const source = Array.from(
			{ length: 1_000 },
			(_, index) => `Message ${index}`,
		).join("\n");
		const first = parseLightweightMarkup(source, "markdown");
		const second = parseLightweightMarkup(source, "markdown");
		expect(first.spans).toHaveLength(1_000);
		expect(second.spans).toEqual(first.spans);
	});
});
