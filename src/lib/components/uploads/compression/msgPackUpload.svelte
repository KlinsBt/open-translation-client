<script lang="ts">
	import * as msgpack from "@msgpack/msgpack";

	let temporarySaveName: string = "";
	let binaryFile: Uint8Array | null = null;
	let jsonData: Record<string, unknown> | null = null;

	// Function to handle JSON file upload and convert to MessagePack binary
	export function handleJsonFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

		if (file && file.type === "application/json") {
			const reader = new FileReader();
			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						jsonData = JSON.parse(e.target.result as string) as Record<
							string,
							unknown
						>;
						binaryFile = msgpack.encode(jsonData);
						downloadBinaryFile();
					}
				} catch (error) {
					console.error("Invalid JSON file", error);
				}
			};
			reader.readAsText(file);
		} else {
			console.error("Please upload a valid JSON file");
		}
	}

	// Function to handle MessagePack binary file upload and convert to JSON
	export function handleBinaryFileUpload(event: Event): void {
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;

		if (file) {
			const reader = new FileReader();
			reader.onload = (e: ProgressEvent<FileReader>) => {
				try {
					if (e.target?.result) {
						const arrayBuffer = e.target.result as ArrayBuffer;
						const decodedData = msgpack.decode(new Uint8Array(arrayBuffer));
						jsonData = decodedData as Record<string, unknown>;
						downloadJsonFile();
					}
				} catch (error) {
					console.error("Invalid MessagePack binary file", error);
				}
			};
			reader.readAsArrayBuffer(file);
		} else {
			console.error("Please upload a valid MessagePack binary file");
		}
	}

	// Function to download the binary file
	function downloadBinaryFile(): void {
		if (binaryFile) {
			const blob = new Blob([binaryFile], { type: "application/octet-stream" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${temporarySaveName}.bin`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}
	}

	// Function to download the JSON file
	function downloadJsonFile(): void {
		if (jsonData) {
			const blob = new Blob([JSON.stringify(jsonData, null, 2)], {
				type: "application/json",
			});
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `${temporarySaveName}.json`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}
	}
</script>

<div class="container">
	<h3 style="margin: 20px 0px 0px 0px">Name for save file</h3>
	<input class="input-text" bind:value={temporarySaveName} type="text" />

	<button
		class="input-button-container"
		onclick={() => document.getElementById("fileInputJson")?.click()}
	>
		<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 58 58">
			<g> </g>
		</svg>
		Upload JSON File
		<input
			id="fileInputJson"
			type="file"
			accept="application/json"
			onchange={handleJsonFileUpload}
		/>
	</button>

	<button
		class="input-button-container"
		onclick={() => document.getElementById("fileInputBinary")?.click()}
	>
		<svg xmlns="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 58 58">
			<g> </g>
		</svg>
		Upload MessagePack Binary File
		<input
			id="fileInputBinary"
			type="file"
			accept=".bin"
			onchange={handleBinaryFileUpload}
		/>
	</button>

	<button onclick={downloadBinaryFile}>Download Binary File</button>
	<button onclick={downloadJsonFile}>Download JSON File</button>
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
