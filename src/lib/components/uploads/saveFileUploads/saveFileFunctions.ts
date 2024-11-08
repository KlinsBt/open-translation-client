export function getXliffVersion(xliff: Document): string {
	const xliffElement = xliff.getElementsByTagName("xliff")[0];
	if (!xliffElement) return "invalid";

	const version = xliffElement.getAttribute("version");
	if (!version) return "invalid";

	return version;
}

export function validateXliff2_0Data(xliffDocument: Document): boolean {
	// Check if xliff root element exists
	const xliffElement = xliffDocument.getElementsByTagName("xliff")[0];
	if (!xliffElement) return false;

	if (xliffElement.getAttribute("version") !== "2.0") return false;

	// Check srcLang and trgLang attributes
	const srcLang = xliffElement.getAttribute("srcLang");
	const trgLang = xliffElement.getAttribute("trgLang");
	if (!srcLang || !trgLang) return false;

	// Check file element
	const fileElement = xliffElement.getElementsByTagName("file")[0];
	if (!fileElement) return false;

	// Check id attribute on file element
	const idAttr = fileElement.getAttribute("id");
	if (!idAttr || isNaN(Number(idAttr)) || Number(idAttr) <= 0) return false;

	// Check metadata
	const metadataElements = fileElement.getElementsByTagName("mda:metadata");
	if (!metadataElements || metadataElements.length === 0) return false;
	const metadataElement = metadataElements[0];

	// Check metaGroup with category "open_trc_metadata"
	const metaGroupElements =
		metadataElement.getElementsByTagName("mda:metaGroup");
	let openTrcMetaGroup: Element | null = null;
	for (let i = 0; i < metaGroupElements.length; i++) {
		const category = metaGroupElements[i].getAttribute("category");
		if (category === "open_trc_metadata") {
			openTrcMetaGroup = metaGroupElements[i];
			break;
		}
	}
	if (!openTrcMetaGroup) return false;

	// Check meta elements with types "name", "type", and "type_ref"
	const metaElements = openTrcMetaGroup.getElementsByTagName("mda:meta");
	console.log(metaElements);
	let hasName = false;
	let hasType = false;
	let hasTypeRef = false;

	for (let i = 0; i < metaElements.length; i++) {
		const typeAttr = metaElements[i].getAttribute("type");
		if (typeAttr === "name") hasName = true;
		else if (typeAttr === "type") hasType = true;
		else if (typeAttr === "type_ref") hasTypeRef = true;
	}

	if (!hasName || !hasType || !hasTypeRef) return false;

	return true;
}

export function extractValuesFromXliff2_0(xliff: Document): string[] {
	const values: string[] = [];
	const segments = xliff.querySelectorAll("segment");

	segments.forEach((segment) => {
		const source = segment.querySelector("source")?.textContent;
		const target = segment.querySelector("target")?.textContent;
		values.push(source || "", target || "");
	});

	return values;
}

export function extractXliff2_0Data(
	xliffDocument: Document,
	withCustomData: boolean,
): any {
	const xliffElement = xliffDocument.getElementsByTagName("xliff")[0];

	const srcLang = xliffElement.getAttribute("srcLang");
	const trgLang = xliffElement.getAttribute("trgLang");

	const fileElement = xliffElement.getElementsByTagName("file")[0];
	const idAttr = fileElement.getAttribute("id");
	const id = Number(idAttr);

	let name = "Translation " + idAttr;
	let type = "text";
	let typeRef: any = {};

	if (withCustomData) {
		// Extract metadata
		const metadataElement = fileElement.getElementsByTagName("mda:metadata")[0];
		const metaGroupElements =
			metadataElement.getElementsByTagName("mda:metaGroup");

		for (let i = 0; i < metaGroupElements.length; i++) {
			const category = metaGroupElements[i].getAttribute("category");
			if (category === "open_trc_metadata") {
				const metaElements =
					metaGroupElements[i].getElementsByTagName("mda:meta");
				for (let j = 0; j < metaElements.length; j++) {
					const typeAttr = metaElements[j].getAttribute("type");
					const content = metaElements[j].textContent || "";
					if (typeAttr === "name") name = content;
					else if (typeAttr === "type") type = content;
					else if (typeAttr === "type_ref") {
						try {
							typeRef = JSON.parse(content);
						} catch (e) {
							console.error("Invalid JSON in type_ref", e);
							typeRef = null;
						}
					}
				}
				break;
			}
		}
	}

	// Extract segments
	const units = fileElement.getElementsByTagName("unit");
	const seg1: string[] = [];
	const seg2: string[] = [];

	for (let i = 0; i < units.length; i++) {
		const segment = units[i].getElementsByTagName("segment")[0];
		if (segment) {
			const source =
				segment.getElementsByTagName("source")[0]?.textContent || "";
			const target =
				segment.getElementsByTagName("target")[0]?.textContent || "";
			seg1.push(source);
			seg2.push(target);
		}
	}

	return {
		id: id,
		translationData: {
			name: name,
			targetLang: srcLang,
			sourceLang: trgLang,
			creationDate: new Date().getTime().toString(),
			seg1: seg1,
			seg2: seg2,
			checked: seg1.map(() => false),
			type: type,
			typeRef: typeRef,
		},
	};
}

