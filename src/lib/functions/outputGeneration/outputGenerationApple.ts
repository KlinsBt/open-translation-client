import {
	detectAppleProfile,
	parseAppleStrings,
	parseAppleStringsdict,
	parseAppleXcstrings,
} from "$lib/formats/appleLocalization";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getTextSkeletonContent,
	type AppleValueReplacement,
} from "$lib/formats/skeleton";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

export function buildAppleLocalizationTranslation(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "apple");
	if (content === undefined)
		throw new Error(
			"Apple localization export requires its original positional skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is AppleValueReplacement =>
			replacement.kind === "apple-value",
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
			`Apple localization export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const replacement of replacements.filter(
		(replacement) => !replacement.insertionGroup,
	)) {
		const translated = data.seg2[replacement.unitIndex] ?? "";
		if (translated === replacement.originalValue) continue;
		edits.push({
			start: replacement.start,
			end: replacement.end,
			value: encodeAppleValue(translated, replacement.profile),
		});
	}
	const insertionGroups = new Map<string, AppleValueReplacement[]>();
	for (const replacement of replacements.filter(
		(replacement) => replacement.insertionGroup,
	)) {
		const group = insertionGroups.get(replacement.insertionGroup!) ?? [];
		group.push(replacement);
		insertionGroups.set(replacement.insertionGroup!, group);
	}
	for (const group of insertionGroups.values()) {
		if (
			group.every(
				(replacement) =>
					(data.seg2[replacement.unitIndex] ?? "") ===
					replacement.originalValue,
			)
		)
			continue;
		const first = group[0];
		if (
			first.insertionStart === undefined ||
			!first.targetLanguage ||
			group.some(
				(replacement) =>
					replacement.insertionStart !== first.insertionStart ||
					replacement.insertLocalizationsProperty !==
						first.insertLocalizationsProperty,
			)
		)
			throw new Error("Apple string-catalog insertion metadata is invalid.");
		const localization =
			first.sourceObjectStart !== undefined &&
			first.sourceObjectEnd !== undefined
				? (JSON.parse(
						content.slice(first.sourceObjectStart, first.sourceObjectEnd),
					) as Record<string, unknown>)
				: { stringUnit: { state: "new", value: first.key } };
		for (const replacement of group) {
			if (!replacement.relativePath)
				throw new Error("Apple string-catalog variation path is missing.");
			setCatalogValue(
				localization,
				replacement.relativePath,
				data.seg2[replacement.unitIndex] ?? "",
			);
		}
		let prior = first.insertionStart - 1;
		while (/\s/.test(content[prior] ?? "")) prior--;
		const comma = content[prior] === "{" ? "" : ",";
		const localizationMember = `${JSON.stringify(first.targetLanguage)}:${JSON.stringify(localization)}`;
		edits.push({
			start: first.insertionStart,
			end: first.insertionStart,
			value: first.insertLocalizationsProperty
				? `${comma}"localizations":{${localizationMember}}`
				: `${comma}${localizationMember}`,
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	const profile = replacements[0]?.profile ?? detectAppleProfile("", output);
	if (profile === "strings") parseAppleStrings(output);
	else if (profile === "stringsdict") parseAppleStringsdict(output);
	else
		parseAppleXcstrings(
			output,
			String(data.filterOptions?.sourceLanguage ?? ""),
			String(data.filterOptions?.targetLanguage ?? ""),
			true,
		);
	return output;
}

function setCatalogValue(
	root: Record<string, unknown>,
	path: string[],
	value: string,
): void {
	let current = root;
	for (const part of path.slice(0, -1)) {
		const next = current[part];
		if (!next || typeof next !== "object" || Array.isArray(next))
			current[part] = {};
		current = current[part] as Record<string, unknown>;
	}
	current[path.at(-1)!] = value;
	const stringUnitIndex = path.lastIndexOf("stringUnit");
	if (stringUnitIndex >= 0) {
		let unit = root;
		for (const part of path.slice(0, stringUnitIndex + 1))
			unit = unit[part] as Record<string, unknown>;
		unit.state = "translated";
	}
}

function encodeAppleValue(
	value: string,
	profile: AppleValueReplacement["profile"],
): string {
	if (profile === "xcstrings") return JSON.stringify(value);
	if (profile === "strings")
		return `"${value
			.replaceAll("\\", "\\\\")
			.replaceAll('"', '\\"')
			.replaceAll("\n", "\\n")
			.replaceAll("\r", "\\r")
			.replaceAll("\t", "\\t")}"`;
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export function buildAppleLocalizationTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const output = buildAppleLocalizationTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "apple");
	if (source === output && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(output, encoding, hasBom)], {
		type: data.skeleton?.source.mimeType || "text/plain",
	});
}

export async function generateAppleLocalizationTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.skeleton?.source.name ?? "Localizable.strings";
	const requested = project.translationData.name || sourceName;
	const sourceExtension = sourceName.toLowerCase().split(".").at(-1);
	const extension = ["strings", "stringsdict", "xcstrings"].includes(
		sourceExtension ?? "",
	)
		? sourceExtension!
		: "strings";
	const name = new RegExp(`\\.${extension}$`, "i").test(requested)
		? requested
		: `${requested}.${extension}`;
	const url = URL.createObjectURL(
		buildAppleLocalizationTranslationBlob(project),
	);
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
