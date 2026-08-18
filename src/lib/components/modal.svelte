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
		box-sizing: border-box;
		width: min(100%, 460px);
		min-width: min(280px, 100%);
		max-height: calc(100vh - 2rem);
		border: 1px solid rgba(119, 164, 176, 0.3);
		border-radius: 1rem;
		padding: 1.65rem;
		background: var(--color-theme-7);
		box-shadow: 0 24px 70px rgba(4, 28, 40, 0.28);
		overflow-y: auto;
		pointer-events: auto;
	}

	h2 {
		text-align: center;
		font-size: clamp(1.35rem, 4vw, 1.75rem);
		line-height: 1.2;
		margin: 0 0 1.25rem;
		color: #194858;
		font-weight: 750;
		letter-spacing: -0.025em;
	}
</style>
