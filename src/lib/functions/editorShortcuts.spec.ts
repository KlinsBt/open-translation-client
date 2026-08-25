// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import {
	resolveEditorShortcut,
	type EditorShortcutCommand,
} from "./editorShortcuts";

function keydown(
	code: string,
	key: string,
	overrides: KeyboardEventInit & { altGraph?: boolean } = {},
): KeyboardEvent {
	const event = new KeyboardEvent("keydown", {
		code,
		key,
		ctrlKey: true,
		altKey: true,
		cancelable: true,
		...overrides,
	});
	Object.defineProperty(event, "getModifierState", {
		value: (modifier: string) =>
			modifier === "AltGraph" && overrides.altGraph === true,
	});
	return event;
}

describe("editor keyboard shortcuts", () => {
	it.each<[string, string, EditorShortcutCommand]>([
		["ArrowDown", "ArrowDown", "next-segment"],
		["ArrowUp", "ArrowUp", "previous-segment"],
		["KeyL", "l", "toggle-lock"],
		["KeyM", "m", "open-resources"],
		["KeyF", "f", "fill-segment"],
		["KeyE", "e", "split-segment"],
		["KeyJ", "j", "join-segments"],
	])("maps %s to %s", (code, key, command) => {
		expect(resolveEditorShortcut(keydown(code, key))).toBe(command);
	});

	it("supports Cmd+Option and the key fallback", () => {
		expect(
			resolveEditorShortcut(
				keydown("", "m", { ctrlKey: false, metaKey: true }),
			),
		).toBe("open-resources");
	});

	it("uses physical codes when a keyboard layout changes the key value", () => {
		expect(resolveEditorShortcut(keydown("KeyF", "ƒ"))).toBe("fill-segment");
	});

	it("does not steal normal editing, AltGr, IME, shifted, repeated, or handled keys", () => {
		expect(
			resolveEditorShortcut(
				keydown("KeyF", "f", { ctrlKey: true, altKey: false }),
			),
		).toBeNull();
		expect(
			resolveEditorShortcut(keydown("KeyE", "€", { altGraph: true })),
		).toBeNull();
		expect(
			resolveEditorShortcut(keydown("KeyF", "f", { isComposing: true })),
		).toBeNull();
		expect(
			resolveEditorShortcut(keydown("KeyF", "F", { shiftKey: true })),
		).toBeNull();
		expect(
			resolveEditorShortcut(keydown("KeyF", "f", { repeat: true })),
		).toBeNull();
		const handled = keydown("KeyF", "f");
		handled.preventDefault();
		expect(resolveEditorShortcut(handled)).toBeNull();
	});

	it("ignores unadvertised Ctrl/Cmd+Alt combinations", () => {
		expect(resolveEditorShortcut(keydown("KeyZ", "z"))).toBeNull();
	});
});
