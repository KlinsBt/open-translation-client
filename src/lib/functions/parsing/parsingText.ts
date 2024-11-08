// More sophisticated filter using the array of strings as
// filter criteria to create text segments
const PARSE_CRITERIA: string[] = [".", "?", "!", ". ", "? ", "! "];
export async function createTextSegmentsByArrayFilters(fullText: string) {
	let text: string = "";
	let textSegments1: string[] = [];
	let textSegments2: string[] = [];
	let checked: boolean[] = [];
	for (let i = 0; i < fullText.length; i++) {
		if (
			PARSE_CRITERIA.includes(fullText[i]) ||
			(i > 0 && fullText[i - 1] == `"`) ||
			(i > 0 && fullText[i - 1] == `"`)
		) {
			text += fullText[i];
		} else {
			text += fullText[i];
			textSegments1.push(text);
			textSegments2.push("");
			checked.push(false);
			text = "";
			continue;
		}
	}
	if (textSegments1.length === 0) {
		return [
			[{ segment: fullText, checked: "" }],
			[{ segment: "", checked: "" }],
		];
	}
	return [textSegments1, textSegments2];
}

// Simple filter by "." to create text segments
export async function createTextSegmentsSimple(fullText: string) {
	let text: string = "";
	let textSegments1: string[] = [];
	let textSegments2: string[] = [];
	let checked: boolean[] = [];
	for (let i = 0; i < fullText.length; i++) {
		if (
			fullText[i] !== "." ||
			(i > 0 && fullText[i - 1] == `"`) ||
			(i > 0 && fullText[i - 1] == `"`)
		) {
			text += fullText[i];
		} else {
			text += fullText[i];
			textSegments1.push(text);
			textSegments2.push("");
			checked.push(false);
			text = "";
			continue;
		}
	}
	if (textSegments1.length === 0) {
		return [[], [], []];
	}
	return [textSegments1, textSegments2, checked];
}

export function createTextSegmentsWithRegexGeneralTextAlgo(
	fullText: string,
): [string[], string[], boolean[]] {
	// Replace newlines with a special marker to help split by newlines later
	const sanitizedText = fullText
		.replace(/\n+/g, "|")
		.replace(/\|+/g, "|")
		.trim();

	// Split by punctuation followed by space and/or newlines
	const segments: string[] = sanitizedText
		.replace(/([.?!])\s*(?=[A-Z])/g, "$1|") // Split by punctuation followed by uppercase letter
		.split("|") // Split using the delimiter '|'
		.map((segment) => segment.trim()) // Trim whitespace around each segment
		.filter((segment) => segment.length > 0); // Filter out any empty segments

	let textSegments1: string[] = [];
	let textSegments2: string[] = [];
	let checked: boolean[] = [];
	for (let i = 0; i < segments.length; i++) {
		textSegments1.push(segments[i]);
		textSegments2.push("");
		checked.push(false);
	}
	if (textSegments1.length === 0) {
		return [[], [], []];
	}
	return [textSegments1, textSegments2, checked];
}

// Works well for technical content with a lot of code-like
// patterns and unusual punctuation, spacing and commas
function createTextSegmentsWithRegexTechnicalTextAlgo(fullText: string) {
	// Step 1: Replace double newlines (or more) with a strong delimiter
	let sanitizedText = fullText.replace(/\n\s*\n/g, "|||");

	// Step 2: Replace remaining newlines with a space to avoid splitting within sentences
	sanitizedText = sanitizedText.replace(/\n/g, " ");

	// Step 3: Protect technical content by adding markers around regex and code-like patterns
	sanitizedText = sanitizedText.replace(
		/(replace|split|filter|map)\(([^)]+)\)/g,
		"__MARKER__$1($2)__ENDMARKER__",
	);

	// Step 4: Split on punctuation followed by space and an uppercase letter, also consider the strong delimiter
	let segments = sanitizedText
		.replace(/([.?!])\s+(?=[A-Z])/g, "$1|||") // Split by punctuation followed by space and uppercase letter
		.split("|||") // Split using the delimiter '|||'
		.map((segment) => segment.trim()) // Trim whitespace around each segment
		.filter((segment) => segment.length > 0); // Filter out any empty segments

	// Step 5: Restore protected technical content
	segments = segments.map((segment) =>
		segment.replace(/__MARKER__(.*?)__ENDMARKER__/g, "$1"),
	);

	let textSegments1: string[] = [];
	let textSegments2: string[] = [];
	let checked: boolean[] = [];
	for (let i = 0; i < segments.length; i++) {
		textSegments1.push(segments[i]);
		textSegments2.push("");
		checked.push(false);
	}
	if (textSegments1.length === 0) {
		return [[], [], []];
	}
	return [textSegments1, textSegments2, checked];
}

// Works well for simple text content with standard punctuation
export async function createTextSegmentsWithRegexSimple(fullText: string) {
	let arrayText: string[] = fullText
		.replace(/([.?!])\s*(?=[A-Z])/g, "$1|")
		.split("|");
	console.log("fullText converted: ", arrayText);
	let textSegments1: string[] = [];
	let textSegments2: string[] = [];
	let checked: boolean[] = [];
	for (let i = 0; i < arrayText.length; i++) {
		textSegments1.push(arrayText[i]);
		textSegments2.push("");
		checked.push(false);
	}
	if (textSegments1.length === 0) {
		return [[], [], []];
	}
	return [textSegments1, textSegments2, checked];
}
