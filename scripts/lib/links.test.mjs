import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { checkDist, classifyUrl, extractUrls, readBase } from './links.mjs';

const BASE = '/revoiced/';
const tempDirs = [];

after(() => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))));

const PAGEFIND_ENTRY = JSON.stringify({ languages: { en: { hash: 'en_abc123', wasm: 'en', page_count: 3 } } });
const MANIFEST = JSON.stringify({ icons: [{ src: 'icon-192x192.png' }, { src: '/revoiced/icon-512x512.png' }] });

async function makeDist(files) {
  const dir = await mkdtemp(join(tmpdir(), 'check-links-'));
  tempDirs.push(dir);
  const all = {
    'index.html': '<html></html>',
    'pagefind/pagefind-ui.js': '',
    'pagefind/pagefind-ui.css': '',
    'pagefind/pagefind.js': '',
    'pagefind/pagefind-entry.json': PAGEFIND_ENTRY,
    'pagefind/pagefind.en_abc123.pf_meta': '',
    'pagefind/wasm.en.pagefind': '',
    'sw.js': '',
    'manifest.json': MANIFEST,
    'offline/index.html': '<html></html>',
    'icon-192x192.png': '',
    'icon-512x512.png': '',
    ...files,
  };
  for (const [name, content] of Object.entries(all)) {
    if (content === null) continue;
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

describe('extractUrls', () => {
  test('reads double and single quoted attributes', () => {
    const html = `<a href="/revoiced/a">x</a><img src='/revoiced/b.png'><video poster="/revoiced/p.jpg">`;
    assert.deepEqual(extractUrls(html), ['/revoiced/a', '/revoiced/b.png', '/revoiced/p.jpg']);
  });

  test('splits srcset candidates and drops descriptors', () => {
    const html = `<img srcset="/revoiced/a.png 1x, /revoiced/b.png 2x" src="/revoiced/a.png">`;
    assert.deepEqual(extractUrls(html), ['/revoiced/a.png', '/revoiced/b.png', '/revoiced/a.png']);
  });

  test('includes og:image meta content but ignores other meta and data-src', () => {
    const html = `<meta property="og:image" content="/revoiced/og.png"><meta name="description" content="hi"><div data-src="/nope">`;
    assert.deepEqual(extractUrls(html), ['/revoiced/og.png']);
  });

  test('ignores scripts, styles, and comments', () => {
    const html = `<script>el.setAttribute("href", "/x"); a = '<a href="/y">'</script><!-- <a href="/z"> --><style>a{}</style>`;
    assert.deepEqual(extractUrls(html), []);
  });

  test('keeps src on script tags while ignoring their bodies', () => {
    const html = `<script src="/revoiced/a.js"></script><script type="module" src='/b.js'>import "/c.js";</script>`;
    assert.deepEqual(extractUrls(html), ['/revoiced/a.js', '/b.js']);
  });

  test('ignores attribute-like text outside tags', () => {
    const html = `<p>This is documentation: src="missing.png"</p><code>&lt;a href="/x"&gt; href="/y"</code><a title="a > b" href="/revoiced/ok">`;
    assert.deepEqual(extractUrls(html), ['/revoiced/ok']);
  });
});

describe('classifyUrl', () => {
  test('skips external, mailto, tel, data, javascript, and fragments', () => {
    for (const url of [
      'https://example.com/x',
      'http://example.com',
      '//cdn.example.com/x.js',
      'mailto:a@b.c',
      'tel:123',
      'data:image/png;base64,AAA',
      'javascript:void(0)',
      '#top',
      '',
    ]) {
      assert.equal(classifyUrl(url, BASE).kind, 'skip', url);
    }
  });

  test('flags absolute paths outside the base', () => {
    assert.equal(classifyUrl('/author/x', BASE).kind, 'missing-base');
  });

  test('strips base, query, and hash, and decodes components', () => {
    assert.deepEqual(classifyUrl('/revoiced/a%20b?x=1#frag', BASE), {
      kind: 'internal',
      path: 'a b',
      absolute: true,
    });
    assert.deepEqual(classifyUrl('/revoiced', BASE), { kind: 'internal', path: '', absolute: true });
  });

  test('keeps relative paths relative', () => {
    assert.deepEqual(classifyUrl('../x.png', BASE), { kind: 'internal', path: '../x.png', absolute: false });
  });
});

describe('checkDist', () => {
  test('passes a clean fixture', async () => {
    const dist = await makeDist({
      'index.html': '<a href="/revoiced/author/book">b</a><a href="https://example.com">e</a><a href="#top">t</a>',
      'author/book/index.html': '<a href="/revoiced/">home</a><link href="/revoiced/manifest.json">',
    });
    const result = await checkDist(dist, { base: BASE });
    assert.deepEqual(result.errors, []);
    assert.equal(result.htmlFiles, 3);
    assert.ok(result.linksChecked >= 3);
  });

  test('errors when dist is missing', async () => {
    await assert.rejects(checkDist(join(tmpdir(), 'no-such-dist-dir'), { base: BASE }), /dist\/ not found/);
  });

  test('reports a broken link once per file and url', async () => {
    const dist = await makeDist({
      'index.html': '<a href="/revoiced/missing">a</a><a href="/revoiced/missing?q=1">b</a><a href="/revoiced/missing">c</a>',
    });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors, [
      'index.html: broken link /revoiced/missing',
      'index.html: broken link /revoiced/missing?q=1',
    ]);
  });

  test('reports absolute paths missing the base', async () => {
    const dist = await makeDist({ 'index.html': '<a href="/author/x">a</a>' });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors, ['index.html: missing base path /author/x']);
  });

  test('resolves relative URLs against the html file directory', async () => {
    const dist = await makeDist({
      'a/b/index.html': '<img src="pic.png"><a href="../sibling"></a><a href="../../gone"></a>',
      'a/b/pic.png': '',
      'a/sibling.html': '',
    });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors, ['a/b/index.html: broken link ../../gone']);
  });

  test('resolves directories via index.html and extensionless paths via .html', async () => {
    const dist = await makeDist({
      'index.html': '<a href="/revoiced/dir">d</a><a href="/revoiced/dir/">d</a><a href="/revoiced/page">p</a>',
      'dir/index.html': '',
      'page.html': '',
    });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors, []);
  });

  test('reports missing required assets', async () => {
    const dist = await makeDist({ 'pagefind/pagefind-ui.js': null, 'sw.js': null });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors.sort(), [
      'missing required asset pagefind/pagefind-ui.js',
      'missing required asset sw.js',
    ]);
  });

  test('reports broken or missing-base script src', async () => {
    const dist = await makeDist({
      'index.html': '<script src="/revoiced/missing.js"></script><script src="/missing-base.js"></script>',
    });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors, [
      'index.html: broken link /revoiced/missing.js',
      'index.html: missing base path /missing-base.js',
    ]);
  });

  test('requires the pagefind runtime and the index files its entry names', async () => {
    const dist = await makeDist({ 'pagefind/pagefind.js': null, 'pagefind/wasm.en.pagefind': null });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors.sort(), [
      'missing required asset pagefind/pagefind.js',
      'missing required asset pagefind/wasm.en.pagefind',
    ]);
  });

  test('reports an empty search index', async () => {
    const entry = JSON.stringify({ languages: { en: { hash: 'en_abc123', wasm: 'en', page_count: 0 } } });
    const dist = await makeDist({ 'pagefind/pagefind-entry.json': entry });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors, ['pagefind/pagefind-entry.json: search index has no pages']);
  });

  test('reports manifest icons that do not resolve', async () => {
    const dist = await makeDist({ 'icon-192x192.png': null, 'icon-512x512.png': null });
    const { errors } = await checkDist(dist, { base: BASE });
    assert.deepEqual(errors, [
      'manifest.json: broken link icon-192x192.png',
      'manifest.json: broken link /revoiced/icon-512x512.png',
    ]);
  });
});

describe('readBase', () => {
  test('reads base from the astro config and falls back to the default', async () => {
    const dir = await makeDist({ 'astro.config.mjs': `export default { site: 'x', base: '/other' };` });
    assert.equal(await readBase(join(dir, 'astro.config.mjs')), '/other/');
    assert.equal(await readBase(join(dir, 'missing.mjs')), BASE);
    assert.equal(await readBase(join(dir, 'index.html')), BASE);
  });
});
