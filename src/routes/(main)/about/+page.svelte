<script lang="ts">
	import DataStructureCard from "$lib/components/about/dataStructureCard.svelte";

	const sourceFormatGroups = [
		{
			title: "Office, web and text",
			formats: [
				"DOCX, DOCM, DOTX and DOTM",
				"XLSX, XLSM, XLTX and XLTM",
				"PPTX, PPTM, POTX, POTM, PPSX and PPSM",
				"ODT, ODS and ODP",
				"RTF native round trips",
				"Legacy DOC to DOCX, XLS to XLS, and PPT to HTML",
				"HTML and XHTML",
				"TXT, CSV and TSV",
			],
		},
		{
			title: "Structured localization",
			formats: [
				"JSON, ARB, i18next, Chrome and locJSON",
				"YAML 1.2",
				"GNU gettext PO and POT",
				"XML with ITS 2.0",
				"Android strings.xml",
				"Apple .strings, .stringsdict and .xcstrings",
				"Java and Mozilla .properties",
				".NET RESX",
			],
		},
		{
			title: "Application resources",
			formats: [
				"Qt Linguist TS and QML",
				"INI, .desktop and .lang",
				"Limited PHP localization arrays",
				"Windows RC resources",
				"MIF interchange files",
				"Markdown and AsciiDoc",
				"SRT, WebVTT and SBV subtitles",
			],
		},
		{
			title: "Publishing and technical authoring",
			formats: [
				"EPUB 2 and 3",
				"SVG",
				"DITA and DITAMAP",
				"DocBook",
				"Adobe IDML and ICML",
				"TeX and LaTeX",
				"TTML and DFXP timed text",
			],
		},
		{
			title: "Local media and CAT containers",
			formats: [
				"PNG, JPEG and TIFF on-device OCR",
				"WAV, MP3, M4A, Ogg and FLAC transcription",
				"MP4, MOV and WebM transcription",
				"Trados SDLPPX and SDLRPX return packages",
				"WorldServer WSXZ packages",
				"memoQ MQOUT, MQBACK and MQXLZ packages",
			],
		},
	];

	const workflowSteps = [
		{
			number: "01",
			title: "Detect and validate",
			text: "Open TLC checks content as well as the filename, applies archive and XML limits, and selects a dedicated format adapter.",
		},
		{
			number: "02",
			title: "Extract and translate",
			text: "The adapter exposes translatable content as segments while protecting inline codes, placeholders and structural metadata.",
		},
		{
			number: "03",
			title: "Verify and export",
			text: "Format-specific checks run before the translated document or portable project file is generated.",
		},
	];
</script>

<svelte:head>
	<title>About and format support — Open TLC</title>
	<meta
		name="description"
		content="Learn how Open TLC handles source files, CAT exchange formats, local project storage and constrained translation workflows."
	/>
</svelte:head>

