<script>
	const creationDate = new Date(1730553025090).toLocaleDateString();
</script>

<div class="project-card">
	<h1 class="project-name">Example Project Name (ID #1)</h1>
	<div class="language-info">
		<p><strong>Source Language:</strong> English (en)</p>
		<p><strong>Target Language:</strong> German (de)</p>
	</div>
	<p>
		<strong>Created on:</strong> <span id="creationDate">{creationDate}</span>
	</p>
	<p><strong>Type:</strong> Text</p>

	<div class="segments-table">
		<h2>Translation Segments</h2>
		<table>
			<thead>
				<tr>
					<th>#</th>
					<th>Source Segment</th>
					<th>Target Segment</th>
					<th>Checked</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>1</td>
					<td>Segment 1</td>
					<td>Translated Segment 1</td>
					<td><input type="checkbox" checked disabled /></td>
				</tr>
				<tr>
					<td>2</td>
					<td>Segment 2</td>
					<td></td>
					<td><input type="checkbox" disabled /></td>
				</tr>
			</tbody>
		</table>
	</div>
</div>

<style>
	.project-card {
		max-width: 800px;
		margin: auto;
		padding: 20px;
		border-radius: 8px;
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
		background-color: #f8fcff;
	}

	.project-name {
		font-size: 1.8rem;
		margin-bottom: 10px;
		color: #333;
	}

	.language-info p,
	.project-card p {
		font-size: 1rem;
		margin: 5px 0;
		color: #555;
	}

	.segments-table h2 {
		margin-top: 20px;
		font-size: 1.2rem;
		color: #444;
	}

	table {
		width: 100%;
		border-collapse: collapse;
		margin-top: 10px;
	}

	th,
	td {
		padding: 10px;
		border: 1px solid #ddd;
		text-align: left;
	}

	th {
		background-color: #f7f7f7;
		font-weight: bold;
	}

	td {
		font-size: 0.9rem;
	}

	input[type="checkbox"] {
		margin: auto;
	}

	@media (max-width: 390px) {
		.segments-table {
			overflow-x: scroll;
		}
	}
</style>
