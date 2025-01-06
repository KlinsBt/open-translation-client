<script>
	import LodaingDisplay from "$lib/components/loading/dots.svelte";
	import { showLoading } from "$lib/functions/saveData/stores.svelte";
	import "../../../app.css";

	let { children } = $props();
</script>

<div class="app">
	{#if $showLoading}
		<div class="loading-display">
			<div>
				<LodaingDisplay />
			</div>
		</div>
	{/if}
	{@render children()}
</div>

<style>
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
