/**
 * Creates an isolated candidate, persists it, and only then returns it for
 * publication to a Svelte store. The caller's current value is never mutated.
 */
export async function commitPersistedMutation<T>(
	current: T,
	mutate: (candidate: T) => void,
	persist: (candidate: T) => Promise<void>,
): Promise<T> {
	const candidate = structuredClone(current);
	mutate(candidate);
	await persist(candidate);
	return candidate;
}

/** Restores an editor-local draft to the last transaction-confirmed snapshot. */
export function persistedSnapshot<T>(value: T): T {
	return structuredClone(value);
}
