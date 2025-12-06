<script lang="ts">
	// import File from "$lib/components/file.svelte";
	// import Jimp from "jimp";
	// import Tesseract from "tesseract.js";
	// import Menu from "$lib/components/menu/modalMenu/menuContainer.svelte";
	import TextSegments from "$lib/components/textSegments/segments.svelte";
	import { openMenu, userData } from "$lib/functions/saveData/stores.svelte";
	import TopData from "$lib/components/menu/components/topData.svelte";
	import Menu from "$lib/components/menu/menuContent.svelte";
	import ToastContainer from "$lib/components/notifications/ToastContainer.svelte";
</script>

<svelte:head>
	<title>Open Translation Client</title>
	<meta
		name="description"
		content="Open Translation Client Web Application/CAT-Tool"
	/>
</svelte:head>

<section>
	<ToastContainer />
	{#if $openMenu}
		<TopData />
		<div class="menu-container">
			<Menu />
		</div>
	{:else}
		<div class="app-container">
			<TextSegments />
		</div>
	{/if}
</section>

<style>
	section {
		display: grid;
		align-items: center;
		padding: 0px;
		margin: 0px;

		display: grid;
		align-items: baseline;
		padding: 0px;
		margin: 0px;
		min-height: 90vh;
	}

	.menu-container {
		display: grid;
		justify-items: center;
		align-items: start;
		/* padding: 0rem 2rem; */
		min-height: 100vh;
		min-height: 75vh;
		margin: 0;
		padding: 0;
	}

	.app-container {
		display: grid;
		justify-items: center;
		align-items: center;
		padding: 0px;
	}

	@keyframes load89234 {
		100% {
			background-position: -100% 0;
		}
	}
</style>
