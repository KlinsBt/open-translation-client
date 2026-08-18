// @vitest-environment happy-dom

import JSZip from "jszip";
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
