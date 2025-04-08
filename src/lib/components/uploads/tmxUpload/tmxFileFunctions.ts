import type { TmData } from "$lib/types/types";

/**
 * Validate the structure of a TMX file (version 1.4).
 * @param tmxDocument - The parsed TMX document.
 * @returns True if valid, false otherwise.
 */
export function validateTmxFile(tmxDocument: Document): boolean {
	// Check for TMX root element
	const tmxElement = tmxDocument.getElementsByTagName("tmx")[0];
	if (!tmxElement) return false;

	// Validate TMX version
	// const version = tmxElement.getAttribute("version");
	// if (version !== "1.4") return false;

	// Validate header element
	const headerElement = tmxElement.getElementsByTagName("header")[0];
	if (!headerElement) return false;

	// Check required attributes in the header
	const requiredHeaderAttributes = [
		"creationtool",
		"creationtoolversion",
		"segtype",
		"o-tmf",
		"adminlang",
		"srclang",
		"datatype",
	];
	for (const attr of requiredHeaderAttributes) {
		if (!headerElement.getAttribute(attr)) return false;
	}

	// Check for <prop> elements with required types
	const props = headerElement.getElementsByTagName("prop");
	let hasIdProp = false;
	let hasNameProp = false;

	for (let i = 0; i < props.length; i++) {
		const typeAttr = props[i].getAttribute("type");
		if (typeAttr === "id") hasIdProp = true;
		if (typeAttr === "name") hasNameProp = true;
	}

	// Validate <body> and translation units
	const bodyElement = tmxElement.getElementsByTagName("body")[0];
	if (!bodyElement) return false;

	const tus = bodyElement.getElementsByTagName("tu");
	if (tus.length === 0) return false;

	// Validate each <tu> element
	for (let i = 0; i < tus.length; i++) {
		const tu = tus[i];
		const tuid = tu.getAttribute("tuid");
		if (!tuid || isNaN(Number(tuid))) return false;

		// Validate <tuv> elements inside each <tu>
		const tuvs = tu.getElementsByTagName("tuv");
		// if (tuvs.length < 2) return false; // Minimum of 2 languages required

		if (tuvs.length < 2) {
			console.warn(
				`Skipping TU with tuid="${tuid}" – only one language found.`,
			);
			continue;
		}

		for (let j = 0; j < tuvs.length; j++) {
			const tuv = tuvs[j];
			const lang = tuv.getAttribute("xml:lang");
			if (!lang) return false;

			const seg = tuv.getElementsByTagName("seg")[0];
			if (!seg || !seg.textContent) return false;
		}
	}

	return true; // All checks passed
}

export function extractTmxData(tmxDocument: Document): TmData {
	const tmxElement = tmxDocument.getElementsByTagName("tmx")[0];
	const headerElement = tmxElement.getElementsByTagName("header")[0];

	console.log(headerElement);

	// Extract metadata from the header
	const id = parseInt(
		headerElement.querySelector('prop[type="id"]')?.textContent || "0",
		10,
	);
	const name =
		headerElement.querySelector('prop[type="name"]')?.textContent || "New TM";

	const srcLang = headerElement.getAttribute("srclang") || "unknown";

	console.log(srcLang);

	// Extract translation units (TUs)
	const tus = tmxElement.getElementsByTagName("tu");
	const terms: TmData["terms"] = [];

	for (let i = 0; i < tus.length; i++) {
		const tu = tus[i];
		// const tuid = parseInt(tu.getAttribute("tuid") || (i + 1).toString(), 10); // Assign ID or fallback to index

		const tuvs = tu.getElementsByTagName("tuv");

		// Extract source and target segments
		let sourceSegment: { lang: string; segment: string } | null = null;
		const targetSegments: { lang: string; segment: string }[] = [];

		console.log(tuvs);

		for (let j = 0; j < tuvs.length; j++) {
			const tuv = tuvs[j];
			const lang = tuv.getAttribute("xml:lang") || "";
			const segment = tuv.getElementsByTagName("seg")[0]?.textContent || "";

			if (!sourceSegment) {
				// Assume the first segment matches the source language
				sourceSegment = { lang, segment };
			} else {
				// Subsequent segments are treated as targets
				targetSegments.push({ lang, segment });
			}
		}

		if (sourceSegment) {
			terms.push({
				// id: tuid,
				source: sourceSegment,
				target: targetSegments,
			});
		}
	}

	return {
		id,
		name,
		terms,
	};
}
