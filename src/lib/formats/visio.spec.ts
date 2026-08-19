// @vitest-environment happy-dom

import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { PROJECT_SCHEMA_VERSION } from "./persistenceMigrations";
import { detectFormatWithConfidence } from "./registry";
import {
	buildVisioTranslation,
	importVisioFile,
	validateVisioFile,
} from "./visio";
import type { FormatImportResult } from "./types";
import type { UserData } from "$lib/types/types";
import {
	createLegacyVisioFile,
	createVisioPackage,
	createVisioReport,
	createVisioXml,
} from "../../test/visioFixtures";

function project(
	result: FormatImportResult,
	targets: readonly string[],
	name = "diagram.vsdx",
): UserData {
	const segments =
		result.kind === "segments"
			? result.segments
			: result.document.units.map((unit) =>
					unit.source.fragments
						.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
						.join(""),
				);
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		translationData: {
			name,
			targetLang: "de",
			sourceLang: "en",
			creationDate: "0",
			seg1: segments,
			seg2: [...targets],
			checked: segments.map(() => false),
			type: "visio",
			typeRef: result.typeRef ?? {},
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

async function bytes(blob: Blob): Promise<number[]> {
	return [...new Uint8Array(await blob.arrayBuffer())];
}

describe("Microsoft Visio families", () => {
	it.each(["vsdx", "vsdm", "vssx", "vssm", "vstx", "vstm"] as const)(
		"validates, detects, and retains the %s OPC family",
		async (extension) => {
			const file = await createVisioPackage({ extension });
			await expect(validateVisioFile(file)).resolves.toEqual({ valid: true });
			await expect(detectFormatWithConfidence(file)).resolves.toMatchObject({
				formatId: "visio",
				confidence: "high",
				evidence: ["package", "signature"],
			});
			const imported = await importVisioFile(file);
			const identity = await buildVisioTranslation(
				project(
					imported,
					imported.kind === "segments" ? imported.segments : [],
					file.name,
				),
			);
			expect(identity.extension).toBe(extension);
			expect(await bytes(identity.blob)).toEqual(await bytes(file));
		},
	);

	it.each(["vdx", "vsx", "vtx"] as const)(
		"round-trips standalone %s DataDiagramML with positional XML edits",
		async (extension) => {
			const file = createVisioXml(extension, "Hello مرحبا 👩🏽‍💻");
			const imported = await importVisioFile(file);
			expect(imported.kind).toBe("segments");
			if (imported.kind !== "segments") throw new Error("Expected segments");
			expect(imported.segments).toContain("Hello مرحبا 👩🏽‍💻");
			expect(imported.segments).not.toContain("PROTECTED FIELD");
			expect(imported.segments).not.toContain("=GUARD(1)");
			const targets = imported.segments.map((value) => `DE ${value}`);
			const output = await buildVisioTranslation(
				project(imported, targets, file.name),
			);
			expect(output.extension).toBe(extension);
			const document = new DOMParser().parseFromString(
				await output.blob.text(),
				"application/xml",
			);
			expect(document.documentElement.localName).toBe("VisioDocument");
			expect(document.getElementsByTagName("fld")[0].textContent).toBe(
				"PROTECTED FIELD",
			);
			const reopened = await importVisioFile(
				new File([output.blob], `translated.${extension}`, {
					type: "application/xml",
				}),
			);
			expect(reopened.kind === "segments" && reopened.segments).toEqual(
				targets,
			);
		},
	);

	it("extracts page, connector, master, layer, property, and metadata text in stable order", async () => {
		const imported = await importVisioFile(
			await createVisioPackage({ shapeText: "Node text" }),
		);
		expect(imported.kind).toBe("segments");
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments).toEqual([
			"Diagram title",
			"Overview",
			"Node text",
			"Connector label",
			"Approval status",
			"Ready",
			"Choose status",
			"Workflow layer",
			"Data graphic callout",
			"Process box",
			"Reusable box",
			"Master text",
		]);
		expect(JSON.stringify(imported.document.metadata)).toContain("Formulas");
	});

	it("changes only localized XML and preserves macros, objects, images, formulas, and links", async () => {
		const file = await createVisioPackage({
			extension: "vsdm",
			includeMacro: true,
		});
		const imported = await importVisioFile(file);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const output = await buildVisioTranslation(
			project(
				imported,
				imported.segments.map((value) => `Übersetzt ${value}`),
				file.name,
			),
		);
		const originalZip = await JSZip.loadAsync(await file.arrayBuffer());
		const translatedZip = await JSZip.loadAsync(
			await output.blob.arrayBuffer(),
		);
		for (const path of [
			"visio/vbaProject.bin",
			"visio/media/image1.png",
			"visio/embeddings/object1.bin",
			"custom/unknown.dat",
			"_rels/.rels",
			"visio/document.xml",
		]) {
			expect(await translatedZip.file(path)?.async("uint8array")).toEqual(
				await originalZip.file(path)?.async("uint8array"),
			);
		}
		const page = await translatedZip
			.file("visio/pages/page1.xml")!
			.async("string");
		expect(page).toContain("Übersetzt Diagram text");
		expect(page).toContain('F="NOW()"');
		expect(page).not.toContain('F="Width*0.5"');
		const master = await translatedZip
			.file("visio/masters/master1.xml")!
			.async("string");
		expect(master).toContain('F="Width*0.5"');
		const independent = new DOMParser().parseFromString(
			page,
			"application/xml",
		);
		expect(independent.documentElement.localName).toBe("PageContents");
	});

	it("retains signed packages byte-for-byte but blocks edits that would invalidate their signature", async () => {
		const file = await createVisioPackage({ includeSignature: true });
		const imported = await importVisioFile(file);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const identity = await buildVisioTranslation(
			project(imported, imported.segments, file.name),
		);
		expect(await bytes(identity.blob)).toEqual(await bytes(file));
		await expect(
			buildVisioTranslation(
				project(
					imported,
					imported.segments.map((value) => `Translated ${value}`),
					file.name,
				),
			),
		).rejects.toThrow(/digitally signed/i);
	});

	it.each(["vsd", "vss", "vdw", "vsr"] as const)(
		"provides protected local import and VDX delivery for legacy %s compound files",
		async (extension) => {
			const file = createLegacyVisioFile(extension);
			const imported = await importVisioFile(file);
			expect(imported.kind).toBe("segments");
			if (imported.kind !== "segments") throw new Error("Expected segments");
			expect(imported.segments).toContain("Legacy diagram text مرحبا");
			expect(imported.segments.join(" ")).not.toContain("Dangerous");
			const identity = await buildVisioTranslation(
				project(imported, imported.segments, file.name),
			);
			expect(identity.extension).toBe(extension);
			expect(await bytes(identity.blob)).toEqual(await bytes(file));
			const translated = await buildVisioTranslation(
				project(imported, ["Sicher übersetzt مرحبا"], file.name),
			);
			expect(translated.extension).toBe("vdx");
			const reopened = await importVisioFile(
				new File([translated.blob], "translated.vdx", {
					type: "application/xml",
				}),
			);
			expect(reopened.kind === "segments" && reopened.segments).toContain(
				"Sicher übersetzt مرحبا",
			);
		},
	);

	it("supports structurally identified report-definition XML without exposing formulas", async () => {
		const imported = await importVisioFile(createVisioReport());
		expect(imported.kind === "segments" && imported.segments).toEqual([
			"Shape report",
			"Report description",
			"Shape name",
		]);
	});

	it("rejects renamed, mismatched, malformed, and entity-bearing sources", async () => {
		const vsdx = await createVisioPackage();
		await expect(
			validateVisioFile(
				new File([vsdx], "renamed.vssm", { type: "application/vnd.visio" }),
			),
		).resolves.toMatchObject({ valid: false, errorCode: "VISIO_INVALID" });
		await expect(
			validateVisioFile(
				new File(["not a diagram"], "fake.vdx", {
					type: "application/xml",
				}),
			),
		).resolves.toMatchObject({ valid: false });
		await expect(
			validateVisioFile(
				new File(
					[
						'<!DOCTYPE VisioDocument [<!ENTITY x SYSTEM "file:///etc/passwd">]><VisioDocument xmlns="urn:schemas-microsoft-com:office:visio"><Pages><Page><Shapes><Shape><Text>&x;</Text></Shape></Shapes></Page></Pages></VisioDocument>',
					],
					"unsafe.vdx",
				),
			),
		).resolves.toMatchObject({
			valid: false,
			errorCode: "XML_UNSAFE_DECLARATION",
		});
	});

	it("identifies the exact OPC family from content when the filename is generic", async () => {
		const packageFile = await createVisioPackage({ extension: "vstm" });
		const generic = new File([packageFile], "uploaded.zip", {
			type: "application/zip",
		});
		await expect(detectFormatWithConfidence(generic)).resolves.toMatchObject({
			formatId: "visio",
			confidence: "high",
		});
		const imported = await importVisioFile(generic);
		expect(imported.typeRef).toMatchObject({ sourceExtension: "vstm" });
	});

	it("honors cancellation before package extraction", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			importVisioFile(await createVisioPackage(), undefined, {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("imports a generated 1,000-shape package without committed large fixtures", async () => {
		const imported = await importVisioFile(
			await createVisioPackage({ shapeCount: 1_000 }),
		);
		expect(imported.kind).toBe("segments");
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(
			imported.segments.filter((entry) => /^Message \d+$/.test(entry)),
		).toHaveLength(1_000);
	});
});