<main class="about-page">
	<header class="about-hero">
		<div>
			<p class="eyebrow">About Open TLC</p>
			<h1>An open translation workspace with format rules built in</h1>
			<p>
				Open Translation Client is a browser-based, open source CAT tool for
				professional translators, learners and teams. It began as a master's
				thesis project at Anhalt University of Applied Sciences in Germany and
				has grown into a local-first editor with more than 35 registered format
				workflows.
			</p>
		</div>
	</header>

	<div class="page-layout">
		<nav class="table-of-contents" aria-label="About page contents">
			<p>On this page</p>
			<a href="#workflow">How files are handled</a>
			<a href="#source-formats">Source formats</a>
			<a href="#cat-interchange">CAT interchange</a>
			<a href="#constrained-workflows">Constrained workflows</a>
			<a href="#data-storage">Local data storage</a>
			<a href="#project-files">Project files</a>
			<a href="#contribute">Contribute</a>
		</nav>

		<div class="main-content">
			<section id="workflow" class="content-block">
				<p class="section-label">Format-aware by design</p>
				<h2>How files move through Open TLC</h2>
				<p class="lead">
					A DOCX document, a PO catalog and an EPUB publication do not have the
					same structure. Open TLC routes each supported file through an adapter
					with its own extraction, validation and export behavior.
				</p>
				<div class="workflow-grid">
					{#each workflowSteps as step}
						<article>
							<span>{step.number}</span>
							<h3>{step.title}</h3>
							<p>{step.text}</p>
						</article>
					{/each}
				</div>
				<div class="note">
					<strong>Translation safeguards:</strong> Inline codes and placeholders
					remain protected, split and join operations retain their segment lineage,
					and structured imports can offer format-specific extraction options.
				</div>
			</section>

			<section id="source-formats" class="content-block">
				<p class="section-label">Source document support</p>
				<h2>Formats you can bring into the editor</h2>
				<p class="lead">
					The groups below cover native round-trip adapters and deliberately
					limited parsers. Exact behavior depends on the selected format and is
					validated before export.
				</p>
				<div class="format-grid">
					{#each sourceFormatGroups as group}
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
				<div class="note warning">
					<strong>PowerPoint validation:</strong> PPTX-family packages have automated
					round-trip coverage, but final native Microsoft PowerPoint interoperability
					validation is still tracked as an external manual check.
				</div>
			</section>

			<section id="cat-interchange" class="content-block split-block">
				<div>
					<p class="section-label">Industry exchange</p>
					<h2>CAT projects, memories and terminology</h2>
					<p>
						Open TLC imports and exports standard XLIFF 1.2, 2.0 and 2.1
						projects. It also retains the structure of supported Trados,
						WorldServer and memoQ containers and writes translated return
						packages.
					</p>
				</div>
				<ul class="capability-list">
					<li>
						<strong>TMX 1.4b</strong><span>Translation-memory exchange</span>
					</li>
					<li>
						<strong>TBX Core / Min</strong><span>Terminology exchange</span>
					</li>
					<li>
						<strong>SRX 2.0</strong><span>Segmentation-rule exchange</span>
					</li>
					<li>
						<strong>XLIFF 1.2–2.1</strong><span>Bilingual project exchange</span
						>
					</li>
					<li>
						<strong>CAT return packages</strong><span
							>Trados, WorldServer and memoQ handoff</span
						>
					</li>
				</ul>
			</section>

			<section id="constrained-workflows" class="content-block">
				<p class="section-label">Support boundaries</p>
				<h2>Some files need a safer, narrower workflow</h2>
				<p class="lead">
					The interface labels these capabilities instead of implying that every
					file can make a lossless browser-only round trip.
				</p>
				<div class="constraint-list">
					<article>
						<strong>PDF is source-only</strong>
						<p>
							Text is extracted for translation and exported as accessible
							bilingual HTML. Open TLC does not claim to recreate the original
							PDF layout.
						</p>
					</article>
					<article>
						<strong>CAT packages support return-package export</strong>
						<p>
							Trados, WorldServer and memoQ-style packages are inspected safely,
							their bilingual members are updated, and every other package entry
							is retained when the return container is rebuilt.
						</p>
					</article>
					<article>
						<strong
							>Legacy Office runs locally with format-specific output</strong
						>
						<p>
							DOC, XLS, PPT and RTF are imported in the browser. RTF and XLS
							keep their formats; DOC exports to DOCX and PPT exports to HTML
							because no LibreOffice server or remote conversion service is
							used.
						</p>
					</article>
					<article>
						<strong>Archive projects require a manifest</strong>
						<p>
							Generic ZIP import is available only for packages with a validated
							<code>opentlc-project.json</code> manifest and safe member paths.
						</p>
					</article>
					<article>
						<strong>OCR and transcription run on-device</strong>
						<p>
							Images are read with local OCR and audio/video is transcribed with
							a local Whisper model. Model files may be downloaded and cached by
							the browser, but source media is not uploaded and no provider
							consent is needed.
						</p>
					</article>
				</div>
			</section>

			<section id="data-storage" class="content-block split-block">
				<div>
					<p class="section-label">Privacy and ownership</p>
					<h2>Projects live in your browser</h2>
					<p>
						Open TLC stores project data in IndexedDB on the current device and
						browser profile. The application does not send project content to an
						Open TLC storage server.
					</p>
				</div>
				<div class="storage-card">
					<h3>Keep regular backups</h3>
					<p>
						Browser data can still be lost through site-data clearing, profile
						changes, device failure or browser maintenance. Export project files
						regularly and store them somewhere you control.
					</p>
					<p>
						To move a project to another browser or device, export it on the
						first device and import that file on the second.
					</p>
				</div>
			</section>

			<section id="project-files" class="content-block">
				<p class="section-label">Portable project saves</p>
				<h2>Open TLC JSON and XLIFF</h2>
				<p class="lead">
					The versioned Open TLC JSON format keeps application-specific project
					state in a readable structure. Standard XLIFF 1.2, 2.0 and 2.1 exports
					provide interoperable bilingual project files for compatible CAT
					tools.
				</p>
				<p>
					Project-save formats are separate from translated source-document
					exports: an XLIFF save preserves a bilingual project, while a DOCX,
					PO, EPUB or other source export rebuilds that source format.
				</p>
				<details>
					<summary>View the Open TLC project data structure</summary>
					<div class="data-card-wrapper"><DataStructureCard /></div>
				</details>
			</section>

			<section id="contribute" class="content-block contribution-card">
				<div>
					<p class="section-label">Open source contribution</p>
					<h2>Real files make format support better</h2>
					<p>
						Developers, translators and technical writers can contribute code,
						sanitized fixtures, interoperability results, documentation and
						issue reports.
					</p>
				</div>
				<a
					href="https://github.com/KlinsBt/open-translation-client"
					target="_blank"
					rel="noreferrer">Visit the GitHub project →</a
				>
			</section>
		</div>
	</div>
</main>

<style>
	:global(html) {
		scroll-behavior: smooth;
	}

	.about-page {
		color: #19333d;
	}

	.about-hero {
		padding: 7.5rem max(1.5rem, calc((100% - 1120px) / 2)) 5rem;
		background: radial-gradient(
				circle at 85% 20%,
				rgba(108, 198, 210, 0.23),
				transparent 32%
			),
			#103d50;
		color: white;
	}

	.about-hero > div {
		max-width: 870px;
		margin: 0 auto;
		text-align: center;
	}

	.eyebrow,
	.section-label {
		margin: 0 0 0.85rem;
		color: #bfeafa;
		font-size: 0.76rem;
		font-weight: 800;
		letter-spacing: 0.15em;
		text-transform: uppercase;
	}

	.about-hero h1 {
		margin: 0;
		font-size: clamp(2.55rem, 6vw, 4.8rem);
		letter-spacing: -0.05em;
		line-height: 1.02;
	}

	.about-hero p:last-child {
		max-width: 780px;
		margin: 1.6rem auto 0;
		color: #d6e9ed;
		font-size: 1.12rem;
		line-height: 1.72;
	}

	.page-layout {
		display: grid;
		grid-template-columns: 210px minmax(0, 1fr);
		gap: 4rem;
		width: min(1120px, calc(100% - 3rem));
		margin: 0 auto;
		padding: 4.5rem 0 6rem;
	}

	.table-of-contents {
		position: sticky;
		top: 1.5rem;
		align-self: start;
		padding-left: 1rem;
		border-left: 2px solid #cbdfe3;
	}

	.table-of-contents p {
		margin: 0 0 0.8rem;
		color: #73858b;
		font-size: 0.75rem;
		font-weight: 800;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	.table-of-contents a {
		display: block;
		padding: 0.38rem 0;
		color: #46616a;
		font-size: 0.87rem;
		text-decoration: none;
	}

	.table-of-contents a:hover {
		color: #0b6983;
	}

	.main-content {
		min-width: 0;
	}

	.content-block {
		scroll-margin-top: 2rem;
		padding: 0 0 5rem;
	}

	.content-block + .content-block {
		padding-top: 5rem;
		border-top: 1px solid #d5e5e8;
	}

	.section-label {
		color: #19708a;
	}

	h2 {
		max-width: 760px;
		margin: 0;
		color: #153f4e;
		font-size: clamp(1.9rem, 4vw, 3rem);
		letter-spacing: -0.035em;
		line-height: 1.1;
	}

	h3 {
		color: #234b59;
	}

	p,
	li {
		line-height: 1.7;
	}

	.lead {
		max-width: 780px;
		color: #5d747c;
		font-size: 1.04rem;
	}

	.workflow-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1rem;
		margin-top: 2rem;
	}

	.workflow-grid article {
		padding: 1.4rem;
		border: 1px solid #d6e7ea;
		border-radius: 0.85rem;
		background: rgba(255, 255, 255, 0.7);
	}

	.workflow-grid span {
		color: #1b7892;
		font-size: 0.75rem;
		font-weight: 800;
	}

	.workflow-grid h3 {
		margin: 0.55rem 0 0;
		font-size: 1.02rem;
	}

	.workflow-grid p,
	.constraint-list p {
		margin: 0.6rem 0 0;
		color: #61777e;
		font-size: 0.9rem;
	}

	.note {
		margin-top: 1.5rem;
		padding: 1rem 1.2rem;
		border-left: 4px solid #3492a8;
		border-radius: 0 0.5rem 0.5rem 0;
		background: #eaf7f8;
		color: #315762;
		line-height: 1.6;
	}

	.note.warning {
		border-left-color: #d49627;
		background: #fff7e8;
	}

	.format-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		margin-top: 2rem;
	}

	.format-card {
		padding: 1.5rem;
		border: 1px solid #d7e6e9;
		border-radius: 0.85rem;
		background: rgba(255, 255, 255, 0.7);
	}

	.format-card h3 {
		margin: 0;
		font-size: 1.03rem;
	}

	.format-card ul {
		margin: 1rem 0 0;
		padding: 0;
		list-style: none;
	}

	.format-card li {
		padding: 0.4rem 0;
		border-top: 1px solid #e0ecee;
		color: #5a7078;
		font-size: 0.88rem;
	}

	.split-block {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
		gap: 3rem;
		align-items: start;
	}

	.split-block > div:not(.storage-card) > p:last-child {
		color: #5d747c;
	}

	.capability-list {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.capability-list li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.8rem 0;
		border-bottom: 1px solid #d9e7e9;
	}

	.capability-list span {
		color: #687d84;
		font-size: 0.85rem;
		text-align: right;
	}

	.constraint-list {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 1rem;
		margin-top: 2rem;
	}

	.constraint-list article {
		padding: 1.25rem;
		border-left: 3px solid #5c9dac;
		background: #f4fafb;
	}

	.constraint-list strong {
		color: #214b59;
	}

	.storage-card {
		padding: 1.5rem;
		border-radius: 0.85rem;
		background: #153f4e;
		color: white;
	}

	.storage-card h3 {
		margin-top: 0;
		color: white;
	}

	.storage-card p {
		color: #d3e7ea;
		font-size: 0.9rem;
	}

	details {
		margin-top: 1.5rem;
		border: 1px solid #d3e4e7;
		border-radius: 0.65rem;
		background: rgba(255, 255, 255, 0.6);
	}

	summary {
		padding: 1rem 1.2rem;
		color: #196a80;
		font-weight: 750;
		cursor: pointer;
	}

	.data-card-wrapper {
		padding: 0 1rem 1rem;
	}

	.contribution-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 2rem;
		padding: 2.2rem;
		border: 0;
		border-radius: 1rem;
		background: #e1f1f3;
	}

	.content-block + .contribution-card {
		padding: 2.2rem;
		border-top: 0;
	}

	.contribution-card p:not(.section-label) {
		max-width: 650px;
		color: #557078;
	}

	.contribution-card a {
		flex-shrink: 0;
		color: #146a82;
		font-weight: 800;
		text-decoration: none;
	}

	.contribution-card a:hover {
		text-decoration: underline;
		text-underline-offset: 0.25em;
	}

	@media (max-width: 900px) {
		.page-layout {
			grid-template-columns: 1fr;
			gap: 2.5rem;
		}

		.table-of-contents {
			position: static;
			display: flex;
			flex-wrap: wrap;
			gap: 0.25rem 1rem;
			padding: 1rem;
			border: 1px solid #d4e5e8;
			border-radius: 0.75rem;
		}

		.table-of-contents p {
			width: 100%;
		}

		.workflow-grid {
			grid-template-columns: 1fr;
		}
	}

	@media (max-width: 680px) {
		.about-hero {
			padding-top: 6rem;
			padding-bottom: 4rem;
		}

		.format-grid,
		.split-block,
		.constraint-list {
			grid-template-columns: 1fr;
		}

		.content-block + .content-block {
			padding-top: 3.5rem;
		}

		.content-block {
			padding-bottom: 3.5rem;
		}

		.contribution-card {
			align-items: flex-start;
			flex-direction: column;
		}
	}
</style>
