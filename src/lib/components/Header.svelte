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
</style>
