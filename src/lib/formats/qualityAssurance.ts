import type { FormatId } from "./formatIds";
import {
	hasInlineCodes,
	type InlineCodeFragment,
	type SegmentContent,
} from "./documentModel";
import type { UserData } from "$lib/types/types";

export type ExportQaIssueCode =
	| "MISSING_PLACEHOLDER"
	| "DUPLICATED_PLACEHOLDER"
	| "UNEXPECTED_PLACEHOLDER"
	| "REORDERED_PLACEHOLDER"
	| "MALFORMED_PLACEHOLDER"
	| "MISSING_TAG"
	| "DUPLICATED_TAG"
	| "UNEXPECTED_TAG"
	| "REORDERED_TAG"
	| "MALFORMED_TAG"
	| "MISSING_INLINE_CODE"
	| "DUPLICATED_INLINE_CODE"
	| "UNEXPECTED_INLINE_CODE"
	| "REORDERED_INLINE_CODE"
	| "MALFORMED_INLINE_CODE"
	| "UNIT_ALIGNMENT";

export interface ExportQaIssue {
	code: ExportQaIssueCode;
	unitIndex: number;
	unitId?: string;
	message: string;
	token?: string;
}

export interface ExportQaResult {
	valid: boolean;
	issues: ExportQaIssue[];
	checkedUnits: number;
}

export interface FormatQaPolicy {
	allowTagReorder: boolean;
	allowInlineCodeReorder: boolean;
}

export const FORMAT_QA_POLICIES: Readonly<Record<FormatId, FormatQaPolicy>> = {
	text: { allowTagReorder: false, allowInlineCodeReorder: false },
	csv: { allowTagReorder: false, allowInlineCodeReorder: false },
	json: { allowTagReorder: false, allowInlineCodeReorder: false },
	yaml: { allowTagReorder: false, allowInlineCodeReorder: false },
	po: { allowTagReorder: false, allowInlineCodeReorder: false },
	android: { allowTagReorder: true, allowInlineCodeReorder: true },
	apple: { allowTagReorder: false, allowInlineCodeReorder: false },
	properties: { allowTagReorder: false, allowInlineCodeReorder: false },
	resx: { allowTagReorder: false, allowInlineCodeReorder: false },
	"qt-ts": { allowTagReorder: true, allowInlineCodeReorder: true },
	ini: { allowTagReorder: false, allowInlineCodeReorder: false },
	php: { allowTagReorder: false, allowInlineCodeReorder: false },
	markup: { allowTagReorder: false, allowInlineCodeReorder: false },
	subtitles: { allowTagReorder: true, allowInlineCodeReorder: true },
	odf: { allowTagReorder: true, allowInlineCodeReorder: true },
	epub: { allowTagReorder: true, allowInlineCodeReorder: true },
	svg: { allowTagReorder: true, allowInlineCodeReorder: true },
	dita: { allowTagReorder: true, allowInlineCodeReorder: true },
	docbook: { allowTagReorder: true, allowInlineCodeReorder: true },
	idml: { allowTagReorder: true, allowInlineCodeReorder: true },
	latex: { allowTagReorder: false, allowInlineCodeReorder: false },
	ttml: { allowTagReorder: true, allowInlineCodeReorder: true },
	mif: { allowTagReorder: false, allowInlineCodeReorder: false },
	"windows-rc": { allowTagReorder: false, allowInlineCodeReorder: false },
	qml: { allowTagReorder: false, allowInlineCodeReorder: false },
	pdf: { allowTagReorder: false, allowInlineCodeReorder: false },
	"image-ocr": { allowTagReorder: false, allowInlineCodeReorder: false },
	"media-transcription": {
		allowTagReorder: false,
		allowInlineCodeReorder: false,
	},
	rtf: { allowTagReorder: true, allowInlineCodeReorder: true },
	"legacy-office": { allowTagReorder: false, allowInlineCodeReorder: false },
	"cat-package": { allowTagReorder: false, allowInlineCodeReorder: false },
	"zip-project": { allowTagReorder: false, allowInlineCodeReorder: false },
	xml: { allowTagReorder: false, allowInlineCodeReorder: false },
	docx: { allowTagReorder: true, allowInlineCodeReorder: true },
	xlsx: { allowTagReorder: false, allowInlineCodeReorder: false },
	pptx: { allowTagReorder: true, allowInlineCodeReorder: true },
	html: { allowTagReorder: true, allowInlineCodeReorder: true },
};

