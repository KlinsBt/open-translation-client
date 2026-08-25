import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { sveltekit } from "@sveltejs/kit/vite";
import { existsSync } from "node:fs";
import { isolatePdfJsWorkerImport } from "./src/test/runtimeWarningPolicy.ts";

const chromiumPath =
	process.env.OPEN_TLC_CHROMIUM_PATH ??
	(existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
const supportedBrowsers = ["chromium", "firefox", "webkit"] as const;
type SupportedBrowser = (typeof supportedBrowsers)[number];
const requestedBrowsers = (process.env.OPEN_TLC_BROWSERS ?? "chromium")
	.split(",")
	.map((browser) => browser.trim())
	.filter(Boolean);
const unknownBrowsers = requestedBrowsers.filter(
	(browser) => !supportedBrowsers.includes(browser as SupportedBrowser),
);
if (unknownBrowsers.length > 0)
	throw new Error(
		`Unsupported browser test target: ${unknownBrowsers.join(", ")}`,
	);
const browserInstances = requestedBrowsers.map((browser) => ({
	browser: browser as SupportedBrowser,
	// Vitest pages in one browser instance share the same origin and therefore
	// the same IndexedDB database. WebKit aborts concurrent transactions that
	// clone retained Blob/package resources across those pages. Keep its files
	// sequential so the matrix exercises the real persistence path reliably;
	// Chromium and Firefox can retain their faster parallel execution.
	fileParallelism: browser !== "webkit",
	...(browser === "chromium" && chromiumPath
		? {
				provider: playwright({
					launchOptions: {
						executablePath: chromiumPath,
						args: ["--no-sandbox", "--disable-dev-shm-usage"],
					},
				}),
			}
		: {}),
}));

export default defineConfig({
	cacheDir: ".svelte-kit/vite-browser-cache",
	optimizeDeps: {
		exclude: ["pdfjs-dist", "pdfjs-dist/legacy/build/pdf.mjs"],
	},
	plugins: [
		{
			name: "isolate-pdfjs-runtime-worker-import",
			enforce: "pre",
			transform(code, id) {
				const transformed = isolatePdfJsWorkerImport(code, id);
				return transformed === undefined
					? null
					: { code: transformed, map: null };
			},
		},
		sveltekit(),
	],
	test: {
		include: ["src/**/*.browser.spec.ts"],
		setupFiles: ["src/test/setup.ts"],
		dangerouslyIgnoreUnhandledErrors: false,
		teardownTimeout: 10_000,
		browser: {
			enabled: true,
			provider: playwright(),
			instances: browserInstances,
			headless: true,
			api: { host: "127.0.0.1", port: 63315 },
		},
	},
});
