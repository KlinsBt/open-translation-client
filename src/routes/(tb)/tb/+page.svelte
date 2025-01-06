<script lang="ts">
	import TopData from "$lib/components/menu/components/topData.svelte";
	import TbSection from "$lib/components/termBase/tbSection.svelte";
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

	<div class="tb-content-container">
		<TbSection />
	</div>
</section>

<style>
	section {
		display: grid;
		align-items: baseline;
		padding: 0px;
		margin: 0px;
	}

	.tb-content-container {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		padding: 0px;
		margin: 0px;
		gap: 50px 0%;
	}
</style>