export class ExportQaError extends Error {
	readonly name = "ExportQaError";

	constructor(readonly result: ExportQaResult) {
		super(formatExportQaResult(result));
	}
}

interface ProtectedToken {
	key: string;
	raw: string;
	index: number;
	orderSensitive: boolean;
}

interface TokenScan {
	placeholders: ProtectedToken[];
	tags: ProtectedToken[];
	malformedPlaceholders: string[];
	malformedTags: string[];
}

interface TagFrame {
	name: string;
	raw: string;
}

const HTML_VOID_TAGS = new Set([
	"area",
	"base",
	"br",
	"col",
	"embed",
	"hr",
	"img",
	"input",
	"link",
	"meta",
	"param",
	"source",
	"track",
	"wbr",
]);

const PRINTF_PATTERN =
	/%(?:(\d+)\$)?[-+#0 ']*(?:\d+|\*)?(?:\.(?:\d+|\*))?[hlLzjt]*([@diuoxXfFeEgGaAcspn])/g;
const APPLE_SUBSTITUTION_PATTERN = /%#@([A-Za-z_][\w.-]*)@/g;
const QT_PLACEHOLDER_PATTERN = /%(?:L(\d+)|(\d+)(?![\d$])|n)/g;

export function runProjectExportQuality(
	project: UserData,
	policy: FormatQaPolicy = FORMAT_QA_POLICIES[project.translationData.type],
): ExportQaResult {
	const data = project.translationData;
	const issues: ExportQaIssue[] = [];
	const model = data.documentModel;
	const unitCount = Math.max(
		data.seg1.length,
		data.seg2.length,
		model?.units.length ?? 0,
	);
	if (data.seg1.length !== data.seg2.length) {
		issues.push({
			code: "UNIT_ALIGNMENT",
			unitIndex: 0,
			message: `Source and target segment counts differ (${data.seg1.length} vs ${data.seg2.length}).`,
		});
	}
	if (model && model.units.length !== data.seg1.length) {
		issues.push({
			code: "UNIT_ALIGNMENT",
			unitIndex: 0,
			message: `The neutral document has ${model.units.length} units but the editor has ${data.seg1.length} segments.`,
		});
	}

	for (let index = 0; index < unitCount; index++) {
		const unit = model?.units[index];
		const rich =
			unit && (hasInlineCodes(unit.source) || hasInlineCodes(unit.target));
		const source = rich ? contentText(unit.source) : (data.seg1[index] ?? "");
		const target = rich ? contentText(unit.target) : (data.seg2[index] ?? "");
		compareProtectedText(
			source,
			target,
			index,
			unit?.id,
			policy,
			issues,
			data.type === "android" && unit?.metadata?.formatted === false,
			data.type === "subtitles",
		);
		if (data.type === "json" && model?.metadata?.profile === "chrome")
			compareChromePlaceholders(source, target, index, unit?.id, issues);
		if (rich && unit)
			compareInlineCodes(
				unit.source,
				unit.target,
				index,
				unit.id,
				policy,
				issues,
			);
	}
	return { valid: issues.length === 0, issues, checkedUnits: unitCount };
}

function compareChromePlaceholders(
	source: string,
	target: string,
	unitIndex: number,
	unitId: string | undefined,
	issues: ExportQaIssue[],
): void {
	compareTokenCounts(
		scanChromePlaceholders(source),
		scanChromePlaceholders(target),
		unitIndex,
		unitId,
		"PLACEHOLDER",
		issues,
	);
}

function scanChromePlaceholders(text: string): ProtectedToken[] {
	const tokens: ProtectedToken[] = [];
	for (let index = 0; index < text.length; index++) {
		if (text[index] !== "$") continue;
		if (text[index + 1] === "$") {
			index++;
			continue;
		}
		const named = text.slice(index).match(/^\$([A-Za-z_][A-Za-z0-9_@]*)\$/);
		if (named) {
			tokens.push({
				key: `chrome:${named[1].toLowerCase()}`,
				raw: named[0],
				index,
				orderSensitive: false,
			});
			index += named[0].length - 1;
			continue;
		}
		const positional = text.slice(index).match(/^\$(\d+)/);
		if (positional) {
			tokens.push({
				key: `chrome-position:${positional[1]}`,
				raw: positional[0],
				index,
				orderSensitive: false,
			});
			index += positional[0].length - 1;
		}
	}
	return tokens;
}

export function assertProjectExportQuality(project: UserData): void {
	const result = runProjectExportQuality(project);
	if (!result.valid) throw new ExportQaError(result);
}

export function formatExportQaResult(result: ExportQaResult): string {
	if (result.valid)
		return `Export QA passed for ${result.checkedUnits} segment${result.checkedUnits === 1 ? "" : "s"}.`;
	const preview = result.issues
		.slice(0, 3)
		.map((issue) => `Segment ${issue.unitIndex + 1}: ${issue.message}`)
		.join(" ");
	const remaining = result.issues.length - 3;
	return `Export blocked by ${result.issues.length} inline-code or placeholder issue${result.issues.length === 1 ? "" : "s"}. ${preview}${remaining > 0 ? ` ${remaining} more issue${remaining === 1 ? "" : "s"}.` : ""}`;
}

function compareProtectedText(
	source: string,
	target: string,
	unitIndex: number,
	unitId: string | undefined,
	policy: FormatQaPolicy,
	issues: ExportQaIssue[],
	ignorePrintf = false,
	webVttTags = false,
): void {
	const sourceScan = scanProtectedTokens(source, ignorePrintf, webVttTags);
	const targetScan = scanProtectedTokens(target, ignorePrintf, webVttTags);
	for (const malformed of sourceScan.malformedPlaceholders)
		pushIssue(
			issues,
			"MALFORMED_PLACEHOLDER",
			unitIndex,
			unitId,
			`The source contains a malformed placeholder near “${malformed}”.`,
			malformed,
		);
	for (const malformed of targetScan.malformedPlaceholders)
		pushIssue(
			issues,
			"MALFORMED_PLACEHOLDER",
			unitIndex,
			unitId,
			`The target contains a malformed placeholder near “${malformed}”.`,
			malformed,
		);
	for (const malformed of sourceScan.malformedTags)
		pushIssue(
			issues,
			"MALFORMED_TAG",
			unitIndex,
			unitId,
			`The source contains malformed or improperly nested markup near “${malformed}”.`,
			malformed,
		);
	for (const malformed of targetScan.malformedTags)
		pushIssue(
			issues,
			"MALFORMED_TAG",
			unitIndex,
			unitId,
			`The target contains malformed or improperly nested markup near “${malformed}”.`,
			malformed,
		);

	compareTokenCounts(
		sourceScan.placeholders,
		targetScan.placeholders,
		unitIndex,
		unitId,
		"PLACEHOLDER",
		issues,
	);
	compareTokenCounts(
		sourceScan.tags,
		targetScan.tags,
		unitIndex,
		unitId,
		"TAG",
		issues,
	);
	if (sameTokenCounts(sourceScan.placeholders, targetScan.placeholders)) {
		const sourceOrder = sourceScan.placeholders
			.filter((token) => token.orderSensitive)
			.map((token) => token.key);
		const targetOrder = targetScan.placeholders
			.filter((token) => token.orderSensitive)
			.map((token) => token.key);
		if (!sameSequence(sourceOrder, targetOrder))
			pushIssue(
				issues,
				"REORDERED_PLACEHOLDER",
				unitIndex,
				unitId,
				"Sequential placeholders were reordered; use positional placeholders when reordering is required.",
			);
	}
	if (
		!policy.allowTagReorder &&
		sameTokenCounts(sourceScan.tags, targetScan.tags) &&
		!sameSequence(
			sourceScan.tags.map((token) => token.key),
			targetScan.tags.map((token) => token.key),
		)
	)
		pushIssue(
			issues,
			"REORDERED_TAG",
			unitIndex,
			unitId,
			"Markup tags were reordered for a format that requires source order.",
		);
}

function compareTokenCounts(
	source: ProtectedToken[],
	target: ProtectedToken[],
	unitIndex: number,
	unitId: string | undefined,
	kind: "PLACEHOLDER" | "TAG",
	issues: ExportQaIssue[],
): void {
	const sourceCounts = tokenCounts(source);
	const targetCounts = tokenCounts(target);
	const rawByKey = new Map(source.map((token) => [token.key, token.raw]));
	for (const [key, sourceCount] of sourceCounts) {
		const targetCount = targetCounts.get(key) ?? 0;
		if (targetCount < sourceCount)
			pushIssue(
				issues,
				`MISSING_${kind}`,
				unitIndex,
				unitId,
				`${sourceCount - targetCount} required ${kind.toLowerCase()} occurrence${sourceCount - targetCount === 1 ? " is" : "s are"} missing: ${rawByKey.get(key)}.`,
				rawByKey.get(key),
			);
		if (targetCount > sourceCount)
			pushIssue(
				issues,
				`DUPLICATED_${kind}`,
				unitIndex,
				unitId,
				`${kind === "TAG" ? "Tag" : "Placeholder"} ${rawByKey.get(key)} was duplicated ${targetCount - sourceCount} extra time${targetCount - sourceCount === 1 ? "" : "s"}.`,
				rawByKey.get(key),
			);
	}
	for (const [key] of targetCounts) {
		if (sourceCounts.has(key)) continue;
		const raw = target.find((token) => token.key === key)?.raw;
		pushIssue(
			issues,
			`UNEXPECTED_${kind}`,
			unitIndex,
			unitId,
			`The target introduced an unexpected ${kind.toLowerCase()}: ${raw}.`,
			raw,
		);
	}
}

function compareInlineCodes(
	source: SegmentContent,
	target: SegmentContent,
	unitIndex: number,
	unitId: string,
	policy: FormatQaPolicy,
	issues: ExportQaIssue[],
): void {
	const sourceCodes = source.fragments.filter(isCode);
	const targetCodes = target.fragments.filter(isCode);
	validateInlineNesting(sourceCodes, "source", unitIndex, unitId, issues);
	validateInlineNesting(targetCodes, "target", unitIndex, unitId, issues);
	const sourceCounts = codeCounts(sourceCodes);
	const targetCounts = codeCounts(targetCodes);
	const comparedIds = new Set<string>();
	for (const sourceCode of sourceCodes) {
		const sourceCount = sourceCounts.get(sourceCode.id) ?? 0;
		const targetCount = targetCounts.get(sourceCode.id) ?? 0;
		if (targetCount < sourceCount && sourceCode.canDelete !== true)
			pushIssue(
				issues,
				"MISSING_INLINE_CODE",
				unitIndex,
				unitId,
				`Protected inline code “${sourceCode.id}” is missing from the target.`,
				sourceCode.id,
			);
		if (targetCount > sourceCount && sourceCode.canCopy !== true)
			pushIssue(
				issues,
				"DUPLICATED_INLINE_CODE",
				unitIndex,
				unitId,
				`Protected inline code “${sourceCode.id}” is duplicated in the target.`,
				sourceCode.id,
			);
		if (!comparedIds.has(sourceCode.id)) {
			comparedIds.add(sourceCode.id);
			for (const targetCode of targetCodes.filter(
				(code) => code.id === sourceCode.id,
			)) {
				if (
					targetCode.codeType !== sourceCode.codeType ||
					targetCode.pairId !== sourceCode.pairId
				)
					pushIssue(
						issues,
						"MALFORMED_INLINE_CODE",
						unitIndex,
						unitId,
						`Inline code “${sourceCode.id}” changed its boundary type or pair ID in the target.`,
						sourceCode.id,
					);
			}
		}
	}
	for (const targetCode of targetCodes) {
		if (sourceCounts.has(targetCode.id)) continue;
		pushIssue(
			issues,
			"UNEXPECTED_INLINE_CODE",
			unitIndex,
			unitId,
			`The target introduced unknown inline code “${targetCode.id}”.`,
			targetCode.id,
		);
	}
	if (
		allCodeCountsAllowed(sourceCodes, targetCodes) &&
		!sameSequence(
			sourceCodes
				.filter(
					(code) =>
						(targetCounts.get(code.id) ?? 0) > 0 &&
						(code.canReorder === false ||
							(code.canReorder === undefined &&
								!policy.allowInlineCodeReorder)),
				)
				.map((code) => code.id),
			targetCodes
				.filter((code) => {
					const sourceCode = sourceCodes.find((item) => item.id === code.id);
					return (
						sourceCode?.canReorder === false ||
						(sourceCode?.canReorder === undefined &&
							!policy.allowInlineCodeReorder)
					);
				})
				.map((code) => code.id),
		)
	)
		pushIssue(
			issues,
			"REORDERED_INLINE_CODE",
			unitIndex,
			unitId,
			"Protected inline codes were reordered against the format or code policy.",
		);
}

function validateInlineNesting(
	codes: InlineCodeFragment[],
	side: "source" | "target",
	unitIndex: number,
	unitId: string,
	issues: ExportQaIssue[],
): void {
	const seen = new Set<string>();
	const stack: string[] = [];
	for (const code of codes) {
		if (!(["standalone", "start", "end"] as const).includes(code.codeType)) {
			pushIssue(
				issues,
				"MALFORMED_INLINE_CODE",
				unitIndex,
				unitId,
				`Inline code “${code.id}” has an unknown boundary type in the ${side}.`,
				code.id,
			);
			continue;
		}
		if (!code.id || seen.has(code.id))
			pushIssue(
				issues,
				"MALFORMED_INLINE_CODE",
				unitIndex,
				unitId,
				`The ${side} has a missing or duplicate inline-code ID “${code.id}”.`,
				code.id,
			);
		seen.add(code.id);
		if (code.codeType === "standalone") {
			if (code.pairId)
				pushIssue(
					issues,
					"MALFORMED_INLINE_CODE",
					unitIndex,
					unitId,
					`Standalone inline code “${code.id}” cannot have a pair ID.`,
					code.id,
				);
			continue;
		}
		if (!code.pairId) {
			pushIssue(
				issues,
				"MALFORMED_INLINE_CODE",
				unitIndex,
				unitId,
				`Paired inline code “${code.id}” has no pair ID.`,
				code.id,
			);
			continue;
		}
		if (code.codeType === "start") stack.push(code.pairId);
		else if (stack.pop() !== code.pairId)
			pushIssue(
				issues,
				"MALFORMED_INLINE_CODE",
				unitIndex,
				unitId,
				`The ${side} inline-code pairs are unbalanced or improperly nested.`,
				code.pairId,
			);
	}
	if (stack.length > 0)
		pushIssue(
			issues,
			"MALFORMED_INLINE_CODE",
			unitIndex,
			unitId,
			`The ${side} inline-code pairs are unbalanced or improperly nested.`,
			stack.at(-1),
		);
}

function scanProtectedTokens(
	text: string,
	ignorePrintf = false,
	webVttTags = false,
): TokenScan {
	const placeholders: ProtectedToken[] = [];
	const malformedPlaceholders: string[] = [];
	if (!ignorePrintf) scanPrintf(text, placeholders, malformedPlaceholders);
	scanBracedPlaceholders(text, placeholders, malformedPlaceholders);
	const { tags, malformed } = scanTags(text, webVttTags);
	return {
		placeholders: placeholders.sort(
			(first, second) => first.index - second.index,
		),
		tags,
		malformedPlaceholders,
		malformedTags: malformed,
	};
}

function scanPrintf(
	text: string,
	placeholders: ProtectedToken[],
	malformed: string[],
): void {
	const covered = new Set<number>();
	APPLE_SUBSTITUTION_PATTERN.lastIndex = 0;
	for (const match of text.matchAll(APPLE_SUBSTITUTION_PATTERN)) {
		for (let offset = 0; offset < match[0].length; offset++)
			covered.add(match.index + offset);
		placeholders.push({
			key: `apple-substitution:${match[1]}`,
			raw: match[0],
			index: match.index,
			orderSensitive: false,
		});
	}
	QT_PLACEHOLDER_PATTERN.lastIndex = 0;
	for (const match of text.matchAll(QT_PLACEHOLDER_PATTERN)) {
		if ([...match[0]].some((_, offset) => covered.has(match.index + offset)))
			continue;
		for (let offset = 0; offset < match[0].length; offset++)
			covered.add(match.index + offset);
		placeholders.push({
			key: `qt:${match[0]}`,
			raw: match[0],
			index: match.index,
			orderSensitive: false,
		});
	}
	PRINTF_PATTERN.lastIndex = 0;
	for (const match of text.matchAll(PRINTF_PATTERN)) {
		const index = match.index;
		for (let offset = 0; offset < match[0].length; offset++)
			covered.add(index + offset);
		const position = match[1];
		placeholders.push({
			key: `printf:${position ? `${position}$` : "sequential"}:${match[2].toLowerCase()}`,
			raw: match[0],
			index,
			orderSensitive: !position,
		});
	}
	for (let index = 0; index < text.length; index++) {
		if (text[index] !== "%" || covered.has(index)) continue;
		if (text[index + 1] === "%") {
			index++;
			continue;
		}
		if (/[$A-Za-z0-9]/.test(text[index + 1] ?? ""))
			malformed.push(text.slice(index, index + 12));
	}
}

function scanBracedPlaceholders(
	text: string,
	placeholders: ProtectedToken[],
	malformed: string[],
): void {
	for (let index = 0; index < text.length; index++) {
		if (text.startsWith("{{", index)) {
			const triple = text.startsWith("{{{", index);
			const close = triple ? "}}}" : "}}";
			const end = text.indexOf(close, index + (triple ? 3 : 2));
			const candidateText = text.slice(
				index + (triple ? 3 : 2),
				end < 0 ? undefined : end,
			);
			const candidate =
				end < 0
					? (candidateText.match(/^\s*([A-Za-z_][\w.-]*)/)?.[1] ?? "")
					: candidateText.trim();
			if (/^[A-Za-z_][\w.-]*$/.test(candidate)) {
				if (end < 0) malformed.push(text.slice(index, index + 24));
				else {
					placeholders.push({
						key: `mustache:${candidate}`,
						raw: text.slice(index, end + close.length),
						index,
						orderSensitive: false,
					});
					index = end + close.length - 1;
				}
			}
			continue;
		}
		if (text.startsWith("${", index)) {
			const end = text.indexOf("}", index + 2);
			const candidate = text.slice(index + 2, end < 0 ? undefined : end).trim();
			if (/^[A-Za-z_][\w.-]*$/.test(candidate)) {
				if (end < 0) malformed.push(text.slice(index, index + 24));
				else {
					placeholders.push({
						key: `dollar:${candidate}`,
						raw: text.slice(index, end + 1),
						index,
						orderSensitive: false,
					});
					index = end;
				}
			}
			continue;
		}
		if (text[index] !== "{") continue;
		const head = text
			.slice(index + 1)
			.match(/^\s*([A-Za-z_][\w.-]*|\d+)\s*([,:}]|$)/);
		if (!head) continue;
		const end = findBalancedBrace(text, index);
		if (end < 0) {
			malformed.push(text.slice(index, index + 24));
			continue;
		}
		const name = head[1];
		placeholders.push({
			key: `${/^\d+$/.test(name) ? "indexed" : "named"}:${name}`,
			raw: text.slice(index, end + 1),
			index,
			orderSensitive: false,
		});
		index = end;
	}
}

