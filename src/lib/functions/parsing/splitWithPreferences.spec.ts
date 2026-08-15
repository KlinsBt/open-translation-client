import { describe, expect, it } from "vitest";
import { splitTextWithPreferences } from "./splitWithPreferences";

describe("splitTextWithPreferences", () => {
	it("keeps punctuation and whitespace as a separator", () => {
		expect(splitTextWithPreferences("Hello. Next!", [])).toEqual([
			{ text: "Hello", start: 0, end: 7, separator: ". " },
			{ text: "Next", start: 7, end: 12, separator: "!" },
		]);
	});

	it("honors custom multi-character tokens before shorter defaults", () => {
		expect(splitTextWithPreferences("One. Two", [". "])).toEqual([
			{ text: "One", start: 0, end: 5, separator: ". " },
			{ text: "Two", start: 5, end: 8, separator: "" },
		]);
	});

	it("escapes regex characters in custom tokens", () => {
		const pieces = splitTextWithPreferences("left||right", ["||"]);
		expect(pieces.map((piece) => piece.text)).toEqual(["left", "right"]);
		expect(pieces[0].separator).toBe("||");
	});

	it("ignores empty tokens without creating zero-length matches", () => {
		expect(splitTextWithPreferences("plain text", [""])).toEqual([
			{ text: "plain text", start: 0, end: 10, separator: "" },
		]);
	});

	it("returns an empty segment safely for empty input", () => {
		expect(splitTextWithPreferences("", [])).toEqual([
			{ text: "", start: 0, end: 0, separator: "" },
		]);
	});
});
