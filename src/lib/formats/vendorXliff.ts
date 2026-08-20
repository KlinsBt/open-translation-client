import type { UserData } from "$lib/types/types";
import { contentToPlainText, type SegmentContent } from "./documentModel";
import { migrateProjectData } from "./persistenceMigrations";
import { buildXliff12PreservingDocument, validateXliff12Xml } from "./xliff12";
import {
	buildXliff2PreservingDocument,
	type Xliff2Version,
	validateXliff2Xml,
} from "./xliff2";
import {
	detectXliffVendorProfile,
	getXliffVendorProfile,
	type XliffVendorProfile,
} from "./xliffProfiles";

export interface VendorXliffOutput {
	contents: string;
	extension: string;
	fileName: string;
	mimeType: "application/xliff+xml";
	profile: XliffVendorProfile;
}

export class VendorXliffExportError extends Error {
	readonly name = "VendorXliffExportError";
}

export function buildVendorXliff(userData: UserData): VendorXliffOutput {
	const project = migrateProjectData(userData);
	const data = project.translationData;
	const document = data.documentModel;
	const profile = getXliffVendorProfile(document);
	if (!document || !profile)
		throw new VendorXliffExportError(
			"This project has no recognized vendor XLIFF profile. Use a generic XLIFF export instead.",
		);
	if (document.units.length !== data.seg1.length)
		throw new VendorXliffExportError(
			"The vendor XLIFF unit model no longer matches the project segment count.",
		);

	for (const [index, unit] of document.units.entries()) {
		if (editableText(unit.source) !== (data.seg1[index] ?? ""))
			throw new VendorXliffExportError(
				`Source segment ${index + 1} was changed. Same-profile XLIFF export only writes target translations.`,
			);
		const unitProfile = unit.metadata?.xliffProfile as
			| { locked?: boolean }
			| undefined;
		if (
			unitProfile?.locked &&
			editableText(unit.target) !== (data.seg2[index] ?? "")
		)
			throw new VendorXliffExportError(
				`Locked vendor segment ${index + 1} was changed. Restore its original target or unlock it in the originating workflow.`,
			);
	}

	const version = normalizedVersion(profile.xliffVersion, document.metadata);
	const contents =
		version === "1.2"
			? buildXliff12PreservingDocument(project, {
					includeOpenTlcMetadata: false,
				})
			: buildXliff2PreservingDocument(project, version, {
					includeOpenTlcMetadata: false,
				});
	const validation =
		version === "1.2"
			? validateXliff12Xml(contents)
			: validateXliff2Xml(contents);
	if (!validation.valid)
		throw new VendorXliffExportError(
			`The generated ${profile.label} file failed XLIFF validation: ${validation.issues.join(" ")}`,
		);

	const extension = outputExtension(profile);
	const reopenedProfile = detectXliffVendorProfile(
		contents,
		`round-trip.${extension}`,
		version,
	);
	if (reopenedProfile?.id !== profile.id)
		throw new VendorXliffExportError(
			`The generated file no longer carries the ${profile.label} structural signature.`,
		);

	const baseName = safeBaseName(data.name || "translation", extension);
	return {
		contents,
		extension,
		fileName: `${baseName}.${extension}`,
		mimeType: "application/xliff+xml",
		profile,
	};
}

export function downloadVendorXliff(userData: UserData): VendorXliffOutput {
	const output = buildVendorXliff(userData);
	const blob = new Blob([output.contents], { type: output.mimeType });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = output.fileName;
	try {
		document.body.appendChild(anchor);
		anchor.click();
	} finally {
		anchor.remove();
		URL.revokeObjectURL(url);
	}
	return output;
}

function normalizedVersion(
	value: string,
	metadata: Record<string, unknown> | undefined,
): "1.2" | Xliff2Version {
	if (value === "1.2" || value === "2.0" || value === "2.1") return value;
	const xliff12 = metadata?.xliff12 as { kind?: string } | undefined;
	if (xliff12?.kind === "xliff-1.2") return "1.2";
	const xliff2 = metadata?.xliff2 as
		| { kind?: string; version?: string }
		| undefined;
	if (
		xliff2?.kind === "xliff-2" &&
		(xliff2.version === "2.0" || xliff2.version === "2.1")
	)
		return xliff2.version;
	throw new VendorXliffExportError(
		`Vendor XLIFF version “${value}” is not supported for same-profile export.`,
	);
}

function outputExtension(profile: XliffVendorProfile): string {
	const extension = profile.sourceExtension?.toLowerCase();
	const allowed =
		profile.id === "xliff-doc"
			? ["xliffdoc"]
			: profile.id === "sdl-trados"
				? ["sdlxliff"]
				: profile.id === "memoq"
					? ["mqxlf", "mqxliff"]
					: profile.id === "phrase-mxliff"
						? ["mxliff"]
						: ["xlf", "xlif", "xliff"];
	if (extension && allowed.includes(extension)) return extension;
	switch (profile.id) {
		case "xliff-doc":
			return "xliffdoc";
		case "sdl-trados":
			return "sdlxliff";
		case "memoq":
			return "mqxliff";
		case "phrase-mxliff":
			return "mxliff";
		default:
			return "xlf";
	}
}

function editableText(content: SegmentContent): string {
	return (
		contentToPlainText(content) ??
		content.fragments
			.filter((fragment) => fragment.kind === "text")
			.map((fragment) => fragment.text)
			.join("")
	);
}

function safeBaseName(name: string, extension: string): string {
	const leaf = name.replaceAll("\\", "/").split("/").at(-1) ?? "translation";
	const withoutExtension = leaf.replace(
		new RegExp(`\\.${escapeRegExp(extension)}$`, "i"),
		"",
	);
	return (
		withoutExtension.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_") || "translation"
	);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
