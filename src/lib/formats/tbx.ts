import type {
	TbData,
	TbEntry,
	TbTerm,
	TbxDataCategory,
	TbxDialect,
	TbxDocumentMetadata,
	TbxEntryMetadata,
	TbxStyle,
} from "$lib/types/types";

export const TBX_V3_NAMESPACE = "urn:iso:std:iso:30042:ed-2";
const TERM_MARKER_PREFIX = "__OPENTLC_TBX_TERM_";
const STREAM_PLACEHOLDER =
	/<opentlc-stream-record\b[^>]*\bindex=["'](\d+)["'][^>]*\/>/gi;

const DIALECTS = new Set<TbxDialect>(["TBX-Core", "TBX-Min", "TBX-Basic"]);
const CLASSIFICATION_ELEMENTS = new Set([
	"admin",
	"descrip",
	"ref",
	"xref",
	"termNote",
	"transac",
	"transacNote",
]);
const MIN_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
	admin: ["customerSubset"],
	descrip: ["subjectField"],
	termNote: ["administrativeStatus", "partOfSpeech"],
	xref: ["externalCrossReference"],
};
const BASIC_CATEGORIES: Readonly<Record<string, readonly string[]>> = {
	admin: ["customerSubset", "projectSubset", "source"],
	descrip: ["subjectField", "context", "definition"],
	ref: ["crossReference"],
	termNote: [
		"administrativeStatus",
		"partOfSpeech",
		"geographicalUsage",
		"grammaticalGender",
		"termLocation",
		"termType",
	],
	transac: ["transactionType"],
	transacNote: ["responsibility"],
	xref: ["externalCrossReference", "xGraphic"],
};
const PICKLISTS: Readonly<Record<string, readonly string[]>> = {
	administrativeStatus: [
		"admittedTerm-admn-sts",
		"deprecatedTerm-admn-sts",
		"supersededTerm-admn-sts",
		"preferredTerm-admn-sts",
	],
	partOfSpeech: ["adjective", "noun", "other", "verb", "adverb"],
	grammaticalGender: ["masculine", "feminine", "neuter", "other"],
	termType: [
		"fullForm",
		"acronym",
		"abbreviation",
		"shortForm",
		"variant",
		"phrase",
	],
	transactionType: ["origination", "modification"],
};

export interface TbxValidationIssue {
	code:
		| "ROOT"
		| "DIALECT"
		| "STYLE"
		| "NAMESPACE"
		| "STRUCTURE"
		| "ID"
		| "LANGUAGE"
		| "CATEGORY"
		| "PICKLIST"
		| "REFERENCE";
	message: string;
	path: string;
}

export interface BuildTbxOptions {
	dialect?: TbxDialect;
	style?: TbxStyle;
	version?: 2 | 3;
}

export function tbxSchemaAssets(
	dialect: TbxDialect,
	_style: TbxStyle,
	version: 2 | 3,
): string[] {
	if (version === 2) return ["/schemas/tbx/tbx-basic-v2.constraints.json"];
	return [
		"/schemas/tbx/tbx-core-v3.rng",
		`/schemas/tbx/${dialect.toLowerCase()}-v3.constraints.json`,
	];
}

export function readTbxDocumentMetadata(root: Element): TbxDocumentMetadata {
	const rootName = root.localName.toLowerCase();
	const version = rootName === "martif" ? 2 : 3;
	const rawType = root.getAttribute("type") ?? "";
	const dialect: TbxDialect =
		rawType === "TBX" && version === 2 ? "TBX-Basic" : (rawType as TbxDialect);
	const style: TbxStyle =
		version === 2
			? "dca"
			: root.getAttribute("style") === "dct"
				? "dct"
				: "dca";
	return {
		version,
		dialect,
		style,
		rootName: rootName === "martif" ? "martif" : "tbx",
		rootAttributes: attributesOf(root),
		schemaAssets: tbxSchemaAssets(dialect, style, version),
	};
}

