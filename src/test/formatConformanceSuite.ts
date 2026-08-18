import { describe, expect, it } from "vitest";
import type { FormatAdapter } from "$lib/formats/types";
import type { FormatConformanceFixture } from "./formatConformance";
import {
	blobBytes,
	buildConformanceOutput,
	CONFORMANCE_PERFORMANCE_UNITS,
	CONFORMANCE_UNICODE_SOURCE,
	diffZipPackages,
	outputFile,
	projectFromConformanceImport,
	snapshotExtraction,
} from "./formatConformance";

export function registerFormatConformanceSuite(
	adapters: readonly FormatAdapter[],
	fixtures: readonly FormatConformanceFixture[],
): void {
	describe("format adapter conformance harness", () => {
		it("requires exactly one conformance fixture for every adapter", () => {
			const adapterIds = adapters.map((adapter) => adapter.id).sort();
			const fixtureIds = fixtures.map((fixture) => fixture.id).sort();
			expect(fixtureIds).toEqual(adapterIds);
			expect(new Set(fixtureIds).size).toBe(fixtures.length);
		});

		for (const fixture of fixtures) {
			const adapter = adapters.find((entry) => entry.id === fixture.id);
			if (!adapter)
				throw new Error(`No adapter is registered for ${fixture.id}.`);
			const importFixture =
				fixture.importFile ??
				((file: File, options) => adapter.importFile(file, options));

			describe(`${adapter.label} adapter`, () => {
				it("matches its extraction snapshot", async () => {
					const result = await importFixture(
						await fixture.createValidFile(),
						fixture.importOptions,
					);
					expect(snapshotExtraction(result)).toEqual(
						fixture.extractionSnapshot,
					);
				});

				it("accepts its reference fixture and rejects malformed input", async () => {
					await expect(
						adapter.validate(await fixture.createValidFile()),
					).resolves.toMatchObject({ valid: true });
					const malformed = await fixture.createMalformedFile();
					await expect(adapter.validate(malformed)).resolves.toMatchObject({
						valid: false,
					});
					if (fixture.expectMalformedImportFailure) {
						await expect(
							importFixture(malformed, fixture.importOptions),
						).rejects.toBeDefined();
					}
				});

				it(
					!adapter.capabilities.export
						? "retains the original skeleton and rejects proprietary output"
						: adapter.capabilities.roundTrip
							? "round-trips identity output byte-for-byte"
							: "exports a clearly derived artifact instead of claiming identity",
					async () => {
						const source = await fixture.createValidFile();
						const imported = await importFixture(source, fixture.importOptions);
						const identity = projectFromConformanceImport(
							fixture,
							imported,
							fixture.identityTargetSegments ??
								fixture.extractionSnapshot.segments,
						);
						if (!adapter.capabilities.export) {
							expect(
								identity.translationData.skeleton?.source.originalFile,
							).toBeInstanceOf(Blob);
							await expect(adapter.exportFile(identity)).rejects.toThrow(
								/import-only|protected import/i,
							);
							return;
						}
						const output = await buildConformanceOutput(identity);
						if (adapter.capabilities.roundTrip) {
							expect(await blobBytes(output)).toEqual(await blobBytes(source));
						} else {
							expect(fixture.derivedOutput).toBeDefined();
							expect(output.type).toBe(fixture.derivedOutput!.mimeType);
							if (!fixture.identityOutputMayEqualSource)
								expect(await blobBytes(output)).not.toEqual(
									await blobBytes(source),
								);
						}
					},
				);

				it(
					!adapter.capabilities.export
						? "keeps translated targets in the project without writing the package"
						: adapter.capabilities.roundTrip
							? "validates and reimports translated output"
							: "contains translated content in the derived output",
					async () => {
						const imported = await importFixture(
							await fixture.createValidFile(),
							fixture.importOptions,
						);
						const project = projectFromConformanceImport(
							fixture,
							imported,
							fixture.translatedSegments,
						);
						if (!adapter.capabilities.export) {
							expect(project.translationData.seg2).toEqual(
								fixture.translatedSegments,
							);
							await expect(adapter.exportFile(project)).rejects.toThrow(
								/import-only|protected import/i,
							);
							return;
						}
						const output = await buildConformanceOutput(project);
						if (!adapter.capabilities.roundTrip) {
							expect(fixture.derivedOutput).toBeDefined();
							expect(output.type).toBe(fixture.derivedOutput!.mimeType);
							const text = await output.text();
							for (const marker of fixture.derivedOutput!.translatedMarkers)
								expect(text).toContain(marker);
							return;
						}
						const translatedFile = outputFile(fixture, output);

						await expect(
							adapter.validate(translatedFile),
						).resolves.toMatchObject({
							valid: true,
						});
						const reimported = await importFixture(
							translatedFile,
							fixture.importOptions,
						);
						if (fixture.expectTranslatedTargetSegments) {
							expect(reimported.kind).toBe("segments");
							if (reimported.kind !== "segments")
								throw new Error("Expected bilingual segment import");
							expect(reimported.targetSegments).toEqual(
								fixture.translatedSegments,
							);
						} else {
							expect(snapshotExtraction(reimported).segments).toEqual(
								fixture.translatedSegments,
							);
						}
					},
				);

				it("preserves combining marks, RTL text, and non-BMP Unicode", async () => {
					const result = await importFixture(
						await fixture.createValidFile(),
						fixture.importOptions,
					);
					for (const expectation of fixture.unicodeExpectations ?? [
						CONFORMANCE_UNICODE_SOURCE,
					])
						expect(snapshotExtraction(result).segments).toContain(expectation);
				});

				it(`imports the ${CONFORMANCE_PERFORMANCE_UNITS}-unit performance fixture within its regression budget`, async () => {
					const file = await fixture.createPerformanceFile(
						CONFORMANCE_PERFORMANCE_UNITS,
					);
					const start = performance.now();
					const result = await importFixture(file, fixture.performanceOptions);
					const duration = performance.now() - start;

					expect(snapshotExtraction(result).segments).toHaveLength(
						CONFORMANCE_PERFORMANCE_UNITS,
					);
					expect(duration).toBeLessThan(15_000);
				}, 20_000);

				if (fixture.expectedPackageChanges) {
					it("changes only declared package parts after translation", async () => {
						const source = await fixture.createValidFile();
						const imported = await importFixture(source, fixture.importOptions);
						const project = projectFromConformanceImport(
							fixture,
							imported,
							fixture.translatedSegments,
						);
						const diff = await diffZipPackages(
							source,
							await buildConformanceOutput(project),
						);

						expect(diff.changed).toEqual(fixture.expectedPackageChanges);
						expect(diff.added).toEqual([]);
						expect(diff.removed).toEqual([]);
						expect(diff.unchanged.length).toBeGreaterThan(0);
					});
				}
			});
		}
	});
}
