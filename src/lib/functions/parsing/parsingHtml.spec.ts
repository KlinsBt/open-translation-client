// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { applyTranslationsToHtml, segmentHtmlContent } from "./parsingHtml";

const html = `<!doctype html><html><body>
<p>Hello. Next!</p>
<script>window.message = "Do not translate.";</script>
<style>.label::after { content: "Keep."; }</style>
<input placeholder="Your name. Required!" title="Input title">
</body></html>`;

describe("HTML parsing and reconstruction", () => {
	it("segments visible text and translatable attributes only", () => {
		const result = segmentHtmlContent(html, [".", "!"]);
		expect(result.allSegments).toEqual([
			"Hello. ",
			"Next!",
			"Your name. ",
			"Required!",
			"Input title",
		]);
		expect(result.meta).toHaveLength(result.allSegments.length);
	});

	it("reconstructs translated HTML while preserving script and style content", () => {
		const segmented = segmentHtmlContent(html, [".", "!"]);
		const output = applyTranslationsToHtml(
			html,
			["Hallo. ", "Weiter!", "Ihr Name. ", "Erforderlich!", "Eingabe"],
			[".", "!"],
			segmented.meta,
		);

		const doc = new DOMParser().parseFromString(output, "text/html");
		expect(doc.querySelector("p")?.textContent).toBe("Hallo. Weiter!");
		expect(doc.querySelector("input")?.getAttribute("placeholder")).toBe(
			"Ihr Name. Erforderlich!",
		);
		expect(doc.querySelector("input")?.getAttribute("title")).toBe("Eingabe");
		expect(doc.querySelector("script")?.textContent).toContain(
			"Do not translate",
		);
		expect(doc.querySelector("style")?.textContent).toContain("Keep.");
	});
});
