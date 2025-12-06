<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		// message,
		content,
	}: {
		title: string;
		// message: string;
		content?: Snippet;
	} = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="contents" onclick={(e) => e.stopPropagation()}>
	<h2>{title}</h2>
	<!-- <p>{message}</p> -->
	{@render content?.()}
</div>

<style>
	.contents {
		display: grid;
		justify-items: center;
		min-width: 280px;
		/* max-width: 500px; */
		border-radius: 5px;
		padding: 25px;
		margin: 0px 10px;
		background: var(--color-theme-7);
		pointer-events: auto;
	}

	h2 {
		text-align: center;
		font-size: 1.8rem;
		margin: 0px 0px 25px 0px;
		color: var(--color-theme-4);
		font-weight: 600;
	}

	/* p {
		text-align: center;
		margin-top: 1.2rem;
		font-weight: 500;
		margin: 10px 0px 25px 0px;
		color: var(--color-theme-11);
	} */
</style>
