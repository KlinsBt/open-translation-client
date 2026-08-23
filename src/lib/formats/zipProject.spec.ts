// @vitest-environment happy-dom

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { TypeRef, UserData } from "$lib/types/types";
import { PROJECT_SCHEMA_VERSION } from "./persistenceMigrations";
import { getFormatAdapter, detectFormatWithConfidence } from "./registry";
import {
	buildZipProjectTranslationPackage,
	importZipProjectFile,
	inspectZipProjectManifest,
	ZIP_PROJECT_KIND,
	ZIP_PROJECT_MANIFEST_PATH,
	ZIP_PROJECT_MAX_MEMBERS,
	ZIP_PROJECT_SCHEMA_VERSION,
	ZipProjectMemberError,
} from "./zipProject";
import type { FormatImportResult } from "./types";
import { createLegacyVisioFile } from "../../test/visioFixtures";

const unicode = "Café e\u0301 — مرحبا 👩🏽‍💻 𐍈.";

async function batchFile(
	members: Array<{
		path: string;
		format: string;
		mimeType?: string;
		required?: boolean;
		options?: Record<string, string | number | boolean>;
	}>,
	parts: Record<string, string | Uint8Array>,
	name = "batch.zip",
): Promise<File> {
	const zip = new JSZip();
	zip.file(
		ZIP_PROJECT_MANIFEST_PATH,
		JSON.stringify({
			schemaVersion: ZIP_PROJECT_SCHEMA_VERSION,
			kind: ZIP_PROJECT_KIND,
			members,
		}),
	);
	for (const [path, content] of Object.entries(parts)) zip.file(path, content);
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		name,
		{ type: "application/zip" },
	);
}

async function typicalBatch(): Promise<File> {
	return batchFile(
		[
			{
				path: "locales/messages.json",
				format: "json",
				mimeType: "application/json",
				options: { pathSelectors: "hello" },
			},
			{
				path: "docs/readme.txt",
				format: "text",
				mimeType: "text/plain",
				options: { segmentationMode: "document" },
			},
		],
		{
			"locales/messages.json": '{\n  "hello": "Hello",\n  "locked": true\n}\n',
			"docs/readme.txt": unicode,
			"assets/opaque.bin": new Uint8Array([0, 255, 12, 88]),
		},
	);
}

function projectFrom(
	result: FormatImportResult,
	targets: readonly string[],
): UserData {
	if (result.kind !== "segments") throw new Error("Expected segment import");
	return {
		schemaVersion: PROJECT_SCHEMA_VERSION,
		translationData: {
			name: "translated-batch",
			targetLang: "de",
			sourceLang: "en",
			creationDate: "0",
			seg1: [...result.segments],
			seg2: [...targets],
			checked: result.segments.map(() => false),
			locked: result.segments.map(() => false),
			type: "zip-project",
			typeRef: result.typeRef ?? {},
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
			tm: { id: null, name: null, active: false },
			tb: { id: null, name: null, active: false },
		},
	};
}

