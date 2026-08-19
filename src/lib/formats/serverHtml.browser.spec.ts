import { describe, expect, it } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	loadTranslationsUserDataFromIndexedDB,
	updateAllTranslationsOnIndexedDB,
} from "$lib/functions/saveData/indexedDb";
import { buildHtmlTranslationBlob } from "$lib/functions/outputGeneration/outputGenerationHtml";
import { importHtmlFile, validateHtmlFile } from "./importers";
import { detectFormatWithConfidence } from "./registry";

function projectFromImport(
	name: string,
	imported: Awaited<ReturnType<typeof importHtmlFile>>,
	targets: string[],
) {
	if (imported.kind !== "segments") throw new Error("Expected HTML segments");
	return makeUserData({
		type: "html",
		name,
		typeRef: imported.typeRef!,
		seg1: imported.segments,
		seg2: targets,
		checked: targets.map(() => true),
		segmentsMeta: imported.segmentsMeta,
		documentModel: imported.document,
		skeleton: imported.skeleton,
		filterOptions: imported.filterOptions,
	});
}

describe("FF-502 browser-native server HTML workflows", () => {
	it("persists, restores, exports, and reopens a mixed PHP template without executing code", async () => {
		(globalThis as Record<string, unknown>).__ff502BrowserExecuted = false;
		const source = `<?php $GLOBALS['__ff502BrowserExecuted'] = true; ?>\r\n<!doctype html><html dir="rtl"><body><h1>مرحبا 世界</h1><p><?= $user->name ?></p></body></html>`;
		const file = new File([source], "account.php", {
			type: "application/x-httpd-php",
		});
		expect(await detectFormatWithConfidence(file)).toMatchObject({
			formatId: "html",
			supported: true,
			confidence: "high",
		});
		const imported = await importHtmlFile(file);
		expect(imported).toMatchObject({
			kind: "segments",
			segments: ["مرحبا 世界"],
			typeRef: { profile: "php-template", sourceExtension: "php" },
		});
		const name = `ff502-browser-${Date.now()}.php`;
		const project = projectFromImport(name, imported, ["שלום 🌍"]);
		await updateAllTranslationsOnIndexedDB([project]);
		const restored = (await loadTranslationsUserDataFromIndexedDB()).find(
			(entry) => entry.translationData.name === name,
		);
		expect(restored?.translationData.typeRef).toMatchObject({
			profile: "php-template",
			sourceExtension: "php",
		});
		const output = await buildHtmlTranslationBlob(restored!).text();
		expect(output).toContain(
			`<?php $GLOBALS['__ff502BrowserExecuted'] = true; ?>`,
		);
		expect(output).toContain("<h1>שלום 🌍</h1>");
		expect(output).toContain("<?= $user->name ?>");
		expect((globalThis as Record<string, unknown>).__ff502BrowserExecuted).toBe(
			false,
		);
		const reopened = new DOMParser().parseFromString(output, "text/html");
		expect(reopened.querySelector("h1")?.textContent).toBe("שלום 🌍");
	});

	it("round-trips HTML Help labels while retaining their local navigation targets", async () => {
		const source = `<!DOCTYPE HTML><HTML><BODY><UL><LI><OBJECT type="text/sitemap"><param name="Name" value="Overview"><param name="Local" value="guide/overview.htm"></OBJECT></LI></UL></BODY></HTML>`;
		const imported = await importHtmlFile(
			new File([source], "contents.hhc", { type: "text/html" }),
		);
		const project = projectFromImport("contents.hhc", imported, ["Übersicht"]);
		const blob = buildHtmlTranslationBlob(project);
		const reopenedFile = new File([blob], "translated.hhc", {
			type: blob.type,
		});
		expect(await validateHtmlFile(reopenedFile)).toEqual({ valid: true });
		const reopened = await importHtmlFile(reopenedFile);
		expect(reopened).toMatchObject({
			kind: "segments",
			segments: ["Übersicht"],
		});
		expect(await blob.text()).toContain(
			'<param name="Local" value="guide/overview.htm">',
		);
	});
});
