<script lang="ts">
	let {
		marginBottom = "0px",
	}: {
		marginBottom?: string;
	} = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width="17"
	height="17"
	viewBox="0 0 22 22"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	style="margin-bottom: {marginBottom}"
>
	<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
	<polyline points="7 10 12 15 17 10" />
	<line x1="12" y1="15" x2="12" y2="3" />
</svg>

<style>
</style>
