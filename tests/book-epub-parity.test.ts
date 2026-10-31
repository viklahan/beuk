import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadEpubClosure } from '../src/book/epub/closure.js';
import { epubState } from '../src/book/epub/state.js';
import { readBook } from '../src/book/read.js';
import { readZip, type ZipEntry } from '../src/housekeeping/packages.js';

/* BEUK:epub-server — parity, the acceptance test: for every captured
   book the server's EPUB equals the studio's file by file. The studio
   side was captured in a real browser by tools/book-corpus/epub-parity.mjs
   (tests/fixtures/epub-parity/*.json); only two things are masked, the
   same way on both sides: dcterms:modified, and a book id minted because
   the book had none (or a pre-UUID one). BEUK_BOOK_CORPUS adds the
   gallery, read against captures in BEUK_EPUB_PARITY_OUT (default
   .scratch/epub-parity-corpus), one book at a time. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'client');
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8');

type Capture = { book: string; platform: string; lang: string; mintedBookId: boolean; files: { path: string; binary: boolean; sha256: string }[] };

function mask(content: string, mintedId: string | null): string {
  let c = content.replace(/<meta property="dcterms:modified">[^<]*<\/meta>/, '<meta property="dcterms:modified">MASKED</meta>');
  if (mintedId) c = c.split(mintedId).join('MINTED-BOOK-ID');
  return c;
}
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Every difference between the server's files and the capture, listed (never only the first). */
async function diff(raw: { meta?: { bookId?: unknown } }, cap: Capture): Promise<string[]> {
  const read = readBook(raw);
  assert.equal(read.status, 'ok', `${cap.book}: readBook status`);
  const id = read.book.meta.bookId;
  const minted = id !== raw?.meta?.bookId;
  assert.equal(minted, cap.mintedBookId, `${cap.book}: the server minted a book id exactly when the studio did`);
  const { files } = await loadEpubClosure(html, CLIENT).files(epubState(read.book, cap.platform), { lang: cap.lang });
  const out: string[] = [];
  const mine = new Map(files.map((f) => [f.path, sha(mask(f.content, minted ? id : null))]));
  const theirs = new Map(cap.files.map((f) => [f.path, f.sha256]));
  const order = (m: Map<string, string>) => [...m.keys()].join('\n');
  if (order(mine) !== order(theirs)) out.push(`file list differs:\n  server: ${[...mine.keys()].join(' ')}\n  studio: ${[...theirs.keys()].join(' ')}`);
  for (const [p, h] of theirs) {
    if (!mine.has(p)) continue;
    if (mine.get(p) !== h) out.push(`${p} differs`);
  }
  return out;
}

const fixtures = path.join(ROOT, 'tests', 'fixtures');
const captures = readdirSync(path.join(fixtures, 'epub-parity')).filter((f) => f.endsWith('.json')).sort();

test('parity: there is a capture for every real, legacy and constructed book', () => {
  const books = ['books/real', 'books/legacy', 'epub-parity/books'].flatMap((d) => readdirSync(path.join(fixtures, d)).filter((f) => f.endsWith('.json')).map((f) => `${d}/${f}`));
  const captured = new Set(captures.map((c) => (JSON.parse(readFileSync(path.join(fixtures, 'epub-parity', c), 'utf8')) as Capture).book));
  assert.deepEqual(books.filter((b) => !captured.has(b)), []);
});

/* Listed, never hidden: a book the server reads differently from the 1.0
   studio, the capture the server is held to instead, and why. */
const READ_AS: Record<string, { capture: string; why: string }> = {
  'books/legacy/sections-split.json': {
    capture: 'books__real__reads-you--generic.json',
    why: 'Sections stored as {frontMatter, body, backMatter} (older shelf writers). readBook flattens them (upgrade step sections-split, the reading src/account/data.ts asStudioBackupBook gives the studio). The 1.0 studio handed this doc straight to applyBookDoc sees no sections array and opens the empty scaffold, so its own EPUB of it is a blank book. The server builds the book the fixture came from (reads-you), and is held to the studio EPUB of that book.',
  },
};

const loadCapture = (c: string) => JSON.parse(readFileSync(path.join(fixtures, 'epub-parity', c), 'utf8')) as Capture;
const rawBook = (rel: string) => (JSON.parse(readFileSync(path.join(fixtures, rel), 'utf8')) as { book: { meta?: { bookId?: unknown } } }).book;

for (const c of captures) {
  test(`parity: ${c}`, async () => {
    const cap = loadCapture(c);
    const as = READ_AS[cap.book];
    if (!as) {
      assert.deepEqual(await diff(rawBook(cap.book), cap), []);
      return;
    }
    /* The listed difference still holds (if the studio learns the shape, drop the entry) ... */
    assert.notDeepEqual(await diff(rawBook(cap.book), cap), [], `${cap.book}: the studio now reads this shape like the server; remove it from READ_AS`);
    /* ... and the server equals the studio on the book it reads it as. */
    assert.deepEqual(await diff(rawBook(cap.book), { ...loadCapture(as.capture), mintedBookId: cap.mintedBookId }), []);
  });
}

