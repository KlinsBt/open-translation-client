<script lang="ts">
	import bg from "$lib/images/bg14.jpg";

	const featureCards = [
		{
			title: "Format-aware round trips",
			text: "Translate office, web, software-localization, publishing, technical-authoring and subtitle files while preserving the structure each format needs.",
		},
		{
			title: "CAT interoperability",
			text: "Exchange standard and vendor XLIFF projects, edit TTX, ITD, TXML and Workbench bilingual files, and work with TMX memories and TBX terminology.",
		},
		{
			title: "Translation-focused QA",
			text: "Protect inline codes and placeholders, keep segment metadata intact, and use split and join workflows built for editable bilingual content.",
		},
		{
			title: "Local-first projects",
			text: "Projects are stored in your browser's IndexedDB instead of being uploaded to an Open TLC server. Export backups whenever you need them.",
		},
		{
			title: "Configurable extraction",
			text: "Choose what to translate in structured formats, including JSON, YAML, XML, HTML, Markdown and software resource files.",
		},
		{
			title: "Defensive file handling",
			text: "Content-based detection, XML safeguards, archive limits and format-specific validation help reject unsafe or misleading input early.",
		},
	];

	const formatGroups = [
		{
			title: "Office and web",
			formats: [
				"DOCX / XLSX / PPTX / SLDX",
				"Legacy DOC / DOT / BAK",
				"XLS / XLT / XLSB",
				"PPT / PPS / POT",
				"SpreadsheetML 2003 XML",
				"RTF",
				"ODT / OTT / ODM / ODS / OTS / ODP / OTP / ODF Formula",
				"HTML / XHTML / server pages",
				"SHTML / JSP / ASP.NET / PHP templates",
				"HTML Help contents and indexes",
			],
		},
		{
			title: "Software localization",
			formats: [
				"JSON / ARB / locJSON",
				"YAML",
				"PO / POT",
				"Android XML",
				"Apple localization",
				"RESX",
				"Qt TS / QML",
			],
		},
		{
			title: "Publishing and technical",
			formats: [
				"EPUB",
				"Visio VSDX / VSDM / VSSX / VSSM / VSTX / VSTM",
				"Visio VDX / VSX / VTX and protected legacy VSD / VSS / VDW",
				"DITA",
				"DocBook",
				"IDML / ICML / INX",
				"FrameMaker MIF / MIF2",
				"QuarkXPress XTG / TAG",
				"TeX / LaTeX",
				"SVG",
				"TTML",
			],
		},
		{
			title: "Text and interchange",
			formats: [
				"TXT / CSV / TSV",
				"XML + ITS 2.0",
				"Markdown / AsciiDoc",
				"SRT / WebVTT / SBV",
				"XLIFF 1.2 / 2.x",
				"SDLXLIFF / MQXLIFF / MXLIFF / WsXLIFF / WPML / XLIFF:doc",
				"TTX / ITD / TXML / Workbench bilingual",
				"TMX / TBX",
			],
		},
		{
			title: "Local extraction and packages",
			formats: [
				"PNG / JPEG / TIFF OCR",
				"Photoshop PSD text layers to SVG",
				"Audio and video transcription",
				"Trados return packages",
				"WorldServer WSXZ / XLZ packages",
				"memoQ return packages",
				"STAR Transit PXF / PPF handoffs",
				"TIPP request / response packages",
				"COTI packages",
				"Manifest ZIP projects",
			],
		},
	];
</script>

<svelte:head>
	<title>Open TLC — Open source browser-based CAT tool</title>
	<meta
		name="description"
		content="Translate 41 office, web, software-localization, media, diagram and publishing format workflows with a local-first open source CAT tool."
	/>
</svelte:head>

