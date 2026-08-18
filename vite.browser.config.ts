import { defineConfig } from "vitest/config";
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
			name: "chromium",
			provider: "playwright",
			headless: true,
			api: { host: "127.0.0.1", port: 63315 },
			providerOptions: {
				launch: {
					...(chromiumPath ? { executablePath: chromiumPath } : {}),
					args: ["--no-sandbox", "--disable-dev-shm-usage"],
				},
			},
		},
	},
});