export function parseTbxEntry(record: Element, entryIndex: number): TbEntry {
	const recordName =
		record.localName.toLowerCase() === "termentry"
			? "termEntry"
			: "conceptEntry";
	const languageName: "langSet" | "langSec" =
		recordName === "termEntry" ? "langSet" : "langSec";
	const terms: TbTerm[] = [];
	const languageSections = directChildren(record, languageName).map(
		(language, languageSectionIndex) => {
			const lang = xmlLanguage(language);
			const containers =
				recordName === "conceptEntry"
					? directChildren(language, "termSec")
					: directChildren(language).filter((child) =>
							["tig", "ntig"].includes(child.localName.toLowerCase()),
						);
			const termContainers =
				containers.length > 0
					? containers
					: directChildren(language, "term").map((term) => term);
			for (const container of termContainers) {
				const containerName =
					container.localName.toLowerCase() === "term"
						? "bare"
						: (container.localName as "termSec" | "tig" | "ntig");
				const termElement =
					containerName === "bare"
						? container
						: firstDescendant(container, "term");
				if (!termElement) continue;
				const originalTerm = termElement.textContent?.trim() ?? "";
				const termIndex = terms.length;
				const marker = `${TERM_MARKER_PREFIX}${entryIndex}_${termIndex}__`;
				const originalTermXml = serializeXml(termElement);
				while (termElement.firstChild)
					termElement.removeChild(termElement.firstChild);
				termElement.appendChild(
					termElement.ownerDocument.createTextNode(marker),
				);
				const dataCategories =
					containerName === "bare"
						? []
						: [
								...collectLevelCategories(container, ["term", "termGrp"]),
								...directChildren(container, "termGrp").flatMap((group) =>
									collectLevelCategories(group, ["term"]),
								),
							];
				const categoryValue = (name: string) =>
					findCategory(dataCategories, name)?.text;
				const languageCategories = collectLevelCategories(language, [
					"termSec",
					"tig",
					"ntig",
					"term",
				]);
				const conceptCategories = collectLevelCategories(record, [
					languageName,
				]);
				terms.push({
					lang,
					term: originalTerm,
					notes: dataCategories.map((category) => ({
						type:
							category.localName === "note"
								? ""
								: (category.type ?? category.localName),
						text: category.text,
					})),
					...(categoryValue("administrativeStatus")
						? { status: categoryValue("administrativeStatus") }
						: {}),
					...(categoryValue("partOfSpeech")
						? { partOfSpeech: categoryValue("partOfSpeech") }
						: {}),
					...((findCategory(languageCategories, "definition")?.text ??
					findCategory(conceptCategories, "definition")?.text)
						? {
								definition:
									findCategory(languageCategories, "definition")?.text ??
									findCategory(conceptCategories, "definition")?.text,
							}
						: {}),
					tbx: {
						...(container.getAttribute("id")
							? { id: container.getAttribute("id") ?? undefined }
							: {}),
						containerName,
						containerAttributes: attributesOf(container),
						languageSectionIndex,
						dataCategories,
						termMarker: marker,
						originalTerm,
						originalTermXml,
					},
				});
			}
			return {
				index: languageSectionIndex,
				name: languageName,
				language: lang,
				attributes: attributesOf(language),
				dataCategories: collectLevelCategories(language, [
					"termSec",
					"tig",
					"ntig",
					"term",
				]),
			};
		},
	);
	const metadata: TbxEntryMetadata = {
		...(record.getAttribute("id")
			? { id: record.getAttribute("id") ?? undefined }
			: {}),
		recordName,
		attributes: attributesOf(record),
		dataCategories: collectLevelCategories(record, [languageName]),
		languageSections,
		skeletonXml: serializeXml(record),
	};
	return { terms, tbx: metadata };
}

