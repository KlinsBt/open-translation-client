import JSZip from "jszip";
import { ODF_MIME_TYPES, type OdfProfile } from "$lib/formats/odf";
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

function profileFromProject(project: UserData): OdfProfile {
	const profile = (project.translationData.typeRef as { profile?: string })
		?.profile;
	return profile === "ods" || profile === "odp" ? profile : "odt";
}

export async function buildOdfTranslationPackage(
	project: UserData,
): Promise<Blob> {
	assertProjectExportQuality(project);
	const data = project.translationData;
	const skeleton = getPackageSkeleton(data.skeleton, "odf");
	if (!skeleton)
		throw new Error("ODF export requires its original package skeleton.");
	if (
		skeleton.source.originalFile &&
		skeletonHasIdentityTargets(data.seg1, data.seg2)
	)
		return skeleton.source.originalFile;
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
			`ODF export cannot continue because ${replacements.length} mappings do not align uniquely with ${data.seg2.length} targets.`,
		);
	const parts: Record<string, string | Blob> = { ...skeleton.payload.parts };
	const byPart = new Map<string, PackageXmlValueReplacement[]>();
	for (const replacement of replacements) {
		const group = byPart.get(replacement.part) ?? [];
		group.push(replacement);
		byPart.set(replacement.part, group);
	}
	for (const [part, entries] of byPart) {
		const original = parts[part];
		if (typeof original !== "string")
			throw new Error(
				`ODF XML part ${part} is missing from the package skeleton.`,
			);
		let output = original;
		for (const replacement of [...entries].sort((a, b) => b.start - a.start)) {
			if (replacement.end > original.length)
				throw new Error(
					`ODF mapping for ${part} points outside the original XML part.`,
				);
			const translated = data.seg2[replacement.unitIndex] ?? "";
			if (translated === replacement.originalValue) continue;
			output = `${output.slice(0, replacement.start)}${escapeXml(translated, replacement.location)}${output.slice(replacement.end)}`;
		}
		parseXmlSyntax(output);
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
	const profile = profileFromProject(project);
	zip.file("mimetype", ODF_MIME_TYPES[profile], { compression: "STORE" });
	return zip.generateAsync({
		type: "blob",
		mimeType: ODF_MIME_TYPES[profile],
		compression: "DEFLATE",
		compressionOptions: { level: 6 },
	});
}

export async function generateOdfTranslation(project: UserData): Promise<void> {
	const profile = profileFromProject(project);
	const requested =
		project.translationData.name ||
		project.translationData.skeleton?.source.name ||
		`document.${profile}`;
	const name = new RegExp(`\\.${profile}$`, "i").test(requested)
		? requested
		: `${requested}.${profile}`;
	const url = URL.createObjectURL(await buildOdfTranslationPackage(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
