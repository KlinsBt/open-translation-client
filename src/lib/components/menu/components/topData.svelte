<script lang="ts">
	import { userData } from "$lib/functions/saveData/stores.svelte";
	import { getProjectsProgressStatistics } from "$lib/functions/statistics";

	let statistics = $derived(getProjectsProgressStatistics($userData));
</script>

<div class="overview-bar">
	<div class="overview-inner">
		<div class="section">
			<div>
				<p>Workspace overview</p>
				<h2>Projects</h2>
			</div>
			<div
				class="progress-container"
				role="progressbar"
				aria-label="Overall project completion"
				aria-valuemin="0"
				aria-valuemax="100"
				aria-valuenow={statistics[0]}
			>
				<div class="progress-bar">
					<div class="progress" style={`width: ${statistics[0]}%`}></div>
				</div>
				<span class="percentage">{statistics[0]}% complete</span>
			</div>
		</div>

		<div class="stats">
			<div class="stat">
				<span class="large">{$userData.length}</span>
				<span>Total projects</span>
			</div>
			<div class="stat">
				<span class="large">{statistics[1]}</span>
				<span>Finished</span>
			</div>
			<div class="stat words-stat">
				<span class="large">{statistics[2].toLocaleString()}</span>
				<span>Source words</span>
			</div>
		</div>
	</div>
</div>

<style>
	.overview-bar {
		width: 100%;
		background: linear-gradient(110deg, var(--color-theme-5), #174b70);
		box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.08);
		color: white;
	}

	.overview-inner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 1.25rem 3rem;
		width: min(1240px, calc(100% - 3rem));
		min-height: 5.5rem;
		margin: 0 auto;
		padding: 0.85rem 0;
	}

	.section {
		display: flex;
		flex: 1 1 390px;
		align-items: center;
		gap: 2.5rem;
	}

	.section p {
		margin: 0 0 0.2rem;
		color: #a9d4e3;
		font-size: 0.64rem;
		font-weight: 750;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}

	.section h2 {
		margin: 0;
		color: white;
		font-size: 1.15rem;
		font-weight: 650;
	}

	.progress-container {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.65rem;
		max-width: 340px;
	}

	.progress-bar {
		flex: 1;
		height: 0.4rem;
		background: rgba(255, 255, 255, 0.2);
		border-radius: 999px;
		position: relative;
		overflow: hidden;
	}

	.progress {
		height: 100%;
		background-color: var(--color-theme-7);
		border-radius: inherit;
		transition: width 0.3s ease;
	}

	.percentage {
		min-width: 5.4rem;
		font-size: 0.7rem;
		font-weight: 700;
		color: #d7eef5;
	}

	.stats {
		display: flex;
		gap: 1.8rem;
		align-items: center;
	}

	.stat {
		display: grid;
		grid-template-columns: auto minmax(54px, auto);
		align-items: center;
		gap: 0.35rem;
		color: #bdd8e2;
		font-size: 0.62rem;
		font-weight: 700;
		letter-spacing: 0.045em;
		line-height: 1.15;
		text-transform: uppercase;
	}

	.large {
		font-size: 1.55rem;
		font-weight: 750;
		color: white;
		letter-spacing: -0.04em;
	}

	@media (max-width: 760px) {
		.overview-inner {
			width: calc(100% - 1.5rem);
			padding-block: 1rem;
		}

		.section {
			align-items: flex-start;
			flex-direction: column;
			gap: 0.7rem;
		}

		.progress-container {
			width: 100%;
			max-width: none;
		}

		.stats {
			width: 100%;
			justify-content: space-between;
			gap: 0.75rem;
		}

		.words-stat {
			display: none;
		}
	}
</style>
