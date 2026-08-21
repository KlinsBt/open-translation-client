import {
	parsePhpLocalization,
	type PhpStringLeaf,
} from "$lib/formats/phpLocalization";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type PhpValueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function encodePhpString(
	value: string,
	quote: PhpStringLeaf["quote"],
): string {
	if (quote === "'")
		return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
	return value
		.replaceAll("\\", "\\\\")
		.replaceAll("$", "\\$")
		.replaceAll('"', '\\"')
		.replaceAll("\n", "\\n")
		.replaceAll("\r", "\\r")
		.replaceAll("\t", "\\t")
		.replaceAll("\v", "\\v")
		.replaceAll("\f", "\\f")
		.replaceAll("\u001b", "\\e");
}

export function buildPhpTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "php");
	if (content === undefined)
		throw new Error(
			"PHP export requires its original positional text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is PhpValueReplacement =>
			replacement.kind === "php-value",
	);
	if (
		replacements.length !== data.seg2.length ||
		new Set(replacements.map((replacement) => replacement.unitIndex)).size !==
			replacements.length ||
		replacements.some(
			(replacement) =>
				replacement.unitIndex < 0 || replacement.unitIndex >= data.seg2.length,
		)
	)
		throw new Error(
			`PHP export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	let output = content;
	for (const replacement of [...replacements].sort(
		(a, b) => b.start - a.start,
	)) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		output = `${output.slice(0, replacement.start)}${encodePhpString(translated, replacement.quote)}${output.slice(replacement.end)}`;
	}
	parsePhpLocalization(output);
	return output;
}

export function buildPhpTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildPhpTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "php");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `application/x-httpd-php;charset=${encoding}` },
	);
}

export async function generatePhpTranslation(project: UserData): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"messages.php";
	const name = /\.php$/i.test(requested) ? requested : `${requested}.php`;
	const url = URL.createObjectURL(buildPhpTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
