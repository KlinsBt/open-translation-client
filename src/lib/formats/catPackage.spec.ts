// @vitest-environment happy-dom

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
	CatPackageReadOnlyError,
	detectCatPackageProfile,
	importCatPackageFile,
	rejectCatPackageExport,
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

describe("proprietary CAT package protected import", () => {
	it("detects fixture-led Trados, WorldServer, and memoQ structures", () => {
		expect(
			detectCatPackageProfile("work.sdlppx", ["target/a.sdlxliff"]),
		)?.toMatchObject({ id: "trados", exportPolicy: "import-only" });
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

	it("reports a high-confidence read-only workflow and blocks package export", async () => {
		const detection = await detectFormatWithConfidence(await catPackage());
		expect(detection).toMatchObject({
			formatId: "cat-package",
			supported: true,
			confidence: "high",
			workflow: {
				kind: "read-only-package",
				primaryAction: "Import supported bilingual members read-only",
			},
		});
		expect(getFormatAdapter("cat-package").capabilities).toEqual({
			import: true,
			export: false,
			roundTrip: false,
		});
		await expect(rejectCatPackageExport({} as never)).rejects.toBeInstanceOf(
			CatPackageReadOnlyError,
		);
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
