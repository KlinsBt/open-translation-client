import { describe, expect, it } from "vitest";
import {
	combineNeutralDocumentUnits,
	contentToPlainText,
	createNeutralDocument,
	createTextContent,
	projectNeutralDocument,
	splitNeutralDocumentUnit,
	synchronizeNeutralDocument,
	validateNeutralDocument,
	type NeutralDocument,
} from "./documentModel";

describe("neutral document construction and projection", () => {
	it("creates stable, language-aware units from legacy segments", () => {
		const document = createNeutralDocument({
			format: "json",
			documentId: "project-123",
			sourceSegments: ["Hello", "Files"],
			targetSegments: ["Hallo", ""],
			checked: [true, false],
			sourceLanguage: "en",
			targetLanguage: "de",
			sourceLocations: [
				{ path: ["home", "title"], segmentIndex: 0 },
				{ path: ["home", "files"], segmentIndex: 1 },
			],
		});

		expect(document).toMatchObject({
			schemaVersion: 1,
			id: "project-123",
			format: "json",
			sourceLanguage: "en",
			targetLanguage: "de",
		});
		expect(document.units.map((unit) => unit.id)).toEqual(["unit-1", "unit-2"]);
		expect(document.units[0]).toMatchObject({
			state: "reviewed",
			translatable: true,
			source: { language: "en", preserveWhitespace: true },
			target: { language: "de" },
			sourceLocation: { path: ["home", "title"], segmentIndex: 0 },
		});
		expect(document.units[1].state).toBe("initial");
		expect(projectNeutralDocument(document)).toEqual({
			seg1: ["Hello", "Files"],
			seg2: ["Hallo", ""],
			checked: [true, false],
		});
		expect(validateNeutralDocument(document)).toEqual({
			valid: true,
			issues: [],
		});
	});

	it("deduplicates requested IDs deterministically", () => {
		const document = createNeutralDocument({
			format: "text",
			sourceSegments: ["a", "b", "c"],
			unitIds: ["message", "message", ""],
		});
		expect(document.units.map((unit) => unit.id)).toEqual([
			"message",
			"message-2",
			"unit-2",
		]);
	});

	it("synchronizes plain compatibility fields without changing unit IDs", () => {
		const original = createNeutralDocument({
			format: "text",
			sourceSegments: ["One", "Two"],
			targetSegments: ["", ""],
		});
		const synchronized = synchronizeNeutralDocument(
			original,
			{
				seg1: ["One", "Two"],
				seg2: ["Eins", "Zwei"],
				checked: [false, true],
			},
			"en",
			"de",
		);

		expect(synchronized.units.map((unit) => unit.id)).toEqual([
			"unit-1",
			"unit-2",
		]);
		expect(synchronized.units.map((unit) => unit.state)).toEqual([
			"translated",
			"reviewed",
		]);
		expect(
			synchronized.units.map((unit) => contentToPlainText(unit.target)),
		).toEqual(["Eins", "Zwei"]);
	});
});

