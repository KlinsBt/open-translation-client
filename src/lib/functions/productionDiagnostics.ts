function errorCategory(error: unknown): string {
	if (error instanceof DOMException) return error.name || "DOMException";
	if (error instanceof Error) return error.name || "Error";
	return error === null ? "null" : typeof error;
}

/**
 * Reports a production failure without serializing the error, imported content,
 * application state, request payloads, or storage records.
 */
export function reportProductionError(context: string, error: unknown): void {
	console.error(`[Open TLC] ${context} (${errorCategory(error)})`);
}

/** Reports a recoverable production condition under the same redaction policy. */
export function reportProductionWarning(context: string, error: unknown): void {
	console.warn(`[Open TLC] ${context} (${errorCategory(error)})`);
}
