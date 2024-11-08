import type { UserData } from "$lib/types/types";

async function generateHtmlFileDownload(htmlContent: string, name: string) {
	const blob: Blob = new Blob([htmlContent], {
		type: "text/html",
	});

	const url: string = URL.createObjectURL(blob);
	const a: HTMLAnchorElement = document.createElement("a");
	a.href = url;
	a.download = `${name}.html`;

	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);

	URL.revokeObjectURL(url);
}

export async function createHtmlFromModifiedText(translation: UserData) {
	let originalHtmlContent = translation.translationData.typeRef as string;
	console.log("html: ", originalHtmlContent);
	const updatedHtmlContent = replaceTextStrings(
		originalHtmlContent,
		translation.translationData.seg2,
	);
	await generateHtmlFileDownload(
		updatedHtmlContent,
		translation.translationData.name,
	);
}

function replaceTextStrings(htmlContent: string, textArray: string[]): string {
	const parser = new DOMParser();
	const doc = parser.parseFromString(htmlContent, "text/html");
	let index = 0;

	function replaceTextNodes(element: Node) {
		if (element.nodeType === Node.TEXT_NODE && index < textArray.length) {
			const text = element.textContent?.trim();
			if (text) {
				element.textContent = textArray[index++] || "";
			}
		} else if (
			element.nodeType === Node.ELEMENT_NODE &&
			index < textArray.length
		) {
			const el = element as HTMLElement;
			const attributesToCheck = ["placeholder", "value", "alt", "title"];
			attributesToCheck.forEach((attr) => {
				const attrValue = el.getAttribute(attr);
				if (attrValue && attrValue.trim()) {
					el.setAttribute(attr, textArray[index++] || "");
				}
			});
			element.childNodes.forEach((child) => replaceTextNodes(child));
		}
	}

	replaceTextNodes(doc.body);

	const serializer = new XMLSerializer();
	return serializer.serializeToString(doc);
}
