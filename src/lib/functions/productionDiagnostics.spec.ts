import { describe, expect, it, vi } from "vitest";
import {
	reportProductionError,
	reportProductionWarning,
} from "$lib/functions/productionDiagnostics";

describe("production diagnostics", () => {
	it("reports only a safe error category", () => {
		const error = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		reportProductionError(
			"Project import failed",
			new Error("secret source and target content"),
		);

		expect(error).toHaveBeenCalledWith(
			"[Open TLC] Project import failed (Error)",
		);
		expect(JSON.stringify(error.mock.calls)).not.toContain("secret");
		error.mockRestore();
	});

	it("does not stringify arbitrary thrown values", () => {
		const warning = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		reportProductionWarning("Preferences reset", {
			importedText: "private terminology",
		});

		expect(warning).toHaveBeenCalledWith(
			"[Open TLC] Preferences reset (object)",
		);
		expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
		warning.mockRestore();
	});
});
