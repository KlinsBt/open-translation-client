<script>
	import Header from "$lib/components/Header.svelte";
	import Footer from "$lib/components/Footer.svelte";
	import LodaingDisplay from "$lib/components/loading/dots.svelte";
	import "../app.css";
	import { showLoading } from "$lib/functions/saveData/stores.svelte";
</script>

<div class="app">
	<Header />

	{#if $showLoading}
		<div class="loading-display">
			<div>
				<LodaingDisplay />
			</div>
		</div>
	{/if}

	<slot />

	<Footer />
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		min-height: 100vh;
	}

	.loading-display {
		position: fixed;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background-color: rgba(0, 0, 0, 0.8);
		/* background-color: var(--color-theme-6); */
		display: grid;
		justify-content: center;
		align-items: center;
		z-index: 100;
	}
</style>
