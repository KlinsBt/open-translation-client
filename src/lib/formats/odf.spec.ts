// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMParser as IndependentDomParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { buildOdfTranslationPackage } from "$lib/functions/outputGeneration/outputGenerationOdf";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import {
	importOdfFile,
	ODF_MIME_TYPES,
	validateOdfFile,
	type OdfProfile,
} from "./odf";
import type { FormatOptionValues } from "./types";

const namespaces =
	'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"';

function body(profile: OdfProfile, inner: string): string {
	if (profile === "odf")
		return `<?xml version="1.0" encoding="UTF-8"?><math:math xmlns:math="http://www.w3.org/1998/Math/MathML"><math:mrow>${inner}</math:mrow></math:math>`;
	const kind = {
		odt: "text",
		ott: "text",
		odm: "text",
		ods: "spreadsheet",
		ots: "spreadsheet",
		odp: "presentation",
		otp: "presentation",
	}[profile];
	return `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespaces} office:version="1.3"><office:body><office:${kind}>${inner}</office:${kind}></office:body></office:document-content>`;
}

async function odfFile(
	profile: OdfProfile,
	content: string,
	extra: Record<string, string | Uint8Array> = {},
	name = `document.${profile}`,
): Promise<File> {
	const zip = new JSZip();
	zip.file("mimetype", ODF_MIME_TYPES[profile], { compression: "STORE" });
	zip.file("content.xml", content);
	zip.file(
		"META-INF/manifest.xml",
		`<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODF_MIME_TYPES[profile]}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/></manifest:manifest>`,
	);
	for (const [path, value] of Object.entries(extra)) zip.file(path, value);
	return new File(
		[
			await zip.generateAsync({
				type: "uint8array",
				compression: "DEFLATE",
			}),
		],
		name,
		{ type: ODF_MIME_TYPES[profile] },
	);
}

async function importProject(
	file: File,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const result = await importOdfFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected ODF segments");
	return {
		result,
		project: makeUserData({
			type: "odf",
			name: file.name,
			seg1: result.segments,
			seg2: targets ?? [...result.segments],
			checked: result.segments.map(() => false),
			typeRef: result.typeRef ?? {},
			segmentsMeta: result.segmentsMeta,
			documentModel: result.document,
			skeleton: result.skeleton,
			filterOptions: result.filterOptions,
		}),
	};
}

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

