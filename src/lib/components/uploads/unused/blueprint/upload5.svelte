<script>
    import { onMount } from "svelte";
    import Tesseract from "tesseract.js";

    let imageFile;
    let processedImageURL = "";
    let canvas, ctx;

    // Function to detect text and return coordinates
    async function detectText(image) {
        const result = await Tesseract.recognize(image, "eng");
        return result.data.words.map(word => word.bbox); // Array of bounding boxes
    }

    // Function to replace text with adjacent pixels
    function replaceTextWithAdjacentPixels(textRegions) {
        textRegions.forEach(region => {
            for (let y = region.y0; y < region.y1; y++) {
                for (let x = region.x0; x < region.x1; x++) {
                    const adjacentPixel = getAdjacentPixel(x, y);
                    setPixel(x, y, adjacentPixel);
                }
            }
        });
    }

    function getAdjacentPixel(x, y) {
        // Simple example: get the pixel to the left of the current one
        // More complex logic can be implemented for better results
        return ctx.getImageData(x - 1, y, 1, 1).data;
    }

    function setPixel(x, y, pixel) {
        // Set the pixel at (x, y) with the value of 'pixel'
        const imageData = ctx.createImageData(1, 1);
        imageData.data.set(pixel);
        ctx.putImageData(imageData, x, y);
    }

    async function processImage() {
        if (imageFile) {
            canvas = document.createElement('canvas');
            ctx = canvas.getContext('2d');
            const img = new Image();
            img.src = URL.createObjectURL(imageFile);
            img.onload = async () => {
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                const textRegions = await detectText(imageFile);
                replaceTextWithAdjacentPixels(textRegions);
                processedImageURL = canvas.toDataURL();
            };
        }
    }

    onMount(() => {
        Tesseract.setLogging(true);
    });
</script>

<style>
    .image-preview {
        max-width: 100%;
        height: auto;
    }
</style>

<input type="file" accept="image/*" on:change="{(event) => imageFile = event.target.files[0]}"/>
<button on:click="{processImage}">Remove Text</button>

{#if processedImageURL}
    <img class="image-preview" src="{processedImageURL}" alt="Processed">
{/if}
