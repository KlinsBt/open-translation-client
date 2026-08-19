import JSZip from "jszip";
import * as XLSX from "xlsx";

export const VISIO_CORE_NAMESPACE =
	"http://schemas.microsoft.com/office/visio/2011/1/core";

const MAIN_TYPES: Record<string, string> = {
	vsdx: "application/vnd.ms-visio.drawing.main+xml",
	vsdm: "application/vnd.ms-visio.drawing.macroEnabled.main+xml",
	vssx: "application/vnd.ms-visio.stencil.main+xml",
	vssm: "application/vnd.ms-visio.stencil.macroEnabled.main+xml",
	vstx: "application/vnd.ms-visio.template.main+xml",
	vstm: "application/vnd.ms-visio.template.macroEnabled.main+xml",
};

export interface VisioPackageOptions {
	extension?: keyof typeof MAIN_TYPES;
	shapeText?: string;
	shapeCount?: number;
	includeMacro?: boolean;
	includeSignature?: boolean;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

export async function createVisioPackage(
	options: VisioPackageOptions = {},
): Promise<File> {
	const extension = options.extension ?? "vsdx";
	const shapeText = options.shapeText ?? "Diagram text";
	const shapeCount = options.shapeCount ?? 1;
	const macro = options.includeMacro ?? extension.endsWith("m");
	const shapes = Array.from(
		{ length: shapeCount },
		(_, index) =>
			`<Shape ID="${index + 1}" Type="Shape"><Cell N="PinX" V="${index + 1}"/><Cell N="PinY" V="${shapeCount - index}"/><Text>${escapeXml(
				shapeCount === 1 ? shapeText : `Message ${index}`,
			)}</Text></Shape>`,
	).join("");
	const zip = new JSZip();
	zip.file(
		"[Content_Types].xml",
		`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/visio/document.xml" ContentType="${MAIN_TYPES[extension]}"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/><Override PartName="/visio/masters/masters.xml" ContentType="application/vnd.ms-visio.masters+xml"/><Override PartName="/visio/masters/master1.xml" ContentType="application/vnd.ms-visio.master+xml"/></Types>`,
	);
	zip.file(
		"_rels/.rels",
		'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.microsoft.com/visio/2010/relationships/document" Target="visio/document.xml"/><Relationship Id="external" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/never-fetched" TargetMode="External"/></Relationships>',
	);
	zip.file(
		"docProps/core.xml",
		'<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Diagram title</dc:title><dc:creator>Protected author</dc:creator></cp:coreProperties>',
	);
	zip.file(
		"visio/document.xml",
		`<VisioDocument xmlns="${VISIO_CORE_NAMESPACE}"><DocumentSheet><Cell N="DocLangID" V="en-US" F="GUARD(1033)"/></DocumentSheet></VisioDocument>`,
	);
	zip.file(
		"visio/pages/pages.xml",
		`<Pages xmlns="${VISIO_CORE_NAMESPACE}"><Page ID="1" Name="Overview" NameU="Page-1"/></Pages>`,
	);
	zip.file(
		"visio/pages/page1.xml",
		`<PageContents xmlns="${VISIO_CORE_NAMESPACE}"><Shapes>${shapes}<Shape ID="999" Type="Shape"><Text>Connector label</Text><Section N="Property"><Row N="Status"><Cell N="Label" V="Approval status"/><Cell N="Value" V="Ready"/><Cell N="Prompt" V="Choose status"/><Cell N="Value" V="=NOW()" F="NOW()"/></Row></Section><Section N="Layer"><Row IX="0"><Cell N="Name" V="Workflow layer"/></Row></Section></Shape><Shape ID="1000" Type="Shape" NameU="Data Graphic"><Text>Data graphic callout</Text></Shape></Shapes><Connects><Connect FromSheet="999" ToSheet="1"/></Connects></PageContents>`,
	);
	zip.file(
		"visio/masters/masters.xml",
		`<Masters xmlns="${VISIO_CORE_NAMESPACE}"><Master ID="1" Name="Process box" NameU="Process" Prompt="Reusable box"/></Masters>`,
	);
	zip.file(
		"visio/masters/master1.xml",
		`<MasterContents xmlns="${VISIO_CORE_NAMESPACE}"><Shapes><Shape ID="1"><Text>Master text</Text><Section N="Geometry"><Row><Cell N="X" V="1" F="Width*0.5"/></Row></Section></Shape></Shapes></MasterContents>`,
	);
	zip.file("visio/media/image1.png", new Uint8Array([137, 80, 78, 71]));
	zip.file("visio/embeddings/object1.bin", new Uint8Array([1, 2, 3, 4]));
	zip.file("custom/unknown.dat", new Uint8Array([85, 78, 75, 78, 79, 87, 78]));
	if (macro)
		zip.file("visio/vbaProject.bin", new Uint8Array([86, 66, 65, 0, 1, 2]));
	if (options.includeSignature)
		zip.file("_xmlsignatures/sig1.xml", "<Signature>opaque</Signature>");
	return new File(
		[await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })],
		`diagram.${extension}`,
		{ type: "application/vnd.visio" },
	);
}

