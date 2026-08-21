import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import type { PdfSegmentMeta, UserData } from "$lib/types/types";

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		return {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;",
		}[character]!;
	});
}

function isPdfMeta(value: unknown): value is PdfSegmentMeta {
	return (
		!!value &&
		typeof value === "object" &&
		"profile" in value &&
		value.profile === "pdf-source-only" &&
		"page" in value &&
		typeof value.page === "number"
	);
}

export function buildPdfBilingualReview(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	if (data.type !== "pdf")
		throw new Error("PDF review export requires a PDF source-only project.");
	if (
		data.seg1.length !== data.seg2.length ||
		data.segmentsMeta?.length !== data.seg1.length ||
		!data.segmentsMeta.every(isPdfMeta)
	)
		throw new Error(
			"PDF review export cannot continue because page mappings are missing or out of sync.",
		);
	const rowsByPage = new Map<number, string[]>();
	for (const [index, metadata] of (
		data.segmentsMeta as PdfSegmentMeta[]
	).entries()) {
		const bbox = metadata.bbox.map((value) =>
			Number.isFinite(value) ? Number(value.toFixed(3)) : 0,
		);
		const row = `<tr data-page="${metadata.page}" data-bbox="${bbox.join(",")}"><th scope="row">${index + 1}</th><td lang="${escapeHtml(data.sourceLang || "und")}" dir="${metadata.direction}">${escapeHtml(data.seg1[index] ?? "")}</td><td lang="${escapeHtml(data.targetLang || "und")}" dir="auto">${escapeHtml(data.seg2[index] ?? "")}</td></tr>`;
		const rows = rowsByPage.get(metadata.page) ?? [];
		rows.push(row);
		rowsByPage.set(metadata.page, rows);
	}
	const pages = [...rowsByPage.entries()]
		.sort(([first], [second]) => first - second)
		.map(
			([page, rows]) =>
				`<section aria-labelledby="page-${page}"><h2 id="page-${page}">Source page ${page}</h2><table><thead><tr><th scope="col">Unit</th><th scope="col">Source</th><th scope="col">Translation</th></tr></thead><tbody>${rows.join("")}</tbody></table></section>`,
		)
		.join("");
	const title = escapeHtml(
		`${data.name || "PDF"} — accessible bilingual review`,
	);
	return `<!doctype html>
<html lang="${escapeHtml(data.targetLang || "en")}">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
body{font-family:system-ui,sans-serif;line-height:1.5;max-width:80rem;margin:auto;padding:2rem;color:#172033;background:#fff}
.notice{padding:1rem;border:2px solid #9a6700;background:#fff8c5}section{margin-block:2rem}table{border-collapse:collapse;width:100%}th,td{border:1px solid #8c959f;padding:.6rem;text-align:start;vertical-align:top}thead{background:#f0f3f6}tbody th{width:4rem}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p class="notice"><strong>Derived review artifact:</strong> this accessible document contains lossy text extracted from a PDF. It does not reproduce the source layout and is not a replacement PDF.</p>
${pages}
</main>
</body>
</html>`;
}

export function buildPdfBilingualReviewBlob(project: UserData): Blob {
	return new Blob([buildPdfBilingualReview(project)], {
		type: "text/html;charset=utf-8",
	});
}

export async function generatePdfBilingualReview(
	project: UserData,
): Promise<void> {
	const requested = project.translationData.name || "pdf-review";
	const base = requested.replace(/\.pdf$/i, "") || "pdf-review";
	const url = URL.createObjectURL(buildPdfBilingualReviewBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = `${base}.bilingual.html`;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
