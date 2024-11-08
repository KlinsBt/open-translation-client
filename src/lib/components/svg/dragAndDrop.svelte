<script>
</script>

<div class="drag-and-drop-container">
	<svg
		xmlns="http://www.w3.org/2000/svg"
		width="800px"
		height="800px"
		viewBox="0 0 24 24"
		fill="none"
	>
		<path
			d="M7 16H6C4.89543 16 4 15.1046 4 14V7C4 5.89543 4.89543 5 6 
            5H18C19.1046 5 20 5.89543 20 7V14C20 15.1046 19.1046 16 18 16H17M12 
            20V9M12 9L15 12M12 9L9 12"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>

	<h2>Drag and drop file here</h2>
	<p>or</p>
</div>

<style>
	.drag-and-drop-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		padding: 0px;
		margin: 0px;
		text-align: center;
	}

	svg {
		width: 50px;
		height: 50px;
		margin: 0px;
		transition: stroke 0.3s ease;
	}

	.drag-and-drop-container h2 {
		font-size: 15px;
		margin: 0;
		color: var(--color-theme-4);
	}

	.drag-and-drop-container > p {
		font-size: 15px;
		color: var(--color-theme-5);
		margin: 0px;
	}

	svg > path {
		stroke: var(--color-theme-4);
		stroke-width: 1;
	}
</style>
