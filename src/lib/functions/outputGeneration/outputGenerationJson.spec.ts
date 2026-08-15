import { describe, expect, it } from "vitest";
import {
	buildFlatSegMeta,
	reconstructJsonFromValues,
	resolveJsonSegmentMeta,
} from "./outputGenerationJson";
import { makeUserData } from "../../../test/fixtures";

describe("JSON output reconstruction", () => {
	it("reconstructs legacy count-based segments without mutating source data", () => {
		const source = { title: "Hello. Next!", nested: { count: 2 } };
		const output = reconstructJsonFromValues(
			source,
			["Hallo. ", "Weiter!", "3"],
			[2, 1],
		);
		expect(output).toEqual({ title: "Hallo. Weiter!", nested: { count: "3" } });
		expect(source).toEqual({ title: "Hello. Next!", nested: { count: 2 } });
	});

	it("reconstructs path metadata for nested objects and arrays", () => {
		const output = reconstructJsonFromValues(
			{ section: { text: "old" }, items: ["old"] },
			["Neu", "Wert"],
			[{ path: ["section", "text"], separator: "." }, { path: ["items", "0"] }],
		);
		expect(output).toEqual({ section: { text: "Neu." }, items: ["Wert"] });
	});

	it("joins repeated path entries and avoids duplicate separators", () => {
		const output = reconstructJsonFromValues(
			{ message: "old" },
			["First. ", "Second!"],
			[
				{ path: ["message"], separator: ". " },
				{ path: ["message"], separator: "!" },
			],
		);
		expect(output.message).toBe("First. Second!");
	});

	it("builds one fallback metadata entry per primitive leaf", () => {
		expect(buildFlatSegMeta({ a: 1, nested: { b: true, c: "text" } })).toEqual([
			1, 1, 1,
		]);
	});

	it("prefers edited segment metadata over the immutable upload metadata", () => {
		const source = { message: "One. Two!" };
		const translation = makeUserData({
			type: "json",
			typeRef: {
				data: source,
				meta: [
					{ path: ["message"], separator: ". " },
					{ path: ["message"], separator: "!" },
				],
			} as any,
			seg1: ["One. Two!"],
			seg2: ["Eins. Zwei!"],
			checked: [false],
			segmentsMeta: [{ path: ["message"], separator: "!" }],
		}).translationData;

		expect(resolveJsonSegmentMeta(translation, source)).toEqual([
			{ path: ["message"], separator: "!" },
		]);
	});
});