const corpusDir = process.env.BEUK_BOOK_CORPUS;
test('parity: full corpus (BEUK_BOOK_CORPUS)', { skip: corpusDir ? false : 'set BEUK_BOOK_CORPUS to the gallery folder and capture it first' }, async (t) => {
  const capDir = path.resolve(process.env.BEUK_EPUB_PARITY_OUT || path.join(ROOT, '.scratch', 'epub-parity-corpus'));
  const caps = existsSync(capDir) ? readdirSync(capDir).filter((f) => f.endsWith('.json')).sort() : [];
  assert.ok(caps.length > 0, `no captures in ${capDir}: run tools/book-corpus/epub-parity.mjs --corpus first`);
  const bad: string[] = [];
  for (const c of caps) {
    const cap = JSON.parse(readFileSync(path.join(capDir, c), 'utf8')) as Capture;
    const raw = (JSON.parse(readFileSync(path.join(corpusDir!, cap.book), 'utf8')) as { book: { meta?: { bookId?: unknown } } }).book;
    for (const d of await diff(raw, cap)) bad.push(`${cap.book}: ${d}`);
  }
  t.diagnostic(`books compared: ${caps.length}`);
  assert.deepEqual(bad, []);
});

/* ---- Review focus: fonts byte-identical, the accessibility stamp ---- */

const manifestSha = new Map(
  readFileSync(path.join(CLIENT, 'assets', 'fonts', 'MANIFEST.tsv'), 'utf8').split('\n').slice(1).filter(Boolean)
    .map((row) => row.split('\t')).map((c) => [c[1]!, c[3]!] as const),
);
async function zipOf(rel: string) {
  const book = readBook(rawBook(rel)).book;
  const out = await loadEpubClosure(html, CLIENT).build(epubState(book, 'generic'), { lang: 'en' });
  return { entries: readZip(out.bytes), notes: out.notes };
}
const fontSha = (entries: ZipEntry[]) => entries.filter((e) => e.name.startsWith('OEBPS/Fonts/') && !e.name.endsWith('/')).map((e) => [e.name, createHash('sha256').update(e.data).digest('hex')] as const);

for (const [rel, file] of [
  ['epub-parity/books/rtl-arabic.json', 'amiri/Amiri-normal-400.ttf'],
  ['epub-parity/books/hindi.json', 'notoserifdevanagari/Noto_Serif_Devanagari-normal-400.ttf'],
] as const) {
  test(`fonts: ${rel} embeds its script face byte-identical to client/assets/fonts (MANIFEST.tsv sha256)`, async () => {
    const { entries, notes } = await zipOf(rel);
    assert.deepEqual(notes, [], 'no font failed to load');
    const shas = fontSha(entries).map(([, h]) => h);
    assert.ok(shas.includes(manifestSha.get(file)!), `${file} is embedded`);
    for (const [name, h] of fontSha(entries)) assert.ok([...manifestSha.values()].includes(h), `${name} matches a MANIFEST.tsv row`);
    const opf = entries.find((e) => e.name === 'OEBPS/package.opf')!.data.toString('utf8');
    if (rel.includes('arabic')) assert.match(opf, /page-progression-direction="rtl"/);
  });
}

test('fonts: an uploaded font ships its own bytes, and a display face matches MANIFEST.tsv', async () => {
  const { entries, notes } = await zipOf('epub-parity/books/uploaded-font.json');
  assert.deepEqual(notes, []);
  const upload = createHash('sha256').update(readFileSync(path.join(CLIENT, 'assets', 'fonts', 'patrickhand', 'Patrick_Hand-normal-400.ttf'))).digest('hex');
  const got = new Map(fontSha(entries));
  assert.equal(got.get('OEBPS/Fonts/writer-hand.ttf'), upload, 'the upload, byte for byte');
  assert.ok([...got.values()].includes(manifestSha.get('abrilfatface/Abril_Fatface-normal-400.ttf')!), 'Abril Fatface, as listed');
});

test('a11y: the conformance stamp rides only a clean audit, as in the studio (one finding the audit reads through DOMParser)', async () => {
  const opfOf = async (rel: string) => (await zipOf(rel)).entries.find((e) => e.name === 'OEBPS/package.opf')!.data.toString('utf8');
  assert.match(await opfOf('books/real/salt-road-standalone.json'), /<meta property="dcterms:conformsTo">/, 'clean book: stamped');
  assert.doesNotMatch(await opfOf('epub-parity/books/no-author.json'), /dcterms:conformsTo/, 'no dc:creator (found by parsing the OPF): not stamped');
  assert.doesNotMatch(await opfOf('books/real/reads-you.json'), /dcterms:conformsTo/, 'heading levels skip: not stamped');
});
