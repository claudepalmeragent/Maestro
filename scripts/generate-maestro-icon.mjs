#!/usr/bin/env node
/**
 * Generate Maestro app icon with conductor silhouette
 * Creates an HTML file that can be opened in a browser to export PNG icons
 *
 * Usage:
 *   1. Run: node scripts/generate-maestro-icon.mjs
 *   2. Open the generated HTML file in a browser
 *   3. Click "Download All Icons" button
 *   4. Move the downloaded icons to their appropriate directories
 *
 * Or use the SVG directly at build/icon.svg
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTML_CONTENT = `<!DOCTYPE html>
<html>
<head>
  <title>Maestro Icon Generator</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      background: #1a1a2e;
      color: white;
      padding: 40px;
      text-align: center;
    }
    .icon-preview {
      display: inline-block;
      margin: 20px;
      text-align: center;
    }
    .icon-preview canvas {
      border-radius: 18%;
      box-shadow: 0 4px 20px rgba(139, 92, 246, 0.3);
    }
    .icon-preview p {
      margin-top: 10px;
      color: #888;
    }
    button {
      background: #8B5CF6;
      color: white;
      border: none;
      padding: 15px 30px;
      font-size: 16px;
      border-radius: 8px;
      cursor: pointer;
      margin: 20px 10px;
    }
    button:hover {
      background: #7C3AED;
    }
    h1 { color: #8B5CF6; }
    .instructions {
      max-width: 600px;
      margin: 30px auto;
      text-align: left;
      background: rgba(255,255,255,0.05);
      padding: 20px;
      border-radius: 10px;
    }
    .instructions li {
      margin: 10px 0;
      color: #aaa;
    }
  </style>
</head>
<body>
  <h1>Maestro Icon Generator</h1>
  <p>Preview and download the new Maestro conductor icon</p>

  <div id="previews"></div>

  <div>
    <button onclick="downloadAll()">Download All Icons</button>
    <button onclick="downloadSingle(1024)">Download 1024x1024 Only</button>
  </div>

  <div class="instructions">
    <h3>After downloading:</h3>
    <ol>
      <li>Move <code>icon-1024.png</code> to <code>build/icon.png</code></li>
      <li>Move <code>icon-512.png</code> to <code>src/renderer/public/icon.png</code></li>
      <li>Move PWA icons (72-512) to <code>src/web/public/icons/</code></li>
      <li>Run <code>npm run build</code> to regenerate .icns and .ico files</li>
    </ol>
  </div>

  <script>
    const SIZES = [1024, 512, 384, 192, 152, 144, 128, 96, 72];
    const PURPLE = '#8B5CF6';
    const PURPLE_DARK = '#7C3AED';

    function drawMaestro(ctx, size) {
      const scale = size / 512;

      // Purple gradient background
      const gradient = ctx.createRadialGradient(
        size / 2, size / 2, 0,
        size / 2, size / 2, size * 0.7
      );
      gradient.addColorStop(0, PURPLE);
      gradient.addColorStop(1, PURPLE_DARK);

      // Rounded rectangle background
      const radius = size * 0.18;
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, radius);
      ctx.fill();

      // Transform for silhouette
      ctx.save();
      ctx.translate(size * 0.15, size * 0.12);
      ctx.scale(scale * 0.85, scale * 0.85);

      ctx.fillStyle = '#FFFFFF';

      // Head - profile facing left
      ctx.beginPath();
      ctx.ellipse(180, 80, 55, 60, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nose bump
      ctx.beginPath();
      ctx.ellipse(118, 85, 12, 8, 0, 0, Math.PI * 2);
      ctx.fill();

      // Hair/top of head
      ctx.beginPath();
      ctx.ellipse(185, 35, 40, 25, 0, 0, Math.PI * 2);
      ctx.fill();

      // Neck
      ctx.fillRect(155, 130, 50, 40);

      // Collar area
      ctx.beginPath();
      ctx.moveTo(140, 165);
      ctx.lineTo(260, 165);
      ctx.lineTo(250, 185);
      ctx.lineTo(150, 185);
      ctx.closePath();
      ctx.fill();

      // Bow tie
      ctx.beginPath();
      ctx.ellipse(200, 175, 25, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Torso
      ctx.beginPath();
      ctx.moveTo(140, 185);
      ctx.lineTo(120, 350);
      ctx.lineTo(280, 350);
      ctx.lineTo(260, 185);
      ctx.closePath();
      ctx.fill();

      // Left arm
      ctx.beginPath();
      ctx.moveTo(140, 200);
      ctx.quadraticCurveTo(90, 220, 80, 280);
      ctx.quadraticCurveTo(75, 300, 90, 310);
      ctx.lineTo(110, 305);
      ctx.quadraticCurveTo(120, 290, 115, 260);
      ctx.quadraticCurveTo(130, 240, 145, 230);
      ctx.closePath();
      ctx.fill();

      // Left hand
      ctx.beginPath();
      ctx.ellipse(85, 295, 18, 22, 0, 0, Math.PI * 2);
      ctx.fill();

      // Right arm raised with baton
      ctx.beginPath();
      ctx.moveTo(260, 200);
      ctx.quadraticCurveTo(300, 180, 330, 130);
      ctx.quadraticCurveTo(340, 115, 355, 100);
      ctx.lineTo(365, 110);
      ctx.quadraticCurveTo(350, 130, 340, 145);
      ctx.quadraticCurveTo(315, 195, 270, 220);
      ctx.closePath();
      ctx.fill();

      // Right hand
      ctx.beginPath();
      ctx.ellipse(350, 95, 15, 18, 0, 0, Math.PI * 2);
      ctx.fill();

      // Baton
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(360, 85);
      ctx.lineTo(395, 20);
      ctx.stroke();

      // Cuffs (purple on white)
      ctx.fillStyle = PURPLE_DARK;
      ctx.beginPath();
      ctx.roundRect(78, 275, 20, 8, 2);
      ctx.fill();

      ctx.save();
      ctx.translate(344, 92);
      ctx.rotate(-30 * Math.PI / 180);
      ctx.beginPath();
      ctx.roundRect(-9, -4, 18, 8, 2);
      ctx.fill();
      ctx.restore();

      ctx.restore();
    }

    function generateIcon(size) {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      drawMaestro(ctx, size);
      return canvas;
    }

    // Generate previews
    const previewSizes = [512, 192, 96];
    const previewContainer = document.getElementById('previews');

    previewSizes.forEach(size => {
      const div = document.createElement('div');
      div.className = 'icon-preview';
      const canvas = generateIcon(size);
      div.appendChild(canvas);
      const p = document.createElement('p');
      p.textContent = size + 'x' + size;
      div.appendChild(p);
      previewContainer.appendChild(div);
    });

    function downloadSingle(size) {
      const canvas = generateIcon(size);
      const link = document.createElement('a');
      link.download = 'icon-' + size + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }

    function downloadAll() {
      SIZES.forEach((size, i) => {
        setTimeout(() => downloadSingle(size), i * 200);
      });
    }
  </script>
</body>
</html>`;

async function main() {
  const outputPath = path.join(__dirname, '..', 'build', 'generate-icon.html');

  fs.writeFileSync(outputPath, HTML_CONTENT);

  console.log('Icon generator HTML created at: build/generate-icon.html');
  console.log('');
  console.log('To generate icons:');
  console.log('  1. Open build/generate-icon.html in a browser');
  console.log('  2. Click "Download All Icons"');
  console.log('  3. Move icons to their appropriate directories:');
  console.log('     - icon-1024.png -> build/icon.png');
  console.log('     - icon-512.png -> src/renderer/public/icon.png');
  console.log('     - PWA icons -> src/web/public/icons/');
  console.log('');
  console.log('Or use the SVG at build/icon.svg directly.');
}

main().catch(console.error);
