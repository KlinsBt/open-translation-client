import type { TbData } from "../../types/types";

// Function to generate the TBX XML string
function generateTbx(sourceLang: string, tbxData: TbData): string {
	let tbxContent = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	tbxContent += `<?xml-model href="https://raw.githubusercontent.com/LTAC-Global/TBX_Core_RNG/master/TBXcoreStructV03.rng" type="application/xml" schematypens="http://relaxng.org/ns/structure/1.0"?>\n`;
	tbxContent += `<?xml-model href="https://raw.githubusercontent.com/LTAC-Global/TBX-Core_dialect/master/Schemas/TBX-Core.sch" type="application/xml" schematypens="http://purl.oclc.org/dsdl/schematron"?>\n`;
	tbxContent += `<tbx style="dca" type="TBX-Core" xml:lang="${getLanguageCode(sourceLang)}" xmlns="urn:iso:std:iso:30042:ed-2">\n`;
	tbxContent += `  <tbxHeader>\n`;
	tbxContent += `    <fileDesc>\n`;
	tbxContent += `      <titleStmt>\n`;
	tbxContent += `        <title>${tbxData.name || "Untitled TBX File"}</title>\n`;
	tbxContent += `      </titleStmt>\n`;
	tbxContent += `      <sourceDesc>\n`;
	tbxContent += `        <p>OpenTLC ID: ${tbxData.id}</p>\n`;
	tbxContent += `      </sourceDesc>\n`;
	tbxContent += `    </fileDesc>\n`;
	tbxContent += `  </tbxHeader>\n`;
	tbxContent += `  <text>\n`;
	tbxContent += `    <body>\n`;

	// Iterates through terms and construct TBX content
	tbxData.entries.forEach((concept) => {
		tbxContent += `      <conceptEntry id="C${concept.id}">\n`;
		concept.terms.forEach((term) => {
			tbxContent += `        <langSec xml:lang="${term.lang}">\n`;
			tbxContent += `          <termSec>\n`;
			tbxContent += `            <term>${escapeXml(term.term)}</term>\n`;
			term.notes.forEach((note) => {
				tbxContent += `            <note>${escapeXml(note)}</note>\n`;
			});
			tbxContent += `          </termSec>\n`;
			tbxContent += `        </langSec>\n`;
		});
		tbxContent += `      </conceptEntry>\n`;
	});
	tbxContent += `    </body>\n`;
	tbxContent += `  </text>\n`;
	tbxContent += `</tbx>\n`;

	return tbxContent;
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

// Function to trigger the TBX file download
async function generateTbxFileDownload(tbxData: string, name: string) {
	const blob = new Blob([tbxData], { type: "application/xml" });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = `${name}.tbx`;

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

// Main function to generate and download TBX file from tbxData
export async function generateTbxSaveFile(sourceLang: string, tbxData: TbData) {
	try {
		// Generate the TBX content from tbxData
		const tbxContent = generateTbx(sourceLang, tbxData);

		// Trigger download
		await generateTbxFileDownload(tbxContent, tbxData.name || "TBX_Save_File");
	} catch (error) {
		console.error("Failed to generate TBX save file:", error);
	}
}

// // Function to generate random translation units
// function generateRandomTranslationUnits(count: number): TmData {
// 	const languages = ["de", "es"];

// 	function randomWord(): string {
// 		const words = [
// 			"apple",
// 			"tree",
// 			"car",
// 			"house",
// 			"river",
// 			"sun",
// 			"moon",
// 			"star",
// 			"cloud",
// 		];
// 		return words[Math.floor(Math.random() * words.length)];
// 	}

// 	function randomSentence(): string {
// 		const sentenceLength = Math.floor(Math.random() * 7) + 3; // 3 to 10 words
// 		return Array.from({ length: sentenceLength }, randomWord).join(" ");
// 	}

// 	const terms = Array.from({ length: count }, (_, idx) => ({
// 		id: idx + 1,
// 		source: {
// 			lang: "en",
// 			segment: randomSentence(),
// 		},
// 		target: languages.map((lang) => ({
// 			lang: lang,
// 			segment: randomSentence(),
// 		})),
// 	}));

// 	return {
// 		name: "RandomTMX",
// 		terms: terms,
// 	};
// }

// export async function generateRandomTmxFile(count: number) {
// 	const randomTmData = generateRandomTranslationUnits(count);
// 	await generateTbxSaveFile("en", randomTmData);
// }
