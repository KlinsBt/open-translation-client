export function getSplitOffsetFromSelection(
	container: HTMLElement,
	selection: Selection | null,
	textLength: number,
): number | null {
	if (!selection || selection.rangeCount !== 1) return null;

	const anchorNode = selection.anchorNode;
	const focusNode = selection.focusNode;
	const range = selection.getRangeAt(0);
	if (
		!anchorNode ||
		!focusNode ||
		!container.contains(anchorNode) ||
		!container.contains(focusNode) ||
		!container.contains(range.startContainer) ||
		!container.contains(range.endContainer)
	) {
		return null;
	}

	const rangeToCaret = document.createRange();
	rangeToCaret.selectNodeContents(container);
	try {
		rangeToCaret.setEnd(focusNode, selection.focusOffset);
	} catch {
		return null;
	}

	const offset = rangeToCaret.toString().length;
	return offset > 0 && offset < textLength ? offset : null;
}