function scanTags(
	text: string,
	webVttTags = false,
): {
	tags: ProtectedToken[];
	malformed: string[];
} {
	const tags: ProtectedToken[] = [];
	const malformed: string[] = [];
	const stack: TagFrame[] = [];
	for (let index = 0; index < text.length; index++) {
		if (text[index] !== "<") continue;
		if (text.startsWith("<!--", index)) {
			const end = text.indexOf("-->", index + 4);
			if (end < 0) malformed.push(text.slice(index, index + 24));
			else index = end + 2;
			continue;
		}
		const end = findTagEnd(text, index + 1);
		if (end < 0) {
			if (/^<\/?[A-Za-z_]/.test(text.slice(index)))
				malformed.push(text.slice(index, index + 24));
			continue;
		}
		const raw = text.slice(index, end + 1);
		if (webVttTags) {
			if (/^<(?:\d{2}:)?\d{2}:\d{2}\.\d{3}>$/.test(raw)) {
				tags.push({
					key: `tag:standalone:timestamp:${raw}`,
					raw,
					index,
					orderSensitive: true,
				});
				index = end;
				continue;
			}
			const annotation = raw.match(/^<(v|lang)(?:\s+([^>]+))?>$/);
			if (annotation) {
				tags.push({
					key: `tag:standalone:${annotation[1]}:${annotation[2] ?? ""}`,
					raw,
					index,
					orderSensitive: true,
				});
				index = end;
				continue;
			}
		}
		const match = raw.match(/^<\s*(\/)?\s*([A-Za-z_][\w.:-]*)([^>]*)>$/);
		if (!match) continue;
		const closing = Boolean(match[1]);
		const originalName = match[2].toLowerCase();
		const name =
			webVttTags && originalName.startsWith("c.") ? "c" : originalName;
		const tail = match[3];
		const standalone =
			!closing && (/\/\s*>$/.test(raw) || HTML_VOID_TAGS.has(name));
		const boundary = closing ? "end" : standalone ? "standalone" : "start";
		const xliffId =
			name === "xliff:g"
				? tail
						.match(/\bid\s*=\s*(?:"([^"]+)"|'([^']+)')/i)
						?.slice(1)
						.find(Boolean)
				: undefined;
		tags.push({
			key: `tag:${boundary}:${name}${webVttTags && originalName !== name ? `:${originalName.slice(2)}` : ""}${xliffId ? `:${xliffId}` : ""}`,
			raw,
			index,
			orderSensitive: true,
		});
		if (closing) {
			const open = stack.pop();
			if (!open || open.name !== name) malformed.push(raw);
		} else if (!standalone) stack.push({ name, raw });
		if (/\s(?:[\w:-]+)\s*=\s*(?:"[^"]*$|'[^']*$)/.test(tail))
			malformed.push(raw);
		index = end;
	}
	for (const open of stack) malformed.push(open.raw);
	return { tags, malformed: [...new Set(malformed)] };
}

