<script lang="ts">
	import {
		userData,
		userDataStatistics,
	} from "$lib/functions/saveData/stores.svelte";

	// userDataStatistics[0] == TotalProjectsPercentage
	// userDataStatistics[1] == finishedProjects
	// userDataStatistics[2] == totalWords
	// userDataStatistics[3] == totalWordsTranslated
	let totalProjects = $userData.length;
</script>

<div class="dashboard">
	<div class="section">
		<h3>Projects</h3>
		<div class="progress-container">
			<div class="progress-bar">
				<div class="progress" style="width: {$userDataStatistics[0]}%;"></div>
			</div>
			<span class="percentage">{$userDataStatistics[0]}%</span>
		</div>
	</div>

	<div class="stats">
		<div class="stat">
			<span class="large">{totalProjects}</span> Total Projects
		</div>
		<div class="stat">
			<span class="large">{$userDataStatistics[1]}</span> Finished Projects
		</div>
	</div>
</div>

<style>
	.dashboard {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-evenly;
		align-items: center;
		background-color: #2e3a44;
		background-color: var(--color-theme-5);
		padding: 1rem 0rem;
		gap: 3rem 2rem;
		color: white;
	}

	.section {
		display: grid;
		gap: 10px 0px;
		justify-content: center;
		align-items: center;
	}

	.section > h3 {
		font-size: 1.2rem;
		font-weight: 500;
		color: rgb(200, 200, 200);
		margin: 0px;
		padding: 0px;
		max-width: 150px;
		/* text-align: center; */
	}

	.progress-container {
		display: flex;
		align-items: center;
	}

	.progress-bar {
		width: 150px;
		height: 5px;
		background-color: #4b5963;
		border-radius: 5px;
		position: relative;
	}

	.progress {
		height: 100%;
		background-color: var(--color-theme-7);
		border-radius: 5px;
	}

	.percentage {
		font-size: 0.8rem;
		color: var(--color-theme-7);
		margin-left: 5px;
	}

	.stats {
		display: flex;
		gap: 2rem;
		justify-content: center;
		align-items: center;
	}

	.stat {
		display: flex;
		justify-content: center;
		align-items: center;
		font-size: 0.7rem;
		text-transform: uppercase;
		color: rgb(200, 200, 200);
		max-width: 80px;
	}

	.large {
		font-size: 1.8rem;
		font-weight: 600;
		color: white;
		margin-right: 0.2rem;
	}
</style>
