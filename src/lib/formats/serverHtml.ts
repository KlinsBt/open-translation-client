export const SERVER_HTML_EXTENSIONS = [
	"html",
	"htm",
	"xhtml",
	"shtml",
	"jsp",
	"asp",
	"aspx",
	"ascx",
	"inc",
	"hhc",
	"hhk",
	"php",
] as const;

export type ServerHtmlExtension = (typeof SERVER_HTML_EXTENSIONS)[number];
export type ServerHtmlProfile =
	| Exclude<ServerHtmlExtension, "php">
	| "php-template";

export interface ServerHtmlTypeRef {
	profile: ServerHtmlProfile;
	sourceExtension: ServerHtmlExtension;
	mimeType: string;
}

export interface OpaqueTemplateRange {
	start: number;
	end: number;
	kind: "server-block" | "expression" | "template-block";
}

export interface TemplateRangeInspection {
	ranges: OpaqueTemplateRange[];
	error?: string;
}

const SERVER_PROFILE_EXTENSIONS = new Set<ServerHtmlExtension>([
	"shtml",
	"jsp",
	"asp",
	"aspx",
	"ascx",
	"inc",
	"hhc",
	"hhk",
	"php",
]);

export function htmlSourceExtension(name: string): ServerHtmlExtension {
	const extension = name.toLowerCase().split(".").at(-1) ?? "html";
	return SERVER_HTML_EXTENSIONS.includes(extension as ServerHtmlExtension)
		? (extension as ServerHtmlExtension)
		: "html";
}

export function htmlMimeType(profile: ServerHtmlProfile): string {
	if (profile === "xhtml") return "application/xhtml+xml";
	if (profile === "php-template") return "application/x-httpd-php";
	if (profile === "jsp") return "text/x-jsp";
	if (profile === "asp" || profile === "aspx" || profile === "ascx")
		return "text/asp";
	if (profile === "hhc" || profile === "hhk") return "text/html";
	return "text/html";
}

function hasMarkup(content: string): boolean {
	return /<!doctype\s+html\b|<\/?(?:html|head|body|main|section|article|nav|header|footer|div|span|p|h[1-6]|a|img|form|input|label|table|ul|ol|li|object|param)\b/i.test(
		content,
	);
}

