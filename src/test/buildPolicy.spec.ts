import { describe, expect, it } from "vitest";
import { isReviewedDocxBufferWarning } from "../buildPolicy.js";

describe("build diagnostic policy", () => {
	it("isolates only docx's unused Node stream buffer branch", () => {
		expect(
			isReviewedDocxBufferWarning(
				'Module "buffer" has been externalized for browser compatibility, imported by "/workspace/node_modules/docx/build/index.mjs".',
			),
		).toBe(true);
		expect(
			isReviewedDocxBufferWarning(
				'Module "buffer" has been externalized for browser compatibility, imported by "/workspace/src/export.ts".',
			),
		).toBe(false);
	});
});
