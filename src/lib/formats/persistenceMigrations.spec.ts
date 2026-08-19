// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	migrateProjectData,
	migrateTbData,
	migrateTmData,
	PROJECT_SCHEMA_VERSION,
	TB_SCHEMA_VERSION,
	TM_SCHEMA_VERSION,
} from "./persistenceMigrations";
import {
	combineSegmentData,
	splitSegmentData,
} from "$lib/functions/parsing/segmentationLogic";
import { buildJsonSaveFile } from "$lib/functions/saveFileGeneration/generateJsonSaveFile";

describe("persisted data migrations", () => {
	it("upgrades an unversioned project without losing rich format state", () => {
		const packagePart = new Blob(["package data"]);
		const legacy = makeUserData({
			checked: undefined as unknown as boolean[],
			typeRef: { "word/media/image.png": packagePart },
			segmentsMeta: [{ fragments: [], separator: " " }],
			segmentJoinStates: [
				{
					targetSnapshot: "Hallo & willkommen.",
					boundaries: [{ sourceOffset: 5, targetOffset: 6 }],
				},
			],
			parsingTokens: [".", "!"],
		});
		(legacy as unknown as Record<string, unknown>).pluginMetadata = {
			owner: "extension",
		};

		const migrated = migrateProjectData(legacy);

		expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
		expect(migrated.translationData.checked).toEqual([false]);
		expect(
			(migrated.translationData.typeRef as Record<string, Blob>)[
				"word/media/image.png"
			],
		).toBe(packagePart);
		expect(migrated.translationData.segmentJoinStates).toEqual(
			legacy.translationData.segmentJoinStates,
		);
		expect(
			(migrated as unknown as Record<string, unknown>).pluginMetadata,
		).toEqual({ owner: "extension" });
	});

	it("upgrades the oldest flat project shape", () => {
		const migrated = migrateProjectData({
			id: 3,
			name: "Flat backup",
			sourceLang: "en",
			targetLang: "de",
			creationDate: 123,
			seg1: ["Source"],
			seg2: ["Target"],
			checked: [true],
			type: "text",
			typeRef: "Source",
		});

		expect(migrated).toMatchObject({
			schemaVersion: PROJECT_SCHEMA_VERSION,
			id: 3,
			translationData: {
				name: "Flat backup",
				creationDate: "123",
				seg1: ["Source"],
				seg2: ["Target"],
			},
		});
	});

	it("is deterministic and idempotent for current project data", () => {
		const once = migrateProjectData(makeUserData());
		const twice = migrateProjectData(once);

		expect(twice).toEqual(once);
		expect(twice).not.toBe(once);
		expect(twice.translationData.seg1).not.toBe(once.translationData.seg1);
	});

	it.each([
		["project", () => migrateProjectData({ schemaVersion: 2 })],
		["translation memory", () => migrateTmData({ schemaVersion: 2 })],
		["termbase", () => migrateTbData({ schemaVersion: 2 })],
	])("rejects unsupported future %s versions", (_kind, migrate) => {
		expect(migrate).toThrowError(
			expect.objectContaining({
				code: "FUTURE_VERSION",
				version: 2,
			}),
		);
	});

	it("rejects corrupt project alignment and invalid version values", () => {
		expect(() =>
			migrateProjectData(
				makeUserData({ seg1: ["One", "Two"], seg2: ["Eins"] }),
			),
		).toThrow(/segment counts differ/i);
		expect(() =>
			migrateProjectData({ ...makeUserData(), schemaVersion: 1.5 }),
		).toThrowError(expect.objectContaining({ code: "INVALID_VERSION" }));
	});

	it("versions TM and TB records while retaining extension metadata", () => {
		const tm = migrateTmData({
			name: "Memory",
			terms: [
				{
					source: { lang: "en", segment: "File", quality: 100 },
					target: [{ lang: "de", segment: "Datei", origin: "reviewed" }],
				},
			],
		});
		const tb = migrateTbData({
			name: "Terms",
			entries: [
				{
					conceptId: "c1",
					terms: [{ lang: "en", term: "file", notes: ["noun"] }],
				},
			],
		});

		expect(tm.schemaVersion).toBe(TM_SCHEMA_VERSION);
		expect(tm.terms[0].source as Record<string, unknown>).toMatchObject({
			quality: 100,
		});
		expect(tm.terms[0].target[0] as Record<string, unknown>).toMatchObject({
			origin: "reviewed",
		});
		expect(tb.schemaVersion).toBe(TB_SCHEMA_VERSION);
		expect(tb.entries[0] as Record<string, unknown>).toMatchObject({
			conceptId: "c1",
		});
	});

	it("preserves reversible joins through a versioned JSON backup", () => {
		const project = migrateProjectData(
			makeUserData({
				seg1: ["One ", "two"],
				seg2: ["Eins ", "zwei"],
				checked: [true, false],
			}),
		);
		project.translationData = combineSegmentData(
			project.translationData,
			0,
		).data;

		const restored = migrateProjectData(JSON.parse(buildJsonSaveFile(project)));
		const split = splitSegmentData(restored.translationData, 0, 4);

		expect(restored.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
		expect(split.restoredJoinBoundary).toBe(true);
		expect(split.data.seg1).toEqual(["One ", "two"]);
		expect(split.data.seg2).toEqual(["Eins ", "zwei"]);
		expect(split.data.checked).toEqual([true, false]);
	});

	it("retains FF-500 Office profile metadata and original binary resources", async () => {
		const original = new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 7, 8, 9])], {
			type: "application/vnd.ms-excel.sheet.binary.macroenabled.12",
		});
		const project = makeUserData({
			type: "legacy-office",
			typeRef: {
				profile: "legacy-office-browser",
				subtype: "xls",
				sourceExtension: "xlsb",
			},
			segmentsMeta: [
				{
					profile: "legacy-office-browser",
					subtype: "xls",
					sourceExtension: "xlsb",
					sheet: "Main",
					cell: "A1",
				},
			],
		});
		project.translationData.skeleton = {
			schemaVersion: 1,
			format: "legacy-office",
			source: {
				name: "binary.xlsb",
				mimeType: original.type,
				originalFile: original,
			},
			payload: { kind: "package", parts: {} },
			replacements: [],
		};

		const migrated = migrateProjectData(project);
		expect(migrated.translationData.typeRef).toMatchObject({
			profile: "legacy-office-browser",
			sourceExtension: "xlsb",
		});
		expect(migrated.translationData.segmentsMeta?.[0]).toMatchObject({
			sourceExtension: "xlsb",
			sheet: "Main",
			cell: "A1",
		});
		expect(
			new Uint8Array(
				await migrated.translationData.skeleton!.source.originalFile!.arrayBuffer(),
			),
		).toEqual(new Uint8Array(await original.arrayBuffer()));
	});

	it("retains FF-501 ODF family metadata and inert package resources", async () => {
		const original = new Blob([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3])], {
			type: "application/vnd.oasis.opendocument.text-master",
		});
		const embedded = new Blob([new Uint8Array([0, 255, 128, 1])]);
		const project = makeUserData({
			type: "odf",
			typeRef: {
				profile: "odm",
				mimeType: "application/vnd.oasis.opendocument.text-master",
			},
			segmentsMeta: [
				{
					profile: "odf-odm",
					part: "content.xml",
					path: ["office:document-content[1]", "#text"],
					location: "text",
					start: 10,
					end: 14,
					originalValue: "Text",
				},
			],
		});
		project.translationData.skeleton = {
			schemaVersion: 1,
			format: "odf",
			source: {
				name: "master.odm",
				mimeType: original.type,
				originalFile: original,
			},
			payload: {
				kind: "package",
				parts: { "Object 1/data.bin": embedded },
			},
			replacements: [],
		};

		const migrated = migrateProjectData(project);
		expect(migrated.translationData.typeRef).toMatchObject({
			profile: "odm",
			mimeType: "application/vnd.oasis.opendocument.text-master",
		});
		expect(migrated.translationData.segmentsMeta?.[0]).toMatchObject({
			profile: "odf-odm",
			part: "content.xml",
		});
		expect(
			new Uint8Array(
				await (
					migrated.translationData.skeleton!.payload as {
						kind: "package";
						parts: Record<string, Blob>;
					}
				).parts["Object 1/data.bin"].arrayBuffer(),
			),
		).toEqual(new Uint8Array([0, 255, 128, 1]));
	});

	it("retains FF-502 server-page profile, encoding, and original source bytes", async () => {
		const bytes = new Uint8Array([0xff, 0xfe, 0x3c, 0x00, 0x25, 0x00]);
		const original = new Blob([bytes], { type: "text/x-jsp" });
		const project = makeUserData({
			type: "html",
			typeRef: {
				profile: "jsp",
				sourceExtension: "jsp",
				mimeType: "text/x-jsp",
			},
			segmentsMeta: [
				{
					kind: "text",
					path: [0, 0],
					start: 10,
					end: 15,
					sourceText: "Hello",
				},
			],
		});
		project.translationData.skeleton = {
			schemaVersion: 1,
			format: "html",
			source: {
				name: "page.jsp",
				mimeType: "text/x-jsp",
				encoding: "utf-16le",
				hasBom: true,
				originalFile: original,
			},
			payload: { kind: "text", content: "<p>Hello</p>" },
			replacements: [],
		};

		const migrated = migrateProjectData(project);
		expect(migrated.translationData.typeRef).toMatchObject({
			profile: "jsp",
			sourceExtension: "jsp",
		});
		expect(migrated.translationData.skeleton?.source).toMatchObject({
			encoding: "utf-16le",
			hasBom: true,
		});
		expect(
			new Uint8Array(
				await migrated.translationData.skeleton!.source.originalFile!.arrayBuffer(),
			),
		).toEqual(bytes);
	});

	it("retains FF-504 legacy bilingual mappings and protected source bytes", async () => {
		const original = new Blob(
			[
				'<TRADOStag><Body><Tu id="u1"><Tuv>Hello</Tuv><Tuv>Hallo</Tuv></Tu></Body></TRADOStag>',
			],
			{ type: "application/xml" },
		);
		const project = makeUserData({
			type: "legacy-bilingual",
			typeRef: {
				profile: "ttx",
				sourceExtension: "ttx",
				warnings: [],
			},
			segmentsMeta: [
				{
					profile: "ttx",
					unitId: "u1",
					originalSource: "Hello",
					originalTarget: "Hallo",
					locked: false,
					start: 50,
					end: 55,
					targetMode: "inner",
					targetQName: "Tuv",
					tokens: {},
					requiredTokens: [],
				},
			],
		});
		project.translationData.skeleton = {
			schemaVersion: 1,
			format: "legacy-bilingual",
			source: {
				name: "job.ttx",
				mimeType: original.type,
				encoding: "utf-8",
				hasBom: false,
				originalFile: original,
			},
			payload: { kind: "text", content: await original.text() },
			replacements: [],
		};

		const migrated = migrateProjectData(project);
		expect(migrated.translationData.type).toBe("legacy-bilingual");
		expect(migrated.translationData.typeRef).toMatchObject({
			profile: "ttx",
			sourceExtension: "ttx",
		});
		expect(migrated.translationData.segmentsMeta?.[0]).toMatchObject({
			profile: "ttx",
			unitId: "u1",
		});
		expect(
			await migrated.translationData.skeleton!.source.originalFile!.text(),
		).toContain("TRADOStag");
	});

	it("retains FF-508 specialist vocabulary metadata and positional source bytes", async () => {
		const content =
			'<mulix source-language="en" target-language="de"><entry id="one"><source>Hello</source><target>Hallo</target><note>Keep</note></entry></mulix>';
		const original = new Blob([content], { type: "application/xml" });
		const project = makeUserData({
			type: "specialist-xml",
			typeRef: {
				profile: "mulix",
				sourceExtension: "mulix",
				root: "mulix",
			},
			segmentsMeta: [
				{
					kind: "text",
					path: ["mulix[1]", "entry[1]", "target[1]", "#text"],
					start: 100,
					end: 105,
					originalValue: "Hallo",
					separator: "",
				},
			],
		});
		project.translationData.skeleton = {
			schemaVersion: 1,
			format: "specialist-xml",
			source: {
				name: "catalog.mulix",
				mimeType: original.type,
				encoding: "utf-8",
				hasBom: false,
				originalFile: original,
			},
			payload: { kind: "text", content },
			replacements: [],
		};

		const migrated = migrateProjectData(project);
		expect(migrated.translationData.type).toBe("specialist-xml");
		expect(migrated.translationData.typeRef).toMatchObject({
			profile: "mulix",
			sourceExtension: "mulix",
		});
		expect(migrated.translationData.segmentsMeta?.[0]).toMatchObject({
			kind: "text",
			originalValue: "Hallo",
		});
		expect(
			await migrated.translationData.skeleton!.source.originalFile!.text(),
		).toBe(content);
	});
});
