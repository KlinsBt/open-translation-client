import type { UserData } from "$lib/types/types";

// Function to generate the TMX XML string
function generateTmx(userData: UserData): string {
	const { translationData } = userData;
	const { name, sourceLang, targetLang, seg1, seg2, type } = translationData;

	// Build the TMX header
	let tmx = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	tmx += `<tmx version="1.4">\n`;
	tmx += `  <header creationtool="Open Translation Client" creationtoolversion="1.0" datatype="${type}" segtype="sentence" adminlang="en-us" srclang="${getLanguageCode(sourceLang)}" o-tmf="CustomTM"/>\n`;
	tmx += `  <body>\n`;

	// Add translation units (source and target segments)
	for (let i = 0; i < seg1.length; i++) {
		const sourceSegment = seg1[i];
		const targetSegment = seg2[i] || ""; // If target segment is missing, use an empty string

		tmx += `    <tu>\n`;
		tmx += `      <tuv xml:lang="${getLanguageCode(sourceLang)}">\n`;
		tmx += `        <seg>${escapeXml(sourceSegment)}</seg>\n`;
		tmx += `      </tuv>\n`;
		tmx += `      <tuv xml:lang="${getLanguageCode(targetLang)}">\n`;
		tmx += `        <seg>${escapeXml(targetSegment)}</seg>\n`;
		tmx += `      </tuv>\n`;
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

// Main function to generate and download TMX file from UserData
export async function generateTmxSaveFile(userData: UserData) {
	try {
		// Generate the TMX content from UserData
		const tmxContent = generateTmx(userData);

		// Trigger download
		await generateTmxFileDownload(tmxContent, userData.translationData.name);
	} catch (error) {
		console.error("Failed to generate TMX save file:", error);
	}
}
