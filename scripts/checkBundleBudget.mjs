import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CLIENT_ROOT = ".svelte-kit/output/client";
const MANIFEST_PATH = join(CLIENT_ROOT, ".vite/manifest.json");
const BUDGET_PATH = "bundle-budget.json";

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
const budget = JSON.parse(readFileSync(BUDGET_PATH, "utf8"));

const sharedRoots = [
	".svelte-kit/generated/client-optimized/app.js",
	"node_modules/@sveltejs/kit/src/runtime/client/entry.js",
	".svelte-kit/generated/client-optimized/nodes/0.js",
];
const routes = {
	landing: [3, 7],
	about: [3, 8],
	app: [2, 6],
	termBase: [4, 9],
	translationMemory: [5, 10],
};
const deferredModules = [
	"node_modules/@huggingface/transformers/dist/transformers.web.js",
	"node_modules/tesseract.js/src/index.js",
];
const deferredAssetFragments = ["ort-wasm-simd-threaded"];

function nodeKey(id) {
	return `.svelte-kit/generated/client-optimized/nodes/${id}.js`;
}

function staticClosure(keys) {
	const entries = new Set();
	const files = new Set();
	const visit = (key) => {
		if (entries.has(key)) return;
		const entry = manifest[key];
		if (!entry) throw new Error(`Bundle manifest entry is missing: ${key}`);
		entries.add(key);
		files.add(entry.file);
		for (const css of entry.css ?? []) files.add(css);
		for (const imported of entry.imports ?? []) visit(imported);
	};
	for (const key of keys) visit(key);
	return { entries, files };
}

const fileMetrics = new Map();
function metrics(file) {
	if (!fileMetrics.has(file)) {
		const bytes = readFileSync(join(CLIENT_ROOT, file));
		fileMetrics.set(file, {
			raw: bytes.byteLength,
			gzip: gzipSync(bytes, { level: 9 }).byteLength,
		});
	}
	return fileMetrics.get(file);
}

function total(files) {
	let raw = 0;
	let gzip = 0;
	for (const file of files) {
		const value = metrics(file);
		raw += value.raw;
		gzip += value.gzip;
	}
	return { raw, gzip };
}

function assertMaximum(label, actual, maximum, failures) {
	if (actual > maximum)
		failures.push(`${label}: ${actual} bytes exceeds ${maximum} bytes`);
}

const failures = [];
const routeRows = [];
for (const [name, nodeIds] of Object.entries(routes)) {
	const closure = staticClosure([
		...sharedRoots,
		...nodeIds.map((id) => nodeKey(id)),
	]);
	const measured = total(closure.files);
	const limit = budget.routes[name];
	assertMaximum(`${name} raw route`, measured.raw, limit.maxRawBytes, failures);
	assertMaximum(
		`${name} gzip route`,
		measured.gzip,
		limit.maxGzipBytes,
		failures,
	);
	for (const deferred of deferredModules)
		if (closure.entries.has(deferred))
			failures.push(`${name} statically downloads deferred engine ${deferred}`);
	for (const key of closure.entries)
		for (const asset of manifest[key].assets ?? [])
			if (deferredAssetFragments.some((fragment) => asset.includes(fragment)))
				failures.push(`${name} statically references deferred asset ${asset}`);
	routeRows.push({ route: name, raw: measured.raw, gzip: measured.gzip });
}

for (const deferred of deferredModules) {
	const entry = manifest[deferred];
	if (!entry?.isDynamicEntry)
		failures.push(`${deferred} is not emitted as a dynamic entry`);
}

for (const [key, entry] of Object.entries(manifest)) {
	if (!entry.file.startsWith("_app/immutable/")) continue;
	const measured = metrics(entry.file);
	if (entry.file.endsWith(".js")) {
		const dynamic = entry.isDynamicEntry === true;
		assertMaximum(
			`${entry.file} ${dynamic ? "dynamic" : "static"} raw chunk`,
			measured.raw,
			dynamic
				? budget.files.maxDynamicChunkRawBytes
				: budget.files.maxStaticChunkRawBytes,
			failures,
		);
		assertMaximum(
			`${entry.file} ${dynamic ? "dynamic" : "static"} gzip chunk`,
			measured.gzip,
			dynamic
				? budget.files.maxDynamicChunkGzipBytes
				: budget.files.maxStaticChunkGzipBytes,
			failures,
		);
	}
	for (const asset of entry.assets ?? []) {
		const assetMetrics = metrics(asset);
		assertMaximum(
			`${asset} raw asset`,
			assetMetrics.raw,
			budget.files.maxAssetRawBytes,
			failures,
		);
		assertMaximum(
			`${asset} gzip asset`,
			assetMetrics.gzip,
			budget.files.maxAssetGzipBytes,
			failures,
		);
	}
}

console.table(routeRows);
if (failures.length > 0)
	throw new Error(`Bundle budget failed:\n- ${failures.join("\n- ")}`);
console.log("Bundle budgets and deferred-engine boundaries passed.");
