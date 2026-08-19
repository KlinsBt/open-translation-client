import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import type {
	OcrSegmentMeta,
	TranscriptionSegmentMeta,
	UserData,
} from "$lib/types/types";

function escapeHtml(value: string): string {
	return value.replace(
		/[&<>"']/g,
		(character) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				character
			]!,
	);
}

function isOcrMeta(value: unknown): value is OcrSegmentMeta {
	return (
		!!value &&
		typeof value === "object" &&
		"profile" in value &&
		value.profile === "local-image-ocr"
	);
}

function isTranscriptionMeta(
	value: unknown,
): value is TranscriptionSegmentMeta {
	return (
		!!value &&
		typeof value === "object" &&
		"profile" in value &&
		value.profile === "local-media-transcription"
	);
}

function download(blob: Blob, fileName: string): void {
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

export function buildOcrBilingualReview(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	if (data.type !== "image-ocr" || !data.segmentsMeta?.every(isOcrMeta))
		throw new Error("OCR review export requires aligned local OCR metadata.");
	const rows = (data.segmentsMeta as OcrSegmentMeta[])
		.map(
			(meta, index) =>
				`<tr data-bbox="${meta.bbox.join(",")}" data-confidence="${meta.confidence.toFixed(3)}"><th scope="row">${index + 1}</th><td dir="${meta.direction}">${escapeHtml(data.seg1[index] ?? "")}</td><td dir="auto">${escapeHtml(data.seg2[index] ?? "")}</td><td>${Math.round(meta.confidence * 100)}%</td></tr>`,
		)
		.join("");
	const title = escapeHtml(`${data.name || "image"} — OCR translation review`);
	return `<!doctype html><html lang="${escapeHtml(data.targetLang || "en")}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui,sans-serif;max-width:80rem;margin:auto;padding:2rem;line-height:1.5}table{border-collapse:collapse;width:100%}th,td{border:1px solid #8c959f;padding:.6rem;text-align:start;vertical-align:top}.notice{padding:1rem;background:#fff8c5;border:2px solid #9a6700}</style></head><body><main><h1>${title}</h1><p class="notice"><strong>Derived OCR artifact:</strong> recognition ran on-device. Review low-confidence text against the original image before delivery.</p><table><thead><tr><th>Unit</th><th>Recognized source</th><th>Translation</th><th>OCR confidence</th></tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}

export async function generateOcrBilingualReview(
	project: UserData,
): Promise<void> {
	const base = (project.translationData.name || "image").replace(
		/\.(png|jpe?g|jpe|jif|jfif|jfi|tiff?|bmp|dib|gif)$/i,
		"",
	);
	download(
		new Blob([buildOcrBilingualReview(project)], {
			type: "text/html;charset=utf-8",
		}),
		`${base}.ocr-review.html`,
	);
}

function vttTimestamp(milliseconds: number): string {
	const safe = Math.max(0, Math.round(milliseconds));
	const hours = Math.floor(safe / 3_600_000);
	const minutes = Math.floor((safe % 3_600_000) / 60_000);
	const seconds = Math.floor((safe % 60_000) / 1000);
	const millis = safe % 1000;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function buildTranslatedWebVtt(project: UserData): string {
	assertProjectExportQuality(project);
	const data = project.translationData;
	if (
		data.type !== "media-transcription" ||
		!data.segmentsMeta?.every(isTranscriptionMeta)
	)
		throw new Error(
			"WebVTT export requires aligned local transcription timestamps.",
		);
	const cues = (data.segmentsMeta as TranscriptionSegmentMeta[]).map(
		(meta, index) => {
			const translated = (data.seg2[index] || data.seg1[index] || "")
				.replace(/\r?\n/g, " ")
				.trim();
			return `${index + 1}\n${vttTimestamp(meta.startMs)} --> ${vttTimestamp(meta.endMs)}\n${translated}`;
		},
	);
	return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

export async function generateTranslatedWebVtt(
	project: UserData,
): Promise<void> {
	const base = (project.translationData.name || "transcript").replace(
		/\.[^.]+$/i,
		"",
	);
	download(
		new Blob([buildTranslatedWebVtt(project)], {
			type: "text/vtt;charset=utf-8",
		}),
		`${base}.translated.vtt`,
	);
}
