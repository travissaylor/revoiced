// Generates an audio narration for a summary using Gemini TTS
// (gemini-3.1-flash-tts-preview) and writes an MP3 to public/audio/<id>.mp3.
//
// Usage:
//   pnpm generate-audio <author-slug>/<title-slug> [--force] [--dry-run]
//   pnpm generate-audio <author-slug>/<title-slug> --paragraphs
//   pnpm generate-audio --all
//
// Requires GEMINI_API_KEY (put it in .env; the pnpm script loads it).
//
// Two modes:
//   1. Directed mode — if summaries/<id>.narration.json exists, it drives a
//      multi-voice, per-passage performance (see .claude/skills/narrate-summary).
//   2. Plain mode — otherwise the whole summary is read by one voice from the
//      frontmatter `narration` block (or a neutral default).
//
// Text is generated in chunks because the model caps input at ~8k tokens and
// voice quality drifts on outputs longer than a few minutes. Each chunk's PCM
// is cached in .audio-cache/ so an interrupted run resumes instead of
// re-billing completed chunks.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { parse as parseYaml } from 'yaml';

const ROOT = path.join(import.meta.dirname, '..');
const SUMMARIES_DIR = path.join(ROOT, 'summaries');
const AUDIO_DIR = path.join(ROOT, 'public', 'audio');
const CACHE_DIR = path.join(ROOT, '.audio-cache');

const MODEL = 'gemini-3.1-flash-tts-preview';
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const SAMPLE_RATE = 24000; // PCM s16le mono, per the TTS model's output spec
const MAX_CHUNK_CHARS = 2400; // ~2.5 min of speech; keeps each chunk well under drift territory
const MAX_RETRIES = 10;
const PARA_PAUSE_MS = 300; // silence inserted between chunks at paragraph boundaries
const INLINE_PAUSE_MS = 150; // silence at a chunk join inside a paragraph (dialogue / sentence split)

const DEFAULT_VOICE = 'Schedar'; // "Even" — neutral narrator fallback
const DEFAULT_STYLE =
  'Narrate as a professional audiobook reader: clear, engaging, and evenly paced';

function fail(msg) {
  console.error(`\nError: ${msg}`);
  process.exit(1);
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();
// Inline audio tags like [sighs] or [whispers] are performance annotations,
// not content — strip them when checking text fidelity against the source.
const stripTags = (s) => normalize(s.replace(/\[[^\[\]]{1,60}\]/g, ' '));

function parseSummary(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) fail('Could not parse frontmatter');
  return { data: parseYaml(match[1]), body: match[2].trim() };
}

const splitParagraphs = (body) => body.split(/\n\s*\n/).map(normalize).filter(Boolean);

