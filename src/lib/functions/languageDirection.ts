const RTL_LANGUAGE_CODES = new Set([
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
]);

export function normalizedLanguageCode(language: string): string {
	return (language.match(/\(([^)]+)\)\s*$/)?.[1] ?? language)
		.toLowerCase()
		.split(/[-_]/)[0];
}

export function isRtlLanguage(language: string): boolean {
	return RTL_LANGUAGE_CODES.has(normalizedLanguageCode(language));
}

const RTL_CHARACTER =
	/[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;

export function textDirection(
	value: string,
	fallback: "ltr" | "rtl" = "ltr",
): "ltr" | "rtl" {
	for (const character of value) {
		if (RTL_CHARACTER.test(character)) return "rtl";
		if (/[\p{L}\p{N}]/u.test(character)) return "ltr";
	}
	return fallback;
}
