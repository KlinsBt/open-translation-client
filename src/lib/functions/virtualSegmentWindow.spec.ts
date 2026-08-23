import { describe, expect, it } from "vitest";
import { VirtualSegmentSizeIndex } from "./virtualSegmentWindow";

describe("VirtualSegmentSizeIndex", () => {
	it("maps offsets and measured variable row heights", () => {
		const index = new VirtualSegmentSizeIndex(4, 100);
		expect(index.offsetFor(3)).toBe(300);
		expect(index.indexAtOffset(299)).toBe(2);
		expect(index.update(1, 240)).toBe(true);
		expect(index.offsetFor(2)).toBe(340);
		expect(index.indexAtOffset(339)).toBe(1);
		expect(index.indexAtOffset(340)).toBe(2);
		expect(index.totalSize()).toBe(540);
	});

	it("keeps the mounted window bounded for a very large project", () => {
		const index = new VirtualSegmentSizeIndex(250_000, 120);
		const nearEnd = index.rangeForViewport(index.totalSize() - 900, 900, 12);
		expect(nearEnd.end).toBe(250_000);
		expect(nearEnd.end - nearEnd.start).toBeLessThanOrEqual(160);

		const oversizedViewport = index.rangeForViewport(0, 100_000, 12, 160);
		expect(oversizedViewport.end - oversizedViewport.start).toBe(160);
	});

	it("invalidates shifted measurements at split and join boundaries", () => {
		const index = new VirtualSegmentSizeIndex(3, 100);
		index.update(0, 175);
		index.update(1, 240);
		index.update(2, 360);
		index.resize(4);
		index.resetFrom(1);
		expect(index.sizeAt(0)).toBe(175);
		expect(index.sizeAt(1)).toBe(100);
		expect(index.sizeAt(2)).toBe(100);
		expect(index.sizeAt(3)).toBe(100);
		expect(index.offsetFor(4)).toBe(475);

		index.update(1, 220);
		index.update(2, 330);
		index.resize(2);
		index.resetFrom(1);
		expect(index.sizeAt(0)).toBe(175);
		expect(index.sizeAt(1)).toBe(100);
		expect(index.totalSize()).toBe(275);
	});

	it("handles empty projects and rejects invalid defaults", () => {
		const empty = new VirtualSegmentSizeIndex(0, 100);
		expect(empty.rangeForViewport(0, 500)).toEqual({ start: 0, end: 0 });
		expect(empty.totalSize()).toBe(0);
		expect(() => new VirtualSegmentSizeIndex(1, 0)).toThrow(/positive/i);
	});
});
