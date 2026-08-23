import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMAT_ADAPTERS } from "./registry";
import { FORMAT_CONFORMANCE_FIXTURES } from "../../test/formatConformanceFixtures";
import {
	projectFromConformanceImport,
	snapshotExtraction,
} from "../../test/formatConformance";

afterEach(() => vi.restoreAllMocks());

describe("browser adapter import/edit/export smoke tests", () => {
	for (const fixture of FORMAT_CONFORMANCE_FIXTURES) {
		it(`${fixture.id} browser import/edit/export flow`, async () => {
			const adapter = FORMAT_ADAPTERS.find((entry) => entry.id === fixture.id);
			if (!adapter) throw new Error(`Missing ${fixture.id} adapter.`);
			const importFixture =
				fixture.importFile ??
				((file: File, options) => adapter.importFile(file, options));
			const source = await fixture.createValidFile();
			const imported = await importFixture(source, fixture.importOptions);
			const project = projectFromConformanceImport(
				fixture,
				imported,
				fixture.translatedSegments,
			);
			let downloaded: Blob | undefined;
			let downloadName = "";
			const createUrl = vi
				.spyOn(URL, "createObjectURL")
				.mockImplementation((value) => {
					downloaded = value as Blob;
					return "blob:open-tlc-conformance";
				});
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(function (this: HTMLAnchorElement) {
					downloadName = this.download;
				});
			vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

			if (!adapter.capabilities.export) {
				await expect(adapter.exportFile(project)).rejects.toThrow(
					/import-only|protected import/i,
				);
				expect(createUrl).not.toHaveBeenCalled();
				expect(click).not.toHaveBeenCalled();
				return;
			}
			await adapter.exportFile(project);

			expect(createUrl).toHaveBeenCalledOnce();
			expect(click).toHaveBeenCalledOnce();
			expect(downloaded).toBeInstanceOf(Blob);
			if (!adapter.capabilities.roundTrip) {
				const expectedOutput =
					fixture.browserDerivedOutput ?? fixture.derivedOutput;
				expect(expectedOutput).toBeDefined();
				expect(downloaded!.type).toBe(expectedOutput!.mimeType);
				expect(downloadName).toMatch(
					new RegExp(`${expectedOutput!.downloadSuffix.replace(".", "\\.")}$`),
				);
				if (expectedOutput!.translatedMarkers.length > 0) {
					const text = await downloaded!.text();
					for (const marker of expectedOutput!.translatedMarkers)
						expect(text).toContain(marker);
				}
				return;
			}
			const reimported = await importFixture(
				new File([downloaded!], downloadName, {
					type: downloaded!.type || fixture.mimeType,
				}),
				fixture.importOptions,
			);
			if (fixture.expectTranslatedTargetSegments) {
				expect(reimported.kind).toBe("segments");
				if (reimported.kind !== "segments")
					throw new Error("Expected bilingual segment import");
				expect(reimported.targetSegments).toEqual(fixture.translatedSegments);
			} else {
				expect(snapshotExtraction(reimported).segments).toEqual(
					fixture.translatedSegments,
				);
			}
		});
	}
});
