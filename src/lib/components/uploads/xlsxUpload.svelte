<script lang="ts">
	// For local storage use
	// import { saveAndOpenNewFileWithStringArray } from "$lib/functions/createNewTranslationOnLocalStorage";

	// For indexedDB use
	import { saveAndOpenNewFileWithStringArray } from "$lib/functions/createNewTranslationOnIndexedDb";

	import { LANGUAGES } from "$lib/components/data/languages";
	import DragAndDropHere from "$lib/components/svg/dragAndDrop.svelte";
	import JSZip from "jszip";

	// let excelFile: File | null = null;

	let temporarySaveName: string = "";
	let extractedStrings: string[] = [];
	let isDragging = false;
	let sourceLanguage = "";
	let targetLanguage = "";
	let extractedXmlContent: { [key: string]: string } = {};

	// Handle file upload and extract the XML structure
	async function handleFileUpload(event: Event) {
		event.preventDefault();
		const inputElement = event.target as HTMLInputElement;
		const file = inputElement.files ? inputElement.files[0] : null;
		if (file) {
			try {
				console.log("File Type: ", file.type);
				// showLoading.set(true);
				const arrayBuffer = await file.arrayBuffer();
				await extractXmlStructure(arrayBuffer);
				// showLoading.set(false);
			} catch (error) {
				console.log(error);
			}
		}
	}

	// Extract the XML files from the .xlsx file and save them as strings
	async function extractXmlStructure(arrayBuffer: ArrayBuffer): Promise<void> {
		const zip = new JSZip();
		const content = await zip.loadAsync(arrayBuffer);
		const sheetData: string[] = [];

		// Iterate through all files and store relevant XML files in extractedXmlContent
		for (const filePath in content.files) {
			{
				const fileContent = await content.files[filePath].async("string");
				extractedXmlContent[filePath] = fileContent;

				// If it's a sheet file, parse it for text strings
				if (filePath.startsWith("xl/worksheets/sheet")) {
					const parsedStrings = parseTextStringsFromSheet(
						fileContent,
						extractedStrings,
					);
					sheetData.push(...parsedStrings); // Aggregate strings from each sheet
					console.log(`Parsed strings from ${filePath}:`, parsedStrings);
				}
			}
		}

		// Log the presence of critical relationship files
		if (extractedXmlContent["_rels/.rels"]) {
			console.log(
				"Included _rels/.rels file:",
				extractedXmlContent["_rels/.rels"],
			);
		} else {
			console.warn("_rels/.rels file not found!");
		}

		if (extractedXmlContent["xl/_rels/workbook.xml.rels"]) {
			console.log(
				"Included xl/_rels/workbook.xml.rels file:",
				extractedXmlContent["xl/_rels/workbook.xml.rels"],
			);
		} else {
			console.warn("xl/_rels/workbook.xml.rels file not found!");
		}

		// Parse shared strings if available
		const sharedStringsXml = extractedXmlContent["xl/sharedStrings.xml"];
		if (sharedStringsXml) {
			extractedStrings = parseSharedStrings(sharedStringsXml);
			console.log("Shared Strings:", extractedStrings);
		} else {
			console.warn("xl/sharedStrings.xml file not found!");
		}

		// Final output with all extracted strings
		console.log("All extracted strings from sheets:", sheetData);
	}

	// Parse shared strings from sharedStrings.xml
	function parseSharedStrings(sharedStringsXml: string): string[] {
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(sharedStringsXml, "application/xml");
		const siElements = xmlDoc.getElementsByTagName("si");
		const strings: string[] = [];

		for (let i = 0; i < siElements.length; i++) {
			const si = siElements[i];
			// Handle rich text by concatenating all <t> elements within <si>
			let text = "";
			const tElements = si.getElementsByTagName("t");
			for (let j = 0; j < tElements.length; j++) {
				text += tElements[j].textContent || "";
			}
			strings.push(text);
		}

		return strings;
	}

	function parseTextStringsFromSheet(
		sheetXml: string,
		sharedStrings: string[],
	): string[] {
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(sheetXml, "application/xml");

		const rowElements = xmlDoc.getElementsByTagName("row");
		const stringArray: string[] = [];

		for (let i = 0; i < rowElements.length; i++) {
			const row = rowElements[i];
			const cellElements = row.getElementsByTagName("c");

			for (let j = 0; j < cellElements.length; j++) {
				const cell = cellElements[j];
				const type = cell.getAttribute("t");
				const valueElement = cell.getElementsByTagName("v")[0];
				const value = valueElement ? valueElement.textContent || "" : "";

				if (type === "s") {
					// Shared string - look up in sharedStrings array
					const index = parseInt(value, 10);
					const sharedString = sharedStrings[index] || "";
					stringArray.push(sharedString);
				} else if (type === "n" || !type) {
					// Numeric or direct value
					stringArray.push(value);
				} else {
					// Handle other types as needed (booleans, dates, etc.)
					stringArray.push(value);
				}
			}
		}

		console.log("Parsed strings from sheet:", stringArray);
		return stringArray;
	}

	// Parse text strings from the XML string generated from a .xlsx file
	function parseTextStringsFromXML(
		xmlDocument: string,
		sharedStrings: string[],
	): string[] {
		const parser = new DOMParser();
		const xmlDoc = parser.parseFromString(xmlDocument, "application/xml");

		const rowElements = xmlDoc.getElementsByTagName("row");
		let stringArray: string[] = [];

		for (let i = 0; i < rowElements.length; i++) {
			const row = rowElements[i];
			const cElements = row.getElementsByTagName("c"); // 'c' elements represent cells

			for (let j = 0; j < cElements.length; j++) {
				const c = cElements[j];
				const t = c.getAttribute("t"); // type attribute
				const vElement = c.getElementsByTagName("v")[0];
				const value = vElement ? vElement.textContent || "" : "";

				if (t === "s") {
					// Shared string
					const index = parseInt(value, 10);
					const sharedString = sharedStrings[index] || "";
					if (sharedString) {
						// Only add if it's a non-empty string
						stringArray.push(sharedString);
					}
				} else if (value) {
					// Other types (e.g., numbers, booleans) - only add if value is non-empty
					stringArray.push(value);
				}
			}
		}

		console.log("Extracted text strings:", stringArray);
		return stringArray;
	}

	function handleDragOver(event: DragEvent): void {
		event.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(): void {
		isDragging = false;
	}

	async function handleDrop(event: DragEvent) {
		event.preventDefault();
		isDragging = false;

		// Access the file directly from the drag event's dataTransfer object
		const file = event.dataTransfer?.files ? event.dataTransfer.files[0] : null;
		if (file) {
			try {
				console.log("File Type: ", file.type);
				// showLoading.set(true);
				const arrayBuffer = await file.arrayBuffer();
				await extractXmlStructure(arrayBuffer);
				// showLoading.set(false);
			} catch (error) {
				console.log(error);
			}
		}
		console.log(extractedStrings);
		console.log(temporarySaveName);
		console.log(sourceLanguage);
		console.log(targetLanguage);
	}

	function check(opt: number, lang: string) {
		if (opt === 1) {
			console.log("source");
			sourceLanguage = lang;
			console.log(sourceLanguage);
		} else {
			console.log("target");
			targetLanguage = lang;
			console.log(targetLanguage);
		}
	}

	function createNewProject() {
		let timestamp = new Date().valueOf().toString();
		saveAndOpenNewFileWithStringArray(
			temporarySaveName,
			sourceLanguage,
			targetLanguage,
			timestamp,
			extractedStrings,
			"xlsx",
			extractedXmlContent,
		);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="container"
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	class:is-dragging={isDragging}
>
	<div class="name-container">
		<input
			class="input-text"
			bind:value={temporarySaveName}
			type="text"
			placeholder="Project Name"
		/>
	</div>

	<div class="language-selection">
		<select onchange={(e) => check(1, (e.target as HTMLSelectElement).value)}>
			<option disabled selected value="">Source Language ▼</option>
			{#each LANGUAGES as lang}
				<option value={lang.name + " (" + lang.code + ")"}
					>{lang.name} ({lang.code})</option
				>
			{/each}
		</select>

		<select onchange={(e) => check(2, (e.target as HTMLSelectElement).value)}>
			<option disabled selected value="">Target Language ▼</option>
			{#each LANGUAGES as lang}
				<option value={lang.name + " (" + lang.code + ")"}
					>{lang.name} ({lang.code})</option
				>
			{/each}
		</select>
	</div>

	{#if extractedStrings.length === 0 || temporarySaveName.length === 0 || sourceLanguage.length === 0 || targetLanguage.length === 0}
		<DragAndDropHere />
		<button class="input-button-container">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				xmlns:xlink="http://www.w3.org/1999/xlink"
				version="1.1"
				id="Capa_1"
				viewBox="0 0 26 26"
				xml:space="preserve"
			>
				<g>
					<path
						d="M25.162,3H16v2.984h3.031v2.031H16V10h3v2h-3v2h3v2h-3v2h3v2h-3v3h9.162   C25.623,23,26,22.609,26,22.13V3.87C26,3.391,25.623,3,25.162,3z M24,20h-4v-2h4V20z M24,16h-4v-2h4V16z M24,12h-4v-2h4V12z M24,8   h-4V6h4V8z"
					/>
					<path
						d="M0,2.889v20.223L15,26V0L0,2.889z M9.488,18.08l-1.745-3.299c-0.066-0.123-0.134-0.349-0.205-0.678   H7.511C7.478,14.258,7.4,14.494,7.277,14.81l-1.751,3.27H2.807l3.228-5.064L3.082,7.951h2.776l1.448,3.037   c0.113,0.24,0.214,0.525,0.304,0.854h0.028c0.057-0.198,0.163-0.492,0.318-0.883l1.61-3.009h2.542l-3.037,5.022l3.122,5.107   L9.488,18.08L9.488,18.08z"
					/>
				</g>
			</svg>
			Upload XLSX File
			<input
				id="fileInputExcel"
				type="file"
				accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
				oninput={handleFileUpload}
			/>
		</button>
	{:else}
		<button class="create-button-container" onclick={createNewProject}>
			Create Project +
		</button>
	{/if}

	<!-- <button
		onclick={() =>
			createXlsxFromModifiedXmlText(
				$userData[$translationIdSelected].typeRef,
				$userData[$translationIdSelected].seg2,
				$userData[$translationIdSelected].name,
			)}
	>
		Download Translation in Xlsx Format
	</button> -->
</div>

<style>
</style>
