// @vitest-environment happy-dom

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildQmlTranslation,
	buildQmlTranslationBlob,
	encodeQmlString,
} from "$lib/functions/outputGeneration/outputGenerationQml";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	decodeQmlString,
	importQmlFile,
	parseQmlDocument,
	validateQmlFile,
} from "./qml";
import type { FormatOptionValues } from "./types";

const QMLLINT_AVAILABLE =
	spawnSync("qmllint", ["--version"], { encoding: "utf8" }).status === 0;

const source = `import QtQuick 2.15

Item {
    //: Main window title
    property string title: qsTr("Sample application", "window title")
    property string greeting: qsTr('Hello %1').arg(userName)
    property string errorText: qsTranslate("Errors", "Cannot open %1")
    property string queued: QT_TR_NOOP("Queued message")
    property string shared: QT_TRANSLATE_NOOP("Shared", "Shared message")
    property string translationId: qsTrId("app.title")
    property string bareText: "Not extracted"
    property string dynamicText: qsTr(\`Hello \${userName}\`)
    property var bracePattern: /[{}]/
}`;

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "Main.qml", { type: "text/x-qml" });
	const result = await importQmlFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected QML segments");
	return {
		result,
		project: makeUserData({
			type: "qml",
			name: "Main.qml",
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

describe("Qt QML source workflow", () => {
	it("extracts direct Qt translation literals and protects runtime code", async () => {
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual([
			"Sample application",
			"Hello %1",
			"Cannot open %1",
			"Queued message",
			"Shared message",
		]);
		expect(result.segments).not.toContain("Errors");
		expect(result.segments).not.toContain("Shared");
		expect(result.segments).not.toContain("app.title");
		expect(result.segments).not.toContain("Not extracted");
		expect(result.segments).not.toContain("Hello ${userName}");
		expect(result.document.units[0].notes).toEqual([
			{
				category: "translator",
				text: "Main window title",
				appliesTo: "unit",
			},
		]);
		expect(result.document.units[0].contexts).toContainEqual({
			type: "qml-disambiguation",
			value: "window title",
		});
		expect(result.document.units[2].contexts).toContainEqual({
			type: "qml-context",
			value: "Errors",
		});
		project.translationData.seg2 = [
			"Beispielanwendung",
			"Hallo %1",
			"%1 kann nicht geöffnet werden",
			"Vorgemerkte Nachricht",
			"Gemeinsame Nachricht",
		];
		const output = buildQmlTranslation(project);
		expect(output).toContain('qsTr("Beispielanwendung", "window title")');
		expect(output).toContain(
			'qsTranslate("Errors", "%1 kann nicht geöffnet werden")',
		);
		expect(output).toContain('qsTrId("app.title")');
		expect(output).toContain('bareText: "Not extracted"');
		expect(output).toContain("qsTr(`Hello ${userName}`)");
		expect(output).toContain("bracePattern: /[{}]/");
	});

	it("supports explicit function-to-argument selectors", async () => {
		const result = await importQmlFile(new File([source], "Main.qml"), {
			functionSelectors: "qsTranslate:2",
		});
		if (result.kind !== "segments") throw new Error("Expected QML segments");
		expect(result.segments).toEqual(["Cannot open %1"]);
	});

	it("decodes JavaScript escapes and safely exports every quote style", async () => {
		expect(decodeQmlString("Caf\\u00e9\\n\\x26Open")).toBe("Café\n&Open");
		expect(encodeQmlString('Line\n"quoted" \\', '"')).toBe(
			'Line\\n\\"quoted\\" \\\\',
		);
		expect(encodeQmlString("Literal ${value}", "`")).toBe("Literal \\${value}");
		const templates = `import QtQuick\nItem {\n property string a: qsTr(\`Literal text\`)\n}`;
		const { project } = await importProject(templates);
		project.translationData.seg2 = ["Literal value and `tick`"];
		const output = buildQmlTranslation(project);
		expect(output).toContain("`Literal value and \\`tick\\``");
		expect(parseQmlDocument(output).translationCalls).toBe(1);
	});

	it("rejects malformed strings, comments, brackets, and non-QML text", async () => {
		const invalid = [
			'import QtQuick\nItem { property string t: qsTr("broken) }',
			"import QtQuick\nItem { /* broken",
			'import QtQuick\nItem { property string t: qsTr("Text") ] }',
			'import QtQuick\nItem { property string t: qsTr("Text") ',
			'const value = qsTr("Text")',
		];
		for (const content of invalid)
			await expect(
				validateQmlFile(new File([content], "bad.qml")),
			).resolves.toMatchObject({ valid: false });
	});

	it("preserves UTF-16 identity bytes and source encoding", async () => {
		const bytes = encodeTextBytes(
			'import QtQuick\nItem { property string t: qsTr("Café") }\n',
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(await buildQmlTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ["Kaffee"];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildQmlTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain('qsTr("Kaffee")');
	});

	it("round-trips sentence segmentation and blocks stale structural edits", async () => {
		const { result, project } = await importProject(
			'import QtQuick\nItem { property string t: qsTr("First sentence. Second sentence.") }',
			{ segmentationMode: "sentences" },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = buildQmlTranslation(project);
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 9;
		expect(() => buildQmlTranslation(project)).toThrow(/do not align uniquely/);
	});

	it("imports 1,000 translation calls deterministically", async () => {
		const large = `import QtQuick\nItem {\n${Array.from(
			{ length: 1_000 },
			(_, index) => ` property string value${index}: qsTr("Message ${index}")`,
		).join("\n")}\n}`;
		const first = await importQmlFile(new File([large], "Large.qml"));
		const second = await importQmlFile(new File([large], "Large.qml"));
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected QML segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it.skipIf(!QMLLINT_AVAILABLE)(
		"passes the installed Qt qmllint syntax verifier after translation",
		async () => {
			const lintable =
				'import QtQml 2.15\nQtObject { property string message: qsTr("Hello") }\n';
			const { project } = await importProject(lintable);
			project.translationData.seg2 = ["Hallo"];
			const directory = mkdtempSync(join(tmpdir(), "opentlc-qml-"));
			try {
				const path = join(directory, "Main.qml");
				writeFileSync(path, buildQmlTranslation(project));
				const linted = spawnSync("qmllint", ["--silent", path], {
					encoding: "utf8",
				});
				expect(linted.stderr).toBe("");
				expect(linted.status).toBe(0);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
