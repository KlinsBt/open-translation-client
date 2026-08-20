import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { sveltekit } from "@sveltejs/kit/vite";
import { existsSync } from "node:fs";
import { isolatePdfJsWorkerImport } from "./src/test/runtimeWarningPolicy.ts";

const chromiumPath =
	process.env.OPEN_TLC_CHROMIUM_PATH ??
	(existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

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
			provider: playwright({
				launchOptions: {
					...(chromiumPath ? { executablePath: chromiumPath } : {}),
					args: ["--no-sandbox", "--disable-dev-shm-usage"],
				},
			}),
			instances: [{ browser: "chromium" }],
			headless: true,
			api: { host: "127.0.0.1", port: 63315 },
		},
	},
});
