import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import type { UserData } from "$lib/types/types";
import { makeUserData } from "../../test/fixtures";
import { createPackageSkeleton } from "./skeleton";
import {
	buildLegacyOfficeTranslation,
	collectLegacyParagraphs,
	importLegacyOfficeFile,
	validateLegacyOfficeFile,
} from "./legacyOffice";

vi.mock("reamkit", async (importOriginal) => {
	const original = await importOriginal<typeof import("reamkit")>();
	return {
		...original,
		Ream: {
			...original.Ream,
			parse(bytes: Uint8Array) {
				const synthetic =
					bytes[8] === 0x44 ? "doc" : bytes[8] === 0x50 ? "ppt" : null;
				if (!synthetic) return original.Ream.parse(bytes);
				return {
					format: synthetic,
					flow: {
						children: [
							{ paragraph: { runs: [{ text: "Hello עולם مرحبا 😀" }] } },
						],
					},
					losses: [],
					convert: async (format: string) =>
						new TextEncoder().encode(`converted-${synthetic}-${format}`),
				};
			},
		},
	};
});

function projectFromImport(
	result: Awaited<ReturnType<typeof importLegacyOfficeFile>>,
	targets: string[],
): UserData {
	if (result.kind !== "segments") throw new Error("Expected segments");
	return {
		translationData: {
			name: "legacy.xls",
			targetLang: "de",
			sourceLang: "en",
			creationDate: "0",
			seg1: result.segments,
			seg2: targets,
			checked: result.segments.map(() => true),
			type: "legacy-office",
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

function syntheticOle(kind: "doc" | "ppt", name: string): File {
	const bytes = new Uint8Array(512);
	bytes.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
	bytes[8] = kind === "doc" ? 0x44 : 0x50;
	return new File([bytes], name, { type: "application/x-ole-storage" });
}

async function xlsbFixture(rows = 3): Promise<File> {
	const XLSX = await import("xlsx");
	const workbook = XLSX.utils.book_new();
	const data = Array.from({ length: rows }, (_, index) => [
		index === 0 ? "Hello עולם مرحبا 😀" : `Row ${index + 1}`,
		index + 1,
	]);
	const sheet = XLSX.utils.aoa_to_sheet(data);
	sheet.C1 = { t: "n", f: "SUM(B1:B3)", v: 6 };
	sheet["!ref"] = `A1:C${Math.max(rows, 3)}`;
	XLSX.utils.book_append_sheet(workbook, sheet, "Main");
	const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsb" });
	const zip = await JSZip.loadAsync(bytes);
	zip.file("customXml/unknown-resource.bin", new Uint8Array([7, 8, 9]));
	return new File(
		[await zip.generateAsync({ type: "uint8array" })],
		"binary.xlsb",
		{ type: "application/vnd.ms-excel.sheet.binary.macroenabled.12" },
	);
}

describe("browser-native legacy Office support", () => {
	it("finds and mutates paragraph runs without flattening their container", () => {
		const flow = {
			children: [
				{ paragraph: { runs: [{ text: "Hello " }, { text: "world" }] } },
				{ unrelated: true },
			],
		};
		const paragraphs = collectLegacyParagraphs(flow);
		expect(paragraphs.map(({ text }) => text)).toEqual(["Hello world"]);
		paragraphs[0].runs[0].text = "Hallo Welt";
		paragraphs[0].runs[1].text = "";
		expect(flow.children[0]).toMatchObject({
			paragraph: { runs: [{ text: "Hallo Welt" }, { text: "" }] },
		});
	});

	it("rejects an extension-only spoof without an OLE signature", async () => {
		const file = new File(["not an OLE document"], "fake.doc", {
			type: "application/msword",
		});
		expect((await validateLegacyOfficeFile(file)).valid).toBe(false);
		await expect(importLegacyOfficeFile(file)).rejects.toMatchObject({
			code: "LEGACY_OFFICE_INVALID",
		});
	});

	it.each([
		["doc", "doc"],
		["dot", "doc"],
		["bak", "doc"],
		["ppt", "ppt"],
		["pps", "ppt"],
		["pot", "ppt"],
	] as const)(
		"verifies .%s from its OLE application streams",
		async (extension, family) => {
			const file = syntheticOle(family, `sample.${extension}`);
			expect(await validateLegacyOfficeFile(file)).toEqual({ valid: true });
			const imported = await importLegacyOfficeFile(file);
			expect(imported.kind).toBe("segments");
			if (imported.kind === "segments") {
				expect(imported.segments).toEqual(["Hello עולם مرحبا 😀"]);
				expect(imported.document.metadata?.sourceExtension).toBe(extension);
			}
			const wrongFamily = syntheticOle(
				family === "doc" ? "ppt" : "doc",
				`mismatch.${extension}`,
			);
			expect((await validateLegacyOfficeFile(wrongFamily)).valid).toBe(false);
		},
	);

	it("imports, writes, and reopens a real binary XLS workbook", async () => {
		const fixture = await readFile(
			resolve("Test files/xls_test_file_100_rows.xls"),
		);
		const source = new File([fixture], "legacy.xls", {
			type: "application/vnd.ms-excel",
		});
		expect(await validateLegacyOfficeFile(source)).toEqual({ valid: true });
		const imported = await importLegacyOfficeFile(source);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments.length).toBeGreaterThan(20);
		const translated = `Translated: ${imported.segments[0]}`;
		const targets = imported.segments.map((value, index) =>
			index === 0 ? translated : value,
		);
		const output = await buildLegacyOfficeTranslation(
			projectFromImport(imported, targets),
		);
		expect(output.extension).toBe("xlsx");
		const XLSX = await import("xlsx");
		const reopened = XLSX.read(await output.blob.arrayBuffer(), {
			type: "array",
		});
		const firstMeta = imported.segmentsMeta?.[0];
		if (
			!firstMeta ||
			!("sheet" in firstMeta) ||
			!("cell" in firstMeta) ||
			!firstMeta.sheet ||
			!firstMeta.cell
		)
			throw new Error("Expected spreadsheet cell metadata");
		expect(reopened.Sheets[firstMeta.sheet][firstMeta.cell].v).toBe(translated);
	});

	it("accepts an XLS template only after BIFF parsing and retains its family", async () => {
		const fixture = await readFile(
			resolve("Test files/xls_test_file_100_rows.xls"),
		);
		const source = new File([fixture], "template.xlt", {
			type: "application/vnd.ms-excel",
		});
		expect(await validateLegacyOfficeFile(source)).toEqual({ valid: true });
		const imported = await importLegacyOfficeFile(source);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const identity = await buildLegacyOfficeTranslation(
			projectFromImport(imported, [...imported.segments]),
		);
		expect(identity.extension).toBe("xlt");
		expect(new Uint8Array(await identity.blob.arrayBuffer())).toEqual(
			new Uint8Array(fixture),
		);
	});

	it("imports, translates, and independently reopens XLSB while preserving opaque parts", async () => {
		const source = await xlsbFixture();
		expect(await validateLegacyOfficeFile(source)).toEqual({ valid: true });
		const imported = await importLegacyOfficeFile(source);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		expect(imported.segments).toContain("Hello עולם مرحبا 😀");
		expect(imported.segments).not.toContain("SUM(B1:B3)");

		const identity = await buildLegacyOfficeTranslation(
			projectFromImport(imported, [...imported.segments]),
		);
		expect(identity.extension).toBe("xlsb");
		expect(new Uint8Array(await identity.blob.arrayBuffer())).toEqual(
			new Uint8Array(await source.arrayBuffer()),
		);

		const targets = imported.segments.map((text, index) =>
			index === 0 ? "Übersetzt שלום مرحبا" : text,
		);
		const translated = await buildLegacyOfficeTranslation(
			projectFromImport(imported, targets),
		);
		expect(translated.extension).toBe("xlsx");
		const zip = await JSZip.loadAsync(await translated.blob.arrayBuffer());
		expect(zip.file("xl/workbook.xml")).not.toBeNull();
		expect(await imported.skeleton!.source.originalFile!.arrayBuffer()).toEqual(
			await source.arrayBuffer(),
		);
		const XLSX = await import("xlsx");
		const reopened = XLSX.read(await translated.blob.arrayBuffer(), {
			type: "array",
			cellFormula: true,
		});
		expect(reopened.Sheets.Main.A1.v).toBe("Übersetzt שלום مرحبا");
		expect(reopened.Sheets.Main.C1.v).toBe(6);
	});

	it("rejects malformed XLSB packages and honors cancellation on generated large input", async () => {
		const zip = new JSZip();
		zip.file(
			"[Content_Types].xml",
			'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
		);
		const malformed = new File(
			[await zip.generateAsync({ type: "uint8array" })],
			"broken.xlsb",
		);
		expect((await validateLegacyOfficeFile(malformed)).valid).toBe(false);

		const large = await xlsbFixture(2_000);
		const controller = new AbortController();
		controller.abort();
		await expect(
			importLegacyOfficeFile(large, {}, { signal: controller.signal }),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("uses a modern spreadsheet conversion to preserve formulas without evaluating them", async () => {
		const XLSX = await import("xlsx");
		const workbook = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([["Source", 2]]);
		sheet.C1 = { t: "n", f: "B1*3", v: 6 };
		sheet["!ref"] = "A1:C1";
		XLSX.utils.book_append_sheet(workbook, sheet, "Main");
		(workbook as typeof workbook & { vbaraw: Uint8Array }).vbaraw =
			new Uint8Array([1, 2, 3, 4]);
		const bytes = XLSX.write(workbook, {
			type: "array",
			bookType: "xlsm",
			bookVBA: true,
		});
		const source = new File([bytes], "formula.xlsb", {
			type: "application/vnd.ms-excel.sheet.binary.macroenabled.12",
		});
		const project = makeUserData({
			type: "legacy-office",
			name: source.name,
			typeRef: {
				profile: "legacy-office-browser",
				subtype: "xls",
				sourceExtension: "xlsb",
			},
			seg1: ["Source"],
			seg2: ["Target"],
			checked: [true],
			segmentsMeta: [
				{
					profile: "legacy-office-browser",
					subtype: "xls",
					sourceExtension: "xlsb",
					sheet: "Main",
					cell: "A1",
				},
			],
			skeleton: await createPackageSkeleton(source, "legacy-office", {}, []),
		});
		const output = await buildLegacyOfficeTranslation(project);
		expect(output.extension).toBe("xlsm");
		const reopened = XLSX.read(await output.blob.arrayBuffer(), {
			type: "array",
			cellFormula: true,
			bookVBA: true,
		});
		expect(reopened.Sheets.Main.A1.v).toBe("Target");
		expect(reopened.Sheets.Main.C1.f).toBe("B1*3");
		expect(reopened.Sheets.Main.C1.v).toBe(6);
		expect(reopened.vbaraw).toEqual(new Uint8Array([1, 2, 3, 4]));
	});
});
