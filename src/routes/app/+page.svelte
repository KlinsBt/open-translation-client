<script lang="ts">
	// import File from "$lib/components/file.svelte";
	// import Jimp from "jimp";
	// import Tesseract from "tesseract.js";
	// import Menu from "$lib/components/menu/modalMenu/menuContainer.svelte";
	import TextSegments from "$lib/components/textSegments/segments.svelte";
	import { openMenu, userData } from "$lib/functions/saveData/stores.svelte";
	import TopData from "$lib/components/menu/components/topData.svelte";
	import Menu from "$lib/components/menu/menuContent.svelte";
</script>

<svelte:head>
	<title>Open Translation Client</title>
	<meta
		name="description"
		content="Open Translation Client Web Application/CAT-Tool"
	/>
</svelte:head>

<section>
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
</style>
