import JSZip from "jszip";
import { IDML_MIME_TYPE } from "$lib/formats/idml";
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

type InDesignReplacement = PackageXmlValueReplacement | XmlValueReplacement;

function escapeXml(
	value: string,
	location: InDesignReplacement["location"],
): string {
	if (location === "cdata") return value.replaceAll("]]>", "]]]]><![CDATA[>");
	const escaped = value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
	return location === "attribute"
		? escaped.replaceAll('"', "&quot;").replaceAll("'", "&apos;")
		: escaped;
}

function validateMappings(
	replacements: readonly InDesignReplacement[],
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
			`IDML/ICML/INX export cannot continue because ${replacements.length} mappings do not align uniquely with ${targetCount} targets.`,
		);
}

function applyReplacements(
	content: string,
	replacements: readonly InDesignReplacement[],
	targets: readonly string[],
): string {
	const groups = new Map<string, InDesignReplacement[]>();
	for (const replacement of replacements) {
		if (replacement.end > content.length)
			throw new Error(
				"An IDML/ICML mapping points outside its original XML part.",
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
	parseXmlSyntax(output);
	return output;
}

export async function buildInDesignTranslationBlob(
	project: UserData,
): Promise<Blob> {
	assertProjectExportQuality(project);
	const data = project.translationData;
	if (data.skeleton?.payload.kind === "package") {
		const skeleton = getPackageSkeleton(data.skeleton, "idml");
		if (!skeleton)
			throw new Error("IDML export requires its original package skeleton.");
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
					`IDML story ${part} is missing from its package skeleton.`,
				);
			parts[part] = applyReplacements(content, entries, data.seg2);
		}
		const zip = skeleton.source.originalFile
			? await JSZip.loadAsync(await skeleton.source.originalFile.arrayBuffer())
			: new JSZip();
		for (const [path, content] of Object.entries(parts)) {
			if (path === "mimetype") continue;
			if (
				!skeleton.source.originalFile ||
				content !== skeleton.payload.parts[path]
			)
				zip.file(path, content);
		}
		zip.file("mimetype", IDML_MIME_TYPE, { compression: "STORE" });
		return zip.generateAsync({
			type: "blob",
			mimeType: IDML_MIME_TYPE,
			compression: "DEFLATE",
			compressionOptions: { level: 6 },
		});
	}
	const content = getTextSkeletonContent(data.skeleton, "idml");
	if (content === undefined)
		throw new Error(
			"ICML/INX export requires its original positional XML skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is XmlValueReplacement =>
			replacement.kind === "xml-value",
	);
	validateMappings(replacements, data.seg2.length);
	const output = applyReplacements(content, replacements, data.seg2);
	if (
		data.skeleton?.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const inx =
		typeof data.typeRef === "object" && data.typeRef.profile === "inx";
	return new Blob(
		[encodeTextBytes(output, encoding, data.skeleton?.source.hasBom ?? false)],
		{
			type: inx
				? `application/xml;charset=${encoding}`
				: `application/vnd.adobe.incopy-icml;charset=${encoding}`,
		},
	);
}

export async function generateInDesignTranslation(
	project: UserData,
): Promise<void> {
	const sourceName =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"story.icml";
	const packageOutput =
		project.translationData.skeleton?.payload.kind === "package";
	const name = packageOutput
		? /\.idml$/i.test(sourceName)
			? sourceName
			: `${sourceName}.idml`
		: /\.(?:icml|inx)$/i.test(sourceName)
			? sourceName
			: `${sourceName}.icml`;
	const url = URL.createObjectURL(await buildInDesignTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
