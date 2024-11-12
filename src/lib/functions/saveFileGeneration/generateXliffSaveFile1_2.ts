import type { UserData } from "$lib/types/types";

// Function to generate the XLIFF XML string for version 1.2
function generateXliff(userData: UserData): string {
	const { translationData } = userData;
	const { name, sourceLang, targetLang, seg1, seg2, checked, type, typeRef } =
		translationData;

	// XLIFF structure for version 1.2
	let xliff = `<?xml version="1.0" encoding="UTF-8"?>\n`;
	xliff += `<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2"\n`;
	xliff += `        xmlns:sup="http://example.com/sup">\n`;
	xliff += `  <file original="" source-language="${sourceLang}" target-language="${targetLang}" datatype="plaintext">\n`;
	xliff += `    <header>\n`;
	// Adds a <group> element to contain the custom metadata and translation units
	xliff += `      <group>\n`;

	// Includes custom metadata using 'sup' namespace elements within the <group>
	xliff += `        <sup:SourceInfo>\n`;
	xliff += `          <sup:Id>${escapeXml(userData.id!.toString() ?? "")}</sup:Id>\n`;
	xliff += `          <sup:Name>${escapeXml(name)}</sup:Name>\n`;
	xliff += `          <sup:Checked>${escapeXml(JSON.stringify(checked))}</sup:Checked>\n`;
	xliff += `          <sup:Type>${escapeXml(type)}</sup:Type>\n`;
	xliff += `          <sup:TypeRef>${escapeXml(JSON.stringify(typeRef))}</sup:TypeRef>\n`;
	xliff += `        </sup:SourceInfo>\n`;
	xliff += `      </group>\n`;
	xliff += `    </header>\n`;
	xliff += `    <body>\n`;

	// Adding translation units (segments)
	for (let i = 0; i < seg1.length; i++) {
		const sourceSegment = seg1[i];
		const targetSegment = seg2[i];

		xliff += `        <trans-unit id="${i + 1}">\n`;
		xliff += `          <source>${escapeXml(sourceSegment)}</source>\n`;
		xliff += `          <target>${escapeXml(targetSegment)}</target>\n`;
		xliff += `        </trans-unit>\n`;
	}

	xliff += `    </body>\n`;
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
export async function generateXliffSaveFile1_2(userData: UserData) {
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
