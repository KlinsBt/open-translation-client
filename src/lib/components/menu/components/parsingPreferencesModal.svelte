<script lang="ts">
	import Modal from "../../modal.svelte";
	import type { ParsingPreference } from "$lib/functions/parsing/parsingPreferences";
	import {
		addParsingPreference,
		setActiveParsingPreference,
		deleteParsingPreference,
		updateParsingPreference,
		addSrxParsingPreference,
	} from "$lib/functions/parsing/parsingPreferences";
	import { buildSrx20Blob, importSrx20File } from "$lib/formats/srx20";
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
	let srxLanguageCode: string = $state("en");

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

	async function handleSrxImport(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			const document = await importSrx20File(file);
			parsingPreferences = addSrxParsingPreference(
				file.name.replace(/\.srx$/i, ""),
				srxLanguageCode,
				document,
			);
			notifySuccess("SRX 2.0 profile imported");
		} catch (error) {
			notifyError(error instanceof Error ? error.message : "Invalid SRX file");
		} finally {
			input.value = "";
		}
	}

	function handleSrxExport(pref: ParsingPreference) {
		if (!pref.srx) return;
		try {
			const url = URL.createObjectURL(buildSrx20Blob(pref.srx));
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = `${pref.label.replace(/\.srx$/i, "")}.srx`;
			document.body.appendChild(anchor);
			anchor.click();
			document.body.removeChild(anchor);
			URL.revokeObjectURL(url);
		} catch (error) {
			notifyError(
				error instanceof Error ? error.message : "Could not export SRX",
			);
		}
	}

	// Helper function to visualize spaces in tokens
	function displayToken(token: string): string {
		// Replace spaces with a visible character for better UX
		return token.replace(/ /g, "·");
	}
</script>

{#snippet parsingSettings()}
	<div class="options-container">
		<div class="srx-import-section modal-section-card">
			<p class="helper-text">
				Import an SRX 2.0 workflow asset and choose the BCP 47 source-language
				code its maps should evaluate.
			</p>
			<div class="token-input-wrapper">
				<input
					type="text"
					aria-label="SRX source language code"
					placeholder="Source language code (e.g. en-US)"
					bind:value={srxLanguageCode}
				/>
				<label class="modal-button secondary compact srx-file-button">
					Import SRX
					<input
						type="file"
						accept=".srx,application/srx+xml,application/xml,text/xml"
						onchange={handleSrxImport}
					/>
				</label>
			</div>
		</div>

		<div class="parsing-form modal-section-card">
			<label class="modal-field">
				<span>Preset name</span>
				<input
					type="text"
					placeholder="Preset name (optional)"
					bind:value={newParsingLabel}
				/>
			</label>

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
						class="modal-button secondary compact btn-add-token"
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
					class="modal-button primary"
					onclick={handleAddParsingPreference}
					disabled={tokens.length === 0}
				>
					{editingId ? "Save changes" : "Add Preset"}
				</button>
				{#if editingId}
					<button class="modal-button quiet" onclick={handleCancelEdit}>
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
							{#if pref.kind === "srx" && pref.srx}
								<div class="tokens">
									SRX 2.0 · {pref.languageCode} · {pref.srx.languageRules
										.length}
									rule sets
								</div>
							{:else}
								<div class="tokens" title={pref.tokens.join(", ")}>
									{pref.tokens.map((t) => displayToken(t)).join(", ")}
								</div>
							{/if}
						</div>
						<div class="actions">
							<button
								class="modal-button secondary compact"
								disabled={pref.active}
								onclick={() => handleActivateParsingPreference(pref.id)}
							>
								Activate
							</button>
							<button
								class="modal-button danger compact"
								disabled={pref.id === "default"}
								onclick={() => handleDeleteParsingPreference(pref.id)}
							>
								Delete
							</button>
							{#if pref.kind === "srx"}
								<button
									class="modal-button secondary compact"
									onclick={() => handleSrxExport(pref)}
								>
									Export
								</button>
							{:else}
								<button
									class="modal-button secondary compact"
									disabled={pref.id === "default"}
									onclick={() => handleEditParsingPreference(pref)}
								>
									Edit
								</button>
							{/if}
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
	role="presentation"
	class="modal-element-global {show ? '' : 'close-modal-global'}"
	onclick={() => (show = false)}
>
	<Modal
		title="Parsing preferences"
		description="Manage segmentation tokens and reusable SRX 2.0 profiles."
		content={parsingSettings}
		large
		onClose={() => (show = false)}
	/>
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
		max-height: min(72vh, 720px);
		overflow: auto;
	}

	.parsing-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex-shrink: 0;
	}

	.srx-import-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 1rem;
	}

	.srx-file-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		white-space: nowrap;
		cursor: pointer;
		width: auto;
		min-width: 8.5rem;
		flex: 0 0 auto;
	}

	.srx-file-button input[type="file"] {
		display: none;
	}

	.srx-import-section input[type="text"] {
		min-width: 0;
		padding: 10px 12px;
		border: 1px solid var(--color-theme-4);
		border-radius: 0.55rem;
		font: inherit;
	}

	.parsing-form input {
		padding: 10px 12px;
		border: 1px solid var(--color-theme-4);
		border-radius: 0.55rem;
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

	.token-input-wrapper > input:not([type="file"]) {
		flex: 1;
		min-width: 10rem;
	}

	.btn-add-token {
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
		flex-direction: row;
	}

	.parsing-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow-y: auto;
		max-height: 290px;
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
		border: 1px solid #d6e5e8;
		border-radius: 0.7rem;
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
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 6px;
		min-width: min(100%, 300px);
	}

	@media (max-width: 680px) {
		.token-input-wrapper,
		.form-actions,
		.parsing-item {
			align-items: stretch;
			flex-direction: column;
		}

		.parsing-item .actions {
			grid-template-columns: 1fr;
			min-width: 100%;
		}

		.srx-file-button {
			width: 100%;
		}
	}
</style>
