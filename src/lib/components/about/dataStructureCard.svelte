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
</style>
