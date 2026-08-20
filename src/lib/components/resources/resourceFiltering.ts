export interface FilteredResource<T> {
	item: T;
	sourceIndex: number;
}

export function filterWithSourceIndexes<T>(
	items: readonly T[],
	predicate: (item: T) => boolean,
): FilteredResource<T>[] {
	return items.flatMap((item, sourceIndex) =>
		predicate(item) ? [{ item, sourceIndex }] : [],
	);
}