export function validateXliff1_2Data(xliffDocument: Document): boolean {
	// Check if xliff root element exists
	const xliffElement = xliffDocument.getElementsByTagName("xliff")[0];
	if (!xliffElement) return false;

	// Check version attribute
	if (xliffElement.getAttribute("version") !== "1.2") return false;

	// Check file element
	const fileElement = xliffElement.getElementsByTagName("file")[0];
	if (!fileElement) return false;

	// Check source-language and target-language attributes
	const srcLang = fileElement.getAttribute("source-language");
	const trgLang = fileElement.getAttribute("target-language");
	if (!srcLang || !trgLang) return false;

	// Check body element
	const bodyElement = fileElement.getElementsByTagName("body")[0];
	if (!bodyElement) return false;

	// Check group element
	const groupElement = bodyElement.getElementsByTagName("group")[0];
	if (!groupElement) return false;

	// Check for custom metadata in sup:SourceInfo
	const namespaceResolver = xliffDocument.createNSResolver(
		xliffDocument.documentElement,
	);
	const supSourceInfo = xliffDocument.evaluate(
		"//sup:SourceInfo",
		xliffDocument,
		namespaceResolver,
		XPathResult.FIRST_ORDERED_NODE_TYPE,
		null,
	).singleNodeValue as Element;

	if (!supSourceInfo) return false;

	// Check for sup:Name, sup:Type, and sup:TypeRef elements
	const supName = supSourceInfo.getElementsByTagNameNS(
		"http://example.com/sup",
		"Name",
	)[0];
	const supType = supSourceInfo.getElementsByTagNameNS(
		"http://example.com/sup",
		"Type",
	)[0];
	const supTypeRef = supSourceInfo.getElementsByTagNameNS(
		"http://example.com/sup",
		"TypeRef",
	)[0];

	if (!supName || !supType || !supTypeRef) return false;

	return true;
}

// Function to extract values from XLIFF 1.2
export function extractValuesFromXliff1_2(xliff: Document): string[] {
	const values: string[] = [];
	const transUnits = xliff.getElementsByTagName("trans-unit");

	for (let i = 0; i < transUnits.length; i++) {
		const transUnit = transUnits[i];
		const source =
			transUnit.getElementsByTagName("source")[0]?.textContent || "";
		const target =
			transUnit.getElementsByTagName("target")[0]?.textContent || "";
		values.push(source, target);
	}

	return values;
}

// Function to extract data from XLIFF 1.2
export function extractXliff1_2Data(
	xliffDocument: Document,
	withCustomData: boolean,
): any {
	const xliffElement = xliffDocument.getElementsByTagName("xliff")[0];

	const fileElement = xliffElement.getElementsByTagName("file")[0];
	const srcLang = fileElement.getAttribute("source-language");
	const trgLang = fileElement.getAttribute("target-language");

	let name = "Unnamed Translation";
	let type = "text";
	let typeRef: any = {};

	if (withCustomData) {
		// Extract custom metadata
		const namespaceResolver = xliffDocument.createNSResolver(
			xliffDocument.documentElement,
		);
		const supSourceInfo = xliffDocument.evaluate(
			"//sup:SourceInfo",
			xliffDocument,
			namespaceResolver,
			XPathResult.FIRST_ORDERED_NODE_TYPE,
			null,
		).singleNodeValue as Element;

		if (supSourceInfo) {
			const supName = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Name",
			)[0];
			const supType = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Type",
			)[0];
			const supTypeRef = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"TypeRef",
			)[0];

			name = supName?.textContent || name;
			type = supType?.textContent || type;
			const typeRefContent = supTypeRef?.textContent || "{}";

			try {
				typeRef = JSON.parse(typeRefContent);
			} catch (e) {
				console.error("Invalid JSON in TypeRef", e);
				typeRef = {};
			}
		}
	}

	// Extract segments
	const transUnits = xliffDocument.getElementsByTagName("trans-unit");
	const seg1: string[] = [];
	const seg2: string[] = [];

	for (let i = 0; i < transUnits.length; i++) {
		const transUnit = transUnits[i];
		const source =
			transUnit.getElementsByTagName("source")[0]?.textContent || "";
		const target =
			transUnit.getElementsByTagName("target")[0]?.textContent || "";
		seg1.push(source);
		seg2.push(target);
	}

	// Generate a unique ID if none exists
	const id = Date.now();

	return {
		id: id,
		translationData: {
			name: name,
			sourceLang: srcLang,
			targetLang: trgLang,
			creationDate: new Date().getTime().toString(),
			seg1: seg1,
			seg2: seg2,
			checked: seg1.map(() => false),
			type: type,
			typeRef: typeRef,
		},
	};
}

export function validateJsonData(data: any): boolean {
	if (!data) return false;
	if (typeof data.id !== "number" || data.id <= 0) return false;
	if (!data.translationData || typeof data.translationData !== "object")
		return false;

	const td = data.translationData;
	if (typeof td.name !== "string") return false;
	if (typeof td.targetLang !== "string") return false;
	if (typeof td.sourceLang !== "string") return false;
	if (typeof td.creationDate !== "string" || !/^\d+$/.test(td.creationDate))
		return false;
	if (
		!Array.isArray(td.seg1) ||
		!td.seg1.every((s: any) => typeof s === "string") ||
		td.seg1.length !== td.seg2.length
	)
		return false;
	if (
		!Array.isArray(td.seg2) ||
		!td.seg2.every((s: any) => typeof s === "string")
	)
		return false;
	if (
		!Array.isArray(td.checked) ||
		!td.checked.every((s: any) => typeof s === "boolean")
	)
		return false;
	if (typeof td.type !== "string") return false;
	if (typeof td.typeRef !== "object") return false;

	return true;
}
