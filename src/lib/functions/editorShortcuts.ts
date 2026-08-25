export type EditorShortcutCommand =
	| "next-segment"
	| "previous-segment"
	| "toggle-lock"
	| "open-resources"
	| "fill-segment"
	| "split-segment"
	| "join-segments";

const COMMAND_BY_CODE: Readonly<Record<string, EditorShortcutCommand>> = {
	ArrowDown: "next-segment",
	ArrowUp: "previous-segment",
	KeyL: "toggle-lock",
	KeyM: "open-resources",
	KeyF: "fill-segment",
	KeyE: "split-segment",
	KeyJ: "join-segments",
};

const COMMAND_BY_KEY: Readonly<Record<string, EditorShortcutCommand>> = {
	arrowdown: "next-segment",
	arrowup: "previous-segment",
	l: "toggle-lock",
	m: "open-resources",
	f: "fill-segment",
	e: "split-segment",
	j: "join-segments",
};

/**
 * Resolves editor commands without relying on the translated value of
 * `KeyboardEvent.key`. `code` keeps the advertised letter shortcuts stable on
 * non-US layouts, while the key fallback supports browsers and assistive tools
 * that do not expose a physical code.
 */
export function resolveEditorShortcut(
	event: KeyboardEvent,
): EditorShortcutCommand | null {
	if (
		event.defaultPrevented ||
		event.repeat ||
		event.isComposing ||
		event.shiftKey ||
		(!event.ctrlKey && !event.metaKey) ||
		!event.altKey ||
		event.getModifierState("AltGraph")
	)
		return null;

	return (
		COMMAND_BY_CODE[event.code] ??
		COMMAND_BY_KEY[event.key.toLocaleLowerCase()] ??
		null
	);
}
