import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { sveltekit } from "@sveltejs/kit/vite";
import { existsSync } from "node:fs";

const chromiumPath =
	process.env.OPEN_TLC_CHROMIUM_PATH ??
	(existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

export default defineConfig({
	cacheDir: ".svelte-kit/vite-browser-cache",
	plugins: [sveltekit()],
	test: {
		include: ["src/**/*.browser.spec.ts"],
		setupFiles: ["src/test/setup.ts"],
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
