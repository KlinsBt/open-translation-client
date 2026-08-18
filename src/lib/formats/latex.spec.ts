// @vitest-environment happy-dom

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeUserData } from "../../test/fixtures";
import {
	buildLatexTranslation,
	buildLatexTranslationBlob,
} from "$lib/functions/outputGeneration/outputGenerationLatex";
import { encodeTextBytes } from "$lib/functions/outputGeneration/outputGenerationText";
import { splitSegmentData } from "$lib/functions/parsing/segmentationLogic";
import { decodeTextBytes } from "./safeInput";
import { importLatexFile, scanLatexProse, validateLatexFile } from "./latex";
import { normalizeImportOptions } from "./options";
import type { FormatOptionValues } from "./types";

async function importProject(
	content: BlobPart,
	options: Readonly<FormatOptionValues> = {},
	targets?: string[],
) {
	const file = new File([content], "manual.tex", { type: "application/x-tex" });
	const result = await importLatexFile(file, options);
	if (result.kind !== "segments") throw new Error("Expected LaTeX segments");
	return {
		result,
		project: makeUserData({
			type: "latex",
			name: "manual.tex",
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

describe("grammar-aware TeX/LaTeX workflow", () => {
	it("exposes prose and selected macro arguments while protecting commands, math, references, code, and comments", async () => {
		const source = String.raw`\documentclass{article}
\usepackage{hyperref}
\title{Manual title}
\author{Writer}
% translator note
\begin{document}
\maketitle
\section{Introduction}
Hello \textbf{world}. See \href{https://example.com?q=1}{the website}.
Math $E=mc^2$ and \(a+b\) remain protected. \label{sec:intro}\cite{paper}
\begin{verbatim}
dangerous_{code} % not a comment
\end{verbatim}
\end{document}`;
		const { result, project } = await importProject(source, {
			segmentationMode: "range",
		});
		expect(result.segments).toEqual(
			expect.arrayContaining([
				"Manual title",
				"Writer",
				"Introduction",
				"Hello",
				"world",
				"the website",
			]),
		);
		const joined = result.segments.join(" ");
		expect(joined).not.toContain("translator note");
		expect(joined).not.toContain("E=mc");
		expect(joined).not.toContain("dangerous");
		expect(joined).not.toContain("https://");
		expect(joined).not.toContain("sec:intro");
		project.translationData.seg2 = result.segments.map((value) =>
			value === "world" ? "Welt" : value,
		);
		const output = buildLatexTranslation(project);
		expect(output).toContain(String.raw`\textbf{Welt}`);
		expect(output).toContain(String.raw`$E=mc^2$`);
		expect(output).toContain("dangerous_{code} % not a comment");
		expect(output).toContain(String.raw`\label{sec:intro}\cite{paper}`);
	});

	it("supports comment/metadata filters and configurable macro argument indexes", async () => {
		const source = String.raw`\title{Metadata}
% Translate this comment
\custom{Protected argument}
\linkmacro{https://example.com}{Visible label}
\begin{document}Body text\end{document}`;
		const defaults = await importLatexFile(new File([source], "manual.tex"), {
			segmentationMode: "range",
		});
		const custom = await importLatexFile(new File([source], "manual.tex"), {
			includeComments: true,
			includeMetadata: false,
			translatableCommands: "linkmacro:2",
			segmentationMode: "range",
		});
		if (defaults.kind !== "segments" || custom.kind !== "segments")
			throw new Error("Expected LaTeX segments");
		expect(defaults.segments).toContain("Metadata");
		expect(defaults.segments.join(" ")).not.toContain("Protected argument");
		expect(custom.segments).toEqual(
			expect.arrayContaining([
				"Translate this comment",
				"Visible label",
				"Body text",
			]),
		);
		expect(custom.segments.join(" ")).not.toContain("Metadata");
		expect(custom.segments.join(" ")).not.toContain("https://");
	});

	it("rejects malformed braces, environments, math, verbatim delimiters, and macro rules", async () => {
		const invalid = [
			String.raw`\section{Broken`,
			String.raw`\begin{document}Text\end{itemize}`,
			String.raw`\begin{verbatim}never closed`,
			String.raw`Text $never closed`,
			String.raw`\verb|never closed`,
		];
		for (const content of invalid)
			await expect(
				validateLatexFile(new File([content], "bad.tex")),
			).resolves.toMatchObject({
				valid: false,
			});
		expect(() =>
			scanLatexProse("Text", {
				...normalizeImportOptions("latex"),
				translatableCommands: "broken",
			}),
		).toThrow(/name:argument-index/);
	});

	it("escapes translated TeX-special characters and re-lexes the result", async () => {
		const { project } = await importProject(
			String.raw`\begin{document}Price and ratio\end{document}`,
			{ segmentationMode: "range" },
		);
		project.translationData.seg2 = ["Price 50% & file_name #1 ~ ^ \\ path"];
		const output = buildLatexTranslation(project);
		expect(output).toContain(
			String.raw`Price 50\% \& file\_name \#1 \textasciitilde{} \textasciicircum{} \textbackslash{} path`,
		);
		expect(() =>
			scanLatexProse(
				output,
				normalizeImportOptions("latex", project.translationData.filterOptions),
			),
		).not.toThrow();
	});

	it("preserves UTF-16 identity bytes", async () => {
		const bytes = encodeTextBytes(
			String.raw`\begin{document}Café\end{document}`,
			"utf-16be",
			true,
		);
		const { project } = await importProject(bytes, {
			segmentationMode: "range",
		});
		expect(
			new Uint8Array(await buildLatexTranslationBlob(project).arrayBuffer()),
		).toEqual(bytes);
		project.translationData.seg2 = ["Kaffee"];
		const decoded = decodeTextBytes(
			new Uint8Array(await buildLatexTranslationBlob(project).arrayBuffer()),
		);
		expect(decoded).toMatchObject({ encoding: "utf-16be", hasBom: true });
		expect(decoded.text).toContain("Kaffee");
	});

	it("round-trips sentence segmentation without duplication", async () => {
		const { result, project } = await importProject(
			String.raw`\begin{document}First sentence. Second sentence.\end{document}`,
			{ segmentationMode: "sentences" },
		);
		expect(result.segments).toEqual(["First sentence. ", "Second sentence."]);
		project.translationData.seg2 = ["Erster Satz. ", "Zweiter Satz."];
		const output = buildLatexTranslation(project);
		expect(output.match(/Erster Satz/g)).toHaveLength(1);
		expect(output.match(/Zweiter Satz/g)).toHaveLength(1);
	});

	it("blocks structural edits and stale mappings", async () => {
		const { project } = await importProject(
			String.raw`\begin{document}Hello world\end{document}`,
			{ segmentationMode: "range" },
		);
		expect(splitSegmentData(project.translationData, 0, 2).error).toMatch(
			/cannot be split or joined/,
		);
		if (!project.translationData.skeleton) throw new Error("Expected skeleton");
		project.translationData.skeleton.replacements[0].unitIndex = 8;
		expect(() => buildLatexTranslation(project)).toThrow(
			/do not align uniquely/,
		);
	});

	it("imports 1,000 prose paragraphs deterministically", async () => {
		const source = `${String.raw`\begin{document}`}
${Array.from({ length: 1_000 }, (_, index) => `Message ${index}.`).join("\n\n")}
${String.raw`\end{document}`}`;
		const options = { segmentationMode: "sentences" };
		const first = await importLatexFile(
			new File([source], "large.tex"),
			options,
		);
		const second = await importLatexFile(
			new File([source], "large.tex"),
			options,
		);
		if (first.kind !== "segments" || second.kind !== "segments")
			throw new Error("Expected LaTeX segments");
		expect(first.segments).toHaveLength(1_000);
		expect(second.segmentsMeta).toEqual(first.segmentsMeta);
	});

	it.runIf(process.env.OPENTLC_RUN_LATEX_ENGINE === "1")(
		"compiles a translated document when a TeX engine is explicitly enabled",
		async () => {
			const executable = spawnSync("pdflatex", ["--version"], {
				timeout: 10_000,
			});
			expect(executable.status, executable.stderr?.toString()).toBe(0);
			const { project } = await importProject(
				String.raw`\documentclass{article}\begin{document}Hello world.\end{document}`,
				{ segmentationMode: "range" },
			);
			project.translationData.seg2 = ["Hallo Welt."];
			const directory = mkdtempSync(join(tmpdir(), "opentlc-latex-"));
			try {
				const path = join(directory, "translated.tex");
				writeFileSync(path, buildLatexTranslation(project));
				const compiled = spawnSync(
					"pdflatex",
					["-interaction=nonstopmode", "-halt-on-error", "translated.tex"],
					{ cwd: directory, encoding: "utf8", timeout: 120_000 },
				);
				expect(compiled.status, compiled.stdout + compiled.stderr).toBe(0);
				expect(
					readFileSync(join(directory, "translated.pdf")).length,
				).toBeGreaterThan(0);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
