import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";

const allowMissing = process.argv.includes("--allow-missing");
const artifactDirectory =
	process.env.OPENTLC_VALIDATOR_ARTIFACT_DIR ?? "artifacts";

const validators = [
	{
		id: "libreoffice",
		candidates: ["libreoffice"],
		versionArgs: ["--version"],
		environment: "OPENTLC_RUN_LIBREOFFICE",
		fixture:
			"Generated translated ODT, OTT, ODM, OTS, OTP, and ODF packages converted to PDF",
	},
	{
		id: "epubcheck",
		candidates: ["epubcheck"],
		versionArgs: ["--version"],
		environment: "OPENTLC_RUN_EPUBCHECK",
		fixture: "Generated translated EPUB 3 package",
	},
	{
		id: "dita-ot",
		candidates: ["dita"],
		versionArgs: ["--version"],
		environment: "OPENTLC_RUN_DITA_OT",
		fixture: "Generated translated DITA topic published to HTML5",
	},
	{
		id: "tex-engine",
		candidates: ["pdflatex"],
		versionArgs: ["--version"],
		environment: "OPENTLC_RUN_LATEX_ENGINE",
		fixture: "Generated translated LaTeX article compiled to PDF",
	},
	{
		id: "windres",
		candidates: ["windres", "x86_64-w64-mingw32-windres"],
		versionArgs: ["--version"],
		environment: "OPENTLC_RUN_WINDRES",
		fixture: "Generated translated Windows RC compiled to RES",
	},
	{
		id: "ffprobe",
		candidates: ["ffprobe"],
		versionArgs: ["-version"],
		environment: "OPENTLC_RUN_FFPROBE",
		fixture: "Generated translated ASS and Spruce STL subtitle streams",
	},
	{
		id: "pdfinfo",
		candidates: ["pdfinfo"],
		versionArgs: ["-v"],
		fixture: "Generated one-page PDF fixture before local extraction",
	},
	{
		id: "qmllint",
		candidates: ["qmllint"],
		versionArgs: ["--version"],
		fixture: "Generated translated Qt QML document",
	},
	{
		id: "xmllint",
		candidates: ["xmllint"],
		versionArgs: ["--version"],
		fixture:
			"Generated translated DITA, DocBook, ICML, SVG, and TTML XML documents with network access disabled",
	},
	{
		id: "msgfmt",
		candidates: ["msgfmt"],
		versionArgs: ["--version"],
		fixture: "Generated translated GNU gettext PO catalog compiled to MO",
	},
];

function inspectTool(validator) {
	for (const candidate of validator.candidates) {
		const inspected = spawnSync(candidate, validator.versionArgs, {
			encoding: "utf8",
			timeout: 10_000,
		});
		if (inspected.status === 0) {
			const version = `${inspected.stdout ?? ""}\n${inspected.stderr ?? ""}`
				.trim()
				.split(/\r?\n/)
				.find(Boolean);
			return {
				id: validator.id,
				command: [candidate, ...validator.versionArgs],
				version: version ?? "Version command returned no text",
				fixture: validator.fixture,
				status: "available",
			};
		}
	}
	return {
		id: validator.id,
		command: [validator.candidates.join(" or "), ...validator.versionArgs],
		version: null,
		fixture: validator.fixture,
		status: "missing",
	};
}

function operatingSystem() {
	let distribution = null;
	try {
		distribution = readFileSync("/etc/os-release", "utf8")
			.split(/\r?\n/)
			.find((line) => line.startsWith("PRETTY_NAME="))
			?.slice("PRETTY_NAME=".length)
			.replace(/^"|"$/g, "");
	} catch {
		// Non-Linux runners still report the Node platform and kernel below.
	}
	return {
		platform: platform(),
		release: release(),
		architecture: arch(),
		distribution,
	};
}

const inspectedValidators = validators.map(inspectTool);
const missing = inspectedValidators.filter((tool) => tool.status === "missing");
const enabledEnvironment = {};
for (const validator of validators) {
	if (
		validator.environment &&
		inspectedValidators.some(
			(tool) => tool.id === validator.id && tool.status === "available",
		)
	)
		enabledEnvironment[validator.environment] = "1";
}

const testFiles = [
	"src/lib/formats/odf.spec.ts",
	"src/lib/formats/epub.spec.ts",
	"src/lib/formats/dita.spec.ts",
	"src/lib/formats/latex.spec.ts",
	"src/lib/formats/windowsRc.spec.ts",
	"src/lib/formats/ff509.spec.ts",
	"src/lib/formats/pdf.spec.ts",
	"src/lib/formats/qml.spec.ts",
	"src/lib/formats/idml.spec.ts",
	"src/lib/formats/svg.spec.ts",
	"src/lib/formats/ttml.spec.ts",
	"src/lib/formats/docbook.spec.ts",
	"src/lib/formats/poFamily.spec.ts",
];
const testArguments = [
	"run",
	"test:unit",
	"--",
	"--run",
	"--testTimeout=120000",
	...testFiles,
];
const tested = spawnSync("npm", testArguments, {
	encoding: "utf8",
	env: { ...process.env, ...enabledEnvironment },
	maxBuffer: 50 * 1024 * 1024,
	timeout: 10 * 60_000,
});
process.stdout.write(tested.stdout ?? "");
process.stderr.write(tested.stderr ?? "");

const report = {
	createdAt: new Date().toISOString(),
	operatingSystem: operatingSystem(),
	mode: allowMissing ? "available-tools-audit" : "strict-release-gate",
	status:
		tested.status === 0 && missing.length === 0
			? "passed"
			: tested.status === 0 && allowMissing
				? "incomplete"
				: "failed",
	validators: inspectedValidators,
	test: {
		command: ["npm", ...testArguments],
		exitCode: tested.status,
		signal: tested.signal,
		files: testFiles,
	},
};
mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(
	join(artifactDirectory, "external-validator-report.json"),
	`${JSON.stringify(report, null, 2)}\n`,
);
writeFileSync(
	join(artifactDirectory, "external-validator.log"),
	`${tested.stdout ?? ""}${tested.stderr ?? ""}`,
);

for (const tool of inspectedValidators)
	console.log(
		`${tool.status === "available" ? "PASS" : "MISS"} ${tool.id}: ${tool.version ?? tool.command[0]}`,
	);
console.log(
	`External validator report: ${join(artifactDirectory, "external-validator-report.json")}`,
);

if (tested.status !== 0) process.exit(tested.status ?? 1);
if (missing.length > 0 && !allowMissing) {
	console.error(
		`Strict external validation requires: ${missing.map((tool) => tool.id).join(", ")}`,
	);
	process.exit(1);
}
