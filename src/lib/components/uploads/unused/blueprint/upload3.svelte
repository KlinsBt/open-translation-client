<script>
    import { onMount } from "svelte";
    import Tesseract from "tesseract.js";

    let imageFile;
    let extractedText = "";
    let textPositions = [];

    async function extractText() {
        if (imageFile) {
            const result = await Tesseract.recognize(
                imageFile,
                "eng",
                {
                    logger: m => console.log(m) // Log progress
                }
            );

            extractedText = result.data.text;
            textPositions = result.data.words.map(word => ({
                text: word.text,
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0np
            }));
        }
    }

    onMount(() => {
        // Additional initialization if needed
    });
</script>

<input type="file" accept="image/*" on:change="{(event) => imageFile = event.target.files[0]}">
<button on:click="{extractText}">Extract Text</button>

{#if extractedText}
    <p>Extracted Text: {extractedText}</p>
    <ul>
        {#each textPositions as position}
            <li>{position.text} at ({position.x}, {position.y}) [Size: {position.width}x{position.height}]</li>
        {/each}
    </ul>
{/if}
