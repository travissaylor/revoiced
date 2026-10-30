// Validates summaries, narration scripts, and audio files. Exits 1 if anything is wrong.
import path from 'node:path';
import { validateRepo } from './lib/content.mjs';

const rootDir = path.join(import.meta.dirname, '..');
const { errors, stats } = await validateRepo(rootDir);

if (errors.length > 0) {
  const byFile = new Map();
  for (const { file, message } of errors) {
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file).push(message);
  }
  for (const [file, messages] of byFile) {
    for (const message of messages) console.error(`${file}: ${message}`);
  }
  console.error(`\n${errors.length} problem(s) in ${byFile.size} file(s)`);
  process.exit(1);
}

console.log(`OK: ${stats.summaries} summaries, ${stats.narrations} narration scripts, ${stats.audio} audio files`);
