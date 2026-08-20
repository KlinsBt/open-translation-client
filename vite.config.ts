import { defineConfig } from "vitest/config";
import { sveltekit } from "@sveltejs/kit/vite";
import { createLogger } from "vite";
import { isReviewedDocxBufferWarning } from "./src/buildPolicy.js";

const buildLogger = createLogger();
const warn = buildLogger.warn.bind(buildLogger);
buildLogger.warn = (message, options) => {
	if (isReviewedDocxBufferWarning(message)) return;
	warn(message, options);
};

export default defineConfig({
	customLogger: buildLogger,
	plugins: [sveltekit()],
	build: {
		// File and route limits are enforced with gzip-aware checks after build.
		chunkSizeWarningLimit: 1_300,
	},

	test: {
		include: ["src/**/*.{test,spec}.{js,ts}"],
		exclude: ["src/**/*.browser.spec.ts"],
		setupFiles: ["src/test/setup.ts"],
		dangerouslyIgnoreUnhandledErrors: false,
		coverage: {
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: [
				"src/lib/formats/**/*.ts",
				"src/lib/functions/parsing/**/*.ts",
				"src/lib/functions/outputGeneration/**/*.ts",
				"src/lib/functions/saveData/**/*.ts",
				"src/lib/functions/statistics.ts",
				"src/lib/functions/uiHelpers.ts",
				"src/lib/functions/productionDiagnostics.ts",
				"src/lib/components/resources/**/*.ts",
				"src/lib/components/translationMemory/tmFunctions.ts",
				"src/lib/components/termBase/tbFunctions.ts",
			],
			// Svelte views/routes are exercised by the separate real-browser suite.
			// Declarations, generated fixtures, and test modules contain no shipped
			// executable behavior and are excluded from the unit-code denominator.
			exclude: [
				"**/*.{spec,test}.ts",
				"**/*.browser.spec.ts",
				"src/lib/formats/types.ts",
				"src/lib/formats/formatIds.ts",
			],
			thresholds: {
				statements: 84,
				branches: 74,
				functions: 91,
				lines: 86,
			},
		},
	},
});