export function validateTbxDocument(root: Element): TbxValidationIssue[] {
	const issues: TbxValidationIssue[] = [];
	const rootName = root.localName.toLowerCase();
	if (rootName !== "tbx" && rootName !== "martif") {
		issues.push({
			code: "ROOT",
			message: "The root must be tbx or martif.",
			path: "/",
		});
		return issues;
	}
	const metadata = readTbxDocumentMetadata(root);
	if (!DIALECTS.has(metadata.dialect))
		issues.push({
			code: "DIALECT",
			message: `Unsupported TBX dialect “${root.getAttribute("type") ?? ""}”.`,
			path: `/${root.localName}/@type`,
		});
	if (
		metadata.version === 3 &&
		!["dca", "dct"].includes(root.getAttribute("style") ?? "")
	)
		issues.push({
			code: "STYLE",
			message: "TBX v3 style must be dca or dct.",
			path: "/tbx/@style",
		});
	if (metadata.version === 3 && root.namespaceURI !== TBX_V3_NAMESPACE)
		issues.push({
			code: "NAMESPACE",
			message: `TBX v3 must use the ${TBX_V3_NAMESPACE} namespace.`,
			path: "/tbx",
		});
	if (!xmlLanguage(root))
		issues.push({
			code: "LANGUAGE",
			message: "The root needs xml:lang.",
			path: `/${root.localName}/@xml:lang`,
		});
	const header = firstDirectChild(
		root,
		metadata.version === 3 ? "tbxHeader" : "martifHeader",
	);
	const body = firstDescendant(root, "body");
	if (!header || !body)
		issues.push({
			code: "STRUCTURE",
			message: "TBX needs a header and text/body.",
			path: `/${root.localName}`,
		});
	const entryName = metadata.version === 3 ? "conceptEntry" : "termEntry";
	const entries = body ? directChildren(body, entryName) : [];
	if (entries.length === 0)
		issues.push({
			code: "STRUCTURE",
			message: `TBX needs at least one ${entryName}.`,
			path: `/${root.localName}/text/body`,
		});
	for (const [entryIndex, entry] of entries.entries()) {
		if (metadata.version === 3 && !entry.getAttribute("id"))
			issues.push({
				code: "ID",
				message: "Every conceptEntry needs an id.",
				path: `//conceptEntry[${entryIndex + 1}]/@id`,
			});
		const languageName = metadata.version === 3 ? "langSec" : "langSet";
		const languages = directChildren(entry, languageName);
		if (languages.length === 0)
			issues.push({
				code: "STRUCTURE",
				message: `Entry ${entryIndex + 1} has no ${languageName}.`,
				path: `//${entryName}[${entryIndex + 1}]`,
			});
		for (const [languageIndex, language] of languages.entries()) {
			if (!xmlLanguage(language))
				issues.push({
					code: "LANGUAGE",
					message: `${languageName} needs xml:lang.`,
					path: `//${entryName}[${entryIndex + 1}]/${languageName}[${languageIndex + 1}]`,
				});
			if (!firstDescendant(language, "term"))
				issues.push({
					code: "STRUCTURE",
					message: `${languageName} needs a term.`,
					path: `//${entryName}[${entryIndex + 1}]/${languageName}[${languageIndex + 1}]`,
				});
		}
	}
	if (metadata.version === 3 && DIALECTS.has(metadata.dialect))
		validateV3Categories(root, metadata, issues);
	validateReferences(root, issues);
	return issues;
}

