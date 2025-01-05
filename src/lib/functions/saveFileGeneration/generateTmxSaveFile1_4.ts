import type { TmData } from "../../types/types";

// Function to generate the TMX XML string
function generateTmx(sourceLang: string, tm: TmData): string {
	let currentTimeInUnix = Math.floor(Date.now() / 1000);
	let tmx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	tmx += `<tmx version="1.4">\n`;
	tmx += `  <header creationtool="Open Translation Client" creationtoolversion="1.0" datatype="unknown" segtype="sentence" adminlang="en-us" srclang="${getLanguageCode(sourceLang)}" o-tmf="OpenTLCTM" creationdate="${unixToCustomFormat(currentTimeInUnix)}" creationid="System" changedate="${unixToCustomFormat(currentTimeInUnix)}" changeid="System">\n`;
	// tmx += `    <note>This is a generated TMX file</note>\n`;
	tmx += `    <prop type="id">${tm.id}</prop>\n`;
	tmx += `    <prop type="name">${tm.name}</prop>\n`;
	tmx += `  </header>\n`;
	tmx += `  <body>\n`;

	// Add translation units (source and target segments)
	for (let i = 0; i < tm.terms.length; i++) {
		const sourceSeg = tm.terms[i].source.segment;

		tmx += `    <tu tuid="${i + 1}">\n`;
		tmx += `      <tuv xml:lang="${getLanguageCode(sourceLang)}">\n`;
		tmx += `        <seg>${escapeXml(sourceSeg)}</seg>\n`;
		tmx += `      </tuv>\n`;
		for (let j = 0; j < tm.terms[i].target.length; j++) {
			tmx += `      <tuv xml:lang="${getLanguageCode(tm.terms[i].target[j].lang || "")}">\n`;
			tmx += `        <seg>${escapeXml(tm.terms[i].target[j].segment || "")}</seg>\n`;
			tmx += `      </tuv>\n`;
		}
		tmx += `    </tu>\n`;
	}

	tmx += `  </body>\n`;
	tmx += `</tmx>\n`;

	return tmx;
}

// Utility function to escape XML special characters
function escapeXml(unsafe: string): string {
	return unsafe.replace(/[<>&'"]/g, (char) => {
		switch (char) {
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case "&":
				return "&amp;";
			case "'":
				return "&apos;";
			case '"':
				return "&quot;";
			default:
				return char;
		}
	});
}

// Utility function to extract language codes (could be extended for various formats)
function getLanguageCode(lang: string): string {
	// Extract language code from full name like "English (en)" or return as-is
	const match = lang.match(/\(([^)]+)\)/);
	return match ? match[1] : lang; // If no match, return the original string
}

// Function to trigger the TMX file download
async function generateTmxFileDownload(tmxData: string, name: string) {
	const blob = new Blob([tmxData], { type: "application/xml" });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = `${name}.tmx`;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	URL.revokeObjectURL(url);
}

function unixToCustomFormat(unixTime: number): string {
	const date = new Date(unixTime * 1000); // Convert seconds to milliseconds
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, "0");
	const day = String(date.getUTCDate()).padStart(2, "0");
	const hours = String(date.getUTCHours()).padStart(2, "0");
	const minutes = String(date.getUTCMinutes()).padStart(2, "0");
	const seconds = String(date.getUTCSeconds()).padStart(2, "0");

	return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function customFormatToUnix(customTime: string): number {
	const year = parseInt(customTime.slice(0, 4), 10);
	const month = parseInt(customTime.slice(4, 6), 10) - 1; // Month is 0-based
	const day = parseInt(customTime.slice(6, 8), 10);
	const hours = parseInt(customTime.slice(9, 11), 10);
	const minutes = parseInt(customTime.slice(11, 13), 10);
	const seconds = parseInt(customTime.slice(13, 15), 10);

	const date = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
	return Math.floor(date.getTime() / 1000); // Convert milliseconds to seconds
}

// Main function to generate and download TMX file from UserData
export async function generateTmxSaveFile(sourceLang: string, tmData: TmData) {
	try {
		// Generate the TMX content from UserData
		const tmxContent = generateTmx(sourceLang, tmData);

		// Trigger download
		await generateTmxFileDownload(tmxContent, tmData.name || "TMX Save File");
	} catch (error) {
		console.error("Failed to generate TMX save file:", error);
	}
}

// Function to generate random translation units
function generateRandomTranslationUnits(count: number): TmData {
	const languages = ["de", "es"];

	function randomWord(): string {
		const words = [
			"apple",
			"tree",
			"car",
			"house",
			"river",
			"sun",
			"moon",
			"star",
			"cloud",
		];
		return words[Math.floor(Math.random() * words.length)];
	}

	function randomSentence(): string {
		const sentenceLength = Math.floor(Math.random() * 7) + 3; // 3 to 10 words
		return Array.from({ length: sentenceLength }, randomWord).join(" ");
	}

	const terms = Array.from({ length: count }, (_, idx) => ({
		id: idx + 1,
		source: {
			lang: "en",
			segment: randomSentence(),
		},
		target: languages.map((lang) => ({
			lang: lang,
			segment: randomSentence(),
		})),
	}));

	return {
		name: "RandomTMX",
		terms: terms,
	};
}

// Example Usage:
export async function generateRandomTmxFile(count: number) {
	const randomTmData = generateRandomTranslationUnits(count);
	await generateTmxSaveFile("en", randomTmData);
}
