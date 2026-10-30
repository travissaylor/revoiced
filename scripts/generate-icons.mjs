import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const OUTPUT_DIR = join(import.meta.dirname, '..', 'public');
const SOURCE = join(OUTPUT_DIR, 'icon.svg');
const ICONS = [
  [32, 'favicon-32.png'],
  [180, 'apple-touch-icon.png'],
  [192, 'icon-192x192.png'],
  [512, 'icon-512x512.png'],
];

await mkdir(OUTPUT_DIR, { recursive: true });

for (const [size, filename] of ICONS) {
  const outputPath = join(OUTPUT_DIR, filename);
  await sharp(SOURCE).resize(size, size).png().toFile(outputPath);
  console.log(`Generated ${outputPath}`);
}
