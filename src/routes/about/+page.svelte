<script>
	import DataStructureCard from "$lib/components/about/dataStructureCard.svelte";
</script>

<svelte:head>
	<title>About Open TLC</title>
	<meta name="description" content="About Open TLC" />
</svelte:head>

<section>
	<h1>All About Open TLC</h1>

	<nav class="table-of-contents">
		<h2>Contents</h2>
		<ol>
			<li><a href="#about-tool">About This Tool</a></li>
			<li><a href="#data-storage">Data Storage</a></li>
			<li><a href="#save-file-formats">Save File Formats</a></li>
			<li><a href="#open-source-contribution">Open Source Contribution</a></li>
		</ol>
	</nav>

	<div class="main-content">
		<div id="about-tool" class="text-column">
			<h2>About This Tool</h2>
			<p>
				Open Translation Client (Open TLC) is an open source CAT-Tool that was
				initially developed as a master thesis project at the Anhalt University
				of Applied Sciences, Germany. The goal of this project was to create a
				web-based translation tool that is easy to use for anyone, professional
				translators, teachers or students. The tool is designed to be
				user-friendly and intuitive. It has all the necessary features that are
				needed for a translation project such as support of multiple file
				formats, support of XLIFF 1.2 and 2.0 save files, various parsing
				algorithms for different file formats for segmentation etc.
			</p>
			<p>
				Open TLC is a web-based application, which means that it can be used on
				any device that has a web browser and an internet connection. The tool
				is designed to be responsive and work on any device, whether it is a
				desktop computer, a tablet or a smartphone.
			</p>
		</div>

		<div id="data-storage" class="text-column">
			<h2>Data Storage</h2>
			<p>
				All the data that is created and stored in Open TLC is saved inside your
				browser's very own database called IndexedDB. This means that all the
				translation projects that you create are stored locally on your device
				and are not sent to any server, giving you full control and authority
				over your data. You can also export your translation projects to various
				file formats for sharing or backup purposes.
			</p>
			<p>
				Each browser has its own IndexedDB database, which means that the data
				is stored separately for each browser that you use. So if you want to
				access your translation projects on another device, you will need to
				export the projects and import them into the other device.
			</p>
			<h3>Backups and Database Persistence</h3>
			<p>
				It is recommended to export your translation projects regularly to keep
				backups of your data. The IndexedDB database is persistent and will keep
				your data even if you close the browser or restart your device. However,
				there is always a risk of data loss due to cache clearing, browser
				updates, device failures or other unforeseen circumstances. Therefore,
				it is always a good practice to keep backups of your data by exporting
				the project save files to your local device.
			</p>
		</div>

		<div id="save-file-formats" class="text-column">
			<h2>Save File Formats</h2>
			<p>
				Open TLC supports the following file formats for saving and exporting
				translation project files:
			</p>
			<ul>
				<li>JSON (Open TLC format)</li>
				<li>XLIFF Version: 1.2</li>
				<li>XLIFF Version: >=2.0</li>
			</ul>
			<h3>JSON Format</h3>
			<p>
				The JSON format is a self-defined data structure by the Open TLC Team,
				which is used to store the translation project data. This format is
				designed to be more human-readable and easy to understand. It supports
				all the necessary information one would find in an XLIFF file and that
				is necessary for a translation project.
			</p>
			<h3>XLIFF Formats</h3>
			<p>
				XLIFF formats are industry standard file formats that are widely used in
				the translation industry. Open TLC supports both XLIFF 1.2 and XLIFF 2.0
				formats for saving and exporting translation projects. These files can
				be imported into other CAT-Tools that support XLIFF formats.
			</p>

			<h3>Save File Data Structure</h3>
			<p>
				Every project in Open TLC is stored in a specific data structure that
				contains all the necessary information for a translation project. This
				data structure is designed to be easy to understand and work with. Below
				is a visual example of that data structure:
			</p>
			<DataStructureCard />
		</div>

		<div id="open-source-contribution" class="text-column">
			<h2>Open Source Contribution</h2>
			<p>
				Open TLC is an open source project and we welcome contributions from
				anyone. If you are a developer and would like to contribute to the
				project, you can find the source code on our GitHub repository. You can
				also report issues, suggest new features or improvements, or help us
				with translations.
			</p>
			<!-- <p>
				We believe that open source is the way forward and that by working
				together as a community, we can create better tools for everyone. If you
				are interested in contributing to Open TLC, please visit our GitHub
				repository and read the contribution guidelines.
			</p> -->
		</div>
	</div>
</section>

<!-- <pre>
			{
				"translationData": {
				  "name": "Example Project Name",
				  "sourceLang": "English (en)",
				  "targetLang": "Georgian (ka)",
				  "creationDate": "1730553025090",
				  "seg1": ["Segment 1", "Segment 2"],
				  "seg2": ["Translated Segment 1", ""],
				  "checked": [true, false],
				  "type": "text",
				  "typeRef": {}
				}
			}
		</pre> -->

<style>
	section {
		display: flex;
		flex-direction: column;

		padding: 5%;
	}

	.table-of-contents {
		/* position: sticky; */
		/* top: 10px; */
		margin-bottom: 20px;
		padding: 1rem;
		background-color: var(--color-theme-5);
		border-radius: 8px;
	}

	.table-of-contents > h2 {
		font-size: 1.4rem;
		margin-bottom: 0.5rem;
		color: white;
	}

	.table-of-contents ol {
		color: #b2e4ff;
	}

	.table-of-contents ol > li > a {
		text-decoration: none;
		color: var(--color-theme-4);
		color: white;
		font-size: 1rem;
		margin-bottom: 0.5rem;
		display: block;
	}

	.table-of-contents ol li a:hover {
		/* filter: brightness(1.2); */
		color: #b2e4ff;
	}

	.main-content {
		max-width: 1500px;
		margin-top: 20px;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	.text-column {
		margin-bottom: 1rem;
	}

	/* Headings and Text */
	h1 {
		font-size: 2rem;
		margin-bottom: 1rem;
	}

	h2 {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}

	h3 {
		font-size: 1.2rem;
		margin-bottom: 0.5rem;
		font-weight: 500;
	}

	p {
		font-size: 1rem;
		margin: 0.5rem 0;
		line-height: 1.6;
	}

	/* pre {
		background-color: var(--color-theme-7);
		padding: 0.5rem;
		border-radius: 5px;
		overflow-x: auto;
		font-size: 0.9rem;
		line-height: 1.4;
	} */

	@media (min-width: 768px) {
		.table-of-contents {
			min-width: 200px;
			flex-shrink: 0;
		}

		.main-content {
			flex: 1;
		}
	}
</style>