function splitSentences(text) {
  return text.match(/[^.!?]+[.!?]+["')\]]*\s*|.+$/g) ?? [text];
}

// ---------------------------------------------------------------------------
// Directed mode: build ordered segments from a .narration.json script.
// Each segment = one speaker reading one stretch of verbatim summary text
// under one performance direction. See the narrate-summary skill for the
// authoring guide and JSON schema.
// ---------------------------------------------------------------------------

function buildSegments(narration, paragraphs, scriptPath) {
  const cast = narration.cast;
  if (!cast?.narrator?.voice) fail(`${scriptPath}: cast.narrator.voice is required`);
  const entries = narration.paragraphs;
  if (!Array.isArray(entries)) fail(`${scriptPath}: "paragraphs" must be an array`);
  if (entries.length !== paragraphs.length) {
    fail(
      `${scriptPath}: script has ${entries.length} paragraph entries but the summary has ${paragraphs.length} paragraphs. ` +
        `Run with --paragraphs to see the numbered source paragraphs.`
    );
  }

  const segments = [];
  entries.forEach((entry, i) => {
    const num = i + 1;
    if (entry.para !== num) {
      fail(`${scriptPath}: entry ${i} must have para ${num} (entries cover every paragraph, in order); got ${entry.para}`);
    }
    const source = paragraphs[i];
    const baseDirection = entry.direction;

    const pushSegment = (speaker, text, direction) => {
      const member = cast[speaker];
      if (!member?.voice) fail(`${scriptPath}: paragraph ${num} uses speaker "${speaker}" but cast.${speaker}.voice is not defined`);
      segments.push({
        para: num,
        speaker,
        voice: member.voice,
        style: member.style ?? DEFAULT_STYLE,
        direction,
        text: normalize(text),
      });
    };

    if (entry.parts) {
      const joined = stripTags(entry.parts.map((p) => p.text).join(' '));
      if (joined !== source) {
        fail(
          `${scriptPath}: paragraph ${num} — the concatenated "parts" text (audio tags stripped) must reproduce the paragraph verbatim.\n` +
            `  source: ${source.slice(0, 120)}...\n  script: ${joined.slice(0, 120)}...`
        );
      }
      for (const part of entry.parts) {
        pushSegment(part.speaker ?? 'narrator', part.text, part.direction ?? baseDirection);
      }
    } else {
      const text = entry.text ?? source;
      if (stripTags(text) !== source) {
        fail(
          `${scriptPath}: paragraph ${num} — "text" (audio tags stripped) must reproduce the paragraph verbatim.\n` +
            `  source: ${source.slice(0, 120)}...\n  script: ${stripTags(text).slice(0, 120)}...`
        );
      }
      pushSegment('narrator', text, baseDirection);
    }
  });
  return segments;
}

// The directive is the spoken-style instruction the model follows but does not
// read aloud (the "Say cheerfully:" pattern from the TTS docs).
function directiveFor(segment) {
  const parts = [segment.style];
  if (segment.direction) parts.push(`For this passage: ${segment.direction}`);
  return parts.join('. ');
}

// Merge consecutive segments with identical voice + directive up to the chunk
// budget, then split any oversized chunk on sentence boundaries.
function groupSegments(segments) {
  const merged = [];
  for (const seg of segments) {
    const directive = directiveFor(seg);
    const prev = merged.at(-1);
    if (
      prev &&
      prev.voice === seg.voice &&
      prev.directive === directive &&
      prev.text.length + seg.text.length + 2 <= MAX_CHUNK_CHARS
    ) {
      prev.text += (seg.para === prev.endPara ? ' ' : '\n\n') + seg.text;
      prev.endPara = seg.para;
    } else {
      merged.push({
        voice: seg.voice,
        directive,
        speaker: seg.speaker,
        text: seg.text,
        startPara: seg.para,
        endPara: seg.para,
      });
    }
  }

  const groups = [];
  for (const g of merged) {
    if (g.text.length <= MAX_CHUNK_CHARS) {
      groups.push(g);
      continue;
    }
    let cur = '';
    for (const sentence of splitSentences(g.text)) {
      if (cur && cur.length + sentence.length > MAX_CHUNK_CHARS) {
        groups.push({ ...g, text: cur.trim() });
        cur = '';
      }
      cur += sentence;
    }
    if (cur.trim()) groups.push({ ...g, text: cur.trim() });
  }
  // A chunk that starts inside the paragraph the previous chunk ended in
  // (a dialogue part or a sentence-split continuation) gets a short pause
  // instead of a full paragraph pause.
  for (let i = 1; i < groups.length; i++) {
    groups[i].midParagraphJoin = groups[i].startPara === groups[i - 1].endPara;
  }
  return groups;
}

function plainModeGroups(data, body) {
  const voice = data.narration?.voice ?? DEFAULT_VOICE;
  const style = data.narration?.style ?? DEFAULT_STYLE;
  const paragraphs = splitParagraphs(body);
  const segments = paragraphs.map((text, i) => ({
    para: i + 1,
    speaker: 'narrator',
    voice,
    style,
    direction: null,
    text,
  }));
  return groupSegments(segments);
}

// ---------------------------------------------------------------------------
// Gemini TTS call + audio assembly
// ---------------------------------------------------------------------------

// The interaction response carries audio as base64 PCM (audio/l16) inside
// steps[].content[]; older doc examples show output_audio.data, so check both.
function extractAudioData(interaction) {
  const direct = interaction.output_audio?.data ?? interaction.outputAudio?.data;
  if (direct) return Buffer.from(direct, 'base64');
  const buffers = [];
  for (const step of interaction.steps ?? []) {
    for (const item of step.content ?? []) {
      if (item.mime_type?.startsWith('audio/') && item.data) {
        buffers.push(Buffer.from(item.data, 'base64'));
      }
    }
  }
  return buffers.length ? Buffer.concat(buffers) : null;
}

async function generateChunk(input, voice, attempt = 1) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      model: MODEL,
      input,
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
  });

  if (res.status === 429 || res.status >= 500) {
    const body = await res.text();
    if (attempt > MAX_RETRIES) fail(`API kept failing (HTTP ${res.status}): ${body}`);
    // Honor the server's suggested wait ("Please retry in 32.1s") when present.
    const hinted = body.match(/retry in ([\d.]+)s/i)?.[1];
    const delay = hinted
      ? Math.ceil(Number(hinted) + 2) * 1000
      : Math.min(2 ** attempt * 1000, 45000);
    console.log(`    HTTP ${res.status}, retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})...`);
    await new Promise((r) => setTimeout(r, delay));
    return generateChunk(input, voice, attempt + 1);
  }
  if (!res.ok) fail(`API error (HTTP ${res.status}): ${await res.text()}`);

  const interaction = await res.json();
  const pcm = extractAudioData(interaction);
  if (!pcm) {
    fail(`No audio in response. Top-level keys: ${Object.keys(interaction).join(', ')}\n${JSON.stringify(interaction).slice(0, 2000)}`);
  }
  return pcm;
}

