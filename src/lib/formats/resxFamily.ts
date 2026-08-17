import type { ResxSegmentMeta, TypeRef } from "$lib/types/types";
import { createNeutralDocument } from "./documentModel";
import { normalizeImportOptions } from "./options";
import {
	createSkeletonSource,
	readSafeTextFile,
	SafeInputError,
	type SafeInputContext,
} from "./safeInput";
import { createTextSkeleton, type ResxValueReplacement } from "./skeleton";
import type {
	FormatImportResult,
	FormatOptionValues,
	FormatValidationResult,
} from "./types";
import {
	decodeXmlText,
	parseXmlSyntax,
	type XmlElementLocation,
} from "./xmlFamily";

interface ResxValue {
	name: string;
	value: string;
	start: number;
	end: number;
	location: "text" | "cdata";
	type?: string;
	explicitSystemString: boolean;
	comment?: string;
}

export function parseResx(content: string): {
	values: ResxValue[];
	warnings: string[];
} {
	const syntax = parseXmlSyntax(content);
	const root = syntax.elements.find(
		(element) => element.parentId === undefined,
	);
	if (!root || root.localName !== "root")
		throw invalidResx("RESX must have a <root> document element.");
	const values: ResxValue[] = [];
	const warnings: string[] = [];
	const names = new Set<string>();
	for (const data of syntax.elements.filter(
		(element) => element.parentId === root.id && element.localName === "data",
	)) {
		const name = attribute(data, "name");
		if (!name) throw invalidResx("A RESX data record is missing its name.");
		if (names.has(name)) warnings.push(`Duplicate RESX data name ${name}.`);
		names.add(name);
		const type = attribute(data, "type");
		const mimetype = attribute(data, "mimetype");
		const explicitSystemString = Boolean(
			type && /^System\.String(?:,|$)/.test(type),
		);
		if (mimetype || (type && !explicitSystemString)) continue;
		const children = syntax.elements.filter(
			(element) => element.parentId === data.id,
		);
		const valueElement = children.find(
			(element) => element.localName === "value",
		);
		if (!valueElement || valueElement.endTagStart === undefined) {
			warnings.push(`String resource ${name} has no editable value element.`);
			continue;
		}
		if (
			syntax.elements.some((element) => element.parentId === valueElement.id)
		) {
			warnings.push(
				`String resource ${name} contains nested XML and was protected.`,
			);
			continue;
		}
		const innerStart = valueElement.startTagEnd + 1;
		const innerEnd = valueElement.endTagStart;
		const raw = content.slice(innerStart, innerEnd);
		const cdataPattern = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
		const cdata = [...raw.matchAll(cdataPattern)];
		const cdataOnly =
			cdata.length > 0 && raw.replace(cdataPattern, "").trim().length === 0;
		let start = innerStart;
		let end = innerEnd;
		let value = decodeXmlText(raw);
		let location: ResxValue["location"] = "text";
		if (cdataOnly) {
			const first = cdata[0];
			const last = cdata.at(-1)!;
			start = innerStart + first.index + 9;
			end = innerStart + last.index + last[0].length - 3;
			value = cdata.map((match) => match[1]).join("");
			location = "cdata";
		}
		const commentElement = children.find(
			(element) => element.localName === "comment",
		);
		const comment = commentElement
			? elementText(content, commentElement)
			: undefined;
		values.push({
			name,
			value,
			start,
			end,
			location,
			explicitSystemString,
			...(type ? { type } : {}),
			...(comment ? { comment } : {}),
		});
	}
	return { values, warnings };
}

function attribute(
	element: XmlElementLocation,
	name: string,
): string | undefined {
	return element.attributes.find((candidate) => candidate.localName === name)
		?.value;
}

function elementText(
	content: string,
	element: XmlElementLocation,
): string | undefined {
	if (element.endTagStart === undefined) return undefined;
	return decodeXmlText(
		content.slice(element.startTagEnd + 1, element.endTagStart),
	);
}

function invalidResx(message: string): SafeInputError {
	return new SafeInputError("RESX_INVALID", message);
}

export async function validateResxFile(
	file: File,
	context?: SafeInputContext,
): Promise<FormatValidationResult> {
	try {
		const { text } = await readSafeTextFile(file, context);
		parseResx(text);
		return { valid: true };
	} catch (error) {
		return error instanceof SafeInputError
			? { valid: false, reason: error.message, errorCode: error.code }
			: { valid: false, reason: "The file is not valid safe RESX XML." };
	}
}

export async function importResxFile(
	file: File,
	options?: Readonly<FormatOptionValues>,
	context?: SafeInputContext,
): Promise<FormatImportResult> {
	const filterOptions = normalizeImportOptions("resx", options);
	const read = await readSafeTextFile(file, context);
	const parsed = parseResx(read.text);
	const values = parsed.values.filter(
		(value) =>
			(filterOptions.includeExplicitSystemStrings ||
				!value.explicitSystemString) &&
			(filterOptions.includeEmpty || value.value.length > 0),
	);
	const segments = values.map((value) => value.value);
	const meta: ResxSegmentMeta[] = values.map((value) => ({
		name: value.name,
		start: value.start,
		end: value.end,
		originalValue: value.value,
		location: value.location,
		...(value.type ? { type: value.type } : {}),
	}));
	const replacements: ResxValueReplacement[] = meta.map((value, unitIndex) => ({
		kind: "resx-value",
		unitIndex,
		...value,
	}));
	const document = createNeutralDocument({
		format: "resx",
		sourceSegments: segments,
		targetSegments: segments.map(() => ""),
		unitIds: values.map((value) => value.name),
		sourceLocations: values.map((value, segmentIndex) => ({
			part: file.name,
			path: ["root", "data", value.name, "value"],
			segmentIndex,
		})),
	});
	document.metadata = {
		profile: "dotnet-resx",
		encoding: read.encoding,
		hasBom: read.hasBom,
		warnings: parsed.warnings,
	};
	for (const [index, value] of values.entries()) {
		const unit = document.units[index];
		unit.contexts.push({ type: "resx-name", value: value.name });
		if (value.type)
			unit.contexts.push({ type: "resx-type", value: value.type });
		if (value.comment)
			unit.notes.push({
				category: "developer-comment",
				text: value.comment,
				appliesTo: "source",
			});
	}
	return {
		kind: "segments",
		segments,
		targetSegments: segments.map(() => ""),
		document,
		skeleton: await createTextSkeleton(
			file,
			"resx",
			read.text,
			replacements,
			createSkeletonSource(file, read),
		),
		filterOptions,
		typeRef: { profile: "dotnet-resx" } as TypeRef,
		segmentsMeta: meta,
	};
}
