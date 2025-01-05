<script lang="ts">
	import TopData from "$lib/components/menu/components/topData.svelte";
	import TmSection from "$lib/components/translationMemory/tmSection.svelte";
	import RightArrow from "$lib/components/svg/rightArrow.svelte";
	import { goto } from "$app/navigation";
</script>

<svelte:head>
	<title>Open Translation Client</title>
	<meta
		name="description"
		content="Open Translation Client Web Application/CAT-Tool"
	/>
</svelte:head>

<section>
	<TopData />

	<div class="tm-content-container">
		<TmSection />
	</div>
</section>

<style>
	section {
		display: grid;
		align-items: baseline;
		padding: 0px;
		margin: 0px;
	}

	.tm-content-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0px;
		margin: 0px;
		gap: 50px 0%;
	}
</style>
