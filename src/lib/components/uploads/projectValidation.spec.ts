import { describe, expect, it } from "vitest";

import { getProjectSetupError } from "./projectValidation";

describe("new project validation", () => {
	it("requires a meaningful project name", () => {
		expect(getProjectSetupError("  ", "English (en)", "German (de)")).toMatch(
			/project name/,
		);
	});

	it("requires two selected, different languages", () => {
		expect(getProjectSetupError("Project", "", "German (de)")).toMatch(
			/source and target/,
		);
		expect(
			getProjectSetupError("Project", "English (en)", "English (en)"),
		).toMatch(/different/);
	});

	it("accepts a complete project setup", () => {
		expect(
			getProjectSetupError(" Project ", "English (en)", "German (de)"),
		).toBeNull();
	});
});
