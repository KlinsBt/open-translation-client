import type { UserData } from "$lib/types/types";

// Function to generate the XLIFF XML string
function generateXliff(userData: UserData): string {
	const { translationData } = userData;
	const {
		name,
		sourceLang,
		targetLang,
		seg1,
		seg2,
		checked,
		type,
		typeRef,
		tm,
		tb,
	} = translationData;

	// Builds the XLIFF structure
	let xliff = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	xliff += `<xliff xmlns="urn:oasis:names:tc:xliff:document:2.0" version="2.0" srcLang="${sourceLang}" trgLang="${targetLang}">\n`;
	xliff += `  <file id="${escapeXml(userData.id!.toString() ?? "")}" original="">\n`;

	// Adds a <mda:metadata> element to contain the custom metadata
	xliff += `    <mda:metadata>\n`;
	xliff += `      <mda:metaGroup category="open_tlc_metadata">\n`;
	xliff += `        <mda:meta type="name">${escapeXml(name)}</mda:meta>\n`;
	xliff += `        <mda:meta type="checked">${escapeXml(JSON.stringify(checked))}</mda:meta>\n`;
	xliff += `        <mda:meta type="type">${escapeXml(type)}</mda:meta>\n`;
	xliff += `        <mda:meta type="type_ref">${escapeXml(JSON.stringify(typeRef))}</mda:meta>\n`;
	xliff += `        <mda:meta type="tm">${escapeXml(JSON.stringify(tm))}</mda:meta>\n`;
	xliff += `        <mda:meta type="tb">${escapeXml(JSON.stringify(tb))}</mda:meta>\n`;
	xliff += `      </mda:metaGroup>\n`;
	xliff += `    </mda:metadata>\n`;

	// Adding translation units (segments)
	for (let i = 0; i < seg1.length; i++) {
		const sourceSegment = seg1[i];
		const targetSegment = seg2[i];

		xliff += `    <unit id="${i + 1}">\n`;
		xliff += `      <segment>\n`;
		xliff += `        <source>${escapeXml(sourceSegment)}</source>\n`;
		xliff += `        <target>${escapeXml(targetSegment)}</target>\n`;
		xliff += `      </segment>\n`;
		xliff += `    </unit>\n`;
	}

	xliff += `  </file>\n`;
	xliff += `</xliff>\n`;

	return xliff;
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

// Function to trigger the XLIFF file download
async function generateXliffFileDownload(xliffData: string, name: string) {
	const blob = new Blob([xliffData], { type: "application/xliff+xml" });
	const url = URL.createObjectURL(blob);

	const a = document.createElement("a");
	a.href = url;
	a.download = `${name}.xliff`;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	URL.revokeObjectURL(url);
}

// Main function to generate and download XLIFF file from UserData
export async function generateXliffSaveFile2_0(userData: UserData) {
	try {
		// Generates the XLIFF content from UserData
		const xliffContent = generateXliff(userData);

		// Triggers download
		await generateXliffFileDownload(
			xliffContent,
			userData.translationData.name,
		);
	} catch (error) {
		console.error("Failed to generate XLIFF save file:", error);
	}
}
