// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildAuxiliaryResourceTranslation,
	buildAuxiliaryResourceTranslationBlob,
	detectAuxiliaryResourceProfile,
	importAuxiliaryResourceFile,
	parseInf,
	parseReg,
	validateAuxiliaryResourceFile,
} from "./auxiliaryResources";
import { detectFormatWithConfidence } from "./registry";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";

const INF = `; driver package remains inert
[Version]
Signature="$Windows NT$"
Class=Sample
ClassGuid={4d36e972-e325-11ce-bfc1-08002be10318}

[Manufacturer]
%Vendor%=Models,NTamd64

[Strings]
; Product name shown in setup
AppName="Hello ""World"" — مرحبا"
Description="Install %AppName% safely"
Continued=First part \\
  and second part
InternalGuid="{4d36e972-e325-11ce-bfc1-08002be10318}"

[Strings.0407]
AppName="Hallo Welt"
Description="%AppName% sicher installieren"
`;

const REG = `Windows Registry Editor Version 5.00

; importing this file must never modify the registry
[HKEY_CURRENT_USER\\Software\\OpenTLC]
@="Default مرحبا"
"Title"="Hello \\"World\\" and C:\\\\Temp"
"Expandable"=hex(2):25,00,50,00,41,00,54,00,48,00,25,00,20,00,48,00,65,00,\
  6c,00,6c,00,6f,00,00,00
"Lines"=hex(7):4f,00,6e,00,65,00,00,00,54,00,77,00,6f,00,00,00,00,00
"Counter"=dword:0000002a
"Opaque"=hex:de,ad,be,ef
"DeleteMe"=-
`;

const MM = `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.0.1">
  <!-- unknown content stays byte-for-byte -->
  <node ID="ID_ROOT" TEXT="Root مرحبا" LINK="https://example.invalid/local-only">
    <node ID="ID_RICH">
      <richcontent TYPE="NODE"><html><head><style>.x{color:red}</style><script>neverRun()</script></head><body><p>Hello <b>bold</b> עולם</p></body></html></richcontent>
      <richcontent TYPE="NOTE"><html><body><p>Translator note 👩🏽‍💻</p></body></html></richcontent>
      <arrowlink DESTINATION="ID_ROOT"/>
      <hook NAME="accessories/plugins/AutomaticLayout.properties"/>
    </node>
  </node>
</map>`;

async function project(
	content: string,
	name: string,
	targets?: string[],
	options = {},
) {
	const imported = await importAuxiliaryResourceFile(
		new File([content], name, { type: "application/octet-stream" }),
		options,
	);
	if (imported.kind !== "segments") throw new Error("Expected segments");
	return {
		imported,
		project: makeUserData({
			type: "auxiliary-resources",
			name,
			seg1: imported.segments,
			seg2: targets ?? [...imported.segments],
			checked: imported.segments.map(() => false),
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		}),
	};
}

