import {
	DOMParser as XmlDomParser,
	XMLSerializer as XmlSerializer,
} from "@xmldom/xmldom";

if (typeof document === "undefined") {
	Object.assign(globalThis, {
		DOMParser: XmlDomParser,
		XMLSerializer: XmlSerializer,
	});
}
