export function getXliffVersion(xliff: Document): number {
	const xliffElement = xliff.getElementsByTagName("xliff")[0];
	if (!xliffElement) return 0;

	const version = xliffElement.getAttribute("version");
	if (!version) return 0;

	return parseFloat(version);
}

export function validateXliff2_0Data(xliffDocument: Document): boolean {
	// Check if xliff root element exists
	const xliffElement = xliffDocument.getElementsByTagName("xliff")[0];
	if (!xliffElement) return false;

	let version = xliffElement.getAttribute("version") ?? "0.0";

	if (parseFloat(version) < 2.0) return false;

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

	// Check metaGroup with category "open_tlc_metadata"
	const metaGroupElements =
		metadataElement.getElementsByTagName("mda:metaGroup");
	let openTlcMetaGroup: Element | null = null;
	for (let i = 0; i < metaGroupElements.length; i++) {
		const category = metaGroupElements[i].getAttribute("category");
		if (category === "open_tlc_metadata") {
			openTlcMetaGroup = metaGroupElements[i];
			break;
		}
	}
	if (!openTlcMetaGroup) return false;

	// Check meta elements with types "name", "type", and "type_ref"
	const metaElements = openTlcMetaGroup.getElementsByTagName("mda:meta");
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

	console.log(true);

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
	let checked: boolean[] = [];
	let type = "text";
	let typeRef: any = {};
	let tm: any = {};
	let tb: any = {};

	if (withCustomData) {
		// Extract metadata
		const metadataElement = fileElement.getElementsByTagName("mda:metadata")[0];
		const metaGroupElements =
			metadataElement.getElementsByTagName("mda:metaGroup");

		for (let i = 0; i < metaGroupElements.length; i++) {
			const category = metaGroupElements[i].getAttribute("category");
			if (category === "open_tlc_metadata") {
				const metaElements =
					metaGroupElements[i].getElementsByTagName("mda:meta");
				for (let j = 0; j < metaElements.length; j++) {
					const typeAttr = metaElements[j].getAttribute("type");
					const content = metaElements[j].textContent || "";
					if (typeAttr === "name") name = content;
					else if (typeAttr === "checked") checked = JSON.parse(content);
					else if (typeAttr === "type") type = content;
					else if (typeAttr === "type_ref") {
						try {
							console.log("typeAttr:", typeAttr);
							console.log("content:", content);
							console.log("type_ref typeof:", typeof content);
							typeRef = JSON.parse(content);
						} catch (e) {
							console.error("Invalid JSON in type_ref", e);
							typeRef = null;
						}
					} else if (typeAttr === "tm") {
						try {
							tm = JSON.parse(content);
						} catch (e) {
							console.error("Invalid JSON in tm", e);
							tm = {
								id: null,
								name: null,
								active: false,
							};
						}
					} else if (typeAttr === "tb") {
						try {
							tb = JSON.parse(content);
						} catch (e) {
							console.error("Invalid JSON in tb", e);
							tm = {
								id: null,
								name: null,
								active: false,
							};
						}
					}
				}
				break;
			}
		}
	}

	console.log(checked);
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
		...(isNaN(id) ? {} : { id: id }), // Only include the id field if it's not NaN
		translationData: {
			name: name,
			targetLang: srcLang,
			sourceLang: trgLang,
			creationDate: new Date().getTime().toString(),
			seg1: seg1,
			seg2: seg2,
			checked: checked.length !== seg1.length ? seg1.map(() => false) : checked,
			type: type,
			typeRef: typeRef,
			tm,
			tb,
		},
	};
}

export function validateXliff1_2Data(xliffDocument: Document): boolean {
	const xliffElement = xliffDocument.getElementsByTagName("xliff")[0];
	if (!xliffElement) return false;

	const version = xliffElement.getAttribute("version") ?? "0.0";
	// Validate exact version 1.2
	if (parseFloat(version) !== 1.2) return false;

	const fileElement = xliffElement.getElementsByTagName("file")[0];
	if (!fileElement) return false;

	const srcLang = fileElement.getAttribute("source-language");
	const trgLang = fileElement.getAttribute("target-language");
	if (!srcLang || !trgLang) return false;

	const headerElement = fileElement.getElementsByTagName("header")[0];
	if (!headerElement) return false;

	const groupElement = headerElement.getElementsByTagName("group")[0];
	if (!groupElement) return false;

	// Handle namespaces with proper resolver
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

	console.log(true);
	return true;
}

export function extractXliff1_2Data(
	xliffDocument: Document,
	withCustomData: boolean,
): any {
	const xliffElement = xliffDocument.getElementsByTagName("xliff")[0];
	const fileElement = xliffElement.getElementsByTagName("file")[0];
	const srcLang = fileElement.getAttribute("source-language");
	const trgLang = fileElement.getAttribute("target-language");

	let id = null;
	let name = "Unnamed Translation";
	let checked: boolean[] = [];
	let type = "text";
	let typeRef: any = {};
	let tm: any = {};
	let tb: any = {};

	if (withCustomData) {
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
			const supId = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Id",
			)[0];
			const supName = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Name",
			)[0];
			const supChecked = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Checked",
			)[0];
			const supType = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Type",
			)[0];
			const supTypeRef = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"TypeRef",
			)[0];
			const supTm = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Tm",
			)[0];
			const supTb = supSourceInfo.getElementsByTagNameNS(
				"http://example.com/sup",
				"Tb",
			)[0];

			id = supId?.textContent || null;
			name = supName?.textContent || name;
			checked = JSON.parse(supChecked?.textContent!) || checked;
			console.log(checked);
			type = supType?.textContent || type;
			const typeRefContent = (supTypeRef?.textContent || "{}").replace(
				/&quot;/g,
				'"',
			);
			try {
				typeRef = JSON.parse(typeRefContent);
			} catch (e) {
				console.error("Invalid JSON in TypeRef", e);
				typeRef = {};
			}
			const supTmContent = (supTm?.textContent || "{}").replace(/&quot;/g, '"');
			try {
				tm = JSON.parse(supTmContent);
			} catch (e) {
				console.error("Invalid JSON in Tm", e);
				tm = {
					id: null,
					name: null,
					active: false,
				};
			}
			const supTbContent = (supTb?.textContent || "{}").replace(/&quot;/g, '"');
			try {
				tb = JSON.parse(supTbContent);
			} catch (e) {
				console.error("Invalid JSON in Tb", e);
				tb = {
					id: null,
					name: null,
					active: false,
				};
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
	id = id === null ? Date.now() : parseInt(id);

	return {
		id: id,
		translationData: {
			name: name,
			sourceLang: srcLang,
			targetLang: trgLang,
			creationDate: new Date().getTime().toString(),
			seg1: seg1,
			seg2: seg2,
			checked: checked.length != seg1.length ? seg1.map(() => false) : checked,
			type: type,
			typeRef: typeRef,
			tm,
			tb,
		},
	};
}

export function validateJsonData(data: any): boolean {
	if (!data) return false;
	// if (typeof data.id !== "number" || data.id <= 0) return false;
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
	if (typeof td.typeRef !== "string" && typeof td.typeRef !== "object")
		return false;

	return true;
}