function hasHelpSitemapSignature(content: string): boolean {
	return (
		/<object\b[^>]*\btype\s*=\s*(?:["']text\/sitemap["']|text\/sitemap)(?:\s|>)/i.test(
			content,
		) &&
		/<param\b[^>]*\bname\s*=\s*(?:["'](?:name|keyword|local)["']|(?:name|keyword|local))(?:\s|\/?>)/i.test(
			content,
		)
	);
}

export function detectServerHtmlProfile(
	name: string,
	mimeType: string,
	content: string,
): ServerHtmlTypeRef | undefined {
	const extension = htmlSourceExtension(name);
	const php = /<\?(?:php\b|=)/i.test(content);
	const jsp = /<%(?:@|!|=|--)?|<jsp:|\$\{|#\{/i.test(content);
	const asp = /<%(?:@|=|#)?|\brunat\s*=\s*["']?server\b|<asp:/i.test(content);
	const ssi =
		/<!--\s*#(?:include|echo|config|exec|flastmod|fsize|if|elif|else|endif)\b/i.test(
			content,
		);
	const markup = hasMarkup(content);

	if (extension === "xhtml" || /application\/xhtml\+xml/i.test(mimeType)) {
		if (!/<html(?:\s|>)/i.test(content)) return undefined;
		return { profile: "xhtml", sourceExtension: "xhtml", mimeType };
	}
	if (extension === "hhc" || extension === "hhk") {
		if (!hasHelpSitemapSignature(content)) return undefined;
		return { profile: extension, sourceExtension: extension, mimeType };
	}
	if (extension === "php") {
		if (!php || !markup) return undefined;
		return { profile: "php-template", sourceExtension: "php", mimeType };
	}
	if (extension === "jsp") {
		if (!markup && !jsp) return undefined;
		return { profile: "jsp", sourceExtension: "jsp", mimeType };
	}
	if (extension === "asp" || extension === "aspx" || extension === "ascx") {
		if (!markup && !asp) return undefined;
		return { profile: extension, sourceExtension: extension, mimeType };
	}
	if (extension === "shtml") {
		if (!markup && !ssi) return undefined;
		return { profile: "shtml", sourceExtension: "shtml", mimeType };
	}
	if (extension === "inc") {
		if (!markup && !php && !jsp && !asp && !ssi) return undefined;
		return { profile: "inc", sourceExtension: "inc", mimeType };
	}
	if (extension === "html" || extension === "htm") {
		if (!markup) return undefined;
		return { profile: extension, sourceExtension: extension, mimeType };
	}
	if (SERVER_PROFILE_EXTENSIONS.has(extension)) return undefined;
	return undefined;
}

function findPhpEnd(source: string, start: number): number {
	let quote = "";
	let lineComment = false;
	let blockComment = false;
	for (let index = start + 2; index < source.length - 1; index++) {
		const character = source[index];
		const next = source[index + 1];
		if (lineComment) {
			if (character === "\n" || character === "\r") lineComment = false;
			continue;
		}
		if (blockComment) {
			if (character === "*" && next === "/") {
				blockComment = false;
				index++;
			}
			continue;
		}
		if (quote) {
			if (character === "\\") index++;
			else if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'") quote = character;
		else if (character === "/" && next === "/") {
			lineComment = true;
			index++;
		} else if (character === "#") lineComment = true;
		else if (character === "/" && next === "*") {
			blockComment = true;
			index++;
		} else if (character === "?" && next === ">") return index + 2;
	}
	return source.length;
}

function findBalancedExpressionEnd(
	source: string,
	start: number,
	open: string,
	close: string,
): number {
	let depth = 1;
	let quote = "";
	for (let index = start + open.length; index < source.length; index++) {
		const character = source[index];
		if (quote) {
			if (character === "\\") index++;
			else if (character === quote) quote = "";
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			continue;
		}
		if ((open === "${" || open === "#{") && character === "{") {
			depth++;
			continue;
		}
		if ((open === "${" || open === "#{") && character === "}") {
			depth--;
			if (depth === 0) return index + 1;
			continue;
		}
		if (source.startsWith(open, index)) {
			depth++;
			index += open.length - 1;
			continue;
		}
		if (source.startsWith(close, index)) {
			depth--;
			if (depth === 0) return index + close.length;
			index += close.length - 1;
		}
	}
	return -1;
}

function rangeAt(ranges: OpaqueTemplateRange[], offset: number) {
	return ranges.find((range) => range.start <= offset && range.end > offset);
}

export function inspectOpaqueTemplateRanges(
	source: string,
	profile?: ServerHtmlProfile,
): TemplateRangeInspection {
	if (
		!profile ||
		profile === "html" ||
		profile === "htm" ||
		profile === "xhtml"
	)
		return { ranges: [] };
	const ranges: OpaqueTemplateRange[] = [];
	let cursor = 0;
	while (cursor < source.length) {
		const existing = rangeAt(ranges, cursor);
		if (existing) {
			cursor = existing.end;
			continue;
		}
		if (
			source.slice(cursor, cursor + 5).toLowerCase() === "<?php" ||
			source.startsWith("<?=", cursor)
		) {
			const end = findPhpEnd(source, cursor);
			ranges.push({ start: cursor, end, kind: "server-block" });
			cursor = end;
			continue;
		}
		if (source.startsWith("<%", cursor)) {
			const close = source.indexOf("%>", cursor + 2);
			if (close < 0)
				return {
					ranges,
					error:
						"The server-side block beginning with <% is not closed with %>.",
				};
			const end = close + 2;
			ranges.push({ start: cursor, end, kind: "server-block" });
			cursor = end;
			continue;
		}
		const expression = source.startsWith("${", cursor)
			? ["${", "}"]
			: source.startsWith("#{", cursor)
				? ["#{", "}"]
				: source.startsWith("{{", cursor)
					? ["{{", "}}"]
					: source.startsWith("{%", cursor)
						? ["{%", "%}"]
						: source.startsWith("{#", cursor)
							? ["{#", "#}"]
							: undefined;
		if (expression) {
			const [open, close] = expression;
			const end = findBalancedExpressionEnd(source, cursor, open, close);
			if (end < 0)
				return {
					ranges,
					error: `The template expression beginning with ${open} is not closed with ${close}.`,
				};
			ranges.push({
				start: cursor,
				end,
				kind:
					open === "{{" || open === "{%" || open === "{#"
						? "template-block"
						: "expression",
			});
			cursor = end;
			continue;
		}
		cursor++;
	}
	return { ranges };
}

export function isHtmlHelpTranslatableAttribute(
	profile: ServerHtmlProfile | undefined,
	tag: string,
	attributes: ReadonlyMap<string, { value: string }>,
	attributeName: string,
): boolean {
	if (profile !== "hhc" && profile !== "hhk") return true;
	if (tag !== "param" || attributeName !== "value") return false;
	const name = attributes.get("name")?.value.trim().toLowerCase();
	return name === "name" || name === "keyword" || name === "see also";
}

export function isServerCodeElement(
	profile: ServerHtmlProfile | undefined,
	tag: string,
): boolean {
	return (
		profile === "jsp" &&
		[
			"jsp:declaration",
			"jsp:scriptlet",
			"jsp:expression",
			"jsp:directive.page",
			"jsp:directive.include",
			"jsp:directive.taglib",
		].includes(tag)
	);
}
