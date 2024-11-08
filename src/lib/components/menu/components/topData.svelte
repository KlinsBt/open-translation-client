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
</style>
