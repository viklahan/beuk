import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { EPUB_CLOSURE, EPUB_ROOTS, EPUB_SUPPLIED, extractEpubSource, loadEpubClosure, reachableDeclarations } from '../src/book/epub/closure.js';
import { STUDIO_BASE, fontsFetch, makeSandbox } from '../src/book/epub/sandbox.js';
import { epubState } from '../src/book/epub/state.js';
import { readBook } from '../src/book/read.js';
import { fixturePath } from './book-fixtures.js';

/* BEUK:epub-server — the studio's own EPUB code, lifted out of
   client/index.html (src/book/epub/closure.ts) and run in a fenced vm
   context (src/book/epub/sandbox.ts) inside a worker. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
const bookOf = (rel: string) => readBook((JSON.parse(readFileSync(fixturePath(rel), 'utf8')) as { book: unknown }).book).book;

test('closure: every EPUB_CLOSURE name is a top-level declaration of the studio', () => {
  const src = extractEpubSource(html);
  for (const n of EPUB_CLOSURE) assert.ok(src.names.includes(n), `lifted ${n}`);
  assert.ok(src.lines > 0 && src.code.includes('function epubFiles('));
});

test('closure: the list covers everything the studio code reaches from the roots (a new dependency fails here)', () => {
  const reach = reachableDeclarations(html, EPUB_ROOTS, EPUB_SUPPLIED);
  const listed = new Set(EPUB_CLOSURE);
  assert.deepEqual(reach.filter((n) => !listed.has(n)), [], 'reached but not in EPUB_CLOSURE');
});

test('closure: a studio rename fails loudly, naming the missing declaration', () => {
  const renamed = html.replace('function epubTocTarget(', 'function epubTocTargetRenamed(');
  assert.notEqual(renamed, html, 'the fixture rename applied');
  assert.throws(() => extractEpubSource(renamed), /no longer declares: epubTocTarget\b/);
});

test('sandbox: no require, no process, no module, no eval', () => {
  const ctx = makeSandbox({ clientDir: CLIENT, notes: [] });
  assert.equal(vm.runInContext('typeof require', ctx), 'undefined');
  assert.equal(vm.runInContext('typeof process', ctx), 'undefined');
  assert.equal(vm.runInContext('typeof module', ctx), 'undefined');
  assert.throws(() => vm.runInContext('eval("1")', ctx), /Code generation from strings disallowed/);
  assert.throws(() => vm.runInContext('new Function("return 1")', ctx), /Code generation from strings disallowed/);
});

test('sandbox: fetch reads the fonts directory and rejects every other URL', async () => {
  const f = fontsFetch(CLIENT);
  const ok = await f(new URL('assets/fonts/amiri/OFL.txt', STUDIO_BASE).href);
  assert.equal(ok.ok, true);
  assert.match(await ok.text(), /SIL OPEN FONT LICENSE/i);
  const missing = await f(new URL('assets/fonts/amiri/nope.ttf', STUDIO_BASE).href);
  assert.equal(missing.status, 404);
  for (const bad of [
    'https://example.com/assets/fonts/amiri/OFL.txt',
    new URL('index.html', STUDIO_BASE).href,
    new URL('assets/vendor/jszip.min.js', STUDIO_BASE).href,
    STUDIO_BASE + 'assets/fonts/../index.html',
    STUDIO_BASE + 'assets/fonts/%2e%2e/index.html',
    STUDIO_BASE + 'assets/fonts/amiri/%2e%2e/%2e%2e/index.html',
    'file:///etc/passwd',
  ]) await assert.rejects(f(bad), TypeError, bad);
});

test('closure: epubFiles runs on salt-road-standalone and returns a whole package', async () => {
  const sb = loadEpubClosure(html, CLIENT);
  const { files } = await sb.files(epubState(bookOf('real/salt-road-standalone.json'), 'generic'), { lang: 'en' });
  const paths = files.map((f) => f.path);
  assert.equal(paths[0], 'mimetype');
  for (const p of ['META-INF/container.xml', 'OEBPS/package.opf', 'OEBPS/nav.xhtml', 'OEBPS/toc.ncx', 'OEBPS/Styles/blitz.css']) assert.ok(paths.includes(p), p);
  assert.ok(paths.some((p) => p.startsWith('OEBPS/Text/chapter_')), 'chapters');
  assert.ok(paths.some((p) => p.startsWith('OEBPS/Images/')), 'pictures');
});

test('closure: the build is a zip whose first entry is an uncompressed mimetype', async () => {
  const sb = loadEpubClosure(html, CLIENT);
  const out = await sb.build(epubState(bookOf('real/reads-you.json'), 'kdp'), { lang: 'en' });
  assert.equal(out.bytes.subarray(0, 4).toString('binary'), 'PK\x03\x04');
  assert.equal(out.bytes.subarray(30, 38).toString(), 'mimetype');
  assert.equal(out.bytes.readUInt16LE(8), 0, 'stored, not deflated');
  assert.match(out.filename, /-kdp\.epub$/);
});

test('closure: loading is cached per studio file', () => {
  assert.equal(loadEpubClosure(html, CLIENT), loadEpubClosure(html, CLIENT));
});