/** Applies the local dialect constraints to the streamed, hierarchy-preserving model. */
export function validateTbxData(data: TbData): TbxValidationIssue[] {
	const issues: TbxValidationIssue[] = [];
	const metadata = data.tbx;
	if (!metadata) return issues;
	if (metadata.version === 2) {
		for (const [entryIndex, entry] of data.entries.entries()) {
			if (entry.tbx?.recordName !== "termEntry")
				issues.push({
					code: "STRUCTURE",
					message: "Legacy TBX body records must be termEntry elements.",
					path: `//body/*[${entryIndex + 1}]`,
				});
			for (const [termIndex, term] of entry.terms.entries()) {
				if (!term.lang || !term.term)
					issues.push({
						code: "STRUCTURE",
						message: "Every legacy term needs a language and value.",
						path: `//termEntry[${entryIndex + 1}]/term[${termIndex + 1}]`,
					});
			}
		}
		return issues;
	}
	const ids = new Set<string>();
	for (const entry of data.entries) {
		if (entry.tbx?.id) ids.add(entry.tbx.id);
		for (const term of entry.terms) if (term.tbx?.id) ids.add(term.tbx.id);
	}
	for (const [entryIndex, entry] of data.entries.entries()) {
		if (entry.tbx?.recordName !== "conceptEntry")
			issues.push({
				code: "STRUCTURE",
				message: "TBX v3 body records must be conceptEntry elements.",
				path: `//body/*[${entryIndex + 1}]`,
			});
		if (!entry.tbx?.id)
			issues.push({
				code: "ID",
				message: "Every conceptEntry needs an id.",
				path: `//conceptEntry[${entryIndex + 1}]/@id`,
			});
		validateModelCategories(
			entry.tbx?.dataCategories ?? [],
			"concept",
			metadata,
			ids,
			issues,
		);
		for (const language of entry.tbx?.languageSections ?? [])
			validateModelCategories(
				language.dataCategories,
				"language",
				metadata,
				ids,
				issues,
			);
		for (const [termIndex, term] of entry.terms.entries()) {
			if (!term.lang)
				issues.push({
					code: "LANGUAGE",
					message: "A term has no language.",
					path: `//conceptEntry[${entryIndex + 1}]/term[${termIndex + 1}]`,
				});
			if (!term.term)
				issues.push({
					code: "STRUCTURE",
					message: "A term value is empty.",
					path: `//conceptEntry[${entryIndex + 1}]/term[${termIndex + 1}]`,
				});
			validateModelCategories(
				term.tbx?.dataCategories ?? [],
				"term",
				metadata,
				ids,
				issues,
			);
		}
	}
	return issues;
}

export function buildTbxDocument(
	sourceLang: string,
	data: TbData,
	options: BuildTbxOptions = {},
): string {
	const dialect = options.dialect ?? data.tbx?.dialect ?? "TBX-Basic";
	const version = options.version ?? data.tbx?.version ?? 3;
	const style =
		version === 2 ? "dca" : (options.style ?? data.tbx?.style ?? "dca");
	const canUseSkeleton =
		data.tbx?.documentSkeletonXml &&
		data.tbx.version === version &&
		data.tbx.dialect === dialect &&
		data.tbx.style === style &&
		placeholderCount(data.tbx.documentSkeletonXml) === data.entries.length &&
		data.entries.every((entry) => entry.tbx?.skeletonXml);
	if (canUseSkeleton) {
		const rebuiltEntries = data.entries.map((entry, index) =>
			rebuildEntry(entry, index),
		);
		let rebuilt = data.tbx!.documentSkeletonXml!.replace(
			STREAM_PLACEHOLDER,
			(_placeholder, index: string) => rebuiltEntries[Number(index)] ?? "",
		);
		if (data.name)
			rebuilt = rebuilt.replace(
				/(<((?:[\w.-]+:)?title)\b[^>]*>)[\s\S]*?(<\/\2\s*>)/i,
				(_match, start: string, _name: string, end: string) =>
					`${start}${escapeXml(data.name!)}${end}`,
			);
		if (data.id !== undefined)
			rebuilt = rebuilt.replace(/OpenTLC ID:\s*\d*/i, `OpenTLC ID: ${data.id}`);
		return rebuilt;
	}
	return buildNewTbx(sourceLang, data, { dialect, style, version });
}