describe("manifest-driven ZIP projects", () => {
	it("requires the versioned manifest contract and exact safe member paths", () => {
		const paths = new Set([ZIP_PROJECT_MANIFEST_PATH, "a.txt"]);
		expect(
			inspectZipProjectManifest(
				JSON.stringify({
					schemaVersion: 1,
					kind: ZIP_PROJECT_KIND,
					members: [{ path: "a.txt", format: "text" }],
				}),
				paths,
			),
		).toMatchObject({ valid: true });
		for (const member of [
			{ path: "../a.txt", format: "text" },
			{ path: "missing.txt", format: "text" },
			{ path: "a.txt", format: "zip-project" },
			{ path: "a.txt", format: "pdf" },
			{ path: "a.txt", format: "unknown" },
		])
			expect(
				inspectZipProjectManifest(
					JSON.stringify({
						schemaVersion: 1,
						kind: ZIP_PROJECT_KIND,
						members: [member],
					}),
					paths,
				),
			).toMatchObject({ valid: false });
		expect(
			inspectZipProjectManifest(
				JSON.stringify({
					schemaVersion: 1,
					kind: ZIP_PROJECT_KIND,
					members: Array.from(
						{ length: ZIP_PROJECT_MAX_MEMBERS + 1 },
						(_, index) => ({ path: `f${index}.txt`, format: "text" }),
					),
				}),
			),
		).toMatchObject({ valid: false });
	});

	it("imports each explicitly declared adapter and reports/preserves every entry", async () => {
		const file = await typicalBatch();
		const result = await importZipProjectFile(
			file,
			{},
			undefined,
			getFormatAdapter,
		);
		expect(result.kind).toBe("segments");
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Hello", unicode]);
		expect(result.targetSegments).toEqual(["", ""]);
		expect(
			result.document.units.map((unit) => unit.sourceLocation?.part),
		).toEqual(["locales/messages.json", "docs/readme.txt"]);
		expect(result.document.metadata?.zipProject).toMatchObject({
			reports: [
				{ path: "locales/messages.json", status: "imported", units: 1 },
				{ path: "docs/readme.txt", status: "imported", units: 1 },
			],
		});
		expect(result.skeleton.payload.kind).toBe("package");
		if (result.skeleton.payload.kind !== "package")
			throw new Error("Expected package skeleton");
		expect(Object.keys(result.skeleton.payload.parts).sort()).toEqual([
			"assets/opaque.bin",
			"docs/readme.txt",
			"locales/messages.json",
			ZIP_PROJECT_MANIFEST_PATH,
		]);
	});

	it("returns byte-identical identity output and patches only changed declared members", async () => {
		const source = await typicalBatch();
		const imported = await importZipProjectFile(
			source,
			{},
			undefined,
			getFormatAdapter,
		);
		const identity = await buildZipProjectTranslationPackage(
			projectFrom(imported, ["", ""]),
		);
		expect(new Uint8Array(await identity.arrayBuffer())).toEqual(
			new Uint8Array(await source.arrayBuffer()),
		);

		const translated = await buildZipProjectTranslationPackage(
			projectFrom(imported, ["Hallo", "Übersetzt: " + unicode]),
		);
		const [before, after] = await Promise.all([
			JSZip.loadAsync(await source.arrayBuffer()),
			JSZip.loadAsync(await translated.arrayBuffer()),
		]);
		expect(
			await after.file("locales/messages.json")!.async("string"),
		).toContain('"hello": "Hallo"');
		expect(await after.file("docs/readme.txt")!.async("string")).toBe(
			"Übersetzt: " + unicode,
		);
		for (const path of [ZIP_PROJECT_MANIFEST_PATH, "assets/opaque.bin"])
			expect(await after.file(path)!.async("uint8array")).toEqual(
				await before.file(path)!.async("uint8array"),
			);

		const reimported = await importZipProjectFile(
			new File([translated], "translated.zip", { type: "application/zip" }),
			{},
			undefined,
			getFormatAdapter,
		);
		expect(reimported.kind).toBe("segments");
		if (reimported.kind === "segments")
			expect(reimported.segments).toEqual(["Hallo", "Übersetzt: " + unicode]);
	});

	it("renames conversion output and its manifest entry before reopening the complete ZIP", async () => {
		const legacy = createLegacyVisioFile("vsd", "Legacy source مرحبا");
		const source = await batchFile(
			[
				{
					path: "drawings/legacy.vsd",
					format: "visio",
					mimeType: "application/vnd.visio",
				},
			],
			{
				"drawings/legacy.vsd": new Uint8Array(await legacy.arrayBuffer()),
				"opaque/readme.bin": new Uint8Array([0, 255, 12]),
			},
		);
		const imported = await importZipProjectFile(
			source,
			{},
			undefined,
			getFormatAdapter,
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const translated = await buildZipProjectTranslationPackage(
			projectFrom(
				imported,
				imported.segments.map(() => "Sicher übersetzt مرحبا"),
			),
		);
		const outputZip = await JSZip.loadAsync(await translated.arrayBuffer());
		expect(outputZip.file("drawings/legacy.vsd")).toBeNull();
		expect(outputZip.file("drawings/legacy.vdx")).not.toBeNull();
		expect(
			await outputZip.file("opaque/readme.bin")!.async("uint8array"),
		).toEqual(new Uint8Array([0, 255, 12]));
		const manifest = JSON.parse(
			await outputZip.file(ZIP_PROJECT_MANIFEST_PATH)!.async("string"),
		) as { members: Array<{ path: string; mimeType: string }> };
		expect(manifest.members).toEqual([
			expect.objectContaining({
				path: "drawings/legacy.vdx",
				mimeType: "application/xml;charset=utf-8",
			}),
		]);

		const reopened = await importZipProjectFile(
			new File([translated], "translated.zip", { type: "application/zip" }),
			{},
			undefined,
			getFormatAdapter,
		);
		expect(reopened.kind === "segments" && reopened.segments).toContain(
			"Sicher übersetzt مرحبا",
		);
	});

	it("refuses a conversion path collision instead of overwriting another ZIP member", async () => {
		const legacy = createLegacyVisioFile("vsd");
		const source = await batchFile(
			[
				{
					path: "legacy.vsd",
					format: "visio",
					mimeType: "application/vnd.visio",
				},
			],
			{
				"legacy.vsd": new Uint8Array(await legacy.arrayBuffer()),
				"legacy.vdx": "opaque collision",
			},
		);
		const imported = await importZipProjectFile(
			source,
			{},
			undefined,
			getFormatAdapter,
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		await expect(
			buildZipProjectTranslationPackage(
				projectFrom(
					imported,
					imported.segments.map(() => "Translated"),
				),
			),
		).rejects.toThrow(/already exists/i);
	});

	it("renames a translated binary Workbench member to RTF instead of writing RTF bytes as DOC", async () => {
		const source = await batchFile(
			[
				{
					path: "jobs/workbench.doc",
					format: "legacy-bilingual",
					mimeType: "application/msword",
				},
			],
			{
				"jobs/workbench.doc":
					'<?xml version="1.0"?><TRADOStag Version="2.0"><Body><Tu id="u1"><Tuv Lang="EN">Source</Tuv><Tuv Lang="DE">Target</Tuv></Tu></Body></TRADOStag>',
			},
		);
		const imported = await importZipProjectFile(
			source,
			{},
			undefined,
			getFormatAdapter,
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const stored = (
			imported.typeRef as {
				batchMembers: Array<{
					typeRef: TypeRef;
					segmentsMeta?: UserData["translationData"]["segmentsMeta"];
				}>;
			}
		).batchMembers[0];
		stored.typeRef = { profile: "workbench-ole", sourceExtension: "doc" };
		stored.segmentsMeta = [
			{
				profile: "workbench-ole",
				unitId: "workbench-ole-1",
				originalSource: "Source",
				originalTarget: "Target",
				locked: false,
				status: "100",
			},
		];
		const translated = await buildZipProjectTranslationPackage(
			projectFrom(imported, ["Übersetztes Ziel"]),
		);
		const outputZip = await JSZip.loadAsync(await translated.arrayBuffer());
		expect(outputZip.file("jobs/workbench.doc")).toBeNull();
		expect(outputZip.file("jobs/workbench.rtf")).not.toBeNull();
		expect(
			await outputZip.file("jobs/workbench.rtf")!.async("string"),
		).toContain("\\rtf1");
		const reopened = await importZipProjectFile(
			new File([translated], "workbench-return.zip", {
				type: "application/zip",
			}),
			{},
			undefined,
			getFormatAdapter,
		);
		expect(reopened.kind === "segments" && reopened.targetSegments?.[0]).toBe(
			"Übersetztes Ziel",
		);
	});

	it("reports every failure and only skips explicitly optional members", async () => {
		const file = await batchFile(
			[
				{
					path: "good.txt",
					format: "text",
					options: { segmentationMode: "document" },
				},
				{ path: "broken.docx", format: "docx", required: false },
			],
			{ "good.txt": "Good", "broken.docx": "not a package" },
		);
		await expect(
			importZipProjectFile(file, {}, undefined, getFormatAdapter),
		).rejects.toBeInstanceOf(ZipProjectMemberError);
		const result = await importZipProjectFile(
			file,
			{ failurePolicy: "skip-optional" },
			undefined,
			getFormatAdapter,
		);
		expect(result.document.metadata?.zipProject).toMatchObject({
			reports: [
				{ path: "good.txt", status: "imported" },
				{ path: "broken.docx", status: "skipped" },
			],
		});

		const required = await batchFile(
			[
				{
					path: "good.txt",
					format: "text",
					options: { segmentationMode: "document" },
				},
				{ path: "broken.docx", format: "docx" },
			],
			{ "good.txt": "Good", "broken.docx": "not a package" },
		);
		await expect(
			importZipProjectFile(
				required,
				{ failurePolicy: "skip-optional" },
				undefined,
				getFormatAdapter,
			),
		).rejects.toMatchObject({
			reports: [
				expect.objectContaining({ status: "imported" }),
				expect.objectContaining({ status: "failed" }),
			],
		});
	});

	it("detects only valid manifest ZIPs and guides ordinary ZIP users", async () => {
		await expect(
			detectFormatWithConfidence(await typicalBatch()),
		).resolves.toMatchObject({
			formatId: "zip-project",
			supported: true,
			confidence: "high",
			evidence: ["package", "signature", "content"],
		});
		const ordinaryZip = new JSZip();
		ordinaryZip.file("notes.txt", "Hello");
		const detection = await detectFormatWithConfidence(
			new File(
				[await ordinaryZip.generateAsync({ type: "uint8array" })],
				"ordinary.zip",
				{ type: "application/zip" },
			),
		);
		expect(detection).toMatchObject({
			formatId: null,
			supported: false,
			workflow: {
				kind: "manifest-required",
				primaryAction: `Add a valid ${ZIP_PROJECT_MANIFEST_PATH}`,
			},
		});
	});

	it("rejects structural edits, cancellation, and nested-manifest recursion", async () => {
		const imported = await importZipProjectFile(
			await typicalBatch(),
			{},
			undefined,
			getFormatAdapter,
		);
		const structurallyEdited = projectFrom(imported, ["Hallo"]);
		structurallyEdited.translationData.seg1.splice(1, 1);
		structurallyEdited.translationData.checked.splice(1, 1);
		await expect(
			buildZipProjectTranslationPackage(structurallyEdited),
		).rejects.toThrow(/split\/join|align/i);

		const controller = new AbortController();
		controller.abort();
		await expect(
			importZipProjectFile(
				await typicalBatch(),
				{},
				{ signal: controller.signal },
				getFormatAdapter,
			),
		).rejects.toMatchObject({ code: "ABORTED" });

		expect(
			inspectZipProjectManifest(
				JSON.stringify({
					schemaVersion: 1,
					kind: ZIP_PROJECT_KIND,
					members: [{ path: "nested.zip", format: "zip-project" }],
				}),
				new Set([ZIP_PROJECT_MANIFEST_PATH, "nested.zip"]),
			),
		).toMatchObject({
			valid: false,
			reason: expect.stringMatching(/recursive/),
		});

		const bomb = await batchFile(
			[
				{
					path: "source.txt",
					format: "text",
					options: { segmentationMode: "document" },
				},
			],
			{ "source.txt": "0".repeat(2_000_000) },
			"bomb.zip",
		);
		await expect(
			importZipProjectFile(bomb, {}, undefined, getFormatAdapter),
		).rejects.toMatchObject({ code: "ARCHIVE_RATIO_EXCEEDED" });
	});
});
