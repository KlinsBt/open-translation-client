import { describe, expect, it } from "vitest";
import {
	isRtlLanguage,
	normalizedLanguageCode,
	textDirection,
} from "./languageDirection";

describe("language direction", () => {
	it("normalizes UI labels and locale variants", () => {
		expect(normalizedLanguageCode("Kurdish (ckb-IQ)")).toBe("ckb");
		expect(normalizedLanguageCode("zh_Hant")).toBe("zh");
	});

	it.each([
		"ar",
		"arc",
		"ckb",
		"dv",
		"fa",
		"he",
		"ku",
		"nqo",
		"ps",
		"sd",
		"syr",
		"ug",
		"ur",
		"yi",
	])("recognizes %s as right-to-left", (language) =>
		expect(isRtlLanguage(language)).toBe(true),
	);

	it.each(["en", "de", "ja", "ko", "zh-Hant"])(
		"keeps %s left-to-right",
		(language) => expect(isRtlLanguage(language)).toBe(false),
	);

	it("uses the first strong character for mixed segment direction", () => {
		expect(textDirection("日本語 ܫܠܡܐ", "rtl")).toBe("ltr");
		expect(textDirection("  ܫܠܡܐ English", "ltr")).toBe("rtl");
		expect(textDirection("…", "rtl")).toBe("rtl");
	});
});
