export interface SyntheticPdfPage {
	lines?: string[];
	imageOnly?: boolean;
}

interface PdfObject {
	id: number;
	body: string;
}

function utf16Hex(value: string): string {
	let output = "";
	for (let index = 0; index < value.length; index++)
		output += value.charCodeAt(index).toString(16).padStart(4, "0");
	return output.toUpperCase();
}

function glyphMap(values: readonly string[]): Map<string, number> {
	const glyphs = new Map<string, number>();
	for (const value of values)
		for (const character of value)
			if (!glyphs.has(character)) glyphs.set(character, glyphs.size + 1);
	return glyphs;
}

function contentHex(
	value: string,
	glyphs: ReadonlyMap<string, number>,
): string {
	const characters = [...value];
	const ordered = /^[\p{Script=Arabic}\s]+$/u.test(value)
		? characters.reverse()
		: characters;
	return ordered
		.map((character) =>
			(glyphs.get(character) ?? 0).toString(16).padStart(4, "0"),
		)
		.join("")
		.toUpperCase();
}

function toUnicodeCmap(glyphs: ReadonlyMap<string, number>): string {
	const mappings = [...glyphs.entries()]
		.sort(([, first], [, second]) => first - second)
		.map(([character, code]) => {
			const source = code.toString(16).padStart(4, "0").toUpperCase();
			return `<${source}> <${utf16Hex(character)}>`;
		})
		.join("\n");
	return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${glyphs.size} beginbfchar
${mappings}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

function stream(content: string, dictionary = ""): string {
	return `<< /Length ${content.length}${dictionary ? ` ${dictionary}` : ""} >>\nstream\n${content}\nendstream`;
}

export function createSyntheticPdf(
	pages: readonly SyntheticPdfPage[],
	name = "source.pdf",
): File {
	if (!pages.length)
		throw new Error("Synthetic PDF requires at least one page.");
	const allLines = pages.flatMap((page) => page.lines ?? []);
	const glyphs = glyphMap(allLines);
	const cmap = toUnicodeCmap(glyphs);
	const objects: PdfObject[] = [
		{ id: 1, body: "" },
		{ id: 2, body: "" },
		{
			id: 3,
			body: "<< /Type /Font /Subtype /Type0 /BaseFont /OpenTLCUnicode /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>",
		},
		{
			id: 4,
			body: "<< /Type /Font /Subtype /CIDFontType2 /BaseFont /OpenTLCUnicode /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 600 /CIDToGIDMap /Identity >>",
		},
		{
			id: 5,
			body: "<< /Type /FontDescriptor /FontName /OpenTLCUnicode /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>",
		},
		{ id: 6, body: stream(cmap) },
	];
	let nextId = 7;
	const pageIds: number[] = [];
	for (const page of pages) {
		const contentId = nextId++;
		let imageId: number | undefined;
		if (page.imageOnly) imageId = nextId++;
		const pageId = nextId++;
		pageIds.push(pageId);
		const content = page.imageOnly
			? "q 100 0 0 100 72 600 cm /Im1 Do Q"
			: `BT /F1 12 Tf 72 720 Td ${(page.lines ?? [])
					.map(
						(line, index) =>
							`${index ? "0 -20 Td " : ""}<${contentHex(line, glyphs)}> Tj`,
					)
					.join(" ")} ET`;
		objects.push({ id: contentId, body: stream(content) });
		if (imageId !== undefined)
			objects.push({
				id: imageId,
				body: stream(
					"FFFFFF>",
					"/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode",
				),
			});
		objects.push({
			id: pageId,
			body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >>${imageId === undefined ? "" : ` /XObject << /Im1 ${imageId} 0 R >>`} >> /Contents ${contentId} 0 R >>`,
		});
	}
	objects[0].body = "<< /Type /Catalog /Pages 2 0 R >>";
	objects[1].body = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
	objects.sort((first, second) => first.id - second.id);
	let pdf = "%PDF-1.7\n%OpenTLC\n";
	const offsets = new Map<number, number>();
	for (const object of objects) {
		offsets.set(object.id, pdf.length);
		pdf += `${object.id} 0 obj\n${object.body}\nendobj\n`;
	}
	const xref = pdf.length;
	pdf += `xref\n0 ${nextId}\n0000000000 65535 f \n`;
	for (let id = 1; id < nextId; id++)
		pdf += `${String(offsets.get(id) ?? 0).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${nextId} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new File([pdf], name, { type: "application/pdf" });
}
