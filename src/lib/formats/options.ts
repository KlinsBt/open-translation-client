import type { FormatId } from "./formatIds";
import type {
	FormatImportOption,
	FormatOptionValue,
	FormatOptionValues,
} from "./types";

export const FORMAT_IMPORT_OPTIONS = {
	text: [
		{
			id: "segmentationMode",
			label: "Segmentation",
			type: "select",
			defaultValue: "preferences",
			choices: ["preferences", "paragraphs", "lines", "document"],
			description: "Choose how source text is divided into translation units.",
		},
	],
	json: [
		{
			id: "pathSelectors",
			label: "JSON paths",
			type: "text",
			defaultValue: "",
			placeholder: "e.g. messages.**, products.*.title",
			description:
				"Comma-separated paths. * matches one key; ** matches any depth.",
		},
		{
			id: "includeNonStringValues",
			label: "Include numbers and booleans",
			type: "boolean",
			defaultValue: true,
			description: "Import primitive values as well as strings.",
		},
	],
	docx: [
		{
			id: "paragraphs",
			label: "Paragraphs",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. 1-5, 8",
			description: "Import all paragraphs or a 1-based range list.",
		},
	],
	xlsx: [
		{
			id: "worksheetPaths",
			label: "Worksheets",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. sheet1, sheet3",
			description: "Comma-separated worksheet filenames or package paths.",
		},
		{
			id: "columns",
			label: "Columns",
			type: "text",
			defaultValue: "",
			placeholder: "All, or e.g. A, C-F",
			description: "Column letters and ranges for inline and value cells.",
		},
		{
			id: "includeSharedStrings",
			label: "Include shared strings",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "includeCellValues",
			label: "Include numeric and formula values",
			type: "boolean",
			defaultValue: true,
		},
	],
	html: [
		{
			id: "includeTextNodes",
			label: "Include visible text",
			type: "boolean",
			defaultValue: true,
		},
		{
			id: "translatableAttributes",
			label: "Translatable attributes",
			type: "text",
			defaultValue: "placeholder,value,alt,title",
			placeholder: "placeholder, value, alt, title",
			description:
				"Comma-separated HTML attribute names; leave empty for none.",
		},
	],
} as const satisfies Record<FormatId, readonly FormatImportOption[]>;

export function normalizeImportOptions(
	format: FormatId,
	supplied: Readonly<FormatOptionValues> = {},
): FormatOptionValues {
	const normalized: FormatOptionValues = {};
	for (const option of FORMAT_IMPORT_OPTIONS[format]) {
		const value = supplied[option.id] ?? option.defaultValue;
		normalized[option.id] = normalizeValue(option, value);
	}
	return normalized;
}

function normalizeValue(
	option: FormatImportOption,
	value: FormatOptionValue,
): FormatOptionValue {
	if (option.type === "boolean") {
		return typeof value === "string"
			? value.toLowerCase() === "true"
			: Boolean(value);
	}
	if (option.type === "number") {
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : option.defaultValue;
	}
	const text = String(value);
	if (option.type === "select" && !option.choices?.includes(text)) {
		return option.defaultValue;
	}
	return text.trim();
}

export function parseList(value: FormatOptionValue | undefined): string[] {
	return String(value ?? "")
		.split(/[\n,]/)
		.map((item) => item.trim())
		.filter(Boolean);
}

export function matchesJsonSelector(
	path: readonly string[],
	selectors: readonly string[],
): boolean {
	if (selectors.length === 0) return true;
	return selectors.some((selector) => {
		const parts = selector
			.replace(/^\$\.?/, "")
			.split(/[./]/)
			.filter(Boolean);
		return matchPathParts(path, parts, 0, 0);
	});
}

function matchPathParts(
	path: readonly string[],
	pattern: readonly string[],
	pathIndex: number,
	patternIndex: number,
): boolean {
	if (patternIndex === pattern.length) return pathIndex === path.length;
	if (pattern[patternIndex] === "**") {
		return (
			matchPathParts(path, pattern, pathIndex, patternIndex + 1) ||
			(pathIndex < path.length &&
				matchPathParts(path, pattern, pathIndex + 1, patternIndex))
		);
	}
	if (pathIndex >= path.length) return false;
	return (
		(pattern[patternIndex] === "*" ||
			pattern[patternIndex] === path[pathIndex]) &&
		matchPathParts(path, pattern, pathIndex + 1, patternIndex + 1)
	);
}

export function parsePositiveRanges(
	value: FormatOptionValue | undefined,
	maximum = 100_000,
): Set<number> | null {
	const entries = parseList(value);
	if (
		entries.length === 0 ||
		entries.some((entry) => entry.toLowerCase() === "all")
	)
		return null;
	const result = new Set<number>();
	for (const entry of entries) {
		const match = entry.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
		if (!match) continue;
		const start = Number(match[1]);
		const end = Number(match[2] ?? match[1]);
		for (
			let current = Math.max(1, start);
			current <= Math.min(end, maximum);
			current++
		)
			result.add(current);
	}
	return result;
}

function columnNumber(column: string): number {
	return [...column.toUpperCase()].reduce(
		(total, character) => total * 26 + character.charCodeAt(0) - 64,
		0,
	);
}

export function parseColumns(
	value: FormatOptionValue | undefined,
): Set<number> | null {
	const entries = parseList(value);
	if (
		entries.length === 0 ||
		entries.some((entry) => entry.toLowerCase() === "all")
	)
		return null;
	const result = new Set<number>();
	for (const entry of entries) {
		const match = entry.match(/^([a-z]+)(?:\s*-\s*([a-z]+))?$/i);
		if (!match) continue;
		const start = columnNumber(match[1]);
		const end = columnNumber(match[2] ?? match[1]);
		for (let current = start; current <= Math.min(end, 16_384); current++)
			result.add(current);
	}
	return result;
}

export function columnFromCellReference(reference: string): number | null {
	const match = reference.match(/^([a-z]+)/i);
	return match ? columnNumber(match[1]) : null;
}
