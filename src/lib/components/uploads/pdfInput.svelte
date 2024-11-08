<script lang="ts">
	// import { handleFileUpload } from "../../functions/uploadConversion";
	const handleFileUpload = () => {
		return null;
	};
</script>

<button class="input-button-container">
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15 15" fill="none">
		<path
			d="M3.5 8H3V7H3.5C3.77614 7 4 7.22386 4 7.5C4 7.77614 3.77614 8 3.5 8Z"
		/>
		<path
			d="M7 10V7H7.5C7.77614 7 8 7.22386 8 7.5V9.5C8 9.77614 7.77614 10 7.5 10H7Z"
		/>
		<path
			fill-rule="evenodd"
			clip-rule="evenodd"
			d="M1 1.5C1 0.671573 1.67157 0 2.5 0H10.7071L14 3.29289V13.5C14 14.3284 13.3284 15 12.5 15H2.5C1.67157 15 1 14.3284 1 13.5V1.5ZM3.5 6H2V11H3V9H3.5C4.32843 9 5 8.32843 5 7.5C5 6.67157 4.32843 6 3.5 6ZM7.5 6H6V11H7.5C8.32843 11 9 10.3284 9 9.5V7.5C9 6.67157 8.32843 6 7.5 6ZM10 11V6H13V7H11V8H12V9H11V11H10Z"
		/>
	</svg>
	Upload PDF File
	<input
		id="fileInputPdf"
		type="file"
		accept="application/json"
		oninput={handleFileUpload}
	/>
</button>

<style>
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
		margin: 0px 10px 0px 0px;
		padding: 0px;
	}

	.input-button-container > svg path {
		fill: white;
	}
</style>
