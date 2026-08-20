import { buildTmx14 } from "$lib/formats/tmx14";
import type { TmData } from "$lib/types/types";

export function buildTmx(sourceLanguage: string, tm: TmData): string {
	return buildTmx14(sourceLanguage, tm);
}

async function downloadTmx(tmx: string, name: string): Promise<void> {
	const blob = new Blob([tmx], { type: "application/x-tmx+xml" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = `${name}.tmx`;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export async function generateTmxSaveFile(
	sourceLanguage: string,
	tmData: TmData,
): Promise<void> {
	await downloadTmx(
		buildTmx(sourceLanguage, tmData),
		tmData.name || "TMX Save File",
	);
}

export async function generateRandomTmxFile(count: number): Promise<void> {
	const languages = ["de", "es"];
	const words = ["apple", "tree", "car", "house", "river", "sun", "moon"];
	const sentence = () =>
		Array.from(
			{ length: Math.floor(Math.random() * 7) + 3 },
			() => words[Math.floor(Math.random() * words.length)],
		).join(" ");
	await generateTmxSaveFile("en", {
		name: "RandomTMX",
		terms: Array.from({ length: count }, (_, index) => ({
			tuid: `unit-${index + 1}`,
			source: { lang: "en", segment: sentence() },
			target: languages.map((lang) => ({ lang, segment: sentence() })),
		})),
	});
}
