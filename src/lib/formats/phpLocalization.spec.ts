// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildPhpTranslation,
	buildPhpTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationPhp";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import {
	importPhpLocalizationFile,
	parsePhpLocalization,
	validatePhpLocalizationFile,
} from "./phpLocalization";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "messages.php", {
		type: "application/x-httpd-php",
	});
	const result = await importPhpLocalizationFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected PHP segments");
	return {
		result,
		project: makeUserData({
			type: "php",
			name: "messages.php",
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

describe("static PHP localization array workflow", () => {
	it("extracts nested short and long arrays while preserving keys and syntax", async () => {
		const source = `<?php
// Authentication messages
return [
    'auth' => array(
        'welcome' => 'Hello',
        "logout" => "Sign out",
    ),
    'locked' => ['code' => 'Keep'],
];
`;
		const { result, project } = await importProject(
			source,
			{ pathSelectors: "auth.*" },
			["Hallo", "Abmelden"],
		);
		expect(result.segments).toEqual(["Hello", "Sign out"]);
		expect(result.document.units.map((unit) => unit.id)).toEqual([
			"auth.welcome",
			"auth.logout",
		]);
		const output = buildPhpTranslation(project);
		expect(output).toContain("'welcome' => 'Hallo'");
		expect(output).toContain('"logout" => "Abmelden"');
		expect(output).toContain("'locked' => ['code' => 'Keep']");
	});

	it("round-trips PHP string escapes without interpolating targets", async () => {
		const source = `<?php return ['single' => 'It\\'s \\\\ safe', 'double' => "Line\\n\\$name\\x21"];`;
		const { result, project } = await importProject(source);
		expect(result.segments).toEqual(["It's \\ safe", "Line\n$name!"]);
		project.translationData.seg2 = ["L'argent \\ sûr", 'Price $5\n"now"'];
		const output = buildPhpTranslation(project);
		expect(output).toContain("'L\\'argent \\\\ sûr'");
		expect(output).toContain('"Price \\$5\\n\\"now\\""');
		expect(
			parsePhpLocalization(output).leaves.map((leaf) => leaf.value),
		).toEqual(project.translationData.seg2);
	});

	it("reports duplicates, filters paths, and optionally includes empty strings", async () => {
		const source = `<?php return ['a' => ['x' => 'One', 'x' => 'Two', 'empty' => ''], 'b' => 'Other'];`;
		const filtered = await importPhpLocalizationFile(
			new File([source], "messages.php"),
			{ pathSelectors: "a.**", includeEmpty: true },
		);
		if (filtered.kind !== "segments") throw new Error("Expected segments");
		expect(filtered.segments).toEqual(["One", "Two", ""]);
		expect(filtered.document.metadata?.warnings).toContain(
			"Duplicate PHP localization path a.x.",
		);
	});

	it("rejects every dynamic PHP construct without executing it", async () => {
		const invalid = [
			"<?php return ['x' => getenv('SECRET')];",
			"<?php return ['x' => $value];",
			"<?php return ['x' => 'a' . 'b'];",
			'<?php return ["x" => "Hello $name"];',
			"<?php echo 'side effect'; return ['x' => 'Hello'];",
			"<?php return ['x' => true];",
		];
		for (const content of invalid) {
			const file = new File([content], "bad.php");
			await expect(validatePhpLocalizationFile(file)).resolves.toMatchObject({
				valid: false,
				errorCode: "PHP_LOCALIZATION_INVALID",
			});
			await expect(importPhpLocalizationFile(file)).rejects.toMatchObject({
				code: "PHP_LOCALIZATION_INVALID",
			});
		}
	});

	it("preserves UTF-16 identity bytes and line endings", async () => {
		const bytes = encodeTextBytes(
			"<?php\r\nreturn ['hello' => 'Café'];\r\n",
			"utf-16le",
			true,
		);
		const { project } = await importProject(bytes);
		expect(
			new Uint8Array(await buildPhpTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ["Grüße"];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildPhpTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16le", hasBom: true });
		expect(decoded.text).toContain("'hello' => 'Grüße'");
	});

	it("blocks placeholder regressions, structural edits, and stale mappings", async () => {
		const { project } = await importProject(
			"<?php return ['welcome' => 'Hello :name %1$s'];",
			{},
			["Hallo"],
		);
		expect(() => buildPhpTranslation(project)).toThrow(/Export blocked/);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.seg2 = ["Hallo :name %1$s"];
		project.translationData.skeleton.replacements[0].unitIndex = 7;
		expect(() => buildPhpTranslation(project)).toThrow(/do not align uniquely/);
	});

	it("imports 1,000 static leaves deterministically", async () => {
		const source = `<?php return [${Array.from(
			{ length: 1_000 },
			(_, index) => `'message_${index}' => 'Message ${index}'`,
		).join(",")}];`;
		const first = await importPhpLocalizationFile(
			new File([source], "messages.php"),
		);
		const second = await importPhpLocalizationFile(
			new File([source], "messages.php"),
		);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});
});
