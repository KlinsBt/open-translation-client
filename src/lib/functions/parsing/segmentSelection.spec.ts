// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { getSplitOffsetFromSelection } from "./segmentSelection";

function selectRange(
	startNode: Node,
	startOffset: number,
	endNode: Node,
	endOffset: number,
) {
	const selection = window.getSelection()!;
	const range = document.createRange();
	range.setStart(startNode, startOffset);
	range.setEnd(endNode, endOffset);
	selection.removeAllRanges();
	selection.addRange(range);
	return selection;
}

describe("segment source selection", () => {
	it("returns a split offset only when the selection stays in one container", () => {
		const first = document.createElement("p");
		const second = document.createElement("p");
		first.textContent = "First segment";
		second.textContent = "Second segment";
		document.body.append(first, second);

		const inside = selectRange(first.firstChild!, 0, first.firstChild!, 5);
		expect(getSplitOffsetFromSelection(first, inside, 13)).toBe(5);

		const acrossRows = selectRange(first.firstChild!, 6, second.firstChild!, 6);
		expect(getSplitOffsetFromSelection(second, acrossRows, 14)).toBeNull();
		expect(getSplitOffsetFromSelection(first, acrossRows, 13)).toBeNull();
	});

	it("rejects offsets at either edge", () => {
		const container = document.createElement("p");
		container.textContent = "Segment";
		document.body.append(container);
		const node = container.firstChild!;

		expect(
			getSplitOffsetFromSelection(container, selectRange(node, 0, node, 0), 7),
		).toBeNull();
		expect(
			getSplitOffsetFromSelection(container, selectRange(node, 7, node, 7), 7),
		).toBeNull();
	});
});
