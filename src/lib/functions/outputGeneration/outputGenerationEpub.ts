import JSZip from "jszip";
import { EPUB_MIME_TYPE, maskKnownEpubDoctype } from "$lib/formats/epub";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import {
	getPackageSkeleton,
	skeletonHasIdentityTargets,
	type PackageXmlValueReplacement,
} from "$lib/formats/skeleton";
import { parseXmlSyntax } from "$lib/formats/xmlFamily";
import type { UserData } from "$lib/types/types";

function escapeXml(
	value: string,
	location: PackageXmlValueReplacement["location"],
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

function reparseEpubPart(content: string, profile: string): void {
	if (profile === "epub-xhtml")
		parseXmlSyntax(maskKnownEpubDoctype(content, "xhtml"));
	else if (profile === "epub-ncx")
		parseXmlSyntax(maskKnownEpubDoctype(content, "ncx"));
	else parseXmlSyntax(content);
}

export async function buildEpubTranslationPackage(
	project: UserData,
): Promise<Blob> {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const skeleton = getPackageSkeleton(data.skeleton, "epub");
	if (!skeleton)
		throw new Error("EPUB export requires its original package skeleton.");
	const replacements = skeleton.replacements.filter(
		(replacement): replacement is PackageXmlValueReplacement =>
			replacement.kind === "package-xml-value",
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
			`EPUB export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
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
		const original = parts[part];
		if (typeof original !== "string")
			throw new Error(
				`EPUB XML part ${part} is missing from the package skeleton.`,
			);
		let output = original;
		for (const replacement of [...entries].sort((a, b) => b.start - a.start)) {
			if (replacement.end > original.length)
				throw new Error(
					`EPUB mapping for ${part} points outside the original XML part.`,
				);
			const translated = data.seg2[replacement.unitIndex] ?? "";
			if (translated === replacement.originalValue) continue;
			output = `${output.slice(0, replacement.start)}${escapeXml(translated, replacement.location)}${output.slice(replacement.end)}`;
		}
		reparseEpubPart(output, entries[0].profile);
		parts[part] = output;
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
	zip.file("mimetype", EPUB_MIME_TYPE, { compression: "STORE" });
	return zip.generateAsync({
		type: "blob",
		mimeType: EPUB_MIME_TYPE,
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});
}

export async function generateEpubTranslation(
	project: UserData,
): Promise<void> {
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		"book.epub";
	const name = /\.epub$/i.test(requested) ? requested : `${requested}.epub`;
	const url = URL.createObjectURL(await buildEpubTranslationPackage(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
