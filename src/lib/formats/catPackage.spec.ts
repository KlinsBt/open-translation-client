// @vitest-environment happy-dom

import JSZip from "jszip";
import { DOMParser as IndependentDomParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import type { UserData } from "$lib/types/types";
import {
	buildCatReturnPackage,
	detectCatPackageProfile,
	importCatPackageFile,
	validateCatPackageFile,
} from "./catPackage";
import { SafeInputError } from "./safeInput";
import { detectFormatWithConfidence, getFormatAdapter } from "./registry";

function xliff(units: readonly [string, string][]): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0">
  <file original="source.docx" source-language="en" target-language="de" datatype="x-sdlfilterframework2">
    <body>${units
			.map(
				([source, target], index) =>
					`<trans-unit id="${index + 1}"><source>${source}</source><target state="translated">${target}</target><sdl:seg-defs><sdl:seg id="${index + 1}" /></sdl:seg-defs></trans-unit>`,
			)
			.join("")}</body>
  </file>
</xliff>`;
}

function projectFromImport(
	result: Awaited<ReturnType<typeof importCatPackageFile>>,
	targets: string[],
	name = "project.sdlppx",
): UserData {
	if (result.kind !== "segments") throw new Error("Expected segments");
	return {
		translationData: {
			name,
			targetLang: "de",
			sourceLang: "en",
			creationDate: "0",
			seg1: result.segments,
			seg2: targets,
			checked: result.segments.map(() => true),
			locked: result.segments.map(() => false),
			type: "cat-package",
			typeRef: result.typeRef ?? {},
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

async function catPackage(
	name = "project.sdlppx",
	entries: Record<string, string | Uint8Array> = {
		"project/project.sdlproj": "opaque project metadata",
		"target/en-de/document.sdlxliff": xliff([
			["Hello", "Hallo"],
			["Café e\u0301 — مرحبا 👩🏽‍💻 𐍈.", "Unicode target"],
		]),
		"resources/image.bin": new Uint8Array([0, 255, 7, 4]),
	},
): Promise<File> {
	const zip = new JSZip();
	for (const [path, content] of Object.entries(entries))
		zip.file(path, content);
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		name,
		{ type: "application/x-sdl-project-package" },
	);
}

async function tippPackage(
	name = "job.tipp",
	manifest = `<manifest xmlns="http://schema.interoperability-now.org/tipp/v1.5" packageId="urn:uuid:test"><task type="translate-strict-bitext" /></manifest>`,
): Promise<File> {
	const resources = new JSZip();
	resources.file("payload/job.xlf", xliff([["Hello مرحبا", "Old target"]]));
	resources.file("opaque/reference.bin", new Uint8Array([1, 9, 2, 8]));
	const outer = new JSZip();
	outer.file("manifest.xml", manifest);
	outer.file(
		"resources.zip",
		await resources.generateAsync({
			type: "uint8array",
			compression: "DEFLATE",
		}),
	);
	outer.file("opaque.bin", new Uint8Array([7, 6, 5]));
	return new File(
		[await outer.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		name,
		{ type: "application/x-tipp-package" },
	);
}

async function cotiPackage(name = "handoff.coti"): Promise<File> {
	return catPackage(name, {
		"coti.xml":
			'<coti version="1.1.2" level="1"><project id="p1"><translation sourceLanguage="en" targetLanguage="de" /></project></coti>',
		"translation files/en-de/job.xlf": xliff([["Source", "Target"]]),
		"reference files/layout.pdf": new Uint8Array([0x25, 0x50, 0x44, 0x46]),
	});
}

async function transitPackage(name = "job.ppf"): Promise<File> {
	return catPackage(name, {
		"project.prj": '<Project SourceLanguage="ENG" TargetLanguage="DEU" />',
		"files/manual.ENG":
			'<Transit><Seg SegID="1" Data="AA==">Hello</Seg><Seg SegID="2" Data="BB==">Unicode مرحبا 👩🏽‍💻</Seg></Transit>',
		"files/manual.DEU":
			'<Transit><Seg SegID="1" Data="AA==">Hallo</Seg><Seg SegID="2" Data="BB==">Alt</Seg></Transit>',
		"files/manual.COD": new Uint8Array([0, 10, 255, 4]),
	});
}

describe("proprietary CAT package return workflow", () => {
	it("detects fixture-led Trados, WorldServer, and memoQ structures", () => {
		expect(
			detectCatPackageProfile("work.sdlppx", ["target/a.sdlxliff"]),
		)?.toMatchObject({ id: "trados", exportPolicy: "return-package" });
		expect(
			detectCatPackageProfile("work.wszx", ["target/a.xlf"]),
		).toBeUndefined();
		expect(
			detectCatPackageProfile("work.wsxz", ["target/a.xlf"]),
		)?.toMatchObject({ id: "worldserver" });
		expect(
			detectCatPackageProfile("handoff.mqout", ["Documents/a.mqxliff"]),
		)?.toMatchObject({ id: "memoq" });
		expect(
			detectCatPackageProfile("renamed.zip", ["ordinary/document.xlf"]),
		).toBeUndefined();
	});

	it("imports all selected bilingual members with vendor context and existing targets", async () => {
		const file = await catPackage();
		const result = await importCatPackageFile(file);
		expect(result.kind).toBe("segments");
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Hello", "Café e\u0301 — مرحبا 👩🏽‍💻 𐍈."]);
		expect(result.targetSegments).toEqual(["Hallo", "Unicode target"]);
		expect(result.document.format).toBe("cat-package");
		expect(result.document.units[0].sourceLocation?.part).toBe(
			"target/en-de/document.sdlxliff",
		);
		expect(result.document.units[0].contexts).toContainEqual({
			type: "xliff-profile",
			value: "SDLXLIFF / Trados Studio",
		});
		expect(result.skeleton.payload.kind).toBe("package");
		if (result.skeleton.payload.kind !== "package")
			throw new Error("Expected package skeleton");
		expect(Object.keys(result.skeleton.payload.parts).sort()).toEqual([
			"project/project.sdlproj",
			"resources/image.bin",
			"target/en-de/document.sdlxliff",
		]);
		expect(
			new Uint8Array(
				await (
					result.skeleton.payload.parts["resources/image.bin"] as Blob
				).arrayBuffer(),
			),
		).toEqual(new Uint8Array([0, 255, 7, 4]));
	});

	it("supports member selection and intentionally omitting existing targets", async () => {
		const file = await catPackage("return.sdlrpx", {
			"project.sdlproj": "metadata",
			"files/one.sdlxliff": xliff([["One", "Eins"]]),
			"files/two.sdlxliff": xliff([["Two", "Zwei"]]),
		});
		const result = await importCatPackageFile(file, {
			memberPaths: "files/two.*",
			includeExistingTargets: false,
		});
		expect(result.kind).toBe("segments");
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Two"]);
		expect(result.targetSegments).toEqual([""]);
		expect(result.filterOptions).toEqual({
			memberPaths: "files/two.*",
			includeExistingTargets: false,
		});
	});

	it("reports a high-confidence return workflow and enables package export", async () => {
		const detection = await detectFormatWithConfidence(await catPackage());
		expect(detection).toMatchObject({
			formatId: "cat-package",
			supported: true,
			confidence: "high",
			workflow: {
				kind: "return-package",
				primaryAction: "Import, translate, and write a return package",
			},
		});
		expect(getFormatAdapter("cat-package").capabilities).toEqual({
			import: true,
			export: true,
			roundTrip: true,
		});
	});

	it("writes a Trados return package, preserves opaque entries, and reopens its targets", async () => {
		const source = await catPackage();
		const imported = await importCatPackageFile(source);
		const translated = ["Guten Tag", "Unicode geändert"];
		const output = await buildCatReturnPackage(
			projectFromImport(imported, translated),
		);
		expect(output.extension).toBe("sdlrpx");

		const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
		expect(
			new Uint8Array(
				await zip.file("resources/image.bin")!.async("uint8array"),
			),
		).toEqual(new Uint8Array([0, 255, 7, 4]));
		const bilingual = await zip
			.file("target/en-de/document.sdlxliff")!
			.async("string");
		expect(bilingual).toContain("Guten Tag");
		expect(bilingual).toContain("Unicode geändert");

		const reopened = await importCatPackageFile(
			new File([output.blob], "translated.sdlrpx", {
				type: "application/x-sdl-return-package",
			}),
		);
		expect(reopened.kind).toBe("segments");
		if (reopened.kind === "segments")
			expect(reopened.targetSegments).toEqual(translated);
	});

	it.each([
		["handoff.mqout", "translated.mqback", "mqback"],
		["archive.mqxlz", "translated.mqxlz", "mqxlz"],
		["world.wsxz", "translated.wsxz", "wsxz"],
	] as const)(
		"maps %s to a reusable %s return container",
		async (sourceName, outputName, expected) => {
			const member = sourceName.endsWith(".wsxz")
				? "files/a.xlf"
				: "Documents/a.mqxliff";
			const source = await catPackage(sourceName, {
				[member]: sourceName.endsWith(".wsxz")
					? xliff([["Hello", "Hallo"]])
					: xliff([["Hello", "Hallo"]])
							.replace(' xmlns:sdl="http://sdl.com/FileTypes/SdlXliff/1.0"', "")
							.replace(/<sdl:seg-defs>[\s\S]*?<\/sdl:seg-defs>/g, ""),
				"resources/keep.bin": new Uint8Array([9, 8, 7]),
			});
			const imported = await importCatPackageFile(source);
			const output = await buildCatReturnPackage(
				projectFromImport(imported, ["Guten Tag"], sourceName),
			);
			expect(output.extension).toBe(expected);
			const reopened = await importCatPackageFile(
				new File([output.blob], outputName),
			);
			expect(reopened.kind).toBe("segments");
			if (reopened.kind === "segments")
				expect(reopened.targetSegments).toEqual(["Guten Tag"]);
		},
	);

	it("detects only structurally signed additional handoff containers", () => {
		expect(
			detectCatPackageProfile("job.ppf", [
				"project.prj",
				"files/a.ENG",
				"files/a.DEU",
			]),
		)?.toMatchObject({ id: "star-transit" });
		expect(
			detectCatPackageProfile("job.tipp", ["manifest.xml", "resources.zip"]),
		)?.toMatchObject({ id: "tipp" });
		expect(
			detectCatPackageProfile("job.zip", [
				"coti.xml",
				"translation files/job.xlf",
			]),
		)?.toMatchObject({ id: "coti" });
		expect(
			detectCatPackageProfile("job.xlz", ["job.xlf", "job.skl"]),
		)?.toMatchObject({ id: "worldserver-xlz" });
		expect(
			detectCatPackageProfile("ordinary.zip", [
				"manifest.xml",
				"resources.zip",
			]),
		).toBeUndefined();
		expect(
			detectCatPackageProfile("fake.coti", ["coti.xml", "readme.txt"]),
		).toBeUndefined();
	});

	it.each([
		["job.ppf", "tpf"],
		["job.pxf", "txf"],
	] as const)(
		"imports and writes aligned native Transit pairs from %s",
		async (name, extension) => {
			const source = await transitPackage(name);
			const imported = await importCatPackageFile(source);
			expect(imported.kind).toBe("segments");
			if (imported.kind !== "segments") throw new Error("Expected segments");
			expect(imported.segments).toEqual(["Hello", "Unicode مرحبا 👩🏽‍💻"]);
			expect(imported.targetSegments).toEqual(["Hallo", "Alt"]);
			const output = await buildCatReturnPackage(
				projectFromImport(imported, ["Guten Tag", "Neu العربية"], name),
			);
			expect(output.extension).toBe(extension);
			const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
			expect(await zip.file("files/manual.DEU")!.async("string")).toContain(
				'<Seg SegID="1" Data="AA==">Guten Tag</Seg>',
			);
			expect(
				new Uint8Array(await zip.file("files/manual.COD")!.async("uint8array")),
			).toEqual(new Uint8Array([0, 10, 255, 4]));
			const reopened = await importCatPackageFile(
				new File([output.blob], `return.${extension}`),
			);
			expect(
				reopened.kind === "segments" ? reopened.targetSegments : [],
			).toEqual(["Guten Tag", "Neu العربية"]);
		},
	);

	it("round-trips a nested TIPP response and preserves both archive layers", async () => {
		const source = await tippPackage();
		const imported = await importCatPackageFile(source, {
			memberPaths: "resources.zip!/payload/*.xlf",
		});
		expect(imported.kind).toBe("segments");
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.document.units[0].sourceLocation?.part).toBe(
			"resources.zip!/payload/job.xlf",
		);
		const output = await buildCatReturnPackage(
			projectFromImport(imported, ["ترجمة جديدة 👩🏽‍💻"], "job.tipp"),
		);
		expect(output.extension).toBe("tipp");
		const outer = await JSZip.loadAsync(await output.blob.arrayBuffer());
		expect(await outer.file("manifest.xml")!.async("string")).toContain(
			"urn:uuid:test",
		);
		expect(await outer.file("opaque.bin")!.async("uint8array")).toEqual(
			new Uint8Array([7, 6, 5]),
		);
		const inner = await JSZip.loadAsync(
			await outer.file("resources.zip")!.async("uint8array"),
		);
		expect(await inner.file("payload/job.xlf")!.async("string")).toContain(
			"ترجمة جديدة 👩🏽‍💻",
		);
		expect(
			await inner.file("opaque/reference.bin")!.async("uint8array"),
		).toEqual(new Uint8Array([1, 9, 2, 8]));
		const reopened = await importCatPackageFile(
			new File([output.blob], "response.tipp"),
		);
		expect(reopened.kind === "segments" ? reopened.targetSegments : []).toEqual(
			["ترجمة جديدة 👩🏽‍💻"],
		);
	});

	it.each(["handoff.coti", "handoff.zip"])(
		"imports structurally declared COTI payloads from %s and returns .coti",
		async (name) => {
			const source = await cotiPackage(name);
			const detection = await detectFormatWithConfidence(source);
			expect(detection).toMatchObject({
				formatId: "cat-package",
				confidence: "high",
			});
			const imported = await importCatPackageFile(source);
			const output = await buildCatReturnPackage(
				projectFromImport(imported, ["Übersetzt"], name),
			);
			expect(output.extension).toBe("coti");
			const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
			expect(await zip.file("coti.xml")!.async("string")).toContain(
				'version="1.1.2"',
			);
			expect(
				await zip.file("translation files/en-de/job.xlf")!.async("string"),
			).toContain("Übersetzt");
		},
	);

	it("rebuilds legacy WorldServer XLZ while retaining its skeleton", async () => {
		const source = await catPackage("legacy.xlz", {
			"job.xlf": xliff([["Hello", "Hallo"]]).replace("</header>", "</header>"),
			"job.skl": new Uint8Array([5, 4, 3, 2, 1]),
		});
		const imported = await importCatPackageFile(source);
		const output = await buildCatReturnPackage(
			projectFromImport(imported, ["WorldServer target"], "legacy.xlz"),
		);
		expect(output.extension).toBe("xlz");
		const zip = await JSZip.loadAsync(await output.blob.arrayBuffer());
		expect(await zip.file("job.skl")!.async("uint8array")).toEqual(
			new Uint8Array([5, 4, 3, 2, 1]),
		);
		expect(await zip.file("job.xlf")!.async("string")).toContain(
			"WorldServer target",
		);
	});

	it("returns the exact original package bytes for an identity export", async () => {
		const source = await tippPackage();
		const imported = await importCatPackageFile(source);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const output = await buildCatReturnPackage(
			projectFromImport(imported, imported.targetSegments ?? [], "job.tipp"),
		);
		expect(new Uint8Array(await output.blob.arrayBuffer())).toEqual(
			new Uint8Array(await source.arrayBuffer()),
		);
	});

	it("handles a generated large TIPP payload and produces independently parseable XLIFF", async () => {
		const units = Array.from(
			{ length: 1_200 },
			(_, index) =>
				[`Source ${index} العربية`, `Target ${index}`] as [string, string],
		);
		const resources = new JSZip();
		resources.file("large.xlf", xliff(units));
		const outer = new JSZip();
		outer.file(
			"manifest.xml",
			'<manifest xmlns="http://schema.interoperability-now.org/tipp/v1.5" packageId="large" />',
		);
		outer.file(
			"resources.zip",
			await resources.generateAsync({
				type: "uint8array",
				compression: "DEFLATE",
			}),
		);
		const input = new File(
			[
				await outer.generateAsync({
					type: "uint8array",
					compression: "DEFLATE",
				}),
			],
			"large.tipp",
		);
		const imported = await importCatPackageFile(input);
		expect(imported.kind === "segments" ? imported.segments.length : 0).toBe(
			1_200,
		);
		const output = await buildCatReturnPackage(
			projectFromImport(
				imported,
				units.map((_, index) => `Translated ${index}`),
				"large.tipp",
			),
		);
		const outputOuter = await JSZip.loadAsync(await output.blob.arrayBuffer());
		const outputInner = await JSZip.loadAsync(
			await outputOuter.file("resources.zip")!.async("uint8array"),
		);
		const xml = await outputInner.file("large.xlf")!.async("string");
		const parsed = new IndependentDomParser().parseFromString(
			xml,
			"application/xml",
		);
		expect(parsed.getElementsByTagName("parsererror").length).toBe(0);
		expect(parsed.getElementsByTagName("target").length).toBe(1_200);
	});

	it("rejects malformed profile manifests, misaligned Transit pairs, and nested bombs", async () => {
		await expect(
			importCatPackageFile(
				await tippPackage(
					"unsafe.tipp",
					'<!DOCTYPE manifest [<!ENTITY x SYSTEM "file:///etc/passwd">]><manifest>&x;</manifest>',
				),
			),
		).rejects.toMatchObject({ code: "XML_UNSAFE_DECLARATION" });
		await expect(
			importCatPackageFile(
				await catPackage("broken.ppf", {
					"project.prj":
						'<Project SourceLanguage="ENG" TargetLanguage="DEU" />',
					"a.ENG": '<Transit><Seg SegID="1">One</Seg></Transit>',
					"a.DEU": '<Transit><Seg SegID="2">Zwei</Seg></Transit>',
				}),
			),
		).rejects.toMatchObject({ code: "CAT_PACKAGE_INVALID" });

		const nested = new JSZip();
		nested.file("payload/job.xlf", "0".repeat(2_000_000));
		const outer = new JSZip();
		outer.file(
			"manifest.xml",
			'<manifest xmlns="http://schema.interoperability-now.org/tipp/v1.5" />',
		);
		outer.file(
			"resources.zip",
			await nested.generateAsync({
				type: "uint8array",
				compression: "DEFLATE",
			}),
		);
		await expect(
			importCatPackageFile(
				new File(
					[await outer.generateAsync({ type: "uint8array" })],
					"bomb.tipp",
				),
			),
		).rejects.toMatchObject({ code: "ARCHIVE_RATIO_EXCEEDED" });
	});

	it("rejects generic, malformed, empty, bomb-like, and cancelled packages", async () => {
		await expect(
			validateCatPackageFile(
				await catPackage("ordinary.zip", {
					"document.xlf": xliff([["A", "B"]]),
				}),
			),
		).resolves.toMatchObject({ valid: false });
		await expect(
			importCatPackageFile(
				await catPackage("broken.sdlppx", {
					"project.sdlproj": "metadata",
					"document.sdlxliff": "<xliff>",
				}),
			),
		).rejects.toMatchObject({ code: "CAT_PACKAGE_INVALID" });
		await expect(
			importCatPackageFile(
				await catPackage("unsafe.sdlppx", {
					"project.sdlproj": "metadata",
					"document.sdlxliff":
						'<!DOCTYPE xliff [<!ENTITY secret SYSTEM "file:///etc/passwd">]><xliff version="1.2">&secret;</xliff>',
				}),
			),
		).rejects.toMatchObject({ code: "CAT_PACKAGE_INVALID" });
		await expect(
			importCatPackageFile(
				await catPackage("empty.sdlppx", {
					"project.sdlproj": "metadata",
				}),
			),
		).rejects.toBeInstanceOf(SafeInputError);

		const bombZip = new JSZip();
		bombZip.file("project.sdlproj", "metadata");
		bombZip.file("document.sdlxliff", "0".repeat(2_000_000));
		const bomb = new File(
			[
				await bombZip.generateAsync({
					type: "uint8array",
					compression: "DEFLATE",
				}),
			],
			"bomb.sdlppx",
		);
		await expect(importCatPackageFile(bomb)).rejects.toMatchObject({
			code: "ARCHIVE_RATIO_EXCEEDED",
		});

		const controller = new AbortController();
		controller.abort();
		await expect(
			importCatPackageFile(
				await catPackage(),
				{},
				{ signal: controller.signal },
			),
		).rejects.toMatchObject({ code: "ABORTED" });
	});
});
