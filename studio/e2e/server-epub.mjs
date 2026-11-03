#!/usr/bin/env node
/* Wave 5a e2e helper: the server's own EPUB build (src/book/epub: the closure 1.0's studio code is lifted into, run in
   its capped worker) on request bodies, as src/book/epub/build.ts builds a book the studio sent — readBook, then the
   studio's state (epubState, the body's platform), then buildEpubBlob in the sandbox — minus the shelf's picture store
   (the bodies carry their pictures inline) and the size cap. Run by e2e/book.mjs as
     node --import tsx e2e/server-epub.mjs <bodies.json> <out.json>
   with the server's dependencies installed (tsx, @xmldom/xmldom). For each body: the file name, the server's notes, the
   zip (base64, for the e2e to serve as the server would), and the unzipped package: each entry's path, whether it is
   stored, its sha256 — with the one field 1.0 makes differ on every build masked: package.opf's dcterms:modified (the
   build's time) — and, when asked, the text of each non-binary file. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(STUDIO, '..');
const [inFile, outFile, withText] = process.argv.slice(2);
const { readBook } = await import(pathToFileURL(path.join(REPO, 'src', 'book', 'read.ts')).href);
const { epubState } = await import(pathToFileURL(path.join(REPO, 'src', 'book', 'epub', 'state.ts')).href);
const { loadEpubClosure } = await import(pathToFileURL(path.join(REPO, 'src', 'book', 'epub', 'closure.ts')).href);
const JSZip = createRequire(import.meta.url)(path.join(REPO, 'client', 'assets', 'vendor', 'jszip.min.js'));
const sb = loadEpubClosure(readFileSync(path.join(REPO, 'client', 'index.html'), 'utf8'), path.join(REPO, 'client'));
/** The one per-build field: the OPF's modification time. */
export const MASK = (p, text) => (p.endsWith('.opf') ? text.replace(/<meta property="dcterms:modified">[^<]*<\/meta>/, '<meta property="dcterms:modified">(the build time)</meta>') : text);
const out = [];
for (const body of JSON.parse(readFileSync(inFile, 'utf8'))) {
  const parsed = typeof body === 'string' ? JSON.parse(body) : body;
  const r = readBook(parsed.book);
  if (r.status !== 'ok') {
    out.push({ error: 'readBook: ' + r.status });
    continue;
  }
  let built;
  try {
    built = await sb.build(epubState(r.book, parsed.platform ?? r.book.exportPlatform), { lang: parsed.lang });
  } catch (e) {
    out.push({ error: 'the build: ' + (e && e.message ? e.message : String(e)) });
    continue;
  }
  const zip = await JSZip.loadAsync(built.bytes);
  const files = [];
  const texts = {};
  for (const name of Object.keys(zip.files)) {
    const e = zip.files[name];
    if (e.dir) continue;
    const bin = /\.(png|jpe?g|gif|webp|ttf|otf|woff2?)$/i.test(name) || name.includes('/Images/') || name.includes('/Fonts/');
    const bytes = Buffer.from(await e.async('uint8array'));
    const masked = bin ? bytes : Buffer.from(MASK(name, bytes.toString('utf8')), 'utf8');
    files.push({ path: name, stored: e._data && e._data.compression ? e._data.compression.magic === '\x00\x00' : null, size: bytes.length, sha256: createHash('sha256').update(masked).digest('hex') });
    if (withText && !bin) texts[name] = bytes.toString('utf8');
  }
  out.push({ filename: built.filename, notes: built.notes, first: Object.keys(zip.files)[0], zip: Buffer.from(built.bytes).toString('base64'), files, texts });
}
writeFileSync(outFile, JSON.stringify(out));