const silence = (ms) => Buffer.alloc(Math.round((SAMPLE_RATE * ms) / 1000) * 2);

function encodeMp3(pcmPath, mp3Path) {
  const result = spawnSync(ffmpegPath, [
    '-y',
    '-f', 's16le',
    '-ar', String(SAMPLE_RATE),
    '-ac', '1',
    '-i', pcmPath,
    '-codec:a', 'libmp3lame',
    '-b:a', '64k',
    mp3Path,
  ]);
  if (result.status !== 0) {
    fail(`ffmpeg failed: ${result.stderr?.toString().slice(-2000)}`);
  }
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function generateEntry(entryId, { force = false, dryRun = false, showParagraphs = false } = {}) {
  const mdPath = path.join(SUMMARIES_DIR, `${entryId}.md`);
  if (!existsSync(mdPath)) fail(`No summary found at ${mdPath}`);

  const { data, body } = parseSummary(await readFile(mdPath, 'utf8'));
  const paragraphs = splitParagraphs(body);

  if (showParagraphs) {
    console.log(`\n${data.title} — ${paragraphs.length} paragraphs:`);
    paragraphs.forEach((p, i) => console.log(`  [${i + 1}] ${p.length} chars: ${p.slice(0, 70)}...`));
    return;
  }

  const outPath = path.join(AUDIO_DIR, `${entryId}.mp3`);
  if (existsSync(outPath) && !force && !dryRun) {
    console.log(`✓ ${entryId} — audio already exists (use --force to regenerate)`);
    return;
  }

  const scriptPath = path.join(SUMMARIES_DIR, `${entryId}.narration.json`);
  let groups;
  let mode;
  if (existsSync(scriptPath)) {
    mode = 'directed';
    let narration;
    try {
      narration = JSON.parse(await readFile(scriptPath, 'utf8'));
    } catch (e) {
      fail(`${scriptPath} is not valid JSON: ${e.message}`);
    }
    groups = groupSegments(buildSegments(narration, paragraphs, path.relative(ROOT, scriptPath)));
  } else {
    mode = 'plain';
    groups = plainModeGroups(data, body);
  }

  const totalChars = groups.reduce((n, g) => n + g.text.length, 0);
  const voices = [...new Set(groups.map((g) => g.voice))];
  console.log(`\n${data.title} by ${data.author} [${mode} mode]`);
  console.log(`  Voices: ${voices.join(', ')}`);
  console.log(`  ${groups.length} chunks, ${totalChars} chars, ~${Math.round(totalChars / 15 / 60)} min of audio`);

  if (dryRun) {
    groups.forEach((g, i) => {
      console.log(
        `  [${i + 1}] ¶${g.startPara}${g.endPara !== g.startPara ? `–${g.endPara}` : ''} ${g.voice} (${g.text.length} chars)`
      );
      console.log(`      directive: ${g.directive.slice(0, 110)}${g.directive.length > 110 ? '...' : ''}`);
      console.log(`      text: ${g.text.slice(0, 80)}...`);
    });
    console.log('\nDry run only — no audio generated. Script is valid.');
    return;
  }
  if (!process.env.GEMINI_API_KEY) {
    fail('GEMINI_API_KEY is not set. Add it to .env in the project root.');
  }

  const cacheDir = path.join(CACHE_DIR, entryId.replaceAll('/', '__'));
  await mkdir(cacheDir, { recursive: true });

  const pcmBuffers = [];
  for (const [i, group] of groups.entries()) {
    if (i > 0) pcmBuffers.push(silence(group.midParagraphJoin ? INLINE_PAUSE_MS : PARA_PAUSE_MS));

    const input = `${group.directive}:\n\n${group.text}`;
    const hash = createHash('sha256').update(`${MODEL}|${group.voice}|${input}`).digest('hex').slice(0, 12);
    const cachePath = path.join(cacheDir, `chunk-${String(i).padStart(3, '0')}-${hash}.pcm`);

    if (existsSync(cachePath)) {
      console.log(`  [${i + 1}/${groups.length}] cached (${group.voice})`);
      pcmBuffers.push(await readFile(cachePath));
      continue;
    }
    process.stdout.write(`  [${i + 1}/${groups.length}] ¶${g_label(group)} ${group.voice}, ${group.text.length} chars... `);
    const started = Date.now();
    const pcm = await generateChunk(input, group.voice);
    await writeFile(cachePath, pcm);
    pcmBuffers.push(pcm);
    console.log(`${(pcm.length / SAMPLE_RATE / 2).toFixed(0)}s of audio in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }

  const pcmPath = path.join(cacheDir, 'full.pcm');
  await writeFile(pcmPath, Buffer.concat(pcmBuffers));
  await mkdir(path.dirname(outPath), { recursive: true });
  encodeMp3(pcmPath, outPath);
  await rm(pcmPath);

  const totalSec = pcmBuffers.reduce((n, b) => n + b.length, 0) / SAMPLE_RATE / 2;
  const { size } = await stat(outPath);
  console.log(`  ✓ Wrote ${path.relative(ROOT, outPath)} — ${Math.floor(totalSec / 60)}m${Math.round(totalSec % 60)}s, ${(size / 1024 / 1024).toFixed(1)} MB`);
}

const g_label = (g) => `${g.startPara}${g.endPara !== g.startPara ? `–${g.endPara}` : ''}`;

async function listEntryIds() {
  const ids = [];
  for (const author of await readdir(SUMMARIES_DIR, { withFileTypes: true })) {
    if (!author.isDirectory()) continue;
    for (const file of await readdir(path.join(SUMMARIES_DIR, author.name))) {
      if (file.endsWith('.md')) ids.push(`${author.name}/${file.replace(/\.md$/, '')}`);
    }
  }
  return ids;
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const opts = {
  force: flags.has('--force'),
  dryRun: flags.has('--dry-run'),
  showParagraphs: flags.has('--paragraphs'),
};

if (flags.has('--all')) {
  for (const id of await listEntryIds()) await generateEntry(id, opts);
} else if (positional.length === 1) {
  await generateEntry(positional[0].replace(/\.md$/, '').replace(/^summaries\//, ''), opts);
} else {
  fail('Usage: pnpm generate-audio <author-slug>/<title-slug> [--force] [--dry-run] [--paragraphs] | --all');
}
