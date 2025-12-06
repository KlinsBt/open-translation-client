<script lang="ts">
	import { toastStore } from "./toastStore";
	import { fly, fade } from "svelte/transition";
</script>

<div class="toast-container" aria-live="polite" aria-atomic="true">
	{#each $toastStore as toast (toast.id)}
		<div
			class={`toast ${toast.type}`}
			role="status"
			in:fly={{ y: 10, duration: 150 }}
			out:fade={{ duration: 150 }}
		>
			<span>{toast.message}</span>
			<button
				class="close"
				aria-label="Dismiss"
				on:click={() => toastStore.remove(toast.id)}
			>
				×
			</button>
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		top: 16px;
		right: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 9999;
		pointer-events: none;
	}

	.toast {
		min-width: 240px;
		max-width: 360px;
		padding: 10px 12px;
		border-radius: 6px;
		box-shadow: 0 8px 18px rgba(0, 0, 0, 0.15);
		color: var(--color-theme-5);
		background: #eef2f6;
		border: 1px solid rgba(0, 0, 0, 0.05);
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 8px;
		pointer-events: auto;
		font-size: 1.1rem;
	}

	.toast.info {
		border-color: #d0e4ff;
		background: #acd0ff;
	}

	.toast.success {
		border-color: #c6f3d2;
		background: #9fffc1;
	}

	.toast.error {
		border-color: #ffd4d4;
		background: #ff9b9b;
	}

	.toast.warning {
		border-color: #ffe6b3;
		background: #ffeaba;
	}

	.close {
		background: transparent;
		border: none;
		font-size: 1rem;
		color: inherit;
		cursor: pointer;
		padding: 2px 4px;
	}

	.close:focus-visible {
		outline: 2px solid currentColor;
		border-radius: 4px;
	}
</style>
