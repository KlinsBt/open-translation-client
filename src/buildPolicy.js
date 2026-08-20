const DOCX_BUFFER_WARNING =
	'Module "buffer" has been externalized for browser compatibility';

/** @param {string} message */
export function isReviewedDocxBufferWarning(message) {
	return (
		message.includes(DOCX_BUFFER_WARNING) &&
		message.includes("node_modules/docx/build/index.mjs")
	);
}
