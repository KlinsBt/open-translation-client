<script>
    import Tesseract from "tesseract.js";

    let imageUrl;
    let canvas;
    let ctx;
    let image = null;
    let width = null;
    let height = null;

    let imageLoaded = false;

    image.onload = () => {
        imageLoaded = true;
        canvas.width = image.width;
        canvas.height = image.height;
        ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
    };

    async function handleFileChange(event) {
        const file = event.target.files[0];
        image = new Image();
        if (file) {
            imageUrl = URL.createObjectURL(file);
            image.src = imageUrl;
        }
    }

    async function removeText() {
        if (!imageUrl || !canvas) return;

        const result = await Tesseract.recognize(
            image,
            'eng',
            { logger: m => console.log(m) }
        );

        // Ensure the canvas context is set
        if (!ctx) {
            ctx = canvas.getContext('2d');
        }

        // Draw over each recognized word
        result.data.words.forEach(word => {
            const { bbox } = word;
            ctx.fillStyle = 'white'; // Change to match the image background
            ctx.fillRect(bbox.x0, bbox.y0, bbox.x1 - bbox.x0, bbox.y1 - bbox.y0);
        });
    }

    function onImageLoad() {
        image = new Image();
        canvas.width = image.width;
        canvas.height = image.height;
        ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);
    }
</script>

<input type="file" accept="image/*" on:change={handleFileChange}>
<button on:click={removeText} disabled={!imageUrl}>Remove Text</button>
<!-- <canvas bind:this={canvas}></canvas> -->
{#if width != null && height != null}
    <canvas bind:this={canvas} on:load={onImageLoad}></canvas>
    <!-- <canvas bind:this={canvas}></canvas> -->
{/if}

<style>
    canvas {
        border: 1px solid black;
        max-width: 100%;
    }
</style>

