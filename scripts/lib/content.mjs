// Content checks for summaries, narration scripts, and audio files. Used by scripts/validate-content.mjs.
import { readdir, readFile, stat, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { parse } from 'yaml';
import { slugify } from '../../src/lib/slugify.ts';

export const MIN_WORDS = 5000;
export const MAX_WORDS = 7000;
export const MAX_AUDIO_BYTES = 90 * 1024 * 1024;

const STRING_FIELDS = ['title', 'author', 'genre'];
const KNOWN_KEYS = new Set([...STRING_FIELDS, 'publication_year', 'summary_generated', 'narration']);
const DAY_MS = 24 * 60 * 60 * 1000;
// OS clutter that is gitignored but may exist in a local checkout.
const IGNORED_FILES = new Set(['.DS_Store']);

const isNonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// Same split the audio generator uses.
export function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { error: 'missing or malformed frontmatter (expected "---" fences at the top of the file)' };
  }
  let data;
  try {
    data = parse(match[1]);
  } catch (err) {
    return { error: `frontmatter is not valid YAML: ${err.message.split('\n')[0]}` };
  }
  if (!isPlainObject(data)) {
    return { error: 'frontmatter must be a YAML mapping' };
  }
  return { data, body: match[2] };
}

export function countWords(body) {
  return body.trim().split(/\s+/).filter(Boolean).length;
}

// Returns a list of problem messages for parsed frontmatter data.
export function checkFrontmatter(data, now = new Date()) {
  const problems = [];

  for (const key of STRING_FIELDS) {
    if (!isNonEmptyString(data[key])) problems.push(`"${key}" must be a non-empty string`);
  }

  const year = data.publication_year;
  if (!Number.isInteger(year)) {
    problems.push('"publication_year" must be an integer');
  } else if (year > now.getUTCFullYear()) {
    problems.push(`"publication_year" (${year}) is in the future`);
  }

  const generated = data.summary_generated;
  const generatedDate = generated instanceof Date ? generated : typeof generated === 'string' ? new Date(generated) : null;
  if (!generatedDate || Number.isNaN(generatedDate.getTime())) {
    problems.push('"summary_generated" must be a valid date (YYYY-MM-DD)');
  } else if (generatedDate.getTime() > now.getTime() + DAY_MS) {
    problems.push(`"summary_generated" (${generated instanceof Date ? generated.toISOString().slice(0, 10) : generated}) is in the future`);
  }

  if (data.narration !== undefined) {
    const narration = data.narration;
    if (!isPlainObject(narration)) {
      problems.push('"narration" must be an object with "voice" and optional "style"');
    } else {
      if (!isNonEmptyString(narration.voice)) problems.push('"narration.voice" must be a non-empty string');
      if (narration.style !== undefined && typeof narration.style !== 'string') {
        problems.push('"narration.style" must be a string');
      }
      for (const key of Object.keys(narration)) {
        if (key !== 'voice' && key !== 'style') problems.push(`unknown key "narration.${key}"`);
      }
    }
  }

  for (const key of Object.keys(data)) {
    if (!KNOWN_KEYS.has(key)) problems.push(`unknown frontmatter key "${key}"`);
  }

  return problems;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readDirOrEmpty(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => !IGNORED_FILES.has(entry.name));
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// Runs the generator's own dry run; returns an error message or null.
function dryRunNarration(rootDir, generator, authorDir, titleSlug) {
  const result = spawnSync(process.execPath, [generator, `${authorDir}/${titleSlug}`, '--dry-run'], {
    cwd: rootDir,
    encoding: 'utf8',
    env: { ...process.env, GEMINI_API_KEY: '' },
  });
  if (result.error) return `could not run narration dry run: ${result.error.message}`;
  if (result.status === 0) return null;
  const detail = (result.stderr || result.stdout || '').trim().slice(-1500);
  return `narration dry run failed (exit ${result.status}):\n${detail}`;
}

async function listAudioFiles(dir, prefix = '') {
  const found = [];
  for (const entry of await readDirOrEmpty(dir)) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await listAudioFiles(path.join(dir, entry.name), rel)));
    else found.push(rel);
  }
  return found;
}