describe("FF-511 auxiliary resource formats", () => {
	it.each([
		[INF, "renamed.data", "inf", "Windows INF string resources"],
		[REG, "renamed.data", "reg", "Windows Registry string resources"],
		[MM, "renamed.data", "freemind", "FreeMind mind map"],
	] as const)(
		"detects %s structurally when renamed",
		async (content, name, profile, label) => {
			const file = new File([content], name);
			await expect(detectAuxiliaryResourceProfile(file)).resolves.toBe(profile);
			await expect(detectFormatWithConfidence(file)).resolves.toMatchObject({
				formatId: "auxiliary-resources",
				label,
				supported: true,
			});
		},
	);

	it("imports only INF localized strings and preserves setup directives, comments, tokens, quoting, Unicode, and sections", async () => {
		const { imported } = await project(INF, "driver.inf");
		expect(imported.segments).toEqual([
			'Hello "World" — مرحبا',
			"Install %AppName% safely",
			"First part and second part",
			"Hallo Welt",
			"%AppName% sicher installieren",
		]);
		expect(imported.document.units[0].notes[0]?.text).toBe(
			"Product name shown in setup",
		);
		expect(imported.document.metadata).toMatchObject({
			profile: "inf",
			encoding: "utf-8",
		});
		expect(imported.skeleton.payload).toMatchObject({ kind: "text" });
		expect(imported.skeleton.replacements).toHaveLength(5);
	});

	it("round-trips INF translations while retaining the operational file around edited ranges", async () => {
		const { project: data } = await project(INF, "driver.inf", [
			"Willkommen — שלום",
			"%AppName% sicher öffnen",
			"Erster und zweiter Teil",
			"Hallo Welt",
			"%AppName% sicher installieren",
		]);
		const output = buildAuxiliaryResourceTranslation(data);
		expect(output).toContain('AppName="Willkommen — שלום"');
		expect(output).toContain('Continued="Erster und zweiter Teil"');
		expect(output).toContain("%Vendor%=Models,NTamd64");
		expect(output).toContain(
			"ClassGuid={4d36e972-e325-11ce-bfc1-08002be10318}",
		);
		expect(output).toContain(
			'InternalGuid="{4d36e972-e325-11ce-bfc1-08002be10318}"',
		);
		expect(output).toContain("; driver package remains inert");
		expect(parseInf(output).entries[0].value).toBe("Willkommen — שלום");
	});

	it("imports only Registry string-bearing types and preserves types, paths, deletion operations, comments, and binary data", async () => {
		const { imported } = await project(REG, "settings.reg");
		expect(imported.segments).toEqual([
			"Default مرحبا",
			'Hello "World" and C:\\Temp',
			"%PATH% Hello",
			"One\nTwo",
		]);
		expect(imported.segmentsMeta).toMatchObject([
			{
				registryType: "REG_SZ",
				registryPath: "HKEY_CURRENT_USER\\Software\\OpenTLC",
			},
			{ registryType: "REG_SZ" },
			{ registryType: "REG_EXPAND_SZ" },
			{ registryType: "REG_MULTI_SZ" },
		]);
		expect(imported.document.metadata?.protectedContent).toContain(
			"never imports a REG file",
		);
	});

	it("re-encodes Registry translations by original value type and reopens them", async () => {
		const { project: data } = await project(REG, "settings.reg", [
			"Standard שלום",
			'Hallo "Welt" und C:\\Temp',
			"%PATH% Willkommen",
			"Eins\nZwei\nثلاثة",
		]);
		const output = buildAuxiliaryResourceTranslation(data);
		expect(output).toContain('"Counter"=dword:0000002a');
		expect(output).toContain('"Opaque"=hex:de,ad,be,ef');
		expect(output).toContain('"DeleteMe"=-');
		expect(parseReg(output).entries.map((entry) => entry.value)).toEqual([
			"Standard שלום",
			'Hallo "Welt" und C:\\Temp',
			"%PATH% Willkommen",
			"Eins\nZwei\nثلاثة",
		]);
	});

	it("imports FreeMind labels and visible rich text while protecting IDs, links, arrows, hooks, style, and script", async () => {
		const { imported } = await project(MM, "map.mm");
		expect(imported.segments).toEqual([
			"Root مرحبا",
			"Hello",
			"bold",
			"עולם",
			"Translator note 👩🏽‍💻",
		]);
		expect(imported.segments.join(" ")).not.toContain("neverRun");
		expect(imported.document.units[1].contexts).toContainEqual({
			type: "freemind-node-id",
			value: "ID_RICH",
		});
		expect(imported.document.metadata?.protectedContent).toContain("Node IDs");
	});

	it("exports and independently reopens translated FreeMind XML without changing protected structure", async () => {
		const { imported, project: data } = await project(MM, "map.mm", [
			"Wurzel مرحبا",
			"Hallo",
			"fett",
			"עולם חדש",
			"Hinweis 👩🏽‍💻",
		]);
		const output = buildAuxiliaryResourceTranslation(data);
		const document = new DOMParser().parseFromString(output, "application/xml");
		expect(document.querySelector("parsererror")).toBeNull();
		expect(
			document.querySelector('node[ID="ID_ROOT"]')?.getAttribute("TEXT"),
		).toBe("Wurzel مرحبا");
		expect(document.querySelector("script")?.textContent).toBe("neverRun()");
		expect(
			document.querySelector("arrowlink")?.getAttribute("DESTINATION"),
		).toBe("ID_ROOT");
		expect(document.querySelector("hook")?.getAttribute("NAME")).toContain(
			"AutomaticLayout",
		);
		const reopened = await importAuxiliaryResourceFile(
			new File([output], "translated.mm", { type: "application/x-freemind" }),
			imported.filterOptions,
		);
		expect(reopened.kind === "segments" ? reopened.segments : []).toEqual([
			"Wurzel مرحبا",
			"Hallo",
			"fett",
			"עולם חדש",
			"Hinweis 👩🏽‍💻",
		]);
	});

	it("can exclude FreeMind NOTE rich content", async () => {
		const { imported } = await project(MM, "map.mm", undefined, {
			includeFreeMindNotes: false,
		});
		expect(imported.segments).not.toContain("Translator note 👩🏽‍💻");
	});

	it("blocks split and join edits that would invalidate typed positional mappings", async () => {
		const { project: data } = await project(MM, "map.mm");
		const split = splitSegmentData(data.translationData, 0, 4);
		expect(split.data).toBe(data.translationData);
		expect(split.error).toContain("FreeMind values cannot be split or joined");
	});

	it.each([
		["fake.inf", "[Version]\nSignature=wrong\n[Strings]\nA=Hello"],
		[
			"fake.reg",
			'Windows Registry Editor Version 5.00\n[HKEY_CURRENT_USER\\X]\n"A"=hex(7):41',
		],
		[
			"fake.mm",
			'<?xml version="1.0"?><map version="1.0"><node ID="same"/><node ID="same"/></map>',
		],
		[
			"entity.mm",
			'<!DOCTYPE map [<!ENTITY xxe SYSTEM \'file:///etc/passwd\'>]><map version="1.0"><node TEXT="&xxe;"/></map>',
		],
	] as const)(
		"rejects malformed or adversarial %s content",
		async (name, content) => {
			await expect(
				validateAuxiliaryResourceFile(new File([content], name)),
			).resolves.toMatchObject({
				valid: false,
			});
			await expect(
				detectFormatWithConfidence(new File([content], name)),
			).resolves.toMatchObject({
				supported: false,
			});
		},
	);

	it("honors cancellation before parsing", async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			importAuxiliaryResourceFile(new File([MM], "map.mm"), undefined, {
				signal: controller.signal,
			}),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("generates and imports a large INF fixture without committed binary data", async () => {
		const count = 3_000;
		const content = `[Version]\nSignature="$Windows NT$"\n[Strings]\n${Array.from(
			{ length: count },
			(_, index) => `Message${index}="Message ${index} — مرحبا"`,
		).join("\n")}`;
		const imported = await importAuxiliaryResourceFile(
			new File([content], "large.inf"),
		);
		expect(imported.kind === "segments" ? imported.segments.length : 0).toBe(
			count,
		);
	});

	it("retains exact original UTF-16 bytes for an identity round trip", async () => {
		const bytes = encodeTextBytes(REG, "utf-16le", true);
		const imported = await importAuxiliaryResourceFile(
			new File([bytes], "identity.reg", {
				type: "application/x-windows-registry",
			}),
		);
		if (imported.kind !== "segments") throw new Error("Expected segments");
		const data = makeUserData({
			type: "auxiliary-resources",
			name: "identity.reg",
			seg1: imported.segments,
			seg2: [...imported.segments],
			checked: imported.segments.map(() => false),
			typeRef: imported.typeRef ?? {},
			segmentsMeta: imported.segmentsMeta,
			documentModel: imported.document,
			skeleton: imported.skeleton,
			filterOptions: imported.filterOptions,
		});
		const output = new Uint8Array(
			await buildAuxiliaryResourceTranslationBlob(data).arrayBuffer(),
		);
		expect(output).toEqual(bytes);
	});
});
