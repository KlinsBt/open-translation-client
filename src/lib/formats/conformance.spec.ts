// @vitest-environment happy-dom

import { afterEach, beforeEach, vi } from "vitest";
import { FORMAT_ADAPTERS } from "./registry";
import { FORMAT_CONFORMANCE_FIXTURES } from "../../test/formatConformanceFixtures";
import { registerFormatConformanceSuite } from "../../test/formatConformanceSuite";

beforeEach(() => {
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
		clear: () => storage.clear(),
	});
});

afterEach(() => vi.unstubAllGlobals());

registerFormatConformanceSuite(FORMAT_ADAPTERS, FORMAT_CONFORMANCE_FIXTURES);
