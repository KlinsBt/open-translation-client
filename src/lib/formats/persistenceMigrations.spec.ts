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
});