export async function validateRepo(rootDir, { checkNarration = true, now = new Date() } = {}) {
  const errors = [];
  const fail = (file, message) => errors.push({ file, message });
  const stats = { summaries: 0, narrations: 0, audio: 0 };
  const summariesDir = path.join(rootDir, 'summaries');
  const generator = path.join(rootDir, 'scripts/generate-audio.mjs');
  const runDryRuns = checkNarration && (await exists(generator));
  const knownSummaries = new Set(); // "<author>/<title>"
  const seenBooks = new Map(); // "<author-slug>/<title-slug>" -> first file

  for (const top of await readDirOrEmpty(summariesDir)) {
    const topRel = `summaries/${top.name}`;
    if (!top.isDirectory()) {
      if (top.name !== '.gitkeep') fail(topRel, 'unexpected file at summaries/ top level (expected summaries/<author>/<title>.md)');
      continue;
    }

    const authorDir = top.name;
    const narrations = [];

    for (const entry of await readDirOrEmpty(path.join(summariesDir, authorDir))) {
      const rel = `${topRel}/${entry.name}`;
      if (entry.isDirectory()) {
        fail(rel, 'nested directories are not allowed (expected summaries/<author>/<title>.md)');
      } else if (entry.name.endsWith('.narration.json')) {
        narrations.push(entry.name.slice(0, -'.narration.json'.length));
      } else if (entry.name.endsWith('.md')) {
        stats.summaries += 1;
        const titleSlug = entry.name.slice(0, -'.md'.length);
        knownSummaries.add(`${authorDir}/${titleSlug}`);
        await checkSummary(rel, path.join(summariesDir, authorDir, entry.name), authorDir, titleSlug);
      } else {
        fail(rel, 'unexpected file (only .md summaries and .narration.json scripts are allowed)');
      }
    }

    for (const titleSlug of narrations) {
      stats.narrations += 1;
      const rel = `${topRel}/${titleSlug}.narration.json`;
      if (!knownSummaries.has(`${authorDir}/${titleSlug}`)) {
        fail(rel, `no matching summary ${topRel}/${titleSlug}.md`);
      } else if (runDryRuns) {
        const message = dryRunNarration(rootDir, generator, authorDir, titleSlug);
        if (message) fail(rel, message);
      }
    }
  }

  async function checkSummary(rel, file, authorDir, titleSlug) {
    const parsed = parseFrontmatter(await readFile(file, 'utf8'));
    if (parsed.error) return fail(rel, parsed.error);

    const { data, body } = parsed;
    for (const problem of checkFrontmatter(data, now)) fail(rel, problem);

    if (isNonEmptyString(data.author) && slugify(data.author) !== authorDir) {
      fail(rel, `author directory "${authorDir}" should be "${slugify(data.author)}" (from author "${data.author}")`);
    }
    if (isNonEmptyString(data.title) && slugify(data.title) !== titleSlug) {
      fail(rel, `file name "${titleSlug}.md" should be "${slugify(data.title)}.md" (from title "${data.title}")`);
    }
    if (isNonEmptyString(data.title) && isNonEmptyString(data.author)) {
      const key = `${slugify(data.author)}/${slugify(data.title)}`;
      if (seenBooks.has(key)) fail(rel, `duplicate of ${seenBooks.get(key)} (same title and author)`);
      else seenBooks.set(key, rel);
    }

    const words = countWords(body);
    if (words < MIN_WORDS || words > MAX_WORDS) {
      fail(rel, `body has ${words} words (expected ${MIN_WORDS}-${MAX_WORDS})`);
    }
  }

  const audioDir = path.join(rootDir, 'public/audio');
  for (const rel of await listAudioFiles(audioDir)) {
    stats.audio += 1;
    const display = `public/audio/${rel}`;
    const parts = rel.split('/');
    if (parts.length !== 2 || !parts[1].endsWith('.mp3')) {
      fail(display, 'unexpected audio file (expected public/audio/<author>/<title>.mp3)');
      continue;
    }
    const key = `${parts[0]}/${parts[1].slice(0, -'.mp3'.length)}`;
    if (!knownSummaries.has(key)) fail(display, `no matching summary summaries/${key}.md`);
    const { size } = await stat(path.join(audioDir, rel));
    if (size > MAX_AUDIO_BYTES) {
      fail(display, `audio file is ${(size / 1024 / 1024).toFixed(1)} MB (limit ${MAX_AUDIO_BYTES / 1024 / 1024} MB; GitHub rejects files over 100 MB)`);
    }
  }

  errors.sort((a, b) => a.file.localeCompare(b.file));
  return { errors, stats };
}
