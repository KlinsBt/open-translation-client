<script>
    import Tesseract from "tesseract.js";
    import { onMount } from "svelte";

    let canvas;
    let ctx;
    let imageFile;
    let image;
    let detectedTextRegions = [];
    let selectedRegionIndex = -1;
    let editText = ""; // Variable to hold the new text for the selected region
    let textWeight = 500;

    onMount(() => {
        ctx = canvas.getContext("2d");
    });

    async function processImageWords() {
        processImage("words");
    }

    async function processImageSentences() {
        processImage("lines");
    }

    async function processImage(mode) {
        if (!imageFile) return;

        image = await loadImage(imageFile);
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);

        const result = await Tesseract.recognize(imageFile, "eng");
        detectedTextRegions = mode === "words" ? result.data.words : result.data.lines;

        // highlightTextRegions(); // Uncomment if you want to highlight regions
    }

    // function highlightTextRegions() {
    //     detectedTextRegions.forEach(word => {
    //         const { bbox } = word;
    //         ctx.strokeStyle = "red";
    //         ctx.strokeRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
    //     });
    // }

    function loadImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    function removeText(region) {
        const { bbox } = region;
        const padding = 3; // Number of pixels around the text to include in the average
        const areaWidth = bbox.x1 - bbox.x0;
        const areaHeight = bbox.y1 - bbox.y0;

        let totalR = 0, totalG = 0, totalB = 0, count = 0;

        // Calculate the average color of the surrounding pixels
        for (let y = bbox.y0 - padding; y < bbox.y1 + padding; y++) {
            for (let x = bbox.x0 - padding; x < bbox.x1 + padding; x++) {
                // Skip pixels inside the text region
                if (x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1) continue;

                const pixel = ctx.getImageData(x, y, 1, 1).data;
                totalR += pixel[0];
                totalG += pixel[1];
                totalB += pixel[2];
                count++;
            }
        }

        const averageR = totalR / count;
        const averageG = totalG / count;
        const averageB = totalB / count;

        // Fill the text region with the average color
        ctx.fillStyle = `rgb(${averageR}, ${averageG}, ${averageB})`;
        ctx.fillRect(bbox.x0, bbox.y0, areaWidth, areaHeight);
    }

    function editTextAtRegion(newText, regionIndex) {
        const region = detectedTextRegions[regionIndex];
        if (!region) return;

        removeText(region); // Remove existing text

        // Calculate an appropriate font size
        const textHeight = region.bbox.y1 - region.bbox.y0;
        const fontSize = Math.floor(textHeight); // Adjust the multiplier as needed

        // Set font with calculated size
        textWeight = 500;
        ctx.font = `${textWeight} ${fontSize}px Arial`;

        // Calculate text width and adjust x position to center the text
        const textWidth = ctx.measureText(newText).width;
        const textX = region.bbox.x0;
        const textY = region.bbox.y0 + fontSize; // Adjust Y position to align text within the box

        // Add new text
        ctx.fillStyle = "black";
        ctx.fillText(newText, textX, textY);

        // Re-highlight other regions
        // highlightTextRegions();
    }

    function selectRegion(index) {
        selectedRegionIndex = index;
        editText = ""; // Reset the edit text when a new region is selected
    }

    function handleTextChange(event) {
        editText = event.target.value;
    }
</script>

<canvas bind:this={canvas}></canvas>
<input type="file" accept="image/*" on:change="{(e) => imageFile = e.target.files[0]}">
<button on:click="{processImageWords}">Process Image as Words</button>
<button on:click="{processImageSentences}">Process Image as Sentences</button>

{#each detectedTextRegions as region, i}
    <div>
        <button on:click={() => selectRegion(i)}>Edit {selectedRegionIndex === -1 ? 'Word' : 'Sentence'} {i + 1}</button>
        {#if selectedRegionIndex === i}
            <textarea placeholder="Edit text" value={editText} on:input={handleTextChange}></textarea>
            <button on:click={() => editTextAtRegion(editText, i)}>Update Text</button>
        {/if}
    </div>
{/each}