function findBalancedBrace(text: string, start: number): number {
	let depth = 0;
	let quote = "";
	for (let index = start; index < text.length; index++) {
		const character = text[index];
		if (quote) {
			if (character === quote && text[index - 1] !== "\\") quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "{") depth++;
		else if (character === "}" && --depth === 0) return index;
	}
	return -1;
}

function findTagEnd(text: string, start: number): number {
	let quote = "";
	for (let index = start; index < text.length; index++) {
		const character = text[index];
		if (quote) {
			if (character === quote) quote = "";
		} else if (character === '"' || character === "'") quote = character;
		else if (character === ">") return index;
	}
	return -1;
}

function sameTokenCounts(
	source: ProtectedToken[],
	target: ProtectedToken[],
): boolean {
	const first = tokenCounts(source);
	const second = tokenCounts(target);
	return (
		first.size === second.size &&
		[...first].every(([key, count]) => second.get(key) === count)
	);
}

function tokenCounts(tokens: ProtectedToken[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const token of tokens)
		counts.set(token.key, (counts.get(token.key) ?? 0) + 1);
	return counts;
}

function codeCounts(codes: InlineCodeFragment[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const code of codes) counts.set(code.id, (counts.get(code.id) ?? 0) + 1);
	return counts;
}

function allCodeCountsAllowed(
	source: InlineCodeFragment[],
	target: InlineCodeFragment[],
): boolean {
	const targetCounts = codeCounts(target);
	const sourceIds = new Set(source.map((code) => code.id));
	return (
		target.every((code) => sourceIds.has(code.id)) &&
		source.every((code) => {
			const count = targetCounts.get(code.id) ?? 0;
			return (
				(count >= 1 || code.canDelete === true) &&
				(count <= 1 || code.canCopy === true)
			);
		})
	);
}

function contentText(content: SegmentContent): string {
	return content.fragments
		.map((fragment) => (fragment.kind === "text" ? fragment.text : ""))
		.join("");
}

function isCode(
	fragment: SegmentContent["fragments"][number],
): fragment is InlineCodeFragment {
	return fragment.kind === "code";
}

function sameSequence(
	first: readonly string[],
	second: readonly string[],
): boolean {
	return (
		first.length === second.length &&
		first.every((value, index) => value === second[index])
	);
}

function pushIssue(
	issues: ExportQaIssue[],
	code: ExportQaIssueCode,
	unitIndex: number,
	unitId: string | undefined,
	message: string,
	token?: string,
): void {
	issues.push({
		code,
		unitIndex,
		...(unitId ? { unitId } : {}),
		message,
		...(token ? { token } : {}),
	});
}
