import type { UserData } from "$lib/types/types";
import { neutralizeCsvFormula } from "$lib/formats/csv";
import { buildSegmentDeliveryPdf } from "./outputGenerationPdf";

export type ConvertedExportFormat =
	| "pdf"
	| "docx"
	| "rtf"
	| "html"
	| "txt"
	| "csv";

export interface ConvertedExportFile {
	blob: Blob;
	fileName: string;
}

function projectBaseName(project: UserData): string {
	const name = project.translationData.name.trim() || "translation";
	const sanitized = name
		.replace(/\.[a-z0-9]{1,8}$/i, "")
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
		.replace(/[. ]+$/g, "")
		.trim();
	if (!sanitized) return "translation";
	if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized))
		return `translation-${sanitized}`;
	return sanitized;
}

function languageCode(language: string): string {
	return language.match(/\(([^)]+)\)\s*$/)?.[1] ?? language;
}

function targetSegments(project: UserData): string[] {
	return project.translationData.seg2.map((segment) => segment ?? "");
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function csvCell(value: string | number): string {
	return `"${neutralizeCsvFormula(String(value)).replaceAll('"', '""')}"`;
}

function rtfText(value: string): string {
	let output = "";
	for (const character of value.replace(/\r\n?/g, "\n")) {
		if (character === "\\" || character === "{" || character === "}") {
			output += `\\${character}`;
			continue;
		}
		if (character === "\n") {
			output += "\\line ";
			continue;
		}
		const codePoint = character.codePointAt(0) ?? 0;
		if (codePoint >= 32 && codePoint <= 126) {
			output += character;
			continue;
		}
		for (let index = 0; index < character.length; index += 1) {
			const codeUnit = character.charCodeAt(index);
			const signed = codeUnit > 32767 ? codeUnit - 65536 : codeUnit;
			output += `\\u${signed}?`;
		}
	}
	return output;
}

async function docxBlob(project: UserData): Promise<Blob> {
	const { Document, Packer, Paragraph, TextRun } = await import("docx");
	const paragraphs = targetSegments(project).map(
		(segment) =>
			new Paragraph({
				children: [new TextRun({ text: segment })],
			}),
	);
	const document = new Document({ sections: [{ children: paragraphs }] });
	return Packer.toBlob(document);
}

export async function buildConvertedTranslation(
	project: UserData,
	format: ConvertedExportFormat,
): Promise<ConvertedExportFile> {
	const baseName = projectBaseName(project);
	const targets = targetSegments(project);
	let blob: Blob;

	if (format === "pdf") {
		blob = await buildSegmentDeliveryPdf(project);
	} else if (format === "docx") {
		blob = await docxBlob(project);
	} else if (format === "html") {
		const lang = escapeHtml(languageCode(project.translationData.targetLang));
		const title = escapeHtml(project.translationData.name || "Translation");
		const body = targets
			.map(
				(segment, index) =>
					`<p data-segment="${index + 1}">${escapeHtml(segment).replaceAll("\n", "<br>")}</p>`,
			)
			.join("\n");
		blob = new Blob(
			[
				`<!doctype html>\n<html lang="${lang}">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title}</title>\n</head>\n<body>\n${body}\n</body>\n</html>\n`,
			],
			{ type: "text/html;charset=utf-8" },
		);
	} else if (format === "csv") {
		const rows = project.translationData.seg1.map((source, index) => [
			index + 1,
			source,
			targets[index] ?? "",
			project.translationData.checked[index] ? "confirmed" : "draft",
		]);
		const csv = [["Segment", "Source", "Target", "Status"], ...rows]
			.map((row) => row.map(csvCell).join(","))
			.join("\r\n");
		blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
	} else if (format === "rtf") {
		const body = targets
			.map((segment) => `${rtfText(segment)}\\par`)
			.join("\n");
		blob = new Blob([`{\\rtf1\\ansi\\deff0\\uc1\n${body}\n}`], {
			type: "application/rtf",
		});
	} else {
		blob = new Blob([targets.join("\n\n")], {
			type: "text/plain;charset=utf-8",
		});
	}

	return { blob, fileName: `${baseName}.${format}` };
}

export async function downloadConvertedTranslation(
	project: UserData,
	format: ConvertedExportFormat,
): Promise<void> {
	const { blob, fileName } = await buildConvertedTranslation(project, format);
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	try {
		link.href = url;
		link.download = fileName;
		document.body.appendChild(link);
		link.click();
	} finally {
		link.remove();
		setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
	}
}
