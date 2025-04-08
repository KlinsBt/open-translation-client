<script>
    import Tesseract from 'tesseract.js';
    import { onMount } from 'svelte';

    let canvas;
    let ctx;
    let imageFile;
    let image;
    let detectedTextRegions = [];
    let selectedRegionIndex = -1;

    onMount(() => {
        ctx = canvas.getContext('2d');
    });

    async function processImage() {
        if (!imageFile) return;

        image = await loadImage(imageFile);
        canvas.width = image.width;
        canvas.height = image.height;
        ctx.drawImage(image, 0, 0);

        const result = await Tesseract.recognize(imageFile, 'eng');
        detectedTextRegions = result.data.words;

        highlightTextRegions();
    }

    function highlightTextRegions() {
        detectedTextRegions.forEach(word => {
            const { bbox } = word;
            console.log(bbox);
            ctx.strokeStyle = 'red';
            ctx.strokeRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
        });
    }

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

    function editTextAtRegion(newText, regionIndex) {
        const region = detectedTextRegions[regionIndex];
        if (!region) return;

        // Remove existing text (basic approach)
        ctx.fillStyle = 'white';
        ctx.fillRect(region.bbox.x0, region.bbox.y0, region.bbox.x1 - region.bbox.x0, region.bbox.y1 - region.y0);

        // Add new text
        ctx.fillStyle = 'black';
        ctx.font = '16px Arial';
        ctx.fillText(newText, region.bbox.x0, region.bbox.y0);

        // Re-highlight other regions
        ctx.drawImage(image, 0, 0);
        highlightTextRegions();
    }

    function selectRegion(index) {
        selectedRegionIndex = index;
    }
</script>

<canvas bind:this={canvas}></canvas>
<input type="file" accept="image/*" on:change="{(e) => imageFile = e.target.files[0]}">
<button on:click="{processImage}">Process Image</button>

{#each detectedTextRegions as region, i}
    <div>
        <button on:click={() => selectRegion(i)}>Edit Region {i + 1}</button>
        {#if selectedRegionIndex === i}
            <input type="text" placeholder="Edit text" on:change="{(e) => editTextAtRegion(e.target.value, i)}">
        {/if}
    </div>
{/each}
