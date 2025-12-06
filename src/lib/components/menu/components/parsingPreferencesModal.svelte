<script lang="ts">
	import Modal from "../../modal.svelte";
	import type { ParsingPreference } from "$lib/functions/parsing/parsingPreferences";
	import {
		addParsingPreference,
		setActiveParsingPreference,
		deleteParsingPreference,
		updateParsingPreference,
	} from "$lib/functions/parsing/parsingPreferences";
	import {
		notifySuccess,
		notifyInfo,
		notifyError,
	} from "$lib/components/notifications/toastStore";

	let {
		show = $bindable(),
		parsingPreferences = $bindable(),
	}: {
		show: boolean;
		parsingPreferences: ParsingPreference[];
	} = $props();

	let newParsingLabel: string = $state("");
	let currentTokenInput: string = $state("");
	let tokens: string[] = $state([]);
	let editingId: string | null = $state(null);

	function handleAddToken() {
		// Only reject completely empty strings, but allow spaces if there's content
		const token = currentTokenInput;
		const hasContent = token.trim().length > 0;

		if (hasContent && !tokens.includes(token)) {
			tokens = [...tokens, token];
			currentTokenInput = "";
		}
	}

	function handleRemoveToken(tokenToRemove: string) {
		tokens = tokens.filter((t) => t !== tokenToRemove);
	}

	function handleKeyPress(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			handleAddToken();
		}
	}

	function handleAddParsingPreference() {
		if (tokens.length === 0) return;

		if (editingId) {
			parsingPreferences = updateParsingPreference(
				editingId,
				newParsingLabel.trim(),
				tokens,
			);
			notifyInfo("Preset updated");
		} else {
			parsingPreferences = addParsingPreference(newParsingLabel.trim(), tokens);
			notifySuccess("Preset added");
		}
		newParsingLabel = "";
		tokens = [];
		currentTokenInput = "";
		editingId = null;
	}

	function handleActivateParsingPreference(id: string) {
		parsingPreferences = setActiveParsingPreference(id);
		notifySuccess("Preset activated");
	}

	function handleDeleteParsingPreference(id: string) {
		parsingPreferences = deleteParsingPreference(id);
		notifyError("Preset deleted");
	}

	function handleEditParsingPreference(pref: ParsingPreference) {
		if (pref.id === "default") return;
		editingId = pref.id;
		newParsingLabel = pref.label;
		tokens = [...pref.tokens];
		currentTokenInput = "";
		show = true;
	}

	function handleCancelEdit() {
		editingId = null;
		newParsingLabel = "";
		tokens = [];
		currentTokenInput = "";
	}

	// Helper function to visualize spaces in tokens
	function displayToken(token: string): string {
		// Replace spaces with a visible character for better UX
		return token.replace(/ /g, "·");
	}
</script>

