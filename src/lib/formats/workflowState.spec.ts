// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { getProjectsProgressStatistics } from "$lib/functions/statistics";
import { getProjectCompletionSummary } from "./qualityAssurance";
import { buildConvertedTranslation } from "$lib/functions/outputGeneration/convertedExport";
import { buildXliff12 } from "./xliff12";

describe("independent lock and workflow state", () => {
	it("does not count a locked draft as confirmed in statistics, QA, XLIFF, or CSV", async () => {
		const project = makeUserData({
			seg1: ["Locked source", "Reviewed source"],
			seg2: ["Locked draft", "Reviewed target"],
			checked: [false, true],
			locked: [true, false],
		});

		expect(getProjectsProgressStatistics([project]).slice(0, 2)).toEqual([
			50, 0,
		]);
		expect(getProjectCompletionSummary(project).unconfirmedUnits).toEqual([0]);

		const xliff = buildXliff12(project);
		const document = new DOMParser().parseFromString(xliff, "application/xml");
		const units = Array.from(document.getElementsByTagName("trans-unit"));
		expect(units[0].getAttribute("approved")).not.toBe("yes");
		expect(units[1].getAttribute("approved")).toBe("yes");

		const csv = await buildConvertedTranslation(project, "csv");
		const csvText = await csv.blob.text();
		expect(csvText).toContain('"1","Locked source","Locked draft","draft"');
		expect(csvText).toContain(
			'"2","Reviewed source","Reviewed target","confirmed"',
		);
	});
});
