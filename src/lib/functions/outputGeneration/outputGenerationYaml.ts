import { isScalar, parseDocument } from "yaml";
import type { UserData } from "$lib/types/types";
import {
	getTextSkeletonContent,
	type YamlScalarReplacement,
} from "$lib/formats/skeleton";
import { assertProjectExportQuality } from "$lib/formats/qualityAssurance";
import { encodeTextBytes } from "./outputGenerationText";

export function buildYamlTranslation(project: UserData): string {
	const data = project.translationData;
	const content = getTextSkeletonContent(data.skeleton, "yaml");
	if (content === undefined)
		throw new Error(
			"YAML export requires its original lossless text skeleton.",
		);
	const replacements = data.skeleton!.replacements.filter(
		(replacement): replacement is YamlScalarReplacement =>
			replacement.kind === "yaml-scalar",
	);
	if (
		replacements.length !== data.seg2.length ||
		new Set(replacements.map((replacement) => replacement.unitIndex)).size !==
			replacements.length ||
		replacements.some(
			(replacement) =>
				replacement.unitIndex < 0 || replacement.unitIndex >= data.seg2.length,
		)
	)
		throw new Error(
			`YAML export cannot continue because its ${replacements.length} scalar mappings do not align uniquely with ${data.seg2.length} target segments.`,
		);

	const groups = new Map<string, YamlScalarReplacement[]>();
	for (const replacement of replacements) {
		const key = `${replacement.start}:${replacement.end}`;
		const group = groups.get(key) ?? [];
		group.push(replacement);
		groups.set(key, group);
	}
	const edits: Array<{ start: number; end: number; encoded: string }> = [];
	for (const group of groups.values()) {
		const ordered = group.sort(
			(first, second) => first.unitIndex - second.unitIndex,
		);
		let translated = "";
		for (const replacement of ordered) {
			const separator = replacement.separator ?? "";
			let value = data.seg2[replacement.unitIndex] ?? "";
			if (separator && value.endsWith(separator))
				value = value.slice(0, -separator.length);
			translated += `${value}${separator}`;
		}
		const replacement = ordered[0];
		if (translated === replacement.originalValue) continue;
		const originalRaw = content.slice(replacement.start, replacement.end);
		edits.push({
			start: replacement.start,
			end: replacement.end,
			encoded: encodeYamlScalar(translated, replacement, originalRaw),
		});
	}

	let output = content;
	for (const edit of edits.sort((first, second) => second.start - first.start))
		output = `${output.slice(0, edit.start)}${edit.encoded}${output.slice(edit.end)}`;
	return output;
}

function encodeYamlScalar(
	value: string,
	replacement: YamlScalarReplacement,
	originalRaw: string,
): string {
	switch (replacement.style) {
		case "QUOTE_SINGLE":
			return `'${value.replaceAll("'", "''")}'`;
		case "QUOTE_DOUBLE":
			return JSON.stringify(value);
		case "BLOCK_LITERAL":
		case "BLOCK_FOLDED":
			return encodeBlockScalar(value, replacement.style, originalRaw);
		default:
			return encodePlainScalar(value, replacement.valueType);
	}
}

function encodePlainScalar(
	value: string,
	valueType: YamlScalarReplacement["valueType"],
): string {
	if (plainCandidateHasSyntax(value, valueType)) return JSON.stringify(value);
	try {
		const document = parseDocument(value, {
			prettyErrors: false,
			strict: true,
			version: "1.2",
		});
		if (document.errors.length || !isScalar(document.contents))
			return JSON.stringify(value);
		const parsed = document.contents.value;
		const parsedType =
			parsed === null
				? "null"
				: typeof parsed === "boolean"
					? "boolean"
					: typeof parsed === "number" || typeof parsed === "bigint"
						? "number"
						: "string";
		if (parsedType !== valueType) return JSON.stringify(value);
		return value;
	} catch {
		return JSON.stringify(value);
	}
}

function plainCandidateHasSyntax(
	value: string,
	valueType: YamlScalarReplacement["valueType"],
): boolean {
	if (valueType !== "string")
		return (
			!value ||
			value.trim() !== value ||
			/[\r\n]/.test(value) ||
			/^[!&*]/.test(value) ||
			/^(?:---|\.\.\.)$/.test(value)
		);
	return (
		!value ||
		value.trim() !== value ||
		/[\r\n]/.test(value) ||
		/^[\-?:,\[\]{}#&*!|>'"%@`]/.test(value) ||
		/:\s|\s#/.test(value) ||
		/^(?:---|\.\.\.)$/.test(value)
	);
}

function encodeBlockScalar(
	value: string,
	style: "BLOCK_LITERAL" | "BLOCK_FOLDED",
	originalRaw: string,
): string {
	const header = originalRaw.match(/^([^\r\n]*)(\r\n|\n|\r)/);
	if (!header) return JSON.stringify(value);
	const headerText = header[1];
	const lineEnding = header[2];
	const body = originalRaw.slice(header[0].length);
	const indent =
		body.match(/^( +)\S/m)?.[1] ??
		" ".repeat(Math.max(1, Number(headerText.match(/[1-9]/)?.[0] ?? 2)));
	const normalized = value.replace(/\r\n?/g, "\n");
	const chomp = headerText
		.match(/^[|>][1-9]?([+-])|^[|>]([+-])[1-9]?/)
		?.slice(1)
		.find(Boolean);
	const trailing = normalized.match(/\n+$/)?.[0].length ?? 0;
	const core = trailing ? normalized.slice(0, -trailing) : normalized;
	const physicalCore =
		style === "BLOCK_FOLDED" ? core.split("\n").join("\n\n") : core;
	const physicalLines = physicalCore
		.split("\n")
		.map((line) => (line ? `${indent}${line}` : ""))
		.join(lineEnding);
	const physicalTrailing =
		chomp === "-"
			? core
				? 1
				: 0
			: chomp === "+"
				? Math.max(core ? 1 : 0, trailing)
				: core
					? 1
					: 0;
	return `${headerText}${lineEnding}${physicalLines}${lineEnding.repeat(physicalTrailing)}`;
}

export function buildYamlTranslationBlob(project: UserData): Blob {
	const data = project.translationData;
	const content = buildYamlTranslation(project);
	const source = getTextSkeletonContent(data.skeleton, "yaml");
	if (source === content && data.skeleton?.source.originalFile)
		return data.skeleton.source.originalFile;
	const encoding = data.skeleton?.source.encoding ?? "utf-8";
	const hasBom = data.skeleton?.source.hasBom ?? false;
	return new Blob([encodeTextBytes(content, encoding, hasBom)], {
		type: `application/yaml;charset=${encoding}`,
	});
}

export async function generateYamlTranslation(
	project: UserData,
): Promise<void> {
	assertProjectExportQuality(project);
	const sourceName =
		project.translationData.skeleton?.source.name ?? "translation.yaml";
	const extension = /\.yml$/i.test(sourceName) ? "yml" : "yaml";
	const requested = project.translationData.name || sourceName;
	const name = /\.(?:yaml|yml)$/i.test(requested)
		? requested
		: `${requested}.${extension}`;
	const url = URL.createObjectURL(buildYamlTranslationBlob(project));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(URL.revokeObjectURL.bind(URL, url), 1_000);
}