{#snippet parsingSettings()}
	<div class="options-container">
		<div class="parsing-form">
			<input
				type="text"
				placeholder="Preset name (optional)"
				bind:value={newParsingLabel}
			/>

			<div class="token-input-section">
				<p class="helper-text">
					Add tokens that will split text into segments (spaces are preserved,
					press Enter or click "+ Add")
				</p>
				<div class="token-input-wrapper">
					<input
						type="text"
						placeholder="Add token (e.g. '.' or '. ' with space)"
						bind:value={currentTokenInput}
						onkeypress={handleKeyPress}
					/>
					<button
						class="btn-add-token"
						onclick={handleAddToken}
						type="button"
						disabled={!currentTokenInput.trim()}
					>
						+ Add
					</button>
				</div>

				{#if tokens.length > 0}
					<div class="token-chips">
						{#each tokens as token}
							<span class="token-chip" title={token}>
								{displayToken(token)}
								<button
									class="remove-token"
									onclick={() => handleRemoveToken(token)}
									type="button"
									aria-label="Remove token"
								>
									×
								</button>
							</span>
						{/each}
					</div>
				{:else}
					<p class="no-tokens-text">No tokens added yet</p>
				{/if}
			</div>

			<div class="form-actions">
				<button
					class="btn save"
					onclick={handleAddParsingPreference}
					disabled={tokens.length === 0}
				>
					{editingId ? "Save changes" : "Add Preset"}
				</button>
				{#if editingId}
					<button class="btn update" onclick={handleCancelEdit}>
						Cancel
					</button>
				{/if}
			</div>
		</div>

		<div class="parsing-list">
			{#each parsingPreferences as pref}
				{#if pref}
					<div class="parsing-item">
						<div class="parsing-item-info">
							<div class="title">
								{pref.label || "Custom preset"}
								{#if pref.id === "default"}
									<span class="default-badge">default</span>
								{/if}
								{#if pref.active}
									<span class="active-badge">(active)</span>
								{/if}
							</div>
							<div class="tokens" title={pref.tokens.join(", ")}>
								{pref.tokens.map((t) => displayToken(t)).join(", ")}
							</div>
						</div>
						<div class="actions">
							<button
								class="btn option"
								disabled={pref.active}
								onclick={() => handleActivateParsingPreference(pref.id)}
							>
								Activate
							</button>
							<button
								class="btn delete"
								disabled={pref.id === "default"}
								onclick={() => handleDeleteParsingPreference(pref.id)}
							>
								Delete
							</button>
							<button
								class="btn option"
								disabled={pref.id === "default"}
								onclick={() => handleEditParsingPreference(pref)}
							>
								Edit
							</button>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</div>
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	role="dialog"
	class="modal-element-global {show ? '' : 'close-modal-global'}"
	onclick={() => (show = false)}
>
	<Modal title="Parsing Preferences" content={parsingSettings} />
</div>

<style>
	.options-container {
		display: flex;
		flex-direction: column;
		justify-content: flex-start;
		align-items: stretch;
		gap: 20px;
		padding: 0px;
		/* min-width: 380px; */
		max-width: 500px;
		max-height: 70vh;
		overflow: hidden;
	}

	.parsing-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex-shrink: 0;
	}

	.parsing-form input {
		padding: 10px 12px;
		border: 1px solid var(--color-theme-4);
		border-radius: 5px;
		font-size: 1rem;
		font-family: var(--font-body);
	}

	.parsing-form input:focus {
		outline: none;
		border-color: var(--color-theme-3);
	}

	.token-input-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.helper-text {
		font-size: 0.85rem;
		color: var(--color-theme-5);
		margin: 0;
		font-weight: 500;
	}

	.no-tokens-text {
		font-size: 0.9rem;
		color: var(--color-theme-5);
		text-align: center;
		padding: 16px;
		margin: 0;
		font-style: italic;
	}

	.token-input-wrapper {
		display: flex;
		gap: 8px;
		align-items: stretch;
	}

	.token-input-wrapper input {
		flex: 1;
	}

	.btn-add-token {
		background: var(--color-theme-4);
		color: white;
		border: none;
		border-radius: 5px;
		padding: 10px 16px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: filter 0.2s linear;
		white-space: nowrap;
	}

	.btn-add-token:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn-add-token:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.token-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		padding: 12px;
		background: var(--color-theme-8);
		border-radius: 5px;
		border: 1px solid var(--color-theme-1);
		min-height: 45px;
		align-items: center;
	}

	.token-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: var(--color-theme-4);
		color: white;
		padding: 6px 10px;
		border-radius: 20px;
		font-size: 0.9rem;
		font-weight: 500;
	}

	.remove-token {
		background: none;
		border: none;
		color: white;
		font-size: 1.3rem;
		line-height: 1;
		cursor: pointer;
		padding: 0;
		width: 18px;
		height: 18px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 50%;
		transition: background-color 0.2s;
	}

	.remove-token:hover {
		background-color: rgba(255, 255, 255, 0.2);
	}

	.form-actions {
		display: flex;
		gap: 8px;
		flex-direction: column;
	}

	.form-actions .btn {
		display: flex;
		align-items: center;
		justify-content: center;
		border: none;
		font-size: 1.1rem;
		font-weight: 600;
		border-radius: 5px;
		padding: 12px;
		cursor: pointer;
		width: 100%;
		transition: filter 0.2s linear;
		color: white;
	}

	.form-actions .btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.form-actions .btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.parsing-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow-y: auto;
		max-height: calc(70vh - 280px);
		min-height: 150px;
		padding-right: 8px;
	}

	.parsing-list::-webkit-scrollbar {
		width: 8px;
	}

	.parsing-list::-webkit-scrollbar-track {
		background: var(--color-theme-8);
		border-radius: 4px;
	}

	.parsing-list::-webkit-scrollbar-thumb {
		background: var(--color-theme-4);
		border-radius: 4px;
	}

	.parsing-list::-webkit-scrollbar-thumb:hover {
		background: var(--color-theme-3);
	}

	.parsing-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border: 2px solid var(--color-theme-1);
		border-radius: 5px;
		padding: 12px 14px;
		gap: 14px;
		background: white;
	}

	.parsing-item-info {
		flex: 1;
		min-width: 0;
	}

	.parsing-item .title {
		font-weight: 600;
		font-size: 1rem;
		color: var(--color-theme-4);
		margin-bottom: 4px;
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.parsing-item .active-badge {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-theme-9);
	}

	.parsing-item .default-badge {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--color-theme-5);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.parsing-item .tokens {
		font-size: 0.9rem;
		color: var(--color-theme-5);
		word-break: break-word;
	}

	.parsing-item .actions {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 100px;
	}

	.parsing-item .actions .btn {
		border: none;
		border-radius: 5px;
		padding: 8px 12px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		transition: filter 0.2s linear;
		color: white;
	}

	.parsing-item .actions .btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}
</style>
