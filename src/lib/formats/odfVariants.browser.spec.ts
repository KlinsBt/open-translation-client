import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { makeUserData } from "../../test/fixtures";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { buildOdfTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationOdf";
import {
	importOdfFile,
	ODF_MIME_TYPES,
	validateOdfFile,
	type OdfProfile,
} from "./odf";
import { detectFormatWithConfidence } from "./registry";

async function packageFile(
	profile: OdfProfile,
	content: string,
	extra: Record<string, string | Uint8Array> = {},
): Promise<File> {
	const zip = new JSZip();
	zip.file("mimetype", ODF_MIME_TYPES[profile], { compression: "STORE" });
	zip.file("content.xml", content);
	zip.file(
		"META-INF/manifest.xml",
		`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODF_MIME_TYPES[profile]}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
	);
	for (const [path, value] of Object.entries(extra)) zip.file(path, value);
	return new File(
		[
			await zip.generateAsync({
				type: "uint8array",
				compression: "DEFLATE",
			}),
		],
		`browser.${profile}`,
		{ type: ODF_MIME_TYPES[profile] },
	);
}

function projectFromImport(
	file: File,
	imported: Awaited<ReturnType<typeof importOdfFile>>,
	targets: string[],
) {
	if (imported.kind !== "segments") throw new Error("Expected ODF segments");
	return makeUserData({
		type: "odf",
		name: file.name,
		typeRef: imported.typeRef!,
		seg1: imported.segments,
		seg2: targets,
		checked: targets.map(() => true),
		segmentsMeta: imported.segmentsMeta,
		documentModel: imported.document,
		skeleton: imported.skeleton,
		filterOptions: imported.filterOptions,
	});
}

describe("FF-501 browser-native OpenDocument variants", () => {
	it("edits and reopens an OTP while retaining inert and embedded resources", async () => {
		const source = await packageFile(
			"otp",
			'<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"><office:body><office:presentation><draw:page><draw:frame><draw:text-box><text:p>Template שלום مرحبا</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document-content>',
			{
				"Scripts/main.js": "throw new Error('must never run')",
				"Object 1/object.bin": new Uint8Array([0, 255, 7, 8]),
			},
		);
		expect(await detectFormatWithConfidence(source)).toMatchObject({
			formatId: "odf",
			supported: true,
			confidence: "high",
		});
		const imported = await importOdfFile(source);
		const project = projectFromImport(source, imported, ["Vorlage שלום مرحبا"]);
		const output = await buildOdfTranslationPackage(project);
		const reopenedFile = new File([output], "translated.otp", {
			type: output.type,
		});
		expect(await validateOdfFile(reopenedFile)).toEqual({ valid: true });
		const reopened = await importOdfFile(reopenedFile);
		expect(reopened).toMatchObject({
			kind: "segments",
			segments: ["Vorlage שלום مرحبا"],
		});
		const zip = await JSZip.loadAsync(await output.arrayBuffer());
		expect(await zip.file("Scripts/main.js")!.async("string")).toBe(
			"throw new Error('must never run')",
		);
		expect(await zip.file("Object 1/object.bin")!.async("uint8array")).toEqual(
			new Uint8Array([0, 255, 7, 8]),
		);
	});

	it("persists and restores an explicitly detected ODF Formula project", async () => {
		const source = await packageFile(
			"odf",
			'<math:math xmlns:math="http://www.w3.org/1998/Math/MathML"><math:mrow><math:mi>x</math:mi><math:mo>=</math:mo><math:mtext>distance 世界</math:mtext></math:mrow></math:math>',
		);
		const imported = await importOdfFile(source);
		const project = projectFromImport(source, imported, ["Abstand 世界"]);
		project.translationData.name = `ff501-browser-${Date.now()}.odf`;
		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === project.translationData.name,
		);
		expect(restored?.translationData.typeRef).toMatchObject({
			profile: "odf",
			mimeType: ODF_MIME_TYPES.odf,
		});
		expect(
			restored?.translationData.skeleton?.source.originalFile,
		).toBeInstanceOf(Blob);
		const output = await buildOdfTranslationPackage(restored!);
		const reopened = await importOdfFile(
			new File([output], "translated.odf", { type: output.type }),
		);
		expect(reopened).toMatchObject({
			kind: "segments",
			segments: ["Abstand 世界"],
		});
	});
});
