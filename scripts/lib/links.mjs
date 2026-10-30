// Link checking for the built site: finds internal references in dist/ HTML
// that do not resolve to a file, plus assets that are only referenced from JS/JSON.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, posix } from 'node:path';

export const DEFAULT_BASE = '/revoiced/';

export const REQUIRED_ASSETS = [
  'pagefind/pagefind-ui.js',
  'pagefind/pagefind-ui.css',
  'sw.js',
  'manifest.json',
  'offline/index.html',
];

const URL_ATTRS = new Set(['href', 'src', 'srcset', 'poster']);
const SKIP_SCHEME = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

function attrValue(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

// Returns every URL found in href/src/srcset/poster attributes and image meta tags.
export function extractUrls(html) {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const urls = [];

  for (const [, name, dq, sq] of source.matchAll(
    /\s([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
  )) {
    const attr = name.toLowerCase();
    if (!URL_ATTRS.has(attr)) continue;
    const value = decodeEntities(dq ?? sq);
    if (attr === 'srcset') {
      for (const candidate of value.split(',')) {
        const url = candidate.trim().split(/\s+/)[0];
        if (url) urls.push(url);
      }
    } else {
      urls.push(value.trim());
    }
  }

  for (const [tag] of source.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attrValue(tag, 'property') ?? attrValue(tag, 'name');
    if (!key || !/^(?:og|twitter):image(?::url)?$/i.test(key)) continue;
    const content = attrValue(tag, 'content');
    if (content) urls.push(decodeEntities(content).trim());
  }

  return urls.filter(Boolean);
}

// Classifies a URL as skipped, missing the base path, or internal.
// Absolute internal paths come back relative to the dist root; relative ones stay relative.
export function classifyUrl(url, base = DEFAULT_BASE) {
  if (!url || url.startsWith('#') || SKIP_SCHEME.test(url)) return { kind: 'skip' };

  let path = url.split('#')[0].split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path; it will most likely fail to resolve
  }

  if (path.startsWith('/')) {
    if (path === base.slice(0, -1)) return { kind: 'internal', path: '', absolute: true };
    if (!path.startsWith(base)) return { kind: 'missing-base' };
    return { kind: 'internal', path: path.slice(base.length), absolute: true };
  }
  return { kind: 'internal', path, absolute: false };
}

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// A target resolves to an exact file, <path>/index.html, or <path>.html.
export async function resolves(distDir, relPath) {
  const clean = posix.normalize(relPath).replace(/\/+$/, '');
  if (clean === '..' || clean.startsWith('../')) return false;
  const target = clean === '.' ? '' : clean;
  const candidates = target
    ? [target, `${target}/index.html`, `${target}.html`]
    : ['index.html'];
  for (const candidate of candidates) {
    if (await isFile(join(distDir, candidate))) return true;
  }
  return false;
}

// Returns an error reason ('missing base path' / 'broken link') or null when the URL is fine.
async function checkUrl(distDir, url, fromDir, base) {
  const result = classifyUrl(url, base);
  if (result.kind === 'skip') return { skipped: true };
  if (result.kind === 'missing-base') return { error: 'missing base path' };
  const relPath = result.absolute ? result.path : posix.join(fromDir, result.path);
  return (await resolves(distDir, relPath)) ? {} : { error: 'broken link' };
}

// Pulls `base: '...'` out of astro.config.mjs, falling back to the default.
export async function readBase(configPath) {
  try {
    const config = await readFile(configPath, 'utf8');
    const match = /\bbase\s*:\s*(['"`])([^'"`]+)\1/.exec(config);
    if (!match) return DEFAULT_BASE;
    let base = match[2];
    if (!base.startsWith('/')) base = `/${base}`;
    return base.endsWith('/') ? base : `${base}/`;
  } catch {
    return DEFAULT_BASE;
  }
}

export async function checkDist(distDir, { base = DEFAULT_BASE } = {}) {
  if (!(await stat(distDir).then((s) => s.isDirectory(), () => false))) {
    throw new Error('dist/ not found — run pnpm build first');
  }

  const errors = new Set();
  const entries = await readdir(distDir, { recursive: true });
  const htmlFiles = entries.filter((entry) => entry.endsWith('.html')).sort();
  let linksChecked = 0;

  for (const file of htmlFiles) {
    const rel = file.split(/[\\/]/).join('/');
    const html = await readFile(join(distDir, file), 'utf8');
    for (const url of new Set(extractUrls(html))) {
      const outcome = await checkUrl(distDir, url, posix.dirname(rel), base);
      if (outcome.skipped) continue;
      linksChecked++;
      if (outcome.error) errors.add(`${rel}: ${outcome.error} ${url}`);
    }
  }

  for (const asset of REQUIRED_ASSETS) {
    if (!(await isFile(join(distDir, asset)))) errors.add(`missing required asset ${asset}`);
  }

  try {
    const manifest = JSON.parse(await readFile(join(distDir, 'manifest.json'), 'utf8'));
    for (const icon of manifest.icons ?? []) {
      if (typeof icon?.src !== 'string') continue;
      const outcome = await checkUrl(distDir, icon.src, '', base);
      if (outcome.skipped) continue;
      linksChecked++;
      if (outcome.error) errors.add(`manifest.json: ${outcome.error} ${icon.src}`);
    }
  } catch (error) {
    // A missing manifest is already reported as a required asset.
    if (error.code !== 'ENOENT') errors.add(`manifest.json: invalid JSON (${error.message})`);
  }

  return { errors: [...errors], htmlFiles: htmlFiles.length, linksChecked };
}
