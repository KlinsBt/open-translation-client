<script>

import { onMount } from "svelte";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import "@tensorflow/tfjs-backend-webgl";
import '@tensorflow/tfjs-backend-cpu';
import '@tensorflow/tfjs-backend-webgl';

let model;
  let imageElement;
  let canvas;
  let ctx;
  let uploadedImage;
  let textRegions = [];

  onMount(async () => {
    model = await cocoSsd.load();
    canvas = document.createElement('canvas');
    ctx = canvas.getContext('2d');
  });

  async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedImage = new Image();
        uploadedImage.onload = () => processImage();
        uploadedImage.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }
  }

  async function processImage() {
    const predictions = await model.detect(uploadedImage);
    canvas.width = uploadedImage.width;
    canvas.height = uploadedImage.height;
    ctx.drawImage(uploadedImage, 0, 0);
    textRegions = predictions
      .filter(prediction => prediction.class === 'text')
      .map(prediction => ({
        bbox: prediction.bbox,
        text: '', // Placeholder for new text
      }));
  }

  function replaceText() {
    ctx.drawImage(uploadedImage, 0, 0); // Redraw original image
    textRegions.forEach(region => {
      const [x, y, width, height] = region.bbox;
      // Remove the old text
      ctx.fillStyle = 'white'; // Adjust as needed
      ctx.fillRect(x, y, width, height);
      // Add new text
      ctx.fillStyle = 'black'; // Adjust as needed
      ctx.font = '16px Arial'; // Adjust as needed
      ctx.fillText(region.text, x, y + height / 2);
    });
  }
</script>

<main>
  <input type="file" accept="image/*" on:change={handleImageUpload} />
  {#if uploadedImage}
    <img bind:this={imageElement} src={uploadedImage.src} alt="Uploaded" />
    <canvas bind:this={canvas} style="display: none;"></canvas>
    <div>
      {#each textRegions as region, i}
        <div>
          <label for={`text-${i}`}>Text {i + 1}:</label>
          <input type="text" id={`text-${i}`} bind:value={region.text} />
        </div>
      {/each}
      <button on:click={replaceText}>Replace Text</button>
    </div>
  {/if}
</main>

<style>
  main {
    text-align: center;
    margin-top: 20px;
  }
  img {
    max-width: 100%;
    height: auto;
  }
</style>
