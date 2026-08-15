import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function sourceFiles(): string[] {
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const absolute = resolve(directory, entry.name);
			if (entry.isDirectory()) {
				walk(absolute);
			} else {
				files.push(relative(root, absolute));
			}
		}
	};
	walk(resolve(root, "src"));
	return files.filter((file) => !file.includes("/uploads/unused/"));
}

describe("repository consistency", () => {
	it("contains no empty shipped source files", () => {
		const empty = sourceFiles().filter(
			(file) => statSync(resolve(root, file)).size === 0,
		);
		expect(empty).toEqual([]);
	});

	it("contains no unresolved merge-conflict markers", () => {
		const conflicts = sourceFiles().filter((file) => {
			if (!/\.(?:ts|svelte|css|html)$/.test(file)) return false;
			return /^(?:<{7}|={7}|>{7})/m.test(
				readFileSync(resolve(root, file), "utf8"),
			);
		});
		expect(conflicts).toEqual([]);
	});

	it("has route modules for every page component", () => {
		const files = sourceFiles();
		const missing = files
			.filter((file) => file.endsWith("+page.svelte"))
			.map((file) => file.replace(/\.svelte$/, ".ts"))
			.filter((file) => !files.includes(file));
		expect(missing).toEqual([]);
	});

	it("keeps all configured translation types connected to export handlers", () => {
		const types = readFileSync(resolve(root, "src/lib/types/types.ts"), "utf8");
		const dispatcher = readFileSync(
			resolve(
				root,
				"src/lib/functions/outputGeneration/handleTranslationExport.ts",
			),
			"utf8",
		);
		const match = types.match(/export type Type = ([^;]+);/);
		expect(match).not.toBeNull();
		const configuredTypes = Array.from(
			match![1].matchAll(/"([^"]+)"/g),
			(item) => item[1],
		);
		const missing = configuredTypes.filter(
			(type) => !dispatcher.includes(`translationData.type === "${type}"`),
		);
		expect(missing).toEqual([]);
	});
});