<main class="landing-page">
	<section class="hero">
		<img class="hero-background" src={bg} alt="" aria-hidden="true" />
		<div class="hero-content">
			<p class="eyebrow">Open source · browser based · local first</p>
			<h1>Translation work belongs in your hands.</h1>
			<p class="hero-copy">
				Open TLC is a computer-assisted translation tool for translators,
				students and teams. Work with 41 registered format workflows, protect
				inline content, and keep projects on your own device.
			</p>
			<div class="hero-actions">
				<a href="/app" class="button button-primary">Start translating</a>
				<a href="/about#source-formats" class="button button-secondary"
					>Explore format support</a
				>
			</div>
		</div>
	</section>

	<section class="status-strip" aria-label="Open TLC highlights">
		<div><strong>41</strong><span>registered format workflows</span></div>
		<div>
			<strong>1.2–2.1</strong><span>standard + vendor XLIFF exchange</span>
		</div>
		<div><strong>TMX + TBX</strong><span>memory and terminology</span></div>
		<div><strong>Local</strong><span>IndexedDB project storage</span></div>
	</section>

	<section class="content-section intro-section">
		<div class="section-heading">
			<p class="eyebrow dark">A capable translation workspace</p>
			<h2>Built around the file, not just the words</h2>
			<p>
				Each format has its own extraction, validation and export rules. Open
				TLC uses dedicated adapters so translatable text can move through the
				editor without losing the structure around it.
			</p>
		</div>

		<div class="feature-grid">
			{#each featureCards as feature}
				<article class="feature-card">
					<h3>{feature.title}</h3>
					<p>{feature.text}</p>
				</article>
			{/each}
		</div>
	</section>

	<section class="formats-section" id="formats">
		<div class="content-section formats-inner">
			<div class="section-heading light">
				<p class="eyebrow">Broad format coverage</p>
				<h2>From documents to localization resources</h2>
				<p>
					Use native round trips where the format permits them, return-package
					workflows for CAT handoffs, and clearly labelled derived output where
					a source format cannot be recreated faithfully.
				</p>
			</div>

			<div class="format-grid">
				{#each formatGroups as group}
					<article class="format-card">
						<h3>{group.title}</h3>
						<ul>
							{#each group.formats as format}
								<li>{format}</li>
							{/each}
						</ul>
					</article>
				{/each}
			</div>
			<a class="text-link light-link" href="/about#source-formats"
				>See capabilities and constraints →</a
			>
		</div>
	</section>

	<section class="content-section constraints-section">
		<div class="constraint-copy">
			<p class="eyebrow dark">Clear boundaries</p>
			<h2>Honest support is safer support</h2>
			<p>
				PDF remains source-only. RTF and XLS round-trip locally; legacy DOC and
				PPT are imported in the browser and exported to DOCX and HTML. CAT
				packages are rebuilt as return packages. Modern Visio drawings, stencils
				and templates retain their exact family; edited legacy Visio binaries
				use an explicit VDX delivery. INX, MIF/MIF2 and XPress Tags preserve
				their structured text. PSD imports validated text layers and delivers
				translated SVG while retaining the exact original PSD. Image OCR and
				media transcription run on-device—the app downloads model assets, never
				the source file to a processing service.
			</p>
			<a class="text-link" href="/about#constrained-workflows"
				>Read the support policy →</a
			>
		</div>
		<aside class="local-card">
			<span class="local-mark" aria-hidden="true">✓</span>
			<h3>Your project stays local</h3>
			<p>
				Open TLC stores project data in the current browser. Regular project
				exports give you portable backups and let you move work between devices.
			</p>
		</aside>
	</section>

	<section class="contribution-section">
		<div>
			<p class="eyebrow">Made in the open</p>
			<h2>Help shape a CAT tool for everyone</h2>
			<p>
				Contribute code, test real-world files, improve documentation, or report
				a format that needs more attention.
			</p>
		</div>
		<a
			class="button button-secondary"
			href="https://github.com/KlinsBt/open-translation-client"
			target="_blank"
			rel="noreferrer">Visit the GitHub project</a
		>
	</section>
</main>

<style>
	:global(html) {
		scroll-behavior: smooth;
	}

	.landing-page {
		width: 100%;
		color: #18313b;
	}

	.hero {
		position: relative;
		display: grid;
		min-height: min(760px, 86vh);
		place-items: center;
		overflow: hidden;
		padding: 7rem 1.5rem 5rem;
		background: #153e54;
	}

	.hero::after {
		position: absolute;
		inset: 0;
		background: linear-gradient(
				110deg,
				rgba(9, 45, 61, 0.94),
				rgba(15, 82, 96, 0.66)
			),
			linear-gradient(180deg, transparent 60%, rgba(5, 36, 49, 0.62));
		content: "";
	}

	.hero-background {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: hue-rotate(300deg);
	}

	.hero-content {
		position: relative;
		z-index: 1;
		width: min(850px, 100%);
		color: white;
		text-align: center;
	}

	.eyebrow {
		margin: 0 0 1rem;
		color: #bfeafa;
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.eyebrow.dark {
		color: #176780;
	}

	.hero h1 {
		max-width: 780px;
		margin: 0 auto;
		font-size: clamp(2.8rem, 7vw, 5.7rem);
		font-weight: 800;
		letter-spacing: -0.055em;
		line-height: 0.98;
	}

	.hero-copy {
		max-width: 710px;
		margin: 1.75rem auto 0;
		color: #e4f4f7;
		font-size: clamp(1.05rem, 2vw, 1.3rem);
		line-height: 1.65;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.85rem;
		margin-top: 2.2rem;
	}

	.button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 48px;
		padding: 0.75rem 1.35rem;
		border: 1px solid transparent;
		border-radius: 0.7rem;
		font-weight: 750;
		text-decoration: none;
		transition:
			transform 160ms ease,
			background 160ms ease;
	}

	.button:hover {
		transform: translateY(-2px);
	}

	.button-primary {
		background: #f5b741;
		color: #17303a;
	}

	.button-primary:hover {
		background: #ffc75a;
	}

	.button-secondary {
		border-color: rgba(255, 255, 255, 0.72);
		background: rgba(255, 255, 255, 0.08);
		color: white;
	}

	.button-secondary:hover {
		background: rgba(255, 255, 255, 0.17);
	}

	.status-strip {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		width: min(1120px, calc(100% - 3rem));
		margin: -2.4rem auto 0;
		position: relative;
		z-index: 2;
		border: 1px solid #d5e7eb;
		border-radius: 1rem;
		background: white;
		box-shadow: 0 18px 50px rgba(20, 66, 79, 0.14);
	}

	.status-strip div {
		display: flex;
		min-height: 104px;
		flex-direction: column;
		justify-content: center;
		padding: 1rem;
		text-align: center;
	}

	.status-strip div + div {
		border-left: 1px solid #dcebed;
	}

	.status-strip strong {
		color: #174f63;
		font-size: 1.35rem;
	}

	.status-strip span {
		margin-top: 0.2rem;
		color: #60747b;
		font-size: 0.84rem;
	}

	.content-section {
		width: min(1120px, calc(100% - 3rem));
		margin: 0 auto;
	}

	.intro-section {
		padding: 7.5rem 0 6rem;
	}

	.section-heading {
		max-width: 720px;
	}

	.section-heading h2,
	.constraint-copy h2,
	.contribution-section h2 {
		margin: 0;
		color: #153e4c;
		font-size: clamp(2rem, 4vw, 3.25rem);
		letter-spacing: -0.035em;
		line-height: 1.08;
	}

	.section-heading > p:last-child,
	.constraint-copy > p,
	.contribution-section > div > p:last-child {
		color: #60747b;
		font-size: 1.04rem;
		line-height: 1.7;
	}

	.feature-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		margin-top: 2.5rem;
	}

	.feature-card {
		padding: 1.65rem;
		border: 1px solid #d9e8ea;
		border-radius: 0.9rem;
		background: rgba(255, 255, 255, 0.72);
	}

	.feature-card h3,
	.format-card h3,
	.local-card h3 {
		margin: 0;
		font-size: 1.08rem;
	}

	.feature-card p,
	.local-card p {
		margin: 0.7rem 0 0;
		color: #62777e;
		font-size: 0.94rem;
		line-height: 1.62;
	}

	.formats-section {
		background: #123e50;
		color: white;
	}

	.formats-inner {
		padding: 6rem 0;
	}

	.section-heading.light h2 {
		color: white;
	}

	.section-heading.light > p:last-child {
		color: #c4dfe5;
	}

	.format-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 1rem;
		margin: 2.5rem 0 2rem;
	}

	.format-card {
		padding: 1.4rem;
		border: 1px solid rgba(191, 234, 250, 0.2);
		border-radius: 0.85rem;
		background: rgba(255, 255, 255, 0.06);
	}

	.format-card ul {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	.format-card li {
		padding: 0.42rem 0;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		color: #d4e9ed;
		font-size: 0.9rem;
	}

	.text-link {
		color: #176780;
		font-weight: 750;
		text-decoration: none;
	}

	.text-link:hover {
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}

	.light-link {
		color: #bfeafa;
	}

	.constraints-section {
		display: grid;
		grid-template-columns: minmax(0, 1.45fr) minmax(270px, 0.75fr);
		gap: 4rem;
		align-items: center;
		padding: 6rem 0;
	}

	.constraint-copy > p {
		max-width: 700px;
	}

	.local-card {
		padding: 2rem;
		border: 1px solid #cfe3e7;
		border-radius: 1rem;
		background: #f8fdfd;
		box-shadow: 0 16px 44px rgba(20, 66, 79, 0.08);
	}

	.local-mark {
		display: grid;
		width: 2.25rem;
		height: 2.25rem;
		place-items: center;
		margin-bottom: 1rem;
		border-radius: 50%;
		background: #d7f1e8;
		color: #176a54;
		font-weight: 800;
	}

	.contribution-section {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		padding: 4.5rem max(1.5rem, calc((100% - 1120px) / 2));
		background: #0a2f3e;
		color: white;
	}

	.contribution-section h2 {
		color: white;
	}

	.contribution-section > div {
		max-width: 700px;
	}

	.contribution-section > div > p:last-child {
		color: #c5dfe5;
	}

	@media (max-width: 900px) {
		.feature-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.format-grid {
			grid-template-columns: repeat(2, 1fr);
		}

		.constraints-section {
			gap: 2rem;
		}
	}

	@media (max-width: 680px) {
		.hero {
			min-height: 680px;
			padding-top: 6rem;
		}

		.hero-actions,
		.contribution-section {
			align-items: stretch;
			flex-direction: column;
		}

		.status-strip {
			grid-template-columns: repeat(2, 1fr);
		}

		.status-strip div:nth-child(3) {
			border-top: 1px solid #dcebed;
			border-left: 0;
		}

		.status-strip div:nth-child(4) {
			border-top: 1px solid #dcebed;
		}

		.feature-grid,
		.format-grid,
		.constraints-section {
			grid-template-columns: 1fr;
		}

		.intro-section,
		.formats-inner,
		.constraints-section {
			padding: 4.5rem 0;
		}

		.contribution-section {
			padding-block: 3.5rem;
		}

		.contribution-section .button {
			align-self: flex-start;
		}
	}
</style>
