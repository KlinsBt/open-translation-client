import { FORMAT_IDS, type FormatId } from "./formatIds";
import type { TbData, TmData, UserData } from "$lib/types/types";

export const PROJECT_SCHEMA_VERSION = 1;
export const TM_SCHEMA_VERSION = 1;
export const TB_SCHEMA_VERSION = 1;

export type PersistenceRecordKind =
	| "project"
	| "translation memory"
	| "termbase";

export type PersistenceMigrationErrorCode =
	| "INVALID_RECORD"
	| "INVALID_VERSION"
	| "FUTURE_VERSION"
	| "MISSING_MIGRATION";

export class PersistenceMigrationError extends Error {
	readonly name = "PersistenceMigrationError";

	constructor(
		readonly code: PersistenceMigrationErrorCode,
		readonly recordKind: PersistenceRecordKind,
		message: string,
		readonly version?: number,
	) {
		super(message);
	}
}

type UnknownRecord = Record<string, unknown>;
type Migration = (record: UnknownRecord) => UnknownRecord;

const PROJECT_MIGRATIONS: Readonly<Record<number, Migration>> = {
	0: migrateProjectV0ToV1,
};

const TM_MIGRATIONS: Readonly<Record<number, Migration>> = {
	0: (record) => ({ ...record, schemaVersion: 1 }),
};

const TB_MIGRATIONS: Readonly<Record<number, Migration>> = {
	0: (record) => ({ ...record, schemaVersion: 1 }),
};

export function migrateProjectData(input: unknown): UserData {
	const migrated = runMigrations(
		input,
		"project",
		PROJECT_SCHEMA_VERSION,
		PROJECT_MIGRATIONS,
	);
	validateOptionalId(migrated.id, "project");
	const translation = requireRecord(
		migrated.translationData,
		"project",
		"The project has no translationData object.",
	);
	const seg1 = stringArray(translation.seg1, "project", "seg1");
	const seg2 = stringArray(translation.seg2, "project", "seg2");
	if (seg1.length !== seg2.length)
		throw invalid(
			"project",
			`Source and target segment counts differ (${seg1.length} vs ${seg2.length}).`,
		);
	const checked = booleanArrayOrDefault(translation.checked, seg1.length);
	if (checked.length !== seg1.length)
		throw invalid(
			"project",
			`The checked-state count differs from the segment count (${checked.length} vs ${seg1.length}).`,
		);
	const type = translation.type;
	if (typeof type !== "string" || !FORMAT_IDS.includes(type as FormatId))
		throw invalid(
			"project",
			`Unsupported or missing project format “${String(type)}”.`,
		);

	return {
		...migrated,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		...(typeof migrated.id === "number" ? { id: migrated.id } : {}),
		translationData: {
			...translation,
			name: stringOr(translation.name, "Untitled project"),
			targetLang: stringOr(translation.targetLang, ""),
			sourceLang: stringOr(translation.sourceLang, ""),
			creationDate:
				typeof translation.creationDate === "number"
					? String(translation.creationDate)
					: stringOr(translation.creationDate, "0"),
			seg1,
			seg2,
			checked,
			type: type as FormatId,
			typeRef:
				typeof translation.typeRef === "string" || isRecord(translation.typeRef)
					? (translation.typeRef as UserData["translationData"]["typeRef"])
					: {},
			...(Array.isArray(translation.segmentsMeta)
				? {
						segmentsMeta: [
							...translation.segmentsMeta,
						] as UserData["translationData"]["segmentsMeta"],
					}
				: {}),
			...(Array.isArray(translation.segmentJoinStates)
				? {
						segmentJoinStates: [
							...translation.segmentJoinStates,
						] as UserData["translationData"]["segmentJoinStates"],
					}
				: {}),
			...(Array.isArray(translation.parsingTokens) &&
			translation.parsingTokens.every((token) => typeof token === "string")
				? { parsingTokens: [...translation.parsingTokens] as string[] }
				: {}),
			tm: normalizeResourceReference(translation.tm),
			tb: normalizeResourceReference(translation.tb),
		} as UserData["translationData"],
	} as UserData;
}

export function migrateTmData(input: unknown): TmData {
	const migrated = runMigrations(
		input,
		"translation memory",
		TM_SCHEMA_VERSION,
		TM_MIGRATIONS,
	);
	validateOptionalId(migrated.id, "translation memory");
	if (!Array.isArray(migrated.terms))
		throw invalid(
			"translation memory",
			"The translation memory has no terms array.",
		);
	const terms = migrated.terms.map((term, index) => {
		const record = requireRecord(
			term,
			"translation memory",
			`Translation unit ${index + 1} is not an object.`,
		);
		const source = normalizeTmVariant(record.source, index, "source");
		if (!Array.isArray(record.target))
			throw invalid(
				"translation memory",
				`Translation unit ${index + 1} has no target array.`,
			);
		return {
			...record,
			source,
			target: record.target.map((target, targetIndex) =>
				normalizeTmVariant(target, index, `target ${targetIndex + 1}`),
			),
		};
	});
	return {
		...migrated,
		schemaVersion: TM_SCHEMA_VERSION,
		...(typeof migrated.id === "number" ? { id: migrated.id } : {}),
		name: stringOr(migrated.name, "Unnamed TM"),
		terms,
	} as TmData;
}

