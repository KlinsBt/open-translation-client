import { describe, expect, it } from "vitest";
import { validateXML } from "xmllint-wasm/index-node.js";
import sdlFixture from "../../test/fixtures/xliff-profiles/sample.sdlxliff?raw";
import memoqFixture from "../../test/fixtures/xliff-profiles/sample.mqxliff?raw";
import phraseFixture from "../../test/fixtures/xliff-profiles/sample.mxliff?raw";
import worldServerFixture from "../../test/fixtures/xliff-profiles/worldserver.xlf?raw";
import wpmlFixture from "../../test/fixtures/xliff-profiles/wpml.xliff?raw";
import drupalFixture from "../../test/fixtures/xliff-profiles/drupal-tmgmt.xlf?raw";
import riseFixture from "../../test/fixtures/xliff-profiles/articulate-rise.xlf?raw";
import storylineFixture from "../../test/fixtures/xliff-profiles/articulate-storyline.xlf?raw";
import { importXliffProjectStreaming } from "./streamingImporters";
import { detectProjectFileFormat } from "./detect";
import {
	VendorXliffRequiresSameProfileExportError,
	detectXliffVendorProfile,
	getXliffVendorProfile,
	type XliffUnitProfileMetadata,
	type XliffVendorProfileId,
} from "./xliffProfiles";
import {
	contentToEditableText,
	type Xliff12DocumentMetadata,
	type Xliff12UnitMetadata,
} from "./xliff12";
import { validateNeutralDocument } from "./documentModel";
import { migrateProjectData } from "./persistenceMigrations";
import { buildXliff1_2 } from "$lib/functions/saveFileGeneration/generateXliffSaveFile1_2";
import {
	buildXliff2_0,
	buildXliff2_1,
} from "$lib/functions/saveFileGeneration/generateXliffSaveFile2_0";
import { makeUserData } from "../../test/fixtures";
import { buildVendorXliff, VendorXliffExportError } from "./vendorXliff";
import uploadUi from "$lib/components/uploads/saveFileUploads/saveFileUpload.svelte?raw";
import exportUi from "$lib/components/textSegments/segments.svelte?raw";
import landingPage from "../../routes/(main)/+page.svelte?raw";
import aboutPage from "../../routes/(main)/about/+page.svelte?raw";
import strictXliff12Schema from "../../test/fixtures/xliff12/xliff-core-1.2-strict.xsd?raw";
import xmlSchema from "../../test/fixtures/xliff12/xml.xsd?raw";
import worldServerWrapperSchema from "../../test/fixtures/xliff12/worldserver-conformance-wrapper.xsd?raw";
import worldServerExtensionSchema from "../../test/fixtures/xliff12/worldserver-extension.xsd?raw";
import worldServerCustomExtensionSchema from "../../test/fixtures/xliff12/worldserver-custom-extension.xsd?raw";

const fixtures: Array<{
	id: XliffVendorProfileId;
	name: string;
	xml: string;
	label: string;
}> = [
	{
		id: "sdl-trados",
		name: "manual.sdlxliff",
		xml: sdlFixture,
		label: "SDLXLIFF / Trados Studio",
	},
	{
		id: "memoq",
		name: "website.mqxliff",
		xml: memoqFixture,
		label: "MQXLIFF / memoQ",
	},
	{
		id: "phrase-mxliff",
		name: "catalog.mxliff",
		xml: phraseFixture,
		label: "MXLIFF / Phrase",
	},
	{
		id: "worldserver-wsxliff",
		name: "worldserver.xlf",
		xml: worldServerFixture,
		label: "WorldServer WsXLIFF",
	},
	{
		id: "wordpress-wpml",
		name: "wordpress.xliff",
		xml: wpmlFixture,
		label: "WordPress WPML XLIFF",
	},
	{
		id: "drupal-tmgmt",
		name: "drupal.xlf",
		xml: drupalFixture,
		label: "Drupal TMGMT XLIFF",
	},
	{
		id: "articulate-rise",
		name: "rise-course.xlf",
		xml: riseFixture,
		label: "Articulate Rise XLIFF",
	},
	{
		id: "articulate-storyline",
		name: "storyline.xlf",
		xml: storylineFixture,
		label: "Articulate Storyline XLIFF",
	},
];

function xliffFile(xml: string, name: string): File {
	return new File([xml], name, { type: "application/xliff+xml" });
}

