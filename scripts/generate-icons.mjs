import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const BRAND_COLOR = '#7b4b2a';
const TEXT_COLOR = '#ffffff';
const SIZES = [192, 512];
const OUTPUT_DIR = join(import.meta.dirname, '..', 'public');

function createIconSvg(size) {
  const fontSize = Math.round(size * 0.45);
  const y = Math.round(size * 0.55);
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="${BRAND_COLOR}" rx="${Math.round(size * 0.1)}" />
  <text x="50%" y="${y}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${fontSize}" fill="${TEXT_COLOR}">R</text>
</svg>`;
}

await mkdir(OUTPUT_DIR, { recursive: true });

for (const size of SIZES) {
  const svg = createIconSvg(size);
  const outputPath = join(OUTPUT_DIR, `icon-${size}x${size}.png`);
  await sharp(Buffer.from(svg)).png().toFile(outputPath);
  console.log(`Generated ${outputPath}`);
}
