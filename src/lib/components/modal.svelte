<script lang="ts">
	import type { Snippet } from "svelte";
	import "./modalSystem.css";

	let {
		title,
		content,
		wide = false,
		large = false,
		description,
		onClose,
	}: {
		title: string;
		content?: Snippet;
		wide?: boolean;
		large?: boolean;
		description?: string;
		onClose?: () => void;
	} = $props();
</script>

<svelte:window
	onkeydown={(event) => {
		if (event.key === "Escape") onClose?.();
	}}
/>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="contents"
	class:wide
	class:large
	role="dialog"
	aria-modal="true"
	aria-label={title}
	tabindex="-1"
	onclick={(e) => e.stopPropagation()}
>
	<header class="modal-header">
		<div>
			<h2>{title}</h2>
			{#if description}
				<p title={description}>{description}</p>
			{/if}
		</div>
		{#if onClose}
			<button
				class="modal-close"
				type="button"
				aria-label="Close dialog"
				onclick={onClose}>×</button
			>
		{/if}
	</header>
	<div class="modal-body">{@render content?.()}</div>
</div>

<style>
	.contents {
		display: grid;
		justify-items: stretch;
		box-sizing: border-box;
		width: min(100%, 460px);
		min-width: min(280px, 100%);
		max-height: calc(100vh - 2rem);
		border: 1px solid rgba(119, 164, 176, 0.3);
		border-radius: 1rem;
		padding: 0;
		background: var(--color-theme-7);
		box-shadow: 0 24px 70px rgba(4, 28, 40, 0.28);
		overflow-y: auto;
		pointer-events: auto;
	}

	.contents.wide {
		width: min(100%, 620px);
	}

	.contents.large {
		width: min(100%, 860px);
	}

	.modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.35rem 1.5rem 1.1rem;
		border-bottom: 1px solid #e0eaec;
	}

	.modal-header > div {
		display: grid;
		gap: 0.28rem;
		min-width: 0;
	}

	h2 {
		text-align: left;
		font-size: clamp(1.35rem, 4vw, 1.75rem);
		line-height: 1.2;
		margin: 0;
		color: #194858;
		font-weight: 750;
		letter-spacing: -0.025em;
	}

	.modal-header p {
		margin: 0;
		overflow: hidden;
		color: #71868d;
		font-size: 0.78rem;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: normal;
	}

	.modal-close {
		display: grid;
		flex: 0 0 2.25rem;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 1px solid #d5e3e6;
		border-radius: 0.55rem;
		background: #f7fafb;
		color: #56727b;
		font: inherit;
		font-size: 1.25rem;
		line-height: 1;
		cursor: pointer;
		transition:
			border-color 0.18s ease,
			background-color 0.18s ease;
	}

	.modal-close:hover,
	.modal-close:focus-visible {
		border-color: #8bb7c1;
		background: #edf6f8;
		outline: none;
	}

	.modal-body {
		display: grid;
		justify-items: stretch;
		padding: 1.35rem 1.5rem 1.5rem;
	}

	@media (max-width: 520px) {
		.modal-header {
			padding: 1.1rem 1.1rem 0.9rem;
		}

		.modal-body {
			padding: 1.1rem;
		}
	}
</style>