describe("vendor XLIFF profiles", () => {
	it.each(fixtures)(
		"detects and imports $label from structural signatures",
		async ({ id, name, xml, label }) => {
			const detection = await detectProjectFileFormat(xliffFile(xml, name));
			expect(detection).toMatchObject({
				format: "xliff",
				label,
				profileId: id,
				exportPolicy: "same-profile",
				confidence: "high",
			});
			const imported = await importXliffProjectStreaming(xliffFile(xml, name));
			const profile = getXliffVendorProfile(
				imported.data.translationData.documentModel,
			);
			expect(profile).toMatchObject({
				id,
				label,
				exportPolicy: "same-profile",
				exportVerification: "automated-round-trip",
			});
			expect(profile?.evidence).not.toEqual(["extension"]);
			expect(
				validateNeutralDocument(imported.data.translationData.documentModel!),
			).toEqual({ valid: true, issues: [] });
		},
	);

	it("maps SDL segment workflow state and locks by mrk mid", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(sdlFixture, "manual.sdlxliff"),
		);
		const units = imported.data.translationData.documentModel!.units;
		expect(units.map((unit) => unit.id)).toEqual([
			"paragraph-1:1",
			"paragraph-1:2",
		]);
		expect(units.map((unit) => unit.state)).toEqual(["reviewed", "translated"]);
		expect(units.map((unit) => unit.translatable)).toEqual([true, false]);
		expect(
			units.map(
				(unit) =>
					(unit.metadata?.xliffProfile as XliffUnitProfileMetadata).status,
			),
		).toEqual(["ApprovedTranslation", "Translated"]);
		const metadata = imported.data.translationData.documentModel!.metadata
			?.xliff12 as Xliff12DocumentMetadata;
		expect(metadata.rootAttributes["xmlns:sdl"]).toBe(
			"http://sdl.com/FileTypes/SdlXliff/1.0",
		);
		expect(metadata.files[0].headerChildren.join(" ")).toContain(
			"sdl:file-info",
		);
		const unitMetadata = units[0].metadata?.xliff12 as Xliff12UnitMetadata;
		expect(unitMetadata.extensions.join(" ")).toContain("sdl:seg-defs");
	});

	it("maps memoQ and Phrase confirmation and lock attributes", async () => {
		const memoq = await importXliffProjectStreaming(
			xliffFile(memoqFixture, "job.mqxliff"),
		);
		expect(
			memoq.data.translationData.documentModel!.units.map((unit) => [
				unit.state,
				unit.translatable,
			]),
		).toEqual([
			["translated", true],
			["final", false],
		]);

		const phrase = await importXliffProjectStreaming(
			xliffFile(phraseFixture, "job.mxliff"),
		);
		expect(
			phrase.data.translationData.documentModel!.units.map((unit) => [
				unit.state,
				unit.translatable,
			]),
		).toEqual([
			["reviewed", true],
			["initial", false],
		]);
	});

	it("maps WorldServer status and locks from the iws extension", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(worldServerFixture, "job.xlf"),
		);
		expect(
			imported.data.translationData.documentModel!.units.map((unit) => [
				unit.state,
				unit.translatable,
			]),
		).toEqual([
			["reviewed", true],
			["reviewed", false],
		]);
	});

	it("protects embedded CMS and e-learning HTML while exposing editable text", async () => {
		for (const [name, xml, expectedSource] of [
			["wordpress.xliff", wpmlFixture, "Welcome friendToday."],
			["drupal.xlf", drupalFixture, "Visit our site."],
			["storyline.xlf", storylineFixture, "Choose one answer."],
		] as const) {
			const imported = await importXliffProjectStreaming(xliffFile(xml, name));
			const unit = imported.data.translationData.documentModel!.units.at(-1)!;
			expect(contentToEditableText(unit.source)).toBe(expectedSource);
			expect(
				unit.source.fragments.some((fragment) => fragment.kind === "code"),
			).toBe(true);
			expect(
				(unit.metadata?.xliffProfile as XliffUnitProfileMetadata)
					.embeddedMarkupProtected,
			).toBe(true);
		}
	});

	it("retains Drupal paths, size limits, notes, and HTML in profile metadata", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(drupalFixture, "drupal.xlf"),
		);
		const unit = imported.data.translationData.documentModel!.units[0];
		expect(unit.contexts).toEqual(
			expect.arrayContaining([
				{
					type: "drupal-path",
					value: "8050][field_body][0][value",
				},
			]),
		);
		expect(unit.notes[0].text).toBe("Body > Text");
		const metadata = unit.metadata?.xliff12 as Xliff12UnitMetadata;
		expect(metadata.attributes["size-unit"]).toBe("char");
		expect(metadata.targetAttributes.maxwidth).toBe("255");
	});

	it.each(fixtures)(
		"keeps generic serializers separate and exports $label through its same-profile writer",
		async ({ id, name, xml }) => {
			const imported = await importXliffProjectStreaming(xliffFile(xml, name));
			for (const build of [buildXliff1_2, buildXliff2_0, buildXliff2_1])
				expect(() => build(imported.data)).toThrowError(
					VendorXliffRequiresSameProfileExportError,
				);
			const output = buildVendorXliff(imported.data);
			expect(output.profile.id).toBe(id);
			expect(output.extension).toBe(name.split(".").at(-1));
			expect(output.contents).not.toContain('from="OpenTLC"');
			expect(
				detectXliffVendorProfile(
					output.contents,
					output.fileName,
					output.profile.xliffVersion,
				)?.id,
			).toBe(id);
			const reopened = await importXliffProjectStreaming(
				xliffFile(output.contents, output.fileName),
			);
			expect(reopened.data.translationData.seg1).toEqual(
				imported.data.translationData.seg1,
			);
			expect(reopened.data.translationData.seg2).toEqual(
				imported.data.translationData.seg2,
			);
		},
	);

	it("accepts the .xlif and .mqxlf aliases only after XLIFF signatures validate", async () => {
		const generic = `<?xml version="1.0"?><xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2"><file original="plain.txt" source-language="en" datatype="plaintext"><body><trans-unit id="1"><source>Hello</source></trans-unit></body></file></xliff>`;
		expect(
			await detectProjectFileFormat(xliffFile(generic, "project.xlif")),
		).toMatchObject({ format: "xliff", confidence: "high" });
		expect(
			await detectProjectFileFormat(xliffFile(memoqFixture, "project.mqxlf")),
		).toMatchObject({
			format: "xliff",
			profileId: "memoq",
			exportPolicy: "same-profile",
		});
		expect(
			await detectProjectFileFormat(
				new File(["not xml"], "fake.mqxlf", { type: "application/xml" }),
			),
		).toMatchObject({ confidence: "low", evidence: ["extension"] });
		await expect(
			importXliffProjectStreaming(
				new File(["not xml"], "fake.mqxlf", { type: "application/xml" }),
			),
		).rejects.toBeDefined();
	});

	it("advertises aliases and same-profile delivery in upload, export, and public UI", () => {
		expect(uploadUi).toContain(".xlif");
		expect(uploadUi).toContain(".mqxlf");
		expect(uploadUi).toContain("same-profile export");
		expect(exportUi).toContain("handleVendorXliffSaveFileDownload");
		expect(exportUi).toContain("vendorXliffProfile.label");
		expect(landingPage).toContain("WsXLIFF");
		expect(aboutPage).toContain("same-profile export");
	});

	it("round-trips Unicode, RTL text, inline codes, and unknown vendor extensions", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(worldServerFixture, "worldserver.xlf"),
		);
		expect(imported.data.translationData.name).toBe("worldserver");
		imported.data.translationData.seg2[0] = "مرحبًا 👩🏽‍💻 e\u0301 <محمي>";
		const output = buildVendorXliff(imported.data);
		expect(output.fileName).toBe("worldserver.xlf");
		expect(output.contents).toContain("custom:workflow");
		expect(output.contents).toContain("custom:opaque");
		expect(output.contents).toContain('equiv-text="&lt;br&gt;"');
		const officialValidation = await validateXML({
			xml: { fileName: output.fileName, contents: output.contents },
			schema: {
				fileName: "worldserver-conformance-wrapper.xsd",
				contents: worldServerWrapperSchema,
			},
			preload: [
				{ fileName: "xml.xsd", contents: xmlSchema },
				{
					fileName: "xliff-core-1.2-strict.xsd",
					contents: strictXliff12Schema,
				},
				{
					fileName: "worldserver-extension.xsd",
					contents: worldServerExtensionSchema,
				},
				{
					fileName: "worldserver-custom-extension.xsd",
					contents: worldServerCustomExtensionSchema,
				},
			],
		});
		expect(officialValidation.errors, officialValidation.rawOutput).toEqual([]);
		expect(officialValidation.valid).toBe(true);
		const reopened = await importXliffProjectStreaming(
			xliffFile(output.contents, output.fileName),
		);
		expect(reopened.data.translationData.seg2[0]).toBe(
			"مرحبًا 👩🏽‍💻 e\u0301 <محمي>",
		);
	});

	it("rejects edits to locked vendor targets with a helpful error", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(worldServerFixture, "worldserver.xlf"),
		);
		imported.data.translationData.seg2[1] = "changed";
		expect(() => buildVendorXliff(imported.data)).toThrowError(
			VendorXliffExportError,
		);
		expect(() => buildVendorXliff(imported.data)).toThrow(
			/Locked vendor segment 2/,
		);
	});

	it("supports cancellation and generated large vendor XLIFF without fixtures", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			importXliffProjectStreaming(xliffFile(memoqFixture, "cancel.mqxliff"), {
				signal: controller.signal,
			}),
		).rejects.toBeDefined();

		const records = Array.from(
			{ length: 1_500 },
			(_, index) =>
				`<trans-unit id="u${index}" mq:status="NotStarted"><source>Source ${index} — עברית</source><target>Target ${index}</target><mq:opaque key="${index}"/></trans-unit>`,
		).join("");
		const xml = `<?xml version="1.0"?><xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" xmlns:mq="MQXliff" version="1.2"><file original="large.txt" source-language="en" target-language="de" datatype="plaintext"><body>${records}</body></file></xliff>`;
		const imported = await importXliffProjectStreaming(
			xliffFile(xml, "large.mqxliff"),
		);
		expect(imported.data.translationData.seg1).toHaveLength(1_500);
		const output = buildVendorXliff(imported.data);
		expect(output.contents.match(/<mq:opaque\b/g)).toHaveLength(1_500);
	});

	it("keeps vendor profile metadata through Open TLC project persistence", async () => {
		const imported = await importXliffProjectStreaming(
			xliffFile(phraseFixture, "catalog.mxliff"),
		);
		const restored = migrateProjectData(
			JSON.parse(JSON.stringify(imported.data)),
		);
		expect(
			getXliffVendorProfile(restored.translationData.documentModel),
		).toEqual(
			getXliffVendorProfile(imported.data.translationData.documentModel),
		);
		const metadata = restored.translationData.documentModel!.metadata
			?.xliff12 as Xliff12DocumentMetadata;
		expect(metadata.rootAttributes["xmlns:m"]).toBe(
			"http://www.memsource.com/mxlf/2.0",
		);
		expect(metadata.files[0].headerChildren.join(" ")).toContain(
			"m:in-ctx-preview-skel",
		);
		const legacy = JSON.parse(JSON.stringify(imported.data));
		legacy.translationData.documentModel.metadata.xliffProfile.exportPolicy =
			"import-only";
		legacy.translationData.documentModel.metadata.xliffProfile.exportVerification =
			"not-tested-in-originating-tool";
		expect(
			getXliffVendorProfile(
				migrateProjectData(legacy).translationData.documentModel,
			),
		).toMatchObject({
			exportPolicy: "same-profile",
			exportVerification: "automated-round-trip",
		});
	});

	it("does not infer a vendor profile from a filename extension alone", async () => {
		const generic = `<?xml version="1.0"?><xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2"><file original="plain.txt" source-language="en" target-language="de" datatype="plaintext"><body><trans-unit id="1"><source>Hello</source><target>Hallo</target></trans-unit></body></file></xliff>`;
		expect(
			detectXliffVendorProfile(generic, "renamed.mqxliff", "1.2"),
		).toBeUndefined();
		const imported = await importXliffProjectStreaming(
			xliffFile(generic, "renamed.mqxliff"),
		);
		expect(
			getXliffVendorProfile(imported.data.translationData.documentModel),
		).toBeUndefined();
		expect(() => buildXliff1_2(imported.data)).not.toThrow();
	});

	it("does not classify ordinary Open TLC XLIFF as a vendor profile", () => {
		const generic = buildXliff1_2(makeUserData());
		expect(
			detectXliffVendorProfile(generic, "project.xliff", "1.2"),
		).toBeUndefined();
	});

	it("still rejects malformed files carrying a recognized vendor marker", async () => {
		const malformed = sdlFixture.replace(/<source>[\s\S]*?<\/source>/, "");
		await expect(
			importXliffProjectStreaming(xliffFile(malformed, "broken.sdlxliff")),
		).rejects.toMatchObject({ code: "XML_MALFORMED" });
	});
});
