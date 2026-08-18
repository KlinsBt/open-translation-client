import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { FORMAT_IDS } from "$lib/formats/formatIds";
import { FORMAT_ADAPTERS, getFormatAdapter } from "$lib/formats/registry";

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

	it("keeps all configured translation types connected to adapters", () => {
		expect(FORMAT_ADAPTERS.map((adapter) => adapter.id)).toEqual(FORMAT_IDS);
		for (const id of FORMAT_IDS) {
			const adapter = getFormatAdapter(id);
			expect(adapter.importFile).toBeTypeOf("function");
			expect(adapter.exportFile).toBeTypeOf("function");
		}
	});

	it("keeps application modals on the shared accessible dialog system", () => {
		const componentFiles = sourceFiles().filter((file) =>
			file.endsWith(".svelte"),
		);
		const modalHosts = componentFiles
			.map((file) => ({
				file,
				source: readFileSync(resolve(root, file), "utf8"),
			}))
			.filter(({ source }) => /<Modal\b/.test(source));

		expect(modalHosts.length).toBeGreaterThan(0);
		for (const { file, source } of modalHosts) {
			const modalTags = source.match(/<Modal\b[\s\S]*?\/>/g) ?? [];
			expect(
				modalTags,
				`${file} should render each Modal as a complete tag`,
			).not.toHaveLength(0);
			for (const tag of modalTags) {
				expect(tag, `${file} modals must expose a close action`).toContain(
					"onClose=",
				);
			}

			expect(
				source,
				`${file} must not override the shared full-screen modal backdrop`,
			).not.toMatch(/\.modal-element-global\s*\{/);
		}

		const sharedModal = readFileSync(
			resolve(root, "src/lib/components/modal.svelte"),
			"utf8",
		);
		expect(sharedModal).toContain('role="dialog"');
		expect(sharedModal).toContain('aria-modal="true"');
		expect(sharedModal).toContain("aria-label={title}");
	});
});
