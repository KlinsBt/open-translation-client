import JSZip from "jszip";
import { maskKnownDitaDoctype } from "$lib/formats/dita";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getPackageSkeleton,
	getTextSkeletonContent,
	skeletonHasIdentityTargets,
	type PackageXmlValueReplacement,
	type XmlValueReplacement,
} from "$lib/formats/skeleton";
import { parseXmlSyntax } from "$lib/formats/xmlFamily";
import type { UserData } from "$lib/types/types";
import { encodeTextBytes } from "./outputGenerationText";

type DitaReplacement = PackageXmlValueReplacement | XmlValueReplacement;

function escapeXml(
	value: string,
	location: DitaReplacement["location"],
): string {
	if (location === "cdata") return value.replaceAll("]]>", "]]]]><![CDATA[>");
	return value.replace(/[&<>"']/g, (character) => {
		if (character === "&") return "&amp;";
		if (character === "<") return "&lt;";
		if (character === ">") return "&gt;";
		if (location !== "attribute") return character;
		return character === '"' ? "&quot;" : "&apos;";
	});
}

function validateMappings(
	replacements: readonly DitaReplacement[],
	targetCount: number,
): void {
	if (
		replacements.length !== targetCount ||
		new Set(replacements.map((replacement) => replacement.unitIndex)).size !==
			replacements.length ||
		replacements.some(
			(replacement) =>
				replacement.unitIndex < 0 || replacement.unitIndex >= targetCount,
		)
	)
		throw new Error(
			`DITA export cannot continue because ${replacements.length} mappings do not align uniquely with ${targetCount} targets.`,
		);
}

function applyDitaReplacements(
	content: string,
	replacements: readonly DitaReplacement[],
	targets: readonly string[],
): string {
	const groups = new Map<string, DitaReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.end > content.length)
			throw new Error(
				"A DITA mapping points outside its original XML document.",
			);
		const key = `${replacement.start}:${replacement.end}`;
		const group = groups.get(key) ?? [];
		group.push(replacement);
		groups.set(key, group);
	}
	const edits: Array<{ start: number; end: number; value: string }> = [];
	for (const group of groups.values()) {
		const ordered = group.sort(
			(first, second) => first.unitIndex - second.unitIndex,
		);
		let translated = "";
		for (const replacement of ordered) {
			const separator = replacement.separator ?? "";
			let value = targets[replacement.unitIndex] ?? "";
			if (separator && value.endsWith(separator))
				value = value.slice(0, -separator.length);
			translated += `${value}${separator}`;
		}
		const first = ordered[0];
		if (translated === first.originalValue) continue;
		edits.push({
			start: first.start,
			end: first.end,
			value: escapeXml(translated, first.location),
		});
	}
	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.value}${output.slice(edit.end)}`;
	parseXmlSyntax(maskKnownDitaDoctype(output));
	return output;
}

export async function buildDitaTranslationBlob(
	project: UserData,
): Promise<Blob> {
	assertProjectExportQuality(project);
	const data = project.translationData;
	if (data.skeleton?.payload.kind === "package") {
		const skeleton = getPackageSkeleton(data.skeleton, "dita");
		if (!skeleton)
			throw new Error(
				"DITA bundle export requires its original package skeleton.",
			);
		const replacements = skeleton.replacements.filter(
			(replacement): replacement is PackageXmlValueReplacement =>
				replacement.kind === "package-xml-value",
		);
		validateMappings(replacements, data.seg2.length);
		if (
			skeleton.source.originalFile &&
			skeletonHasIdentityTargets(data.seg1, data.seg2)
		)
			return skeleton.source.originalFile;
		const parts: Record<string, string | Blob> = { ...skeleton.payload.parts };
		const byPart = new Map<string, PackageXmlValueReplacement[]>();
		for (const replacement of replacements) {
			const entries = byPart.get(replacement.part) ?? [];
			entries.push(replacement);
			byPart.set(replacement.part, entries);
		}
		for (const [part, entries] of byPart) {
			const content = parts[part];
			if (typeof content !== "string")
				throw new Error(
					`DITA XML part ${part} is missing from the bundle skeleton.`,
				);
			parts[part] = applyDitaReplacements(content, entries, data.seg2);
		}
		const zip = skeleton.source.originalFile
			? await JSZip.loadAsync(await skeleton.source.originalFile.arrayBuffer())
			: new JSZip();
		for (const [path, content] of Object.entries(parts))
			if (
				!skeleton.source.originalFile ||
				content !== skeleton.payload.parts[path]
			)
				zip.file(path, content);
		return zip.generateAsync({
			type: "blob",
			mimeType: "application/zip",
			compression: "DEFLATE",
			compressionOptions: { level: 6 },
		});
	}
	const content = getTextSkeletonContent(data.skeleton, "dita");
	if (content === undefined)
		throw new Error(
			"DITA export requires its original positional XML skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is XmlValueReplacement =>
			replacement.kind === "xml-value",
	);
	validateMappings(replacements, data.seg2.length);
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const output = applyDitaReplacements(content, replacements, data.seg2);
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{ type: `application/dita+xml;charset=${encoding}` },
	);
}

export async function generateDitaTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"topic.dita";
	const packageOutput =
		project.translationData.skeleton?.payload.kind === "package";
	const name = packageOutput
		? /\.ditazip$/i.test(sourceName)
			? sourceName
			: `${sourceName}.ditazip`
		: /\.(?:dita|ditamap|bookmap)$/i.test(sourceName)
			? sourceName
			: `${sourceName}.dita`;
	const url = URL.createObjectURL(await buildDitaTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
