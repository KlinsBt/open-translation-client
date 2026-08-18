<script>
	import { page } from "$app/stores";
	import logo from "$lib/images/logo.png";
	// import github from "$lib/images/github.svg";
</script>

<header>
	<div class="wrapper">
		<div class="corner">
			<a href="/">
				<img src={logo} alt="Open TLC" />
				<p>Open TLC</p>
			</a>
		</div>

		<nav>
			<ul>
				<li aria-current={$page.url.pathname === "/" ? "page" : undefined}>
					<a href="/">Home</a>
				</li>
				<li aria-current={$page.url.pathname === "/app" ? "page" : undefined}>
					<a href="/app">App</a>
				</li>
				<!-- <li aria-current={$page.url.pathname === "/about" ? "page" : undefined}>
					<a href="/about">Download for Desktop</a>
				</li> -->
				<li aria-current={$page.url.pathname === "/about" ? "page" : undefined}>
					<a href="/about">About</a>
				</li>
				<li class="deepl-action">
					<a
						class="deepl-link"
						href="https://support.deepl.com/hc/en-us/articles/4407516019218-Get-started-DeepL-browser-extensions"
						target="_blank"
						rel="noreferrer"
						aria-label="Get the DeepL browser plugin (opens in a new tab)"
					>
						<span class="deepl-label-full">DeepL plugin</span>
						<span class="deepl-label-short">DeepL</span>
					</a>
				</li>
			</ul>
		</nav>

		<!-- <div class="corner">
			<a href="https://github.com/sveltejs/kit">
				<img src={github} alt="GitHub" />
			</a>
		</div> -->
	</div>
</header>

<style>
	header {
		width: 100%;
	}

	.wrapper {
		display: flex;
		justify-content: space-between;
		background-color: rgba(108, 226, 249, 1);
		background-color: var(--color-theme-10);
		/* background: linear-gradient(
			90deg,
			rgba(16, 137, 211, 1) 0%,
			rgba(132, 199, 240, 1) 51%,
			rgba(140, 211, 255, 1) 100%
		); */
		width: 100%;
	}

	.corner {
		display: grid;
		justify-items: center;
		align-items: center;
		width: 3rem;
		height: auto;
		padding: 5px 5px 5px 10px;
	}

	.corner > a {
		display: grid;
		align-items: center;
		justify-items: center;
		width: 100%;
		height: 100%;
		text-decoration: none;
	}

	.corner > a > img {
		width: 40px;
		height: auto;
		margin-bottom: 4px;
	}

	.corner > a > p {
		font-size: 0.7rem;
		font-weight: 700;
		text-align: center;
		margin: 0px;
		width: 60px;
		color: var(--color-theme-7);
	}

	nav {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	ul {
		position: relative;
		padding: 0px 15px 0px 0px;
		margin: 0;
		height: 4em;
		display: flex;
		justify-content: center;
		align-items: center;
		list-style: none;
		background-size: contain;
	}

	li {
		position: relative;
		height: 100%;
	}

	li[aria-current="page"]::before {
		--size: 6px;
		content: "";
		width: 0;
		height: 0;
		position: absolute;
		top: 0;
		left: calc(50% - var(--size));
		border: var(--size) solid transparent;
		color: var(--color-theme-7);
	}

	nav > ul > li > a {
		display: flex;
		height: 100%;
		align-items: center;
		padding: 0 0.5rem;
		color: var(--color-theme-7);
		font-weight: 700;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		text-decoration: none;
		transition: color 0.2s linear;
	}

	a:hover {
		color: var(--color-theme-2);
	}

	.deepl-action {
		display: flex;
		align-items: center;
		height: auto;
		margin-left: 0.35rem;
	}

	nav > ul > li > a.deepl-link {
		height: auto;
		min-height: 2.2rem;
		padding: 0.1rem 0.8rem;
		border: 1px solid color-mix(in srgb, var(--color-theme-7) 55%, transparent);
		border-radius: 0.45rem;
		background: color-mix(in srgb, var(--color-theme-7) 10%, transparent);
		letter-spacing: 0.06em;
		transition:
			background-color 0.2s linear,
			border-color 0.2s linear,
			color 0.2s linear;
	}

	nav > ul > li > a.deepl-link:hover {
		border-color: var(--color-theme-7);
		background: color-mix(in srgb, var(--color-theme-7) 18%, transparent);
	}

	.deepl-label-short {
		display: none;
	}

	@media (max-width: 520px) {
		ul {
			padding-right: 0.4rem;
		}

		nav > ul > li > a {
			padding-inline: 0.35rem;
			font-size: 0.7rem;
			letter-spacing: 0.06em;
		}

		.deepl-action {
			margin-left: 0.15rem;
		}

		nav > ul > li > a.deepl-link {
			min-height: 2rem;
			padding-inline: 0.55rem;
		}

		.deepl-label-full {
			display: none;
		}

		.deepl-label-short {
			display: inline;
		}
	}
</style>
