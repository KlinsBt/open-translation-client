<script lang="ts">
	import * as msgpack from "@msgpack/msgpack";

	let temporarySaveName: string = "";
	let binaryFile: Uint8Array | null = null;
	let jsonData: Record<string, unknown> | null = null;
	const defaultFilename = "download";

	function getDownloadFilename(extension: string): string {
		return temporarySaveName.trim() || defaultFilename + extension;
	}

	export function handleJsonFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

		if (file) {
			const reader = new FileReader();
			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						jsonData = JSON.parse(e.target.result as string);
						console.log("JSON Data Parsed:", jsonData);
						binaryFile = msgpack.encode(jsonData);
					}
				} catch (error) {
					console.error("Invalid JSON file", error);
				}
			};
			reader.readAsText(file);
		}
	}

	export function handleBinaryFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

		if (file) {
			const reader = new FileReader();
			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						const arrayBuffer = e.target.result as ArrayBuffer;
						jsonData = msgpack.decode(new Uint8Array(arrayBuffer)) as Record<
							string,
							unknown
						>;
						console.log("Decoded JSON from Binary:", jsonData);
					}
				} catch (error) {
					console.error("Invalid MessagePack binary file", error);
				}
			};
			reader.readAsArrayBuffer(file);
		}
	}

	function downloadBinaryFile(): void {
		if (binaryFile) {
			const blob = new Blob([binaryFile], { type: "application/octet-stream" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = getDownloadFilename(".bin");
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}
	}

	function downloadJsonFile(): void {
		if (jsonData) {
			const blob = new Blob([JSON.stringify(jsonData, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = getDownloadFilename(".json");
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}
	}
</script>

<div class="container">
	<h3>Name for save file</h3>
	<input class="input-text" bind:value={temporarySaveName} type="text" />

	<button onclick={() => document.getElementById("fileInputJson")?.click()}>
		Upload JSON File
	</button>
	<input
		id="fileInputJson"
		type="file"
		accept="application/json"
		onchange={handleJsonFileUpload}
	/>

	<button onclick={() => document.getElementById("fileInputBinary")?.click()}>
		Upload Binary File
	</button>
	<input
		id="fileInputBinary"
		type="file"
		accept=".bin"
		onchange={handleBinaryFileUpload}
	/>

	<button onclick={downloadBinaryFile} disabled={!binaryFile}>
		Download Binary File
	</button>
	<button onclick={downloadJsonFile} disabled={!jsonData}>
		Download JSON File
	</button>
</div>

<style>
	.container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.input-text {
		width: 100%;
		max-width: 270px;
	}

	.input-button-container {
		display: flex;
		position: relative;
		justify-content: center;
		align-items: center;
		background: var(--color-theme-1);
		color: white;
		border: none;
		font-size: 1.3rem;
		border-radius: 5px;
		padding: 10px;
		margin: 10px 0px;
		cursor: pointer;
		width: 100%;
		transition: filter 0.2s linear;
	}

	.input-button-container:hover {
		filter: brightness(1.1);
	}

	.input-button-container:active {
		filter: brightness(1);
		transform: scale(0.99);
	}

	.input-button-container > input[type="file"] {
		position: absolute;
		width: 100%;
		height: 100%;
		top: 0;
		left: 0;
		opacity: 0;
		pointer-events: none;
		cursor: pointer;
	}

	.input-button-container > svg {
		max-width: 30px;
		max-height: 30px;
		margin-right: 10px;
		padding: 0px;
	}

	/* .input-button-container > svg path {
		fill: white;
	} */
</style>
