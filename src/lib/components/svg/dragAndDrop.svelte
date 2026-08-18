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

	<h2>Drop your file here</h2>
	<p>or choose it from your device</p>
</div>

<style>
	.drag-and-drop-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		border-radius: 10px;
		padding: 0.25rem 0;
		margin: 0;
		text-align: center;
	}

	svg {
		width: 44px;
		height: 44px;
		margin: 0 0 0.25rem;
		border-radius: 50%;
		background: rgba(61, 163, 190, 0.1);
		padding: 0.65rem;
		transition: stroke 0.3s ease;
	}

	.drag-and-drop-container h2 {
		font-size: 0.9rem;
		margin: 0;
		color: #275665;
		font-weight: 750;
	}

	.drag-and-drop-container > p {
		font-size: 0.74rem;
		color: #71878e;
		margin: 0;
	}

	svg > path {
		stroke: var(--color-theme-4);
		stroke-width: 1.4;
	}
</style>
