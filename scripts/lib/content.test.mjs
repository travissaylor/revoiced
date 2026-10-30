import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseFrontmatter, checkFrontmatter, countWords, validateRepo } from './content.mjs';

const REPO_ROOT = path.join(import.meta.dirname, '..', '..');
const NOW = new Date('2026-10-29T12:00:00Z');

const validData = () => ({
  title: 'The Great Gatsby',
  author: 'F. Scott Fitzgerald',
  genre: 'Novel',
  publication_year: 1925,
  summary_generated: '2026-10-28',
});

function summary(overrides = {}, words = 5500) {
  const data = { ...validData(), ...overrides };
  const lines = Object.entries(data).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  return `---\n${lines.join('\n')}\n---\n${'word '.repeat(words)}\n`;
}

async function makeRepo(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'revoiced-content-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return root;
}

async function validate(files, options = { checkNarration: false, now: NOW }) {
  const root = await makeRepo(files);
  try {
    return await validateRepo(root, options);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const GATSBY = 'summaries/f-scott-fitzgerald/the-great-gatsby.md';
const messages = (result, file) => result.errors.filter((e) => e.file === file).map((e) => e.message);

test('parseFrontmatter splits frontmatter and body', () => {
  const parsed = parseFrontmatter('---\ntitle: A\n---\nbody text\n');
  assert.deepEqual(parsed.data, { title: 'A' });
  assert.equal(parsed.body, 'body text\n');
});

test('parseFrontmatter rejects missing fences and bad YAML', () => {
  assert.match(parseFrontmatter('no frontmatter').error, /frontmatter/);
  assert.match(parseFrontmatter('---\ntitle: [oops\n---\nbody').error, /YAML/);
  assert.match(parseFrontmatter('---\n- a\n- b\n---\nbody').error, /mapping/);
});

test('countWords counts whitespace-separated words', () => {
  assert.equal(countWords('  one two\n\nthree  '), 3);
  assert.equal(countWords(''), 0);
});

test('checkFrontmatter accepts valid data, Date objects, and negative years', () => {
  assert.deepEqual(checkFrontmatter(validData(), NOW), []);
  assert.deepEqual(checkFrontmatter({ ...validData(), summary_generated: new Date('2026-10-28') }, NOW), []);
  assert.deepEqual(checkFrontmatter({ ...validData(), publication_year: -800 }, NOW), []);
  assert.deepEqual(checkFrontmatter({ ...validData(), narration: { voice: 'Kore', style: 'warm' } }, NOW), []);
});

test('checkFrontmatter rejects bad fields', () => {
  const problems = (overrides) => checkFrontmatter({ ...validData(), ...overrides }, NOW);
  assert.match(problems({ title: '' })[0], /title/);
  assert.match(problems({ genre: 5 })[0], /genre/);
  assert.match(problems({ publication_year: '1925' })[0], /publication_year/);
  assert.match(problems({ publication_year: 1925.5 })[0], /publication_year/);
  assert.match(problems({ publication_year: 2099 })[0], /future/);
  assert.match(problems({ summary_generated: 'not a date' })[0], /summary_generated/);
  assert.match(problems({ summary_generated: '2027-01-01' })[0], /future/);
  assert.match(problems({ summary_generated: undefined })[0], /summary_generated/);
  assert.match(problems({ extra: 1 })[0], /unknown frontmatter key "extra"/);
  assert.match(problems({ narration: { style: 'x' } })[0], /narration\.voice/);
  assert.match(problems({ narration: { voice: 'a', style: 3 } })[0], /narration\.style/);
  assert.match(problems({ narration: 'Kore' })[0], /narration/);
});

test('checkFrontmatter allows one day of timezone slack', () => {
  assert.deepEqual(checkFrontmatter({ ...validData(), summary_generated: '2026-10-30' }, NOW), []);
});

test('valid repo has no errors and reports counts', async () => {
  const result = await validate({
    [GATSBY]: summary(),
    'summaries/.gitkeep': '',
    'summaries/f-scott-fitzgerald/the-great-gatsby.narration.json': '{}',
    'public/audio/f-scott-fitzgerald/the-great-gatsby.mp3': 'x',
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.stats, { summaries: 1, narrations: 1, audio: 1 });
});

test('check 1: malformed frontmatter and stray files are errors', async () => {
  const result = await validate({
    'summaries/f-scott-fitzgerald/the-great-gatsby.md': 'no frontmatter here',
    'summaries/README.md': 'stray',
    'summaries/f-scott-fitzgerald/nested/deep.md': summary(),
  });
  assert.match(messages(result, GATSBY)[0], /frontmatter/);
  assert.match(messages(result, 'summaries/README.md')[0], /top level/);
  assert.match(messages(result, 'summaries/f-scott-fitzgerald/nested')[0], /nested/);
});

test('check 2: frontmatter field errors surface per file', async () => {
  const result = await validate({ [GATSBY]: summary({ genre: '', mystery: true }) });
  const found = messages(result, GATSBY);
  assert.ok(found.some((m) => /genre/.test(m)));
  assert.ok(found.some((m) => /mystery/.test(m)));
});

test('check 3: author directory and file name must match slugified frontmatter', async () => {
  const ok = await validate({ [GATSBY]: summary() });
  assert.deepEqual(ok.errors, []);

  const bad = await validate({ 'summaries/fitzgerald/gatsby.md': summary() });
  const found = messages(bad, 'summaries/fitzgerald/gatsby.md');
  assert.ok(found.some((m) => /f-scott-fitzgerald/.test(m)));
  assert.ok(found.some((m) => /the-great-gatsby\.md/.test(m)));
});

test('check 4: word count must be within 5000-7000', async () => {
  for (const words of [5000, 7000]) {
    assert.deepEqual((await validate({ [GATSBY]: summary({}, words) })).errors, []);
  }
  for (const words of [4999, 7001]) {
    const result = await validate({ [GATSBY]: summary({}, words) });
    assert.match(messages(result, GATSBY)[0], new RegExp(`${words} words`));
  }
});

test('check 5: duplicate title and author are errors', async () => {
  const result = await validate({
    [GATSBY]: summary(),
    'summaries/f-scott-fitzgerald/the-great-gatsby-2.md': summary({ title: 'The Great Gatsby!' }),
  });
  assert.ok(result.errors.some((e) => /duplicate/.test(e.message)));
});

test('check 6: narration script needs a sibling summary', async () => {
  const ok = await validate({
    [GATSBY]: summary(),
    'summaries/f-scott-fitzgerald/the-great-gatsby.narration.json': '{}',
  });
  assert.deepEqual(ok.errors, []);

  const orphan = await validate({ 'summaries/a/b.narration.json': '{}' });
  assert.match(messages(orphan, 'summaries/a/b.narration.json')[0], /no matching summary/);
});

test('check 6: failing generator dry run is reported with stderr', async () => {
  const files = {
    [GATSBY]: summary(),
    'summaries/f-scott-fitzgerald/the-great-gatsby.narration.json': '{}',
    'scripts/generate-audio.mjs': "console.error('bad script: line 3'); process.exit(1);",
  };
  const failing = await validate(files, { now: NOW });
  const narration = 'summaries/f-scott-fitzgerald/the-great-gatsby.narration.json';
  assert.match(messages(failing, narration)[0], /bad script: line 3/);

  const passing = await validate({ ...files, 'scripts/generate-audio.mjs': 'process.exit(0);' }, { now: NOW });
  assert.deepEqual(passing.errors, []);

  const skipped = await validate(files, { checkNarration: false, now: NOW });
  assert.deepEqual(skipped.errors, []);
});

test('check 7: audio must match a summary and stay under 90 MB', async () => {
  const result = await validate({
    [GATSBY]: summary(),
    'public/audio/f-scott-fitzgerald/the-great-gatsby.mp3': 'x',
    'public/audio/f-scott-fitzgerald/missing.mp3': 'x',
    'public/audio/stray.mp3': 'x',
    'public/audio/f-scott-fitzgerald/the-great-gatsby.wav': 'x',
  });
  assert.deepEqual(messages(result, 'public/audio/f-scott-fitzgerald/the-great-gatsby.mp3'), []);
  assert.match(messages(result, 'public/audio/f-scott-fitzgerald/missing.mp3')[0], /no matching summary/);
  assert.match(messages(result, 'public/audio/stray.mp3')[0], /unexpected audio file/);
  assert.match(messages(result, 'public/audio/f-scott-fitzgerald/the-great-gatsby.wav')[0], /unexpected audio file/);
});

test('check 7: oversized audio is an error', async () => {
  const root = await makeRepo({ [GATSBY]: summary() });
  try {
    const mp3 = path.join(root, 'public/audio/f-scott-fitzgerald/the-great-gatsby.mp3');
    await mkdir(path.dirname(mp3), { recursive: true });
    await writeFile(mp3, Buffer.alloc(91 * 1024 * 1024));
    const result = await validateRepo(root, { checkNarration: false, now: NOW });
    assert.match(result.errors[0].message, /91\.0 MB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('check 8: unexpected files in an author directory are errors', async () => {
  const result = await validate({
    [GATSBY]: summary(),
    'summaries/f-scott-fitzgerald/notes.txt': 'hi',
  });
  assert.match(messages(result, 'summaries/f-scott-fitzgerald/notes.txt')[0], /unexpected file/);
});

test('the real repo passes every check', async () => {
  const { errors } = await validateRepo(REPO_ROOT);
  assert.deepEqual(errors, []);
});
