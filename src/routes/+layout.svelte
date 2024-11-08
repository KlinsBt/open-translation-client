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
</style>
