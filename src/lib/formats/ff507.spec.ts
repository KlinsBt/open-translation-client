// @vitest-environment happy-dom

import { writePsdUint8Array } from "ag-psd";
import { DOMParser } from "@xmldom/xmldom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import {
	buildPsdSvgConversion,
	buildPsdTranslationBlob,
	importPsdFile,
	validatePsdFile,
} from "./psd";
import {
	buildQuarkTranslation,
	buildQuarkTranslationBlob,
	encodeQuarkText,
	importQuarkFile,
	parseQuarkDocument,
	validateQuarkFile,
} from "./quark";
import { detectFormat } from "./registry";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

function projectFromImport(
	type: "quark" | "psd",
	name: string,
	result: Awaited<ReturnType<typeof importQuarkFile | typeof importPsdFile>>,
) {
	if (result.kind !== "segments") throw new Error("Expected segments");
	return makeUserData({
		type,
		name,
		seg1: result.segments,
		seg2: [...result.segments],
		checked: result.segments.map(() => false),
		typeRef: result.typeRef ?? {},
		segmentsMeta: result.segmentsMeta,
		documentModel: result.document,
		skeleton: result.skeleton,
		filterOptions: result.filterOptions,
	});
}

function psdFile(
	layers: Array<{
		name: string;
		text: string;
		hidden?: boolean;
		left?: number;
		top?: number;
	}> = [{ name: "Headline", text: "Hello مرحبا 👩🏽‍💻" }],
	name = "design.psd",
): File {
	const bytes = writePsdUint8Array({
		width: 640,
		height: 480,
		children: layers.map((layer, index) => ({
			name: layer.name,
			hidden: layer.hidden,
			left: layer.left ?? 20,
			top: layer.top ?? 30 + index * 40,
			right: 620,
			bottom: 80 + index * 40,
			text: {
				text: layer.text,
				transform: [1, 0, 0, 1, layer.left ?? 20, layer.top ?? 30],
				style: { fontSize: 24, fillColor: { r: 12, g: 80, b: 110 } },
			},
		})),
	});
	return new File([bytes], name, { type: "image/vnd.adobe.photoshop" });
}

