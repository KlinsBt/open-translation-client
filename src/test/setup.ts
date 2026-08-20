import {
	DOMParser as XmlDomParser,
	XMLSerializer as XmlSerializer,
} from "@xmldom/xmldom";
import { afterEach, beforeEach, vi } from "vitest";

let unexpectedStderr: string[] = [];

function readableDiagnostic(value: unknown): string {
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

beforeEach(() => {
	unexpectedStderr = [];
	for (const method of ["warn", "error"] as const)
		vi.spyOn(console, method).mockImplementation((...values: unknown[]) => {
			unexpectedStderr.push(
				`${method}: ${values.map(readableDiagnostic).join(" ")}`,
			);
		});
});

afterEach(() => {
	const diagnostics = [...unexpectedStderr];
	unexpectedStderr = [];
	if (diagnostics.length > 0)
		throw new Error(`Unexpected test stderr:\n${diagnostics.join("\n")}`);
});

if (typeof document === "undefined") {
	const values = new Map<string, string>();
	const localStorage: Storage = {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => values.delete(key),
		setItem: (key, value) => values.set(key, String(value)),
	};
	// Node 25 exposes a warning-producing localStorage getter unless a backing
	// file is configured. Tests need deterministic, process-local storage only.
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		writable: true,
		value: localStorage,
	});
	Object.assign(globalThis, {
		DOMParser: XmlDomParser,
		XMLSerializer: XmlSerializer,
	});
}
