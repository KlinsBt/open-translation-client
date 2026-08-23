import { describe, expect, it } from "vitest";
import aboutPage from "../../routes/(main)/about/+page.svelte?raw";

import { FORMAT_ADAPTERS } from "./registry";
import {
	FORMAT_SUPPORT_LABELS,
	FORMAT_WORKFLOW_COUNT,
	SUPPORT_GROUP_IDS,
} from "./supportCatalog";

describe("public format support catalog", () => {
	it("matches every registered adapter id and label exactly", () => {
		const registry = Object.fromEntries(
			FORMAT_ADAPTERS.map(({ id, label }) => [id, label]),
		);
		expect(FORMAT_SUPPORT_LABELS).toEqual(registry);
		expect(FORMAT_WORKFLOW_COUNT).toBe(FORMAT_ADAPTERS.length);
	});

	it("places every adapter in exactly one public group", () => {
		const grouped = SUPPORT_GROUP_IDS.flatMap(({ ids }) => ids).sort();
		expect(grouped).toEqual(FORMAT_ADAPTERS.map(({ id }) => id).sort());
		expect(new Set(grouped).size).toBe(grouped.length);
	});

	it("keeps public workflow counts derived from the shared catalog", () => {
		expect(aboutPage).toContain("{FORMAT_WORKFLOW_COUNT} registered");
		expect(aboutPage).not.toMatch(/\b\d+ registered format workflows/);
	});
});
