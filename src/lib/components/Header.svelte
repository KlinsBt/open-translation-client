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
</style>