export function migrateTbData(input: unknown): TbData {
	const migrated = runMigrations(
		input,
		"termbase",
		TB_SCHEMA_VERSION,
		TB_MIGRATIONS,
	);
	validateOptionalId(migrated.id, "termbase");
	if (!Array.isArray(migrated.entries))
		throw invalid("termbase", "The termbase has no entries array.");
	const entries = migrated.entries.map((entry, entryIndex) => {
		const record = requireRecord(
			entry,
			"termbase",
			`Term entry ${entryIndex + 1} is not an object.`,
		);
		if (!Array.isArray(record.terms))
			throw invalid(
				"termbase",
				`Term entry ${entryIndex + 1} has no terms array.`,
			);
		return {
			...record,
			terms: record.terms.map((term, termIndex) => {
				const value = requireRecord(
					term,
					"termbase",
					`Term ${termIndex + 1} in entry ${entryIndex + 1} is not an object.`,
				);
				const notes = Array.isArray(value.notes)
					? value.notes.filter(
							(note) =>
								typeof note === "string" ||
								(isRecord(note) && typeof note.text === "string"),
						)
					: [];
				return {
					...value,
					lang: stringOr(value.lang, ""),
					term: stringOr(value.term, ""),
					notes,
				};
			}),
		};
	});
	return {
		...migrated,
		schemaVersion: TB_SCHEMA_VERSION,
		...(typeof migrated.id === "number" ? { id: migrated.id } : {}),
		name: stringOr(migrated.name, "Unnamed TB"),
		entries,
	} as TbData;
}

function runMigrations(
	input: unknown,
	recordKind: PersistenceRecordKind,
	currentVersion: number,
	migrations: Readonly<Record<number, Migration>>,
): UnknownRecord {
	let record = {
		...requireRecord(
			input,
			recordKind,
			`The ${recordKind} record is not an object.`,
		),
	};
	let version = readVersion(record.schemaVersion, recordKind);
	if (version > currentVersion)
		throw new PersistenceMigrationError(
			"FUTURE_VERSION",
			recordKind,
			`This ${recordKind} uses schema version ${version}, but this Open TLC build supports only version ${currentVersion}. Update Open TLC before opening it.`,
			version,
		);
	while (version < currentVersion) {
		const migration = migrations[version];
		if (!migration)
			throw new PersistenceMigrationError(
				"MISSING_MIGRATION",
				recordKind,
				`No ${recordKind} migration exists from schema version ${version}.`,
				version,
			);
		record = migration(record);
		const nextVersion = readVersion(record.schemaVersion, recordKind);
		if (nextVersion <= version)
			throw new PersistenceMigrationError(
				"MISSING_MIGRATION",
				recordKind,
				`The ${recordKind} migration from version ${version} did not advance the schema.`,
				version,
			);
		version = nextVersion;
	}
	return record;
}

function migrateProjectV0ToV1(record: UnknownRecord): UnknownRecord {
	if (isRecord(record.translationData))
		return {
			...record,
			schemaVersion: 1,
			translationData: { ...record.translationData },
		};
	if (Array.isArray(record.seg1) && Array.isArray(record.seg2)) {
		const { id, ...legacyTranslation } = record;
		return {
			...(typeof id === "number" ? { id } : {}),
			schemaVersion: 1,
			translationData: legacyTranslation,
		};
	}
	throw invalid(
		"project",
		"The legacy project has no recognizable translation data.",
	);
}

function normalizeResourceReference(
	value: unknown,
): NonNullable<UserData["translationData"]["tm"]> {
	if (!isRecord(value)) return { id: null, name: null, active: false };
	return {
		...value,
		id: typeof value.id === "number" ? value.id : null,
		name: typeof value.name === "string" ? value.name : null,
		active: value.active === true,
	};
}

function normalizeTmVariant(
	value: unknown,
	unitIndex: number,
	label: string,
): { lang: string; segment: string } {
	const record = requireRecord(
		value,
		"translation memory",
		`Translation unit ${unitIndex + 1} ${label} is not an object.`,
	);
	if (typeof record.lang !== "string" || typeof record.segment !== "string")
		throw invalid(
			"translation memory",
			`Translation unit ${unitIndex + 1} ${label} needs string lang and segment values.`,
		);
	return { ...record, lang: record.lang, segment: record.segment };
}

function validateOptionalId(
	value: unknown,
	recordKind: PersistenceRecordKind,
): void {
	if (
		value !== undefined &&
		(typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
	)
		throw invalid(recordKind, "The record id must be a non-negative integer.");
}

function readVersion(
	value: unknown,
	recordKind: PersistenceRecordKind,
): number {
	if (value === undefined) return 0;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
		throw new PersistenceMigrationError(
			"INVALID_VERSION",
			recordKind,
			`The ${recordKind} schema version must be a non-negative integer.`,
		);
	return value;
}

function requireRecord(
	value: unknown,
	recordKind: PersistenceRecordKind,
	message: string,
): UnknownRecord {
	if (!isRecord(value)) throw invalid(recordKind, message);
	return value;
}

function stringArray(
	value: unknown,
	recordKind: PersistenceRecordKind,
	field: string,
): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
		throw invalid(recordKind, `${field} must be an array of strings.`);
	return [...value];
}

function booleanArrayOrDefault(value: unknown, length: number): boolean[] {
	if (value === undefined) return Array.from({ length }, () => false);
	if (
		!Array.isArray(value) ||
		!value.every((item) => typeof item === "boolean")
	)
		return [];
	return [...value];
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(
	recordKind: PersistenceRecordKind,
	message: string,
): PersistenceMigrationError {
	return new PersistenceMigrationError("INVALID_RECORD", recordKind, message);
}
