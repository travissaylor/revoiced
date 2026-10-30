// Verifies the built site in dist/ has no broken internal links or missing assets.
import { join } from 'node:path';
import { checkDist, readBase } from './lib/links.mjs';

const root = join(import.meta.dirname, '..');
const distDir = process.argv[2] ?? join(root, 'dist');
const base = await readBase(join(root, 'astro.config.mjs'));

let result;
try {
  result = await checkDist(distDir, { base });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const { errors, htmlFiles, linksChecked } = result;
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(`\n${errors.length} link error(s) in ${htmlFiles} HTML files (${linksChecked} links checked)`);
  process.exit(1);
}

console.log(`Checked ${linksChecked} links across ${htmlFiles} HTML files: no broken links`);