describe("FF-507 QuarkXPress Tags", () => {
	it("requires the native header, protects style definitions, and round-trips Unicode text", async () => {
		const source =
			'<v21.00><e9>\n@Body=<f"Arial"><z12>\n@Body:Café é — مرحبا 👩🏽‍💻 𐍈.\n';
		const file = new File([source], "story.xtg", {
			type: "application/vnd.quark.quarkxpress",
		});
		const result = await importQuarkFile(file);
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toEqual(["Café é — مرحبا 👩🏽‍💻 𐍈."]);
		expect(result.document.metadata).toMatchObject({ encodingCode: 9 });
		const project = projectFromImport("quark", "story.xtg", result);
		expect(
			new Uint8Array(await buildQuarkTranslationBlob(project).arrayBuffer()),
		).toEqual(new TextEncoder().encode(source));
		project.translationData.seg2 = ["Übersetzt @ und \\ fertig"];
		const output = buildQuarkTranslation(project);
		expect(output).toContain('@Body=<f"Arial"><z12>');
		expect(output).toContain("<\\@>");
		expect(output).toContain("<\\\\>");
		const reopened = await importQuarkFile(new File([output], "story.xtg"));
		if (reopened.kind !== "segments") throw new Error("Expected segments");
		expect(reopened.segments.join("")).toBe("Übersetzt @ und \\ fertig");
	});

	it("recognizes literal escapes and rejects extension-only, malformed, and cancelled input", async () => {
		expect(encodeQuarkText("@<>\\")).toBe("<\\@><\\<><\\>><\\\\>");
		expect(
			parseQuarkDocument("<v21.00><e9>\nA<\\@>B<\\<>C<\\>>D<\\\\>E")
				.tokens.map((token) => token.value)
				.join(""),
		).toBe("A@B<C>D\\E");
		for (const value of [
			"plain text",
			"<v21.00><e9>\nunterminated <B",
			"<v21.00><e8>\nnot UTF-16",
		])
			await expect(
				validateQuarkFile(new File([value], "fake.xtg")),
			).resolves.toMatchObject({ valid: false });
		await expect(
			detectFormat(new File(["plain text"], "fake.xtg")),
		).resolves.not.toMatchObject({ id: "quark" });
		await expect(
			detectFormat(
				new File(["<v21.00><e9>\nSignature content"], "generic.bin"),
			),
		).resolves.toMatchObject({ id: "quark" });
		const utf16 = encodeTextBytes(
			"<v21.00><e8>\nUTF-16 story مرحبا",
			"utf-16le",
			true,
		);
		const utf16File = new File([utf16], "story.tag");
		await expect(validateQuarkFile(utf16File)).resolves.toEqual({
			valid: true,
		});
		const utf16Import = await importQuarkFile(utf16File);
		const utf16Project = projectFromImport("quark", "story.tag", utf16Import);
		expect(
			new Uint8Array(
				await buildQuarkTranslationBlob(utf16Project).arrayBuffer(),
			),
		).toEqual(utf16);
		const controller = new AbortController();
		controller.abort();
		await expect(
			importQuarkFile(
				new File(["<v21.00><e9>\nText"], "story.xtg"),
				{},
				{
					signal: controller.signal,
				},
			),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("handles generated large tagged-text files deterministically", async () => {
		const content = `<v21.00><e9>\n${Array.from(
			{ length: 1_000 },
			(_, index) => `@Body:Message ${index}`,
		).join("\n")}`;
		const first = await importQuarkFile(new File([content], "large.tag"));
		const second = await importQuarkFile(new File([content], "large.tag"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});

describe("FF-507 Photoshop PSD text-layer source", () => {
	it("validates the binary signature, imports visible text descriptors, and keeps hidden layers optional", async () => {
		const file = psdFile([
			{ name: "Visible", text: "Café مرحبا" },
			{ name: "Hidden", text: "Secret", hidden: true },
		]);
		await expect(validatePsdFile(file)).resolves.toEqual({ valid: true });
		const normal = await importPsdFile(file);
		const expanded = await importPsdFile(file, { includeHiddenText: true });
		if (normal.kind !== "segments" || expanded.kind !== "segments")
			throw new Error("Expected segments");
		expect(normal.segments).toEqual(["Café مرحبا"]);
		expect(expanded.segments).toEqual(["Café مرحبا", "Secret"]);
		expect(normal.document.units[0].contexts).toContainEqual({
			type: "photoshop-layer",
			value: "Visible",
		});
	});

	it("returns the exact PSD when unchanged and a safe, independently parsed SVG when translated", async () => {
		const file = psdFile([{ name: "Title & subtitle", text: "Original" }]);
		const result = await importPsdFile(file);
		const project = projectFromImport("psd", "design.psd", result);
		expect(
			new Uint8Array(await buildPsdTranslationBlob(project).arrayBuffer()),
		).toEqual(new Uint8Array(await file.arrayBuffer()));
		project.translationData.seg2 = ["ترجمة آمنة & 👩🏽‍💻"];
		const svg = buildPsdSvgConversion(project);
		const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
		expect(parsed.documentElement.localName).toBe("svg");
		expect(parsed.getElementsByTagName("parsererror")).toHaveLength(0);
		expect(parsed.getElementsByTagName("script")).toHaveLength(0);
		expect(parsed.getElementsByTagName("text")[0].textContent).toContain(
			"ترجمة آمنة & 👩🏽‍💻",
		);
		expect(
			parsed.getElementsByTagName("text")[0].getAttribute("direction"),
		).toBe("rtl");
		expect((await buildPsdTranslationBlob(project)).type).toBe(
			"image/svg+xml;charset=utf-8",
		);
		const typeRef = project.translationData.typeRef as unknown as Record<
			string,
			unknown
		>;
		(typeRef.layers as Array<Record<string, unknown>>)[0].path = [".."];
		expect(() => buildPsdSvgConversion(project)).toThrow(/metadata is invalid/);
	});

	it("rejects fake signatures, unsafe dimensions, malformed structures, and cancellation", async () => {
		const valid = new Uint8Array(await psdFile().arrayBuffer());
		const huge = valid.slice();
		new DataView(huge.buffer).setUint32(18, 40_000, false);
		const invalid = [
			new File(["8BPS but not a PSD"], "fake.psd"),
			new File([huge], "huge.psd"),
			new File([valid.slice(0, 100)], "truncated.psd"),
		];
		for (const file of invalid)
			await expect(validatePsdFile(file)).resolves.toMatchObject({
				valid: false,
			});
		await expect(
			detectFormat(new File(["not photoshop"], "fake.psd")),
		).resolves.not.toMatchObject({ id: "psd" });
		const controller = new AbortController();
		controller.abort();
		await expect(
			importPsdFile(psdFile(), {}, { signal: controller.signal }),
		).rejects.toMatchObject({ code: "ABORTED" });
	});

	it("imports a generated large text-layer document without binary fixtures", async () => {
		const file = psdFile(
			Array.from({ length: 250 }, (_, index) => ({
				name: `Layer ${index}`,
				text: `Message ${index} — مرحبا`,
			})),
			"large.psd",
		);
		const result = await importPsdFile(file);
		if (result.kind !== "segments") throw new Error("Expected segments");
		expect(result.segments).toHaveLength(250);
		expect(result.segments.at(-1)).toContain("249");
	});
});
