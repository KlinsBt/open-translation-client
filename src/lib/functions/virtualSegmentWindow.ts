export type VirtualSegmentRange = {
	start: number;
	end: number;
};

/**
 * A compact Fenwick-tree-backed size index for variable-height editor rows.
 * It keeps scroll-offset lookups logarithmic even for very large projects.
 */
export class VirtualSegmentSizeIndex {
	readonly defaultSize: number;
	private sizes = new Float64Array(0);
	private tree = new Float64Array(1);

	constructor(count: number, defaultSize: number) {
		if (!Number.isFinite(defaultSize) || defaultSize <= 0)
			throw new RangeError("The default segment size must be positive.");
		this.defaultSize = defaultSize;
		this.resize(count);
	}

	get count(): number {
		return this.sizes.length;
	}

	resize(count: number): void {
		const nextCount = Math.max(0, Math.floor(count));
		const previous = this.sizes;
		this.sizes = new Float64Array(nextCount);
		this.sizes.fill(this.defaultSize);
		this.sizes.set(previous.subarray(0, Math.min(previous.length, nextCount)));
		this.rebuildTree();
	}

	/** Reset measurements at and after a structural edit boundary. Rows before
	 * the boundary retain their identity; split/join shifts every row after it. */
	resetFrom(index: number): void {
		const start = Math.max(0, Math.min(this.count, Math.floor(index)));
		this.sizes.fill(this.defaultSize, start);
		this.rebuildTree();
	}

	private rebuildTree(): void {
		this.tree = new Float64Array(this.count + 1);
		for (let index = 1; index <= this.count; index += 1) {
			this.tree[index] += this.sizes[index - 1];
			const parent = index + (index & -index);
			if (parent <= this.count) this.tree[parent] += this.tree[index];
		}
	}

	sizeAt(index: number): number {
		return this.sizes[index] ?? this.defaultSize;
	}

	update(index: number, measuredSize: number): boolean {
		if (index < 0 || index >= this.count) return false;
		const nextSize = Math.max(1, measuredSize);
		const previousSize = this.sizes[index];
		if (Math.abs(previousSize - nextSize) < 0.5) return false;
		this.sizes[index] = nextSize;
		const delta = nextSize - previousSize;
		for (
			let cursor = index + 1;
			cursor <= this.count;
			cursor += cursor & -cursor
		)
			this.tree[cursor] += delta;
		return true;
	}

	offsetFor(index: number): number {
		let cursor = Math.max(0, Math.min(this.count, Math.floor(index)));
		let total = 0;
		while (cursor > 0) {
			total += this.tree[cursor];
			cursor -= cursor & -cursor;
		}
		return total;
	}

	totalSize(): number {
		return this.offsetFor(this.count);
	}

	indexAtOffset(offset: number): number {
		if (this.count === 0) return 0;
		const target = Math.max(0, Math.min(offset, this.totalSize() - 1));
		let index = 0;
		let accumulated = 0;
		let bit = 1;
		while (bit * 2 <= this.count) bit *= 2;

		for (; bit > 0; bit = Math.floor(bit / 2)) {
			const next = index + bit;
			if (next <= this.count && accumulated + this.tree[next] <= target) {
				index = next;
				accumulated += this.tree[next];
			}
		}
		return Math.min(index, this.count - 1);
	}

	rangeForViewport(
		scrollTop: number,
		viewportHeight: number,
		overscan = 8,
		maximumRows = 160,
	): VirtualSegmentRange {
		if (this.count === 0) return { start: 0, end: 0 };
		const safeTop = Math.max(0, scrollTop);
		const safeHeight = Math.max(1, viewportHeight);
		const firstVisible = this.indexAtOffset(safeTop);
		const lastVisible = this.indexAtOffset(safeTop + safeHeight);
		let start = Math.max(0, firstVisible - Math.max(0, overscan));
		let end = Math.min(this.count, lastVisible + Math.max(0, overscan) + 1);

		if (end - start > maximumRows) {
			start = Math.max(0, firstVisible - Math.floor(maximumRows / 4));
			end = Math.min(this.count, start + maximumRows);
			start = Math.max(0, end - maximumRows);
		}
		return { start, end };
	}
}
