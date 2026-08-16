// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
	applyJsonSkeleton,
	applyTextSkeleton,
	createPlainTextSkeleton,
	createSkeletonFromLegacy,
	findJsonPrimitiveLocations,
	synchronizeSkeletonReplacements,
	validateDocumentSkeleton,
	type JsonValueReplacement,
} from "./skeleton";

describe("JSON skeleton locations", () => {
	it("finds exact primitive ranges in nested objects and arrays", () => {
		const content =
			'{\n  "title": "Hello \\"world\\"",\n  "items": [true, null, 12.5]\n}\n';
		const locations = findJsonPrimitiveLocations(content);

		expect(locations.map((location) => location.path)).toEqual([
			["title"],
			["items", "0"],
			["items", "1"],
			["items", "2"],
		]);
		expect(locations.map((location) => location.value)).toEqual([
			'Hello "world"',
			true,
			null,
			12.5,
		]);
		for (const location of locations) {
			expect(JSON.parse(content.slice(location.start, location.end))).toBe(
				location.value,
			);
		}
	});

	it("patches only value ranges and preserves formatting and property order", () => {
		const content = '{ "z": "One. Two!", "a": 2, "untouched": false }\n';
		const [message] = findJsonPrimitiveLocations(content);
		const replacements: JsonValueReplacement[] = [
			{
				kind: "json-value",
				unitIndex: 0,
				path: ["z"],
				start: message.start,
				end: message.end,
				valueType: "string",
				separator: ". ",
			},
			{
				kind: "json-value",
				unitIndex: 1,
				path: ["z"],
				start: message.start,
				end: message.end,
				valueType: "string",
				separator: "!",
			},
		];

		expect(applyJsonSkeleton(content, replacements, ["Eins.", "Zwei!"])).toBe(
			'{ "z": "Eins. Zwei!", "a": 2, "untouched": false }\n',
		);
	});
});

describe("text and compatibility skeletons", () => {
	it("reports malformed persisted skeletons instead of throwing", () => {
		expect(
			validateDocumentSkeleton({ schemaVersion: 1 } as never),
		).toMatchObject({ valid: false });
	});

	it("preserves untouched gaps and line endings around translated ranges", async () => {
		const content = "First line.\r\n\r\nSecond line.";
		const file = new File([content], "notes.txt", { type: "text/plain" });
		const skeleton = await createPlainTextSkeleton(file, content, [
			"First line.",
			"Second line.",
		]);
		const replacements = skeleton.replacements.filter(
			(replacement) => replacement.kind === "text-range",
		);

		expect(
			applyTextSkeleton(content, replacements, [
				"Erste Zeile.",
				"Zweite Zeile.",
			]),
		).toBe("Erste Zeile.\r\n\r\nZweite Zeile.");
		expect(await skeleton.source.originalFile?.text()).toBe(content);
		expect(validateDocumentSkeleton(skeleton)).toEqual({
			valid: true,
			issues: [],
		});
	});

	it("backfills legacy HTML locations and realigns them after a split", () => {
		const skeleton = createSkeletonFromLegacy({
			format: "html",
			name: "page",
			typeRef: "<p>Hello world</p>",
			segments: ["Hello world"],
			segmentsMeta: [{ kind: "text", path: [0], separator: "" }],
		});
		const synchronized = synchronizeSkeletonReplacements(
			skeleton,
			["Hello ", "world"],
			[
				{ kind: "text", path: [0], separator: "" },
				{ kind: "text", path: [0], separator: "" },
			],
		);

		expect(synchronized?.replacements).toEqual([
			{ kind: "html-text", unitIndex: 0, path: [0], separator: "" },
			{ kind: "html-text", unitIndex: 1, path: [0], separator: "" },
		]);
	});
});
