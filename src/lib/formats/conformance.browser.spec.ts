import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMAT_ADAPTERS } from "./registry";
import { FORMAT_CONFORMANCE_FIXTURES } from "../../test/formatConformanceFixtures";
import {
	outputFile,
	projectFromConformanceImport,
	snapshotExtraction,
} from "../../test/formatConformance";

afterEach(() => vi.restoreAllMocks());

describe("browser adapter import/edit/export smoke tests", () => {
	for (const fixture of FORMAT_CONFORMANCE_FIXTURES) {
		it(`imports, edits, downloads, and reimports ${fixture.id}`, async () => {
			const adapter = FORMAT_ADAPTERS.find((entry) => entry.id === fixture.id);
			if (!adapter) throw new Error(`Missing ${fixture.id} adapter.`);
			const source = await fixture.createValidFile();
			const imported = await adapter.importFile(source, fixture.importOptions);
			const project = projectFromConformanceImport(
				fixture,
				imported,
				fixture.translatedSegments,
			);
			let downloaded: Blob | undefined;
			const createUrl = vi
				.spyOn(URL, "createObjectURL")
				.mockImplementation((value) => {
					downloaded = value as Blob;
					return "blob:open-tlc-conformance";
				});
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(() => undefined);
			vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

			await adapter.exportFile(project);

			expect(createUrl).toHaveBeenCalledOnce();
			expect(click).toHaveBeenCalledOnce();
			expect(downloaded).toBeInstanceOf(Blob);
			const reimported = await adapter.importFile(
				outputFile(fixture, downloaded!),
				fixture.importOptions,
			);
			expect(snapshotExtraction(reimported).segments).toEqual(
				fixture.translatedSegments,
			);
		});
	}
});