function buildNewTbx(
	sourceLang: string,
	data: TbData,
	options: Required<BuildTbxOptions>,
): string {
	const language = extractLanguageCode(sourceLang) || "und";
	if (options.version === 2) return buildLegacyTbx(language, data);
	const dctNamespaces =
		options.style === "dct"
			? `${options.dialect !== "TBX-Core" ? ' xmlns:min="http://www.tbxinfo.net/ns/min"' : ""}${options.dialect === "TBX-Basic" ? ' xmlns:basic="http://www.tbxinfo.net/ns/basic"' : ""}`
			: "";
	const entries = data.entries
		.map((entry, index) => buildV3Entry(entry, index, options))
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<tbx style="${options.style}" type="${options.dialect}" xml:lang="${escapeXml(language)}" xmlns="${TBX_V3_NAMESPACE}"${dctNamespaces}>\n  <tbxHeader>\n    <fileDesc>\n      <titleStmt><title>${escapeXml(data.name || "Untitled TBX File")}</title></titleStmt>\n      <sourceDesc><p>OpenTLC ID: ${escapeXml(String(data.id ?? ""))}</p></sourceDesc>\n    </fileDesc>\n  </tbxHeader>\n  <text>\n    <body>\n${entries}\n    </body>\n  </text>\n</tbx>\n`;
}

function buildV3Entry(
	entry: TbEntry,
	entryIndex: number,
	options: Required<BuildTbxOptions>,
): string {
	if (
		entry.tbx?.recordName === "conceptEntry" &&
		entry.tbx.version === options.version &&
		entry.tbx.dialect === options.dialect &&
		entry.tbx.style === options.style &&
		entry.tbx.skeletonXml
	)
		return rebuildEntry(entry, entryIndex);
	const id = entry.tbx?.id || `c${entryIndex + 1}`;
	const groups = groupTermsByLanguage(entry.terms);
	const languageSections = groups.map(({ language, terms }) => {
		const sections = terms
			.map((term) => {
				const categories = serializeNewTermCategories(
					term,
					options.dialect,
					options.style,
				);
				return `        <termSec${term.tbx?.id ? ` id="${escapeXml(term.tbx.id)}"` : ""}>\n          <term>${escapeXml(term.term)}</term>${categories ? `\n${categories}` : ""}\n        </termSec>`;
			})
			.join("\n");
		return `      <langSec xml:lang="${escapeXml(language || "und")}">\n${sections}\n      </langSec>`;
	});
	return `      <conceptEntry id="${escapeXml(id)}">\n${languageSections.join("\n")}\n      </conceptEntry>`;
}

function buildLegacyTbx(language: string, data: TbData): string {
	const entries = data.entries
		.map((entry, entryIndex) => {
			if (
				entry.tbx?.recordName === "termEntry" &&
				entry.tbx.version === 2 &&
				entry.tbx.skeletonXml
			)
				return rebuildEntry(entry, entryIndex);
			const groups = groupTermsByLanguage(entry.terms).map(
				({ language: lang, terms }) => {
					const tigs = terms
						.map((term) => {
							const notes = term.notes
								.map((note) =>
									typeAndText(note).type
										? `            <termNote type="${escapeXml(typeAndText(note).type)}">${escapeXml(typeAndText(note).text)}</termNote>`
										: `            <note>${escapeXml(typeAndText(note).text)}</note>`,
								)
								.join("\n");
							return `          <tig${term.tbx?.id ? ` id="${escapeXml(term.tbx.id)}"` : ""}>\n            <term>${escapeXml(term.term)}</term>${notes ? `\n${notes}` : ""}\n          </tig>`;
						})
						.join("\n");
					return `        <langSet xml:lang="${escapeXml(lang || "und")}">\n${tigs}\n        </langSet>`;
				},
			);
			return `      <termEntry id="${escapeXml(entry.tbx?.id || `c${entryIndex + 1}`)}">\n${groups.join("\n")}\n      </termEntry>`;
		})
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>\n<martif type="TBX-Basic" xml:lang="${escapeXml(language)}">\n  <martifHeader><fileDesc><titleStmt><title>${escapeXml(data.name || "Untitled TBX File")}</title></titleStmt><sourceDesc><p>OpenTLC ID: ${escapeXml(String(data.id ?? ""))}</p></sourceDesc></fileDesc></martifHeader>\n  <text><body>\n${entries}\n  </body></text>\n</martif>\n`;
}

function rebuildEntry(entry: TbEntry, entryIndex: number): string {
	let xml = entry.tbx?.skeletonXml ?? "";
	entry.terms.forEach((term, termIndex) => {
		const marker =
			term.tbx?.termMarker ??
			`${TERM_MARKER_PREFIX}${entryIndex}_${termIndex}__`;
		const replacement =
			term.tbx && term.term === term.tbx.originalTerm
				? innerXml(term.tbx.originalTermXml)
				: escapeXml(term.term);
		xml = xml.replace(marker, replacement);
	});
	return xml;
}