describe("OpenDocument document, template, master, and formula workflows", () => {
	it.each([
		["ott", "<text:p>Template مرحبا 👩🏽‍💻</text:p>", "Vorlage مرحبا 👩🏽‍💻"],
		["odm", "<text:p>Master document</text:p>", "Masterdokument"],
		[
			"ots",
			'<table:table table:name="Sheet1"><table:table-row><table:table-cell><text:p>Sheet template</text:p></table:table-cell></table:table-row></table:table>',
			"Tabellenvorlage",
		],
		[
			"otp",
			'<draw:page draw:name="page1"><draw:frame><draw:text-box><text:p>Slide template</text:p></draw:text-box></draw:frame></draw:page>',
			"Folienvorlage",
		],
		["odf", "<math:mtext>distance مرحبا</math:mtext>", "Abstand مرحبا"],
	] as const)(
		"detects, preserves, edits, and independently reopens .%s by package signature",
		async (profile, content, target) => {
			const file = await odfFile(
				profile,
				body(profile, content),
				{
					"Scripts/javascript.js": "globalThis.pwned = true;",
					"Object 1/data.bin": new Uint8Array([0, 255, 1, 128]),
				},
				`specialist.${profile}`,
			);
			const { result, project } = await importProject(file);
			expect(result.segments).toEqual([
				profile === "odf" ? "distance مرحبا" : content.match(/>([^<>]+)</)?.[1],
			]);
			expect(result.typeRef).toMatchObject({
				profile,
				mimeType: ODF_MIME_TYPES[profile],
			});
			expect(
				new Uint8Array(
					await (await buildOdfTranslationPackage(project)).arrayBuffer(),
				),
			).toEqual(new Uint8Array(await file.arrayBuffer()));

			project.translationData.seg2 = [target];
			const output = await buildOdfTranslationPackage(project);
			expect(output.type).toBe(ODF_MIME_TYPES[profile]);
			const zip = await JSZip.loadAsync(await output.arrayBuffer());
			expect(await zip.file("mimetype")!.async("string")).toBe(
				ODF_MIME_TYPES[profile],
			);
			expect(await zip.file("Scripts/javascript.js")!.async("string")).toBe(
				"globalThis.pwned = true;",
			);
			expect(await zip.file("Object 1/data.bin")!.async("uint8array")).toEqual(
				new Uint8Array([0, 255, 1, 128]),
			);
			const contentXml = await zip.file("content.xml")!.async("string");
			expect(contentXml).toContain(target);
			const independentlyParsed = new IndependentDomParser().parseFromString(
				contentXml,
				"application/xml",
			);
			expect(
				independentlyParsed.getElementsByTagName("parsererror"),
			).toHaveLength(0);
			const reopenedFile = new File([output], `translated.${profile}`, {
				type: ODF_MIME_TYPES[profile],
			});
			await expect(validateOdfFile(reopenedFile)).resolves.toEqual({
				valid: true,
			});
			const reopened = await importOdfFile(reopenedFile);
			if (reopened.kind !== "segments")
				throw new Error("Expected ODF segments");
			expect(reopened.segments).toEqual([target]);
		},
	);
	it("extracts styled ODT text and accessibility content while preserving package assets", async () => {
		const file = await odfFile(
			"odt",
			body(
				"odt",
				'<text:p text:style-name="Body">Hello <text:span text:style-name="Strong">world</text:span></text:p><draw:frame draw:name="Shape"><svg:title xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">Chart title</svg:title></draw:frame><office:annotation><text:p>Private comment</text:p></office:annotation>',
			),
			{
				"Pictures/image.png": new Uint8Array([1, 2, 3, 4]),
				"styles.xml": `<?xml version="1.0"?><office:document-styles ${namespaces}><office:master-styles><style:master-page xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"><style:header><text:p>Header text</text:p></style:header></style:master-page></office:master-styles></office:document-styles>`,
			},
		);
		const { result, project } = await importProject(file);
		expect(result.segments).toEqual([
			"Hello",
			"world",
			"Chart title",
			"Header text",
		]);
		expect(result.document.units[0].contexts).toContainEqual({
			type: "odf-style-name",
			value: "Body",
		});
		project.translationData.seg2 = [
			"Hallo",
			"Welt",
			"Diagrammtitel",
			"Kopfzeile",
		];
		const output = await buildOdfTranslationPackage(project);
		const zip = await JSZip.loadAsync(await output.arrayBuffer());
		expect(await zip.file("Pictures/image.png")!.async("uint8array")).toEqual(
			new Uint8Array([1, 2, 3, 4]),
		);
		expect(await zip.file("content.xml")!.async("string")).toContain(
			'<text:p text:style-name="Body">Hallo <text:span text:style-name="Strong">Welt</text:span>',
		);
		expect(await zip.file("styles.xml")!.async("string")).toContain(
			"<text:p>Kopfzeile</text:p>",
		);
	});

	it("supports spreadsheet cells and presentation notes without touching formulas or drawings", async () => {
		const ods = await importProject(
			await odfFile(
				"ods",
				body(
					"ods",
					'<table:table table:name="Sheet1"><table:table-row><table:table-cell table:formula="of:=SUM([.A1:.A2])"><text:p>Total</text:p></table:table-cell></table:table-row></table:table>',
				),
			),
			{},
			["Summe"],
		);
		const odsXml = await (
			await JSZip.loadAsync(
				await (await buildOdfTranslationPackage(ods.project)).arrayBuffer(),
			)
		)
			.file("content.xml")!
			.async("string");
		expect(odsXml).toContain('table:formula="of:=SUM([.A1:.A2])"');
		expect(odsXml).toContain("<text:p>Summe</text:p>");

		const odpFile = await odfFile(
			"odp",
			body(
				"odp",
				'<draw:page draw:name="page1"><draw:frame><draw:text-box><text:p>Slide text</text:p></draw:text-box></draw:frame><presentation:notes><draw:frame><draw:text-box><text:p>Speaker note</text:p></draw:text-box></draw:frame></presentation:notes></draw:page>',
			),
		);
		const included = await importOdfFile(odpFile);
		const excluded = await importOdfFile(odpFile, { includeNotes: false });
		if (included.kind !== "segments" || excluded.kind !== "segments")
			throw new Error("Expected segments");
		expect(included.segments).toEqual(["Slide text", "Speaker note"]);
		expect(excluded.segments).toEqual(["Slide text"]);
	});

	it("applies final, original, and all tracked-change policies", async () => {
		const content = body(
			"odt",
			'<text:tracked-changes><text:changed-region text:id="ct1"><text:insertion/></text:changed-region><text:changed-region text:id="ct2"><text:deletion><text:p>Deleted text</text:p></text:deletion></text:changed-region></text:tracked-changes><text:p>Before <text:change-start text:change-id="ct1"/>Inserted text<text:change-end text:change-id="ct1"/> After</text:p>',
		);
		const file = await odfFile("odt", content);
		const final = await importOdfFile(file, { trackedChanges: "final" });
		const original = await importOdfFile(file, { trackedChanges: "original" });
		const all = await importOdfFile(file, { trackedChanges: "all" });
		if (
			final.kind !== "segments" ||
			original.kind !== "segments" ||
			all.kind !== "segments"
		)
			throw new Error("Expected segments");
		expect(final.segments).toEqual(["Before", "Inserted text", "After"]);
		expect(original.segments).toEqual(["Deleted text", "Before", "After"]);
		expect(all.segments).toEqual([
			"Deleted text",
			"Before",
			"Inserted text",
			"After",
		]);
	});

	it("preserves identity bytes and emits mimetype first and uncompressed after edits", async () => {
		const file = await odfFile("odt", body("odt", "<text:p>Café</text:p>"));
		const { project } = await importProject(file);
		expect(
			new Uint8Array(
				await (await buildOdfTranslationPackage(project)).arrayBuffer(),
			),
		).toEqual(new Uint8Array(await file.arrayBuffer()));
		project.translationData.seg2 = ["Kaffee"];
		const changed = new Uint8Array(
			await (await buildOdfTranslationPackage(project)).arrayBuffer(),
		);
		const view = new DataView(
			changed.buffer,
			changed.byteOffset,
			changed.byteLength,
		);
		const nameLength = view.getUint16(26, true);
		expect(new TextDecoder().decode(changed.slice(30, 30 + nameLength))).toBe(
			"mimetype",
		);
		expect(view.getUint16(8, true)).toBe(0);
	});

	it("rejects malformed manifests, mismatched types, unsafe XML, and signatures", async () => {
		const mismatched = await odfFile(
			"odt",
			body("odt", "<text:p>Hello</text:p>"),
			{},
			"wrong.ods",
		);
		await expect(validateOdfFile(mismatched)).resolves.toMatchObject({
			valid: false,
			errorCode: "ODF_INVALID",
		});
		const unsafe = await odfFile(
			"odt",
			'<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
		);
		await expect(validateOdfFile(unsafe)).resolves.toMatchObject({
			valid: false,
			errorCode: "XML_UNSAFE_DECLARATION",
		});
		const signed = await odfFile("odt", body("odt", "<text:p>Hello</text:p>"), {
			"META-INF/documentsignatures.xml": "<document-signatures/>",
		});
		await expect(validateOdfFile(signed)).resolves.toMatchObject({
			valid: false,
			errorCode: "ODF_INVALID",
		});
		const unsafeManifest = await odfFile(
			"ott",
			body("ott", "<text:p>Hello</text:p>"),
			{
				"META-INF/manifest.xml": `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODF_MIME_TYPES.ott}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="../script.js" manifest:media-type="text/javascript"/></manifest:manifest>`,
			},
		);
		await expect(validateOdfFile(unsafeManifest)).resolves.toMatchObject({
			valid: false,
			reason: expect.stringMatching(/manifest path.*unsafe/i),
		});
		const missingContentDeclaration = await odfFile(
			"odm",
			body("odm", "<text:p>Hello</text:p>"),
			{
				"META-INF/manifest.xml": `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODF_MIME_TYPES.odm}"/></manifest:manifest>`,
			},
		);
		await expect(
			validateOdfFile(missingContentDeclaration),
		).resolves.toMatchObject({
			valid: false,
			reason: expect.stringMatching(/does not declare content\.xml/i),
		});
		const wrongFormulaStructure = await odfFile(
			"odf",
			body("ott", "<text:p>Not a formula</text:p>"),
		);
		await expect(validateOdfFile(wrongFormulaStructure)).resolves.toMatchObject(
			{
				valid: false,
				reason: expect.stringMatching(/MathML math root/i),
			},
		);
	});

	it("keeps embedded scripts inert and excludes script text from translation", async () => {
		const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${namespaces} office:version="1.3"><office:scripts><office:script>globalThis.odfScriptExecuted = true;</office:script><office:event-listeners><script:event-listener xmlns:script="urn:oasis:names:tc:opendocument:xmlns:script:1.0" script:event-name="dom:load" script:macro-name="danger"/></office:event-listeners></office:scripts><office:body><office:text><text:p>Safe text</text:p></office:text></office:body></office:document-content>`;
		const imported = await importOdfFile(await odfFile("ott", content));
		if (imported.kind !== "segments") throw new Error("Expected ODF segments");
		expect(imported.segments).toEqual(["Safe text"]);
		expect(
			(globalThis as typeof globalThis & { odfScriptExecuted?: boolean })
				.odfScriptExecuted,
		).toBeUndefined();
	});

	it("blocks placeholders, structural edits, and stale package mappings", async () => {
		const { project } = await importProject(
			await odfFile("odt", body("odt", "<text:p>Hello {name}</text:p>")),
			{},
			["Hallo"],
		);
		await expect(buildOdfTranslationPackage(project)).rejects.toThrow(
			/Export blocked/,
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		project.translationData.seg2 = ["Hallo {name}"];
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		await expect(buildOdfTranslationPackage(project)).rejects.toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 ODF paragraphs deterministically", async () => {
		const file = await odfFile(
			"odt",
			body(
				"odt",
				Array.from(
					{ length: 1_000 },
					(_, index) => `<text:p>Message ${index}</text:p>`,
				).join(""),
			),
		);
		const first = await importOdfFile(file);
		const second = await importOdfFile(file);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it("handles a generated large OTS and honors cancellation", async () => {
		const file = await odfFile(
			"ots",
			body(
				"ots",
				`<table:table table:name="Large">${Array.from(
					{ length: 1_500 },
					(_, index) =>
						`<table:table-row><table:table-cell><text:p>Template row ${index}</text:p></table:table-cell></table:table-row>`,
				).join("")}</table:table>`,
			),
		);
		const imported = await importOdfFile(file);
		if (imported.kind !== "segments") throw new Error("Expected ODF segments");
		expect(imported.segments).toHaveLength(1_500);
		const controller = new AbortController();
		controller.abort();
		await expect(
			importOdfFile(file, {}, { signal: controller.signal }),
		).rejects.toThrow(/cancelled|aborted/i);
	});

	it.runIf(
		process.env.OPENTLC_RUN_LIBREOFFICE === "1" &&
			spawnSync("libreoffice", ["--version"]).status === 0,
	)(
		"produces an ODT LibreOffice can reopen when LibreOffice is available",
		async () => {
			const file = await odfFile("odt", body("odt", "<text:p>Hello</text:p>"));
			const { project } = await importProject(file, {}, ["Hallo"]);
			const output = await buildOdfTranslationPackage(project);
			const directory = mkdtempSync(join(tmpdir(), "opentlc-odf-"));
			try {
				const input = join(directory, "translated.odt");
				const target = join(directory, "converted");
				const profile = join(directory, "profile");
				mkdirSync(target);
				writeFileSync(input, new Uint8Array(await output.arrayBuffer()));
				const reopened = spawnSync(
					"libreoffice",
					[
						"--headless",
						`-env:UserInstallation=file://${profile}`,
						"--convert-to",
						"pdf",
						"--outdir",
						target,
						input,
					],
					{ encoding: "utf8", timeout: 30_000 },
				);
				if (reopened.status !== 0)
					throw new Error(
						`LibreOffice reopen failed (${reopened.status}): ${reopened.stderr || reopened.stdout}`,
					);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);

	it
		.runIf(
			process.env.OPENTLC_RUN_LIBREOFFICE === "1" &&
				spawnSync("libreoffice", ["--version"]).status === 0,
		)
		.each(["ott", "odm", "ots", "otp", "odf"] as const)(
		"produces a translated .%s package LibreOffice can reopen when enabled",
		async (profile) => {
			const inner =
				profile === "odf"
					? "<math:mtext>Hello</math:mtext>"
					: profile === "ots"
						? "<table:table><table:table-row><table:table-cell><text:p>Hello</text:p></table:table-cell></table:table-row></table:table>"
						: profile === "otp"
							? "<draw:page><draw:frame><draw:text-box><text:p>Hello</text:p></draw:text-box></draw:frame></draw:page>"
							: "<text:p>Hello</text:p>";
			const file = await odfFile(profile, body(profile, inner));
			const { project } = await importProject(file, {}, ["Hallo"]);
			const output = await buildOdfTranslationPackage(project);
			const directory = mkdtempSync(join(tmpdir(), `opentlc-${profile}-`));
			try {
				const input = join(directory, `translated.${profile}`);
				const target = join(directory, "converted");
				const userProfile = join(directory, "profile");
				mkdirSync(target);
				writeFileSync(input, new Uint8Array(await output.arrayBuffer()));
				const reopened = spawnSync(
					"libreoffice",
					[
						"--headless",
						`-env:UserInstallation=file://${userProfile}`,
						"--convert-to",
						"pdf",
						"--outdir",
						target,
						input,
					],
					{ encoding: "utf8", timeout: 30_000 },
				);
				if (reopened.status !== 0)
					throw new Error(
						`LibreOffice reopen failed (${reopened.status}): ${reopened.stderr || reopened.stdout}`,
					);
				expect(readdirSync(target).some((name) => name.endsWith(".pdf"))).toBe(
					true,
				);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
		40_000,
	);
});