describe("rich fragments and invariants", () => {
	function richDocument(): NeutralDocument {
		return {
			schemaVersion: 1,
			id: "xliff-file-1",
			format: "html",
			sourceLanguage: "en",
			targetLanguage: "de",
			units: [
				{
					id: "welcome",
					source: {
						language: "en",
						preserveWhitespace: true,
						fragments: [
							{ kind: "text", text: "Read " },
							{
								kind: "code",
								id: "start-1",
								codeType: "start",
								pairId: "link-1",
								originalData: '<a href="/docs">',
								canDelete: false,
							},
							{ kind: "text", text: "the docs" },
							{
								kind: "code",
								id: "end-1",
								codeType: "end",
								pairId: "link-1",
								originalData: "</a>",
							},
							{
								kind: "code",
								id: "break-1",
								codeType: "standalone",
								originalData: "<br>",
							},
						],
					},
					target: createTextContent(""),
					state: "needs-review",
					translatable: true,
					contexts: [{ type: "resname", value: "welcome.link" }],
					notes: [
						{ id: "note-1", category: "developer", text: "Keep the link." },
					],
					relationships: {
						plural: { groupId: "welcome-count", category: "other" },
						variant: { groupId: "welcome-platform", key: "web" },
					},
					sourceLocation: {
						part: "index.html",
						path: [0, 1, 2],
						line: 12,
						column: 4,
					},
				},
			],
		};
	}

	it("represents paired and standalone codes without flattening them", () => {
		const document = richDocument();
		expect(validateNeutralDocument(document).valid).toBe(true);
		expect(contentToPlainText(document.units[0].source)).toBeUndefined();
		expect(() => projectNeutralDocument(document)).toThrow(
			/protected inline codes/,
		);

		const synchronized = synchronizeNeutralDocument(document, {
			seg1: ["legacy source"],
			seg2: ["legacy target"],
			checked: [false],
		});
		expect(synchronized.units[0].source.fragments).toEqual(
			document.units[0].source.fragments,
		);

		const mismatched = synchronizeNeutralDocument(document, {
			seg1: ["first", "second"],
			seg2: ["", ""],
			checked: [false, false],
		});
		expect(mismatched).toBe(document);
	});

	it("rejects duplicate IDs and improperly nested paired codes", () => {
		const document = richDocument();
		document.units.push({ ...document.units[0] });
		document.units[0].source.fragments = [
			{ kind: "code", id: "a", codeType: "start", pairId: "outer" },
			{ kind: "code", id: "b", codeType: "start", pairId: "inner" },
			{ kind: "code", id: "c", codeType: "end", pairId: "outer" },
			{ kind: "code", id: "d", codeType: "end", pairId: "inner" },
		];
		const validation = validateNeutralDocument(document);
		expect(validation.valid).toBe(false);
		expect(validation.issues.map((issue) => issue.message)).toEqual(
			expect.arrayContaining([
				"Unit IDs must be non-empty and unique.",
				"Paired inline codes must be balanced and properly nested.",
			]),
		);
	});
});

describe("neutral unit structural edits", () => {
	it("keeps the first ID, creates a stable second ID, and rejoins fragments", () => {
		const document = createNeutralDocument({
			format: "text",
			sourceSegments: ["Hello world"],
			targetSegments: ["Hallo Welt"],
			unitIds: ["greeting"],
		});
		const split = splitNeutralDocumentUnit(document, 0, 6, {
			firstTarget: "Hallo Welt",
			secondTarget: "",
			firstChecked: false,
			secondChecked: false,
		});
		expect(split.error).toBeUndefined();
		expect(split.document?.units.map((unit) => unit.id)).toEqual([
			"greeting",
			"greeting~2",
		]);
		expect(
			split.document?.units.map((unit) => contentToPlainText(unit.source)),
		).toEqual(["Hello ", "world"]);

		const joined = combineNeutralDocumentUnits(split.document!, 0);
		expect(joined.error).toBeUndefined();
		expect(joined.document?.units).toHaveLength(1);
		expect(contentToPlainText(joined.document!.units[0].source)).toBe(
			"Hello world",
		);
		expect(joined.document?.units[0].metadata?.joinedUnitIds).toEqual([
			"greeting",
			"greeting~2",
		]);
	});

	it("blocks a split that would cross protected paired content", () => {
		const document = createNeutralDocument({
			format: "html",
			sourceSegments: ["bold after"],
		});
		document.units[0].source.fragments = [
			{ kind: "code", id: "s", codeType: "start", pairId: "strong" },
			{ kind: "text", text: "bold" },
			{ kind: "code", id: "e", codeType: "end", pairId: "strong" },
			{ kind: "text", text: " after" },
		];

		expect(
			splitNeutralDocumentUnit(document, 0, 2, {
				firstTarget: "",
				secondTarget: "",
				firstChecked: false,
				secondChecked: false,
			}).error,
		).toMatch(/protected inline code/);
		expect(
			splitNeutralDocumentUnit(document, 0, 7, {
				firstTarget: "",
				secondTarget: "",
				firstChecked: false,
				secondChecked: false,
			}).document,
		).toBeDefined();
	});
});