function utf16le(value: string): Uint8Array {
	const bytes = new Uint8Array(value.length * 2 + 2);
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		bytes[index * 2] = code & 0xff;
		bytes[index * 2 + 1] = code >>> 8;
	}
	return bytes;
}

export function createLegacyVisioFile(
	extension: "vsd" | "vss" | "vdw" | "vsr" = "vsd",
	text = "Legacy diagram text مرحبا",
): File {
	const cfb = XLSX.CFB.utils.cfb_new();
	XLSX.CFB.utils.cfb_add(
		cfb,
		extension === "vdw" ? "VisioServerData" : "VisioDocument",
		utf16le(text),
	);
	XLSX.CFB.utils.cfb_add(
		cfb,
		"VBA/PROJECT",
		new TextEncoder().encode("Attribute VB_Name = Dangerous"),
	);
	XLSX.CFB.utils.cfb_add(
		cfb,
		"ObjectPool/Embedded",
		new Uint8Array([1, 2, 3, 4]),
	);
	const bytes = XLSX.CFB.write(cfb, { type: "array" }) as Uint8Array;
	return new File([bytes], `legacy.${extension}`, {
		type: "application/vnd.visio",
	});
}

export function createVisioXml(
	extension: "vdx" | "vsx" | "vtx" = "vdx",
	text = "XML diagram text",
): File {
	return new File(
		[
			`<?xml version="1.0" encoding="UTF-8"?><VisioDocument xmlns="urn:schemas-microsoft-com:office:visio"><DocumentProperties><Title>XML title</Title></DocumentProperties><Masters><Master ID="1" Name="Reusable master" NameU="Master-1"><Shapes><Shape ID="1"><Text>Master text</Text></Shape></Shapes></Master></Masters><Pages><Page ID="1" Name="Main page" NameU="Page-1"><Shapes><Shape ID="1" Type="Shape"><XForm><PinX>1</PinX><PinY>2</PinY></XForm><Text>${escapeXml(text)}<cp IX="1"/> formatted<fld IX="0">PROTECTED FIELD</fld></Text><Prop><Label>Data label</Label><Value>=GUARD(1)</Value></Prop></Shape></Shapes></Page></Pages></VisioDocument>`,
		],
		`diagram.${extension}`,
		{ type: "application/xml" },
	);
}

export function createVisioReport(text = "Report description"): File {
	return new File(
		[
			`<?xml version="1.0"?><ReportDefinition><Title>Shape report</Title><Description>${escapeXml(text)}</Description><Column><ColumnHeader>Shape name</ColumnHeader><Formula>=Prop.Name</Formula></Column></ReportDefinition>`,
		],
		"report.vsr",
		{ type: "application/xml" },
	);
}
