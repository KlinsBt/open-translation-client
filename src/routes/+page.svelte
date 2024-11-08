<script>
	import bg from "$lib/images/bg14.jpg";
</script>

<div class="landing-page">
	<section class="top-section">
		<div class="header">
			<img class="background" src={bg} alt="Background" />
			<h1 class="title">Open Translation Client</h1>
			<p class="description">An open source CAT-Tool for everyone.</p>
			<a href="/app" class="cta-button">Start Tool</a>
		</div>
	</section>

	<section class="features-section">
		<h2>Open TLC</h2>
		<p>
			Open TLC is a free and open source Computer-Assisted Translation (CAT)
			tool where you can create translation projects using various file formats.
			It is a web-based tool that can be accessed from anywhere within a
			browser.
		</p>
		<div class="features-grid">
			<div class="feature-card">
				<h3>For Everyone</h3>
				<p>
					Open TLC is free to use by anyone and open source. You can use or
					modify it without any restrictions.
				</p>
			</div>
			<div class="feature-card">
				<h3>Multiple File Support</h3>
				<p>
					We support multiple file formats for translation projects including
					.docx, .xlsx, json, html etc. and are continuously adding more.
				</p>
			</div>
			<div class="feature-card">
				<h3>XLIFF Support</h3>
				<p>
					Besides our own JSON save file format, we support XLIFF v1.2 and v2.0
					save files which are widely used in the translation industry by most
					CAT-Tools.
				</p>
			</div>
			<div class="feature-card">
				<h3>Browser Based</h3>
				<p>
					Open TLC is a web-based tool that can be accessed from any device with
					a browser. No need to install any software or plugins.
				</p>
			</div>
		</div>
	</section>

	<section class="contributions-section">
		<h2>Open Source Contributions</h2>
		<p>
			Open TLC is an open-source project, and we welcome contributions from the
			community! Whether you're a developer, translator, or just someone who
			wants to improve the tool, we’d love your help.
		</p>
		<p>
			You can contribute by adding features, fixing bugs, or improving
			documentation. Head over to our GitHub repository to get started!
		</p>
		<a href="https://github.com" target="_blank" class="github-link"
			>Visit our GitHub</a
		>
	</section>
</div>

<style>
	.landing-page {
		display: flex;
		flex-direction: column;
		width: 100%;
		padding: 0;
		margin: 0;
	}

	.top-section {
		position: relative;
		display: flex;
		justify-content: center;
		align-items: start;
		width: 100%;
		height: 100vh;
		padding: 0;
		margin: 0;
		background: linear-gradient(
			135deg,
			rgba(141, 234, 255, 0.3) 0%,
			rgb(163, 232, 255, 0.3) 100%
		);
		overflow: hidden;
		z-index: 1;
	}

	.background {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		object-position: center;
		opacity: 1;
		/* filter: blur(2px); */
		filter: hue-rotate(300deg);
		z-index: -1;
	}

	.header {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: 2rem;
		color: white;
		max-width: 600px;
		background-color: rgba(13, 65, 112, 0);
		margin: 10% 0px 0px 0px;

		/* background-color: rgba(0, 0, 0, 0.3);
		border-radius: 5px; */
	}

	.title {
		font-size: 3rem;
		font-weight: 700;
		margin: 0.5rem 0px;
		line-height: 1.2;
		color: var(--color-theme-6);
		text-shadow: 0px 0px 5px var(--color-theme-7);

		color: white;
		text-shadow: none;
	}

	.description {
		margin: 1rem 0;
		font-size: 1.2rem;
		font-weight: 500;
		color: rgb(50, 52, 53);
		text-shadow: 0px 0px 5px var(--color-theme-7);

		color: white;
		text-shadow: none;
	}

	.cta-button {
		padding: 0.8rem 3rem;
		background-color: var(--color-theme-12);
		border: 3px solid var(--color-theme-7);
		border-radius: 5px;
		color: white;
		cursor: pointer;
		text-decoration: none;
		font-weight: bold;
		transition: background-color 0.3s;
	}

	.cta-button:hover {
		background-color: var(--color-theme-11);
	}

	.features-section {
		display: flex;
		flex-direction: column;
		padding: 3rem 0rem;
		max-width: 1200px;
		width: 90%;
		margin: 0 auto;
		text-align: center;
		/* background-color: var(--color-theme-5); */
	}

	.features-section h2 {
		font-size: 2rem;
		color: #333;
		color: var(--color-theme-4);
		margin-bottom: 1rem;
		font-weight: bold;
	}

	.features-section p {
		font-size: 1.1rem;
		color: #555;
		line-height: 1.6;
		max-width: 800px;
		margin: 2rem auto 2rem auto;
	}

	.features-grid {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 2rem;
		margin: 4rem 0rem;
	}

	.feature-card {
		background: white;
		border-radius: 8px;
		box-shadow: 0 4px 8px var(--color-theme-4);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
		padding: 1rem;
		width: 100%;
		max-width: 300px;
		text-align: center;
		transition: all 0.2s linear;
	}

	.feature-card:hover {
		box-shadow: 0 4px 8px var(--color-theme-4);
	}

	.feature-card h3 {
		font-size: 1.2rem;
		color: var(--color-theme-4);
		margin-bottom: 0.5rem;
	}

	.contributions-section {
		/* background-color: var(--color-theme-3); */
		padding: 2rem;
		margin: 0px;
		text-align: center;
	}

	.contributions-section h2 {
		font-size: 2rem;
		color: #333;
		color: var(--color-theme-4);
		margin-bottom: 1rem;
		font-weight: bold;
	}

	.contributions-section p {
		font-size: 1.1rem;
		color: #555;
		line-height: 1.6;
		max-width: 800px;
		margin: 2rem auto 2rem auto;
	}

	.github-link {
		display: inline-block;
		padding: 0.8rem 2rem;
		background-color: var(--color-theme-12);
		border: none;
		border-radius: 5px;
		color: white;
		font-weight: bold;
		text-decoration: none;
		transition: background-color 0.3s;
	}

	.github-link:hover {
		background-color: var(--color-theme-11);
	}
</style>
