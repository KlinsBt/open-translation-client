<script lang="ts">
	import type { Snippet } from "svelte";
	import { onDestroy, onMount } from "svelte";
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
	let dialog: HTMLElement;
	let previouslyFocused: HTMLElement | null = null;
	let previousBodyOverflow = "";
	let focusFrame: number | null = null;
	let isolatedElements: Array<{
		element: HTMLElement;
		inert: boolean;
		ariaHidden: string | null;
	}> = [];

	const FOCUSABLE =
		'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === "Escape") {
			event.preventDefault();
			onClose?.();
			return;
		}
		if (event.key !== "Tab") return;
		const focusable = Array.from(
			dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
		).filter((element) => element.offsetParent !== null);
		if (focusable.length === 0) {
			event.preventDefault();
			dialog?.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable.at(-1)!;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	onMount(() => {
		previouslyFocused =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		const overlay = dialog.parentElement;
		if (overlay?.parentElement) {
			for (const sibling of Array.from(overlay.parentElement.children)) {
				if (sibling === overlay || !(sibling instanceof HTMLElement)) continue;
				isolatedElements.push({
					element: sibling,
					inert: sibling.inert,
					ariaHidden: sibling.getAttribute("aria-hidden"),
				});
				sibling.inert = true;
				sibling.setAttribute("aria-hidden", "true");
			}
		}
		focusFrame = requestAnimationFrame(() => {
			focusFrame = null;
			(dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
		});
	});

	onDestroy(() => {
		if (focusFrame !== null) cancelAnimationFrame(focusFrame);
		document.body.style.overflow = previousBodyOverflow;
		for (const { element, inert, ariaHidden } of isolatedElements) {
			element.inert = inert;
			if (ariaHidden === null) element.removeAttribute("aria-hidden");
			else element.setAttribute("aria-hidden", ariaHidden);
		}
		previouslyFocused?.focus();
	});
</script>

<svelte:window onkeydown={handleKeydown} />

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
	bind:this={dialog}
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