function serializeNewTermCategories(
	term: TbTerm,
	dialect: TbxDialect,
	style: TbxStyle,
): string {
	const categories: Array<{ name: string; text: string }> = [];
	if (term.partOfSpeech)
		categories.push({ name: "partOfSpeech", text: term.partOfSpeech });
	if (term.status)
		categories.push({ name: "administrativeStatus", text: term.status });
	for (const note of term.notes) {
		const normalized = typeAndText(note);
		if (!normalized.text) continue;
		if (
			normalized.type &&
			dialect !== "TBX-Core" &&
			allowedCategories(dialect).termNote?.includes(normalized.type)
		)
			categories.push({ name: normalized.type, text: normalized.text });
		else
			categories.push({
				name: "note",
				text: normalized.type
					? `${normalized.type}: ${normalized.text}`
					: normalized.text,
			});
	}
	return categories
		.map(({ name, text }) => {
			if (name === "note") return `          <note>${escapeXml(text)}</note>`;
			if (style === "dct") {
				const prefix =
					dialect === "TBX-Basic" && !MIN_CATEGORIES.termNote.includes(name)
						? "basic"
						: "min";
				return `          <${prefix}:${name}>${escapeXml(text)}</${prefix}:${name}>`;
			}
			return `          <termNote type="${escapeXml(name)}">${escapeXml(text)}</termNote>`;
		})
		.join("\n");
}

function validateV3Categories(
	root: Element,
	metadata: TbxDocumentMetadata,
	issues: TbxValidationIssue[],
): void {
	const allowed = allowedCategories(metadata.dialect);
	for (const element of allDescendants(root)) {
		const localName = element.localName;
		let categoryName: string | undefined;
		let categoryElement = localName;
		if (
			metadata.style === "dca" &&
			element.namespaceURI &&
			element.namespaceURI !== TBX_V3_NAMESPACE
		)
			issues.push({
				code: "NAMESPACE",
				message: "DCT namespace elements are not permitted in DCA style.",
				path: `//${element.tagName}`,
			});
		if (metadata.style === "dca" && CLASSIFICATION_ELEMENTS.has(localName))
			categoryName = element.getAttribute("type") ?? undefined;
		else if (
			metadata.style === "dct" &&
			element.namespaceURI === TBX_V3_NAMESPACE &&
			CLASSIFICATION_ELEMENTS.has(localName)
		) {
			issues.push({
				code: "CATEGORY",
				message: `${localName} with @type is DCA markup and is not permitted in DCT style.`,
				path: `//${element.tagName}`,
			});
			continue;
		} else if (
			metadata.style === "dct" &&
			element.namespaceURI &&
			element.namespaceURI !== TBX_V3_NAMESPACE
		) {
			categoryName = localName;
			categoryElement = dctCategoryClass(localName);
			const expectedNamespace = dctNamespace(
				metadata.dialect,
				categoryElement,
				categoryName,
			);
			if (element.namespaceURI !== expectedNamespace)
				issues.push({
					code: "NAMESPACE",
					message: `${categoryName} uses the wrong DCT module namespace.`,
					path: `//${element.tagName}`,
				});
		}
		if (!categoryName) continue;
		if (!(allowed[categoryElement] ?? []).includes(categoryName)) {
			issues.push({
				code: "CATEGORY",
				message: `${categoryName} is not permitted in ${metadata.dialect} ${metadata.style.toUpperCase()}.`,
				path: `//${element.tagName}`,
			});
			continue;
		}
		const values = PICKLISTS[categoryName];
		const value = element.textContent?.trim() ?? "";
		if (values && !values.includes(value))
			issues.push({
				code: "PICKLIST",
				message: `${categoryName} has unsupported value “${value}”.`,
				path: `//${element.tagName}`,
			});
	}
}

