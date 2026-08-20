import { describe, expect, it } from "vitest";
import { filterWithSourceIndexes } from "./resourceFiltering";

describe("resource filtering", () => {
	it("retains the original identity of filtered TM/TB records", () => {
		const records = ["first", "hidden", "wanted", "last"];
		const filtered = filterWithSourceIndexes(records, (value) =>
			value.includes("want"),
		);
		expect(filtered).toEqual([{ item: "wanted", sourceIndex: 2 }]);
		records.splice(filtered[0].sourceIndex, 1);
		expect(records).toEqual(["first", "hidden", "last"]);
	});
});