function validateReferences(root: Element, issues: TbxValidationIssue[]): void {
	const ids = new Set(
		allDescendants(root)
			.map((element) => element.getAttribute("id"))
			.filter((id): id is string => Boolean(id)),
	);
	for (const element of allDescendants(root)) {
		const target = element.getAttribute("target");
		if (!target) continue;
		const internal = target.startsWith("#") ? target.slice(1) : target;
		if (!/^https?:\/\//i.test(target) && !ids.has(internal))
			issues.push({
				code: "REFERENCE",
				message: `Reference target “${target}” is neither an existing id nor an HTTP(S) URI.`,
				path: `//${element.tagName}/@target`,
			});
	}
}

function validateModelCategories(
	categories: TbxDataCategory[],
	level: "concept" | "language" | "term",
	metadata: TbxDocumentMetadata,
	ids: Set<string>,
	issues: TbxValidationIssue[],
): void {
	const allowed = allowedCategories(metadata.dialect);
	for (const category of categories) {
		let categoryName: string | undefined;
		let categoryElement = category.localName;
		if (
			metadata.style === "dca" &&
			category.namespace &&
			category.namespace !== TBX_V3_NAMESPACE
		)
			issues.push({
				code: "NAMESPACE",
				message: "DCT namespace elements are not permitted in DCA style.",
				path: `${level}/${category.name}`,
			});
		if (
			metadata.style === "dct" &&
			category.namespace === TBX_V3_NAMESPACE &&
			CLASSIFICATION_ELEMENTS.has(category.localName)
		)
			issues.push({
				code: "CATEGORY",
				message: `${category.localName} with @type is DCA markup and is not permitted in DCT style.`,
				path: `${level}/${category.name}`,
			});
		if (
			metadata.style === "dca" &&
			CLASSIFICATION_ELEMENTS.has(category.localName)
		)
			categoryName = category.type;
		else if (
			metadata.style === "dct" &&
			category.namespace &&
			category.namespace !== TBX_V3_NAMESPACE
		) {
			categoryName = category.localName;
			categoryElement = dctCategoryClass(category.localName);
			const expectedNamespace = dctNamespace(
				metadata.dialect,
				categoryElement,
				categoryName,
			);
			if (category.namespace !== expectedNamespace)
				issues.push({
					code: "NAMESPACE",
					message: `${categoryName} uses the wrong DCT module namespace.`,
					path: `${level}/${category.name}`,
				});
		}
		if (
			categoryName &&
			!(allowed[categoryElement] ?? []).includes(categoryName)
		)
			issues.push({
				code: "CATEGORY",
				message: `${categoryName} is not permitted in ${metadata.dialect} ${metadata.style.toUpperCase()}.`,
				path: `${level}/${category.name}`,
			});
		if (categoryName) {
			const values = PICKLISTS[categoryName];
			if (values && !values.includes(category.text))
				issues.push({
					code: "PICKLIST",
					message: `${categoryName} has unsupported value “${category.text}”.`,
					path: `${level}/${category.name}`,
				});
			if (!categoryAllowedAtLevel(categoryName, level))
				issues.push({
					code: "CATEGORY",
					message: `${categoryName} is not permitted at ${level} level.`,
					path: `${level}/${category.name}`,
				});
		}
		const target = category.attributes.target;
		if (target) {
			const internal = target.startsWith("#") ? target.slice(1) : target;
			if (!/^https?:\/\//i.test(target) && !ids.has(internal))
				issues.push({
					code: "REFERENCE",
					message: `Reference target “${target}” is neither an existing id nor an HTTP(S) URI.`,
					path: `${level}/${category.name}/@target`,
				});
		}
		validateModelCategories(category.children, level, metadata, ids, issues);
	}
}

function categoryAllowedAtLevel(
	name: string,
	level: "concept" | "language" | "term",
): boolean {
	if (name === "subjectField") return level === "concept";
	if (name === "definition") return level !== "term";
	if (name === "context") return level === "term";
	if (
		[
			"partOfSpeech",
			"administrativeStatus",
			"grammaticalGender",
			"termLocation",
			"termType",
		].includes(name)
	)
		return level === "term";
	if (name === "xGraphic") return level !== "term";
	if (name === "crossReference") return level !== "language";
	if (["customerSubset", "projectSubset"].includes(name))
		return level !== "language";
	return true;
}

function allowedCategories(
	dialect: TbxDialect,
): Readonly<Record<string, readonly string[]>> {
	if (dialect === "TBX-Core") return {};
	return dialect === "TBX-Min" ? MIN_CATEGORIES : BASIC_CATEGORIES;
}

function dctCategoryClass(name: string): string {
	if (["subjectField", "context", "definition"].includes(name))
		return "descrip";
	if (["crossReference"].includes(name)) return "ref";
	if (["externalCrossReference", "xGraphic"].includes(name)) return "xref";
	if (["customerSubset", "projectSubset", "source"].includes(name))
		return "admin";
	if (["transactionType"].includes(name)) return "transac";
	if (["responsibility"].includes(name)) return "transacNote";
	return "termNote";
}

function dctNamespace(
	dialect: TbxDialect,
	elementName: string,
	categoryName: string,
): string | undefined {
	if (dialect === "TBX-Core") return undefined;
	const inheritedFromMin = (MIN_CATEGORIES[elementName] ?? []).includes(
		categoryName,
	);
	return inheritedFromMin
		? "http://www.tbxinfo.net/ns/min"
		: dialect === "TBX-Basic"
			? "http://www.tbxinfo.net/ns/basic"
			: "http://www.tbxinfo.net/ns/min";
}

function collectLevelCategories(
	element: Element,
	excludedNames: string[],
): TbxDataCategory[] {
	const excluded = new Set(excludedNames.map((name) => name.toLowerCase()));
	return directChildren(element)
		.filter((child) => !excluded.has(child.localName.toLowerCase()))
		.map(categoryFromElement);
}

function categoryFromElement(element: Element): TbxDataCategory {
	return {
		name: element.tagName,
		localName: element.localName,
		...(element.namespaceURI ? { namespace: element.namespaceURI } : {}),
		...(element.getAttribute("type")
			? { type: element.getAttribute("type") ?? undefined }
			: {}),
		text: element.textContent?.trim() ?? "",
		attributes: attributesOf(element),
		children: directChildren(element).map(categoryFromElement),
	};
}

function findCategory(
	categories: TbxDataCategory[],
	name: string,
): TbxDataCategory | undefined {
	for (const category of categories) {
		if (category.type === name || category.localName === name) return category;
		const nested = findCategory(category.children, name);
		if (nested) return nested;
	}
}

function attributesOf(element: Element): Record<string, string> {
	return Object.fromEntries(
		Array.from(element.attributes).map((attribute) => [
			attribute.name,
			attribute.value,
		]),
	);
}

function xmlLanguage(element: Element): string {
	return (
		element.getAttribute("xml:lang") ??
		element.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang") ??
		""
	);
}

function directChildren(element: Element, localName?: string): Element[] {
	return Array.from(element.childNodes)
		.filter((node): node is Element => node.nodeType === 1)
		.filter((child) => !localName || child.localName === localName);
}

function firstDirectChild(
	element: Element,
	localName: string,
): Element | undefined {
	return directChildren(element, localName)[0];
}

function firstDescendant(
	element: Element,
	localName: string,
): Element | undefined {
	return allDescendants(element).find((child) => child.localName === localName);
}

function allDescendants(element: Element): Element[] {
	return Array.from(element.getElementsByTagName("*"));
}

function serializeXml(element: Element): string {
	return new XMLSerializer().serializeToString(element);
}

function innerXml(xml: string): string {
	return xml.replace(/^<[^>]+>/, "").replace(/<\/[^>]+>$/, "");
}

function groupTermsByLanguage(
	terms: TbTerm[],
): Array<{ language: string; terms: TbTerm[] }> {
	const groups = new Map<string, TbTerm[]>();
	for (const term of terms)
		groups.set(term.lang, [...(groups.get(term.lang) ?? []), term]);
	return Array.from(groups, ([language, groupedTerms]) => ({
		language,
		terms: groupedTerms,
	}));
}

function typeAndText(note: string | { type: string; text: string }): {
	type: string;
	text: string;
} {
	return typeof note === "string" ? { type: "", text: note } : note;
}

function placeholderCount(skeleton: string): number {
	return Array.from(
		skeleton.matchAll(new RegExp(STREAM_PLACEHOLDER.source, "gi")),
	).length;
}

function extractLanguageCode(language: string): string {
	return language.match(/\(([^)]+)\)/)?.[1] ?? language;
}

function escapeXml(value: string): string {
	return value.replace(
		/[<>&'"]/g,
		(character) =>
			({
				"<": "&lt;",
				">": "&gt;",
				"&": "&amp;",
				"'": "&apos;",
				'"': "&quot;",
			})[character] ?? character,
	);
}
