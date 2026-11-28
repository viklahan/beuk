import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { before, test } from 'node:test';
import { ZipWriter } from '../src/account/zip.js';
import { ARC_META_PROPERTY, ARC_OPF_PREFIX, StampError, stampEpub, type ArcStamp } from '../src/arc/stamp.js';
import { studioEpub } from '../src/book/epub/build.js';
import { StrictDomParser } from '../src/book/epub/sandbox.js';
import { epubState } from '../src/book/epub/state.js';
import { readBook } from '../src/book/read.js';
import { createZip, parseOpf, readZip, validateEpub, type ZipEntry } from '../src/housekeeping/packages.js';

/* ARC slice 1, Task 3 — stampEpub: EPUB bytes in, one reader's stamped
   EPUB out. The line is V's, verbatim (plan Global Constraints):
   "Advance Review Copy prepared for [Name] ([Email])"; English only in
   slice 1 (controller ruling F16). */

const LINE = 'Advance Review Copy prepared for';
const S: ArcStamp = { name: 'Ada Reader', email: 'ada@example.com', publicId: 'pub_ABCDEFGH12', lang: 'en' };
const OPF = 'OEBPS/package.opf';
const ADDED = 'OEBPS/Text/arc-copy.xhtml';

/* A 1×1 PNG, so one binary entry rides along (F18: it keeps its method). */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4//8/AAX+Av4zEpUUAAAAAElFTkSuQmCC';

type Sec = { id: string; type: string; kind: string; title: string; content: string; plateId?: string; plateAlt?: string };
const front = (id: string, type: string, title: string, content = ''): Sec => ({ id, type, kind: 'front', title, content });
const chapter = (id: string, plate = false): Sec => ({
  id, type: 'chapter', kind: 'body', title: 'One', content: 'It began with the tide.',
  ...(plate ? { plateId: 'im1', plateAlt: 'A gull on a post' } : {}),
});
const book = (n: number, sections: Sec[], images: unknown[] = []) => ({
  meta: { title: 'The Salt Road', author: 'A. Writer', language: 'en', bookId: `urn:uuid:00000000-0000-4000-8000-00000000003${n}` },
  sections,
  images,
  cover: null,
});

/** A real EPUB, built the way src/book/epub/build.ts:103-108 builds one. */
async function epubOf(raw: unknown): Promise<Buffer> {
  const read = readBook(raw);
  assert.equal(read.status, 'ok');
  const out = await studioEpub().build(epubState(read.book, read.book.exportPlatform), { lang: 'en' });
  return out.bytes;
}

const failed = (b: Buffer) => validateEpub(readZip(b)).filter((c) => c.status !== 'pass');
const text = (entries: ZipEntry[], name: string) => {
  const e = entries.find((x) => x.name === name);
  assert.ok(e, `${name} is in the package`);
  return e.data.toString('utf8');
};
const withLine = (entries: ZipEntry[]) => entries.filter((e) => e.data.toString('utf8').includes(LINE));
type Doc = { documentElement: { textContent: string }; getElementsByTagName(n: string): { length: number; item(i: number): { textContent: string } | null } };
const parse = (src: string, mime = 'application/xhtml+xml') => new StrictDomParser().parseFromString(src, mime) as Doc;
const spineOf = (entries: ZipEntry[]) => parseOpf(text(entries, OPF)).spineHrefs;
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

let copyrightBook: Buffer; // titlepage, copyright, a plated chapter
let titleBook: Buffer; // halftitle, titlepage, chapter — no copyright
let bareBook: Buffer; // dedication, chapter — neither page
let twoCopyrightBook: Buffer; // titlepage, copyright, copyright, chapter

before(async () => {
  copyrightBook = await epubOf(book(1, [front('t', 'titlepage', 'Title Page'), front('c', 'copyright', 'Copyright'), chapter('ch1', true)], [
    { id: 'im1', name: 'gull.png', mediaType: 'image/png', ext: 'png', data: PNG },
  ]));
  titleBook = await epubOf(book(2, [front('h', 'halftitle', 'Half Title'), front('t', 'titlepage', 'Title Page'), chapter('ch1')]));
  bareBook = await epubOf(book(3, [front('d', 'dedication', 'Dedication', 'For M.'), chapter('ch1')]));
  twoCopyrightBook = await epubOf(book(4, [front('t', 'titlepage', 'Title Page'), front('c1', 'copyright', 'Copyright'), front('c2', 'copyright', 'Copyright'), chapter('ch1')]));
});

/* The fixtures are what the tests say they are (else every test below proves nothing). */
test('fixtures: the four studio books carry the pages their names say', () => {
  const bodyTypes = (b: Buffer) => readZip(b)
    .filter((e) => e.name.endsWith('.xhtml'))
    .map((e) => [e.name, /<body[^>]*epub:type="([^"]*)"/.exec(e.data.toString('utf8'))?.[1] ?? ''] as const);
  const has = (b: Buffer, t: string) => bodyTypes(b).filter(([, v]) => v.split(/\s+/).includes(t)).map(([n]) => n);
  assert.deepEqual(has(copyrightBook, 'copyright-page'), ['OEBPS/Text/copyright.xhtml']);
  assert.deepEqual(has(copyrightBook, 'titlepage'), ['OEBPS/Text/titlepage.xhtml']);
  assert.deepEqual(has(titleBook, 'copyright-page'), []);
  assert.deepEqual(has(titleBook, 'titlepage'), ['OEBPS/Text/titlepage.xhtml']);
  assert.equal(spineOf(readZip(titleBook))[0], 'Text/halftitle.xhtml', 'the title page is not first, so "after it" and "first" differ');
  assert.deepEqual(has(bareBook, 'copyright-page'), []);
  assert.deepEqual(has(bareBook, 'titlepage'), []);
  assert.deepEqual(has(twoCopyrightBook, 'copyright-page').sort(), ['OEBPS/Text/copyright.xhtml', 'OEBPS/Text/copyright_2.xhtml']);
  assert.ok(readZip(copyrightBook).some((e) => e.name.startsWith('OEBPS/Images/') && e.name.endsWith('.png')), 'one picture rides along');
  for (const b of [copyrightBook, titleBook, bareBook, twoCopyrightBook]) assert.ok(!b.includes(LINE), 'no stamp before stamping');
});

test('the copyright page gets exactly one stamp line, word for word', async () => {
  const out = readZip(await stampEpub(copyrightBook, S));
  const hits = withLine(out);
  assert.deepEqual(hits.map((e) => e.name), ['OEBPS/Text/copyright.xhtml']);
  const src = hits[0]!.data.toString('utf8');
  assert.match(src, /<body[^>]*epub:type="copyright-page"/);
  assert.equal(count(src, LINE), 1);
  assert.ok(parse(src).documentElement.textContent.includes('Advance Review Copy prepared for Ada Reader (ada@example.com)'));
  assert.ok(!out.some((e) => e.name === ADDED), 'no page added when a copyright page exists');
});

test('the OPF names the reader once, under a declared prefix', async () => {
  assert.equal(ARC_OPF_PREFIX, 'beuk: https://beuk.studio/ns/arc#');
  assert.equal(ARC_META_PROPERTY, 'beuk:arc-recipient');
  for (const input of [copyrightBook, titleBook, bareBook, twoCopyrightBook]) {
    const opf = text(readZip(await stampEpub(input, S)), OPF);
    assert.match(opf, /<package[^>]*prefix="beuk: https:\/\/beuk\.studio\/ns\/arc#"/);
    assert.equal(count(opf, 'prefix='), 1, 'one prefix attribute');
    assert.equal(count(opf, '<meta property="beuk:arc-recipient">pub_ABCDEFGH12</meta>'), 1);
    assert.equal(count(opf, 'beuk:arc-recipient'), 1);
    assert.ok(/<meta property="beuk:arc-recipient">pub_ABCDEFGH12<\/meta>\s*<\/metadata>/.test(opf), 'inside <metadata>, last');
    parse(opf, 'application/xml'); // throws on any error (strict)
  }
});

test('the package stays as valid as it was', async (t) => {
  for (const [label, input] of [['copyright', copyrightBook], ['title', titleBook], ['bare', bareBook], ['two', twoCopyrightBook]] as const) {
    const out = await stampEpub(input, S);
    t.diagnostic(`${label}: input not passing = ${JSON.stringify(failed(input).map((c) => c.id))}`);
    assert.deepEqual(failed(out), failed(input), label);
    const entries = readZip(out);
    assert.equal(entries[0]!.name, 'mimetype', label);
    assert.equal(entries[0]!.method, 0, `${label}: mimetype stored`);
    assert.equal(out.subarray(30, 38).toString(), 'mimetype', `${label}: the very first local header`);
    for (const e of entries.filter((x) => /\.(xhtml|opf|ncx|xml)$/.test(x.name))) parse(e.data.toString('utf8'), e.name.endsWith('.xhtml') ? 'application/xhtml+xml' : 'application/xml');
  }
});

test('no copyright page: one added page, right after the title page', async () => {
  const out = readZip(await stampEpub(titleBook, S));
  assert.deepEqual(withLine(out).map((e) => e.name), [ADDED]);
  const spine = spineOf(out);
  const before = spineOf(readZip(titleBook));
  const at = before.indexOf('Text/titlepage.xhtml');
  assert.deepEqual(spine, [...before.slice(0, at + 1), 'Text/arc-copy.xhtml', ...before.slice(at + 1)]);
  const opf = parseOpf(text(out, OPF));
  assert.deepEqual(opf.items.filter((i) => i.href === 'Text/arc-copy.xhtml').map((i) => [i.id, i.mediaType]), [['arc-copy', 'application/xhtml+xml']]);
  const page = text(out, ADDED);
  assert.equal(count(page, LINE), 1);
  const doc = parse(page);
  assert.ok(doc.documentElement.textContent.includes('Advance Review Copy prepared for Ada Reader (ada@example.com)'));
  assert.equal(doc.getElementsByTagName('title').item(0)?.textContent, 'Advance Review Copy');
  assert.match(page, /<html [^>]*lang="en" xml:lang="en"/, "the book's dc:language");
  assert.match(page, /href="\.\.\/Styles\/blitz\.css"/);
  assert.equal(text(out, 'OEBPS/nav.xhtml'), text(readZip(titleBook), 'OEBPS/nav.xhtml'), 'nav untouched');
  assert.equal(text(out, 'OEBPS/toc.ncx'), text(readZip(titleBook), 'OEBPS/toc.ncx'), 'NCX untouched');
});

test('no copyright page and no title page: the added page opens the spine', async () => {
  const out = readZip(await stampEpub(bareBook, S));
  assert.deepEqual(withLine(out).map((e) => e.name), [ADDED]);
  assert.deepEqual(spineOf(out), ['Text/arc-copy.xhtml', ...spineOf(readZip(bareBook))]);
});

test('two copyright pages: only the first is stamped', async () => {
  const input = readZip(twoCopyrightBook);
  const firstCopyright = spineOf(input).find((h) => /<body[^>]*epub:type="copyright-page"/.test(text(input, `OEBPS/${h}`)));
  assert.equal(firstCopyright, 'Text/copyright.xhtml');
  const out = readZip(await stampEpub(twoCopyrightBook, S));
  assert.deepEqual(withLine(out).map((e) => e.name), ['OEBPS/Text/copyright.xhtml']);
  assert.equal(count(text(out, 'OEBPS/Text/copyright.xhtml'), LINE), 1);
  assert.equal(text(out, 'OEBPS/Text/copyright_2.xhtml'), text(input, 'OEBPS/Text/copyright_2.xhtml'));
  assert.ok(!out.some((e) => e.name === ADDED));
});

test('a hostile name stays text', async () => {
  const name = '<b>Tom & "Jerry"</b>‮';
  const email = '"x&y"<i>@example.com';
  for (const [input, where] of [[copyrightBook, 'OEBPS/Text/copyright.xhtml'], [titleBook, ADDED]] as const) {
    const bytes = await stampEpub(input, { ...S, name, email });
    const out = readZip(bytes);
    const src = text(out, where);
    const doc = parse(src); // strict: any error throws
    assert.ok(doc.documentElement.textContent.includes(`${LINE} ${name} (${email})`), 'the text, verbatim');
    assert.equal(doc.getElementsByTagName('b').length, 0);
    assert.equal(doc.getElementsByTagName('i').length, 0);
    const bdi = doc.getElementsByTagName('bdi');
    assert.equal(bdi.length, 2, 'name and email each isolated (U+202E cannot flip what follows)');
    assert.equal(bdi.item(0)?.textContent, name);
    assert.equal(bdi.item(1)?.textContent, email);
    assert.ok(src.includes('&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;'), 'real XML escaping');
    assert.deepEqual(failed(bytes), failed(input), 'the package stays as valid as it was');
  }
});

/* Mine (not in the brief): XML 1.0 cannot carry U+0000-U+0008 and the
   like at all; escaping cannot save them, so the stamp refuses rather
   than write a broken document or silently change the name. */
test('a name XML cannot carry is refused, never mangled', async () => {
  await assert.rejects(stampEpub(copyrightBook, { ...S, name: 'Ada\u0001' }), StampError);
  await assert.rejects(stampEpub(copyrightBook, { ...S, email: 'a￾@example.com' }), StampError);
  await assert.rejects(stampEpub(copyrightBook, { ...S, name: '   ' }), StampError);
});

function syntheticEpub(packageAttrs: string): Buffer {
  const b = (s: string) => Buffer.from(s, 'utf8');
  return createZip([
    { name: 'mimetype', data: b('application/epub+zip') },
    { name: 'META-INF/container.xml', data: b('<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>') },
    { name: 'OEBPS/package.opf', data: b(`<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" ${packageAttrs} unique-identifier="pub-id" version="3.0">\n  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n    <dc:identifier id="pub-id">urn:uuid:00000000-0000-4000-8000-000000000099</dc:identifier>\n    <dc:title>T</dc:title>\n    <dc:language>en</dc:language>\n  </metadata>\n  <manifest>\n    <item id="c" href="Text/copyright.xhtml" media-type="application/xhtml+xml"/>\n  </manifest>\n  <spine>\n    <itemref idref="c"/>\n  </spine>\n</package>`) },
    { name: 'OEBPS/Text/copyright.xhtml', data: b('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">\n<head><title>Copyright</title></head>\n<body epub:type="copyright-page">\n<p>© T</p>\n</body>\n</html>') },
  ]);
}

test('an existing prefix attribute is extended, not replaced', async () => {
  const opf = text(readZip(await stampEpub(syntheticEpub('prefix="foo: http://x/"'), S)), OPF);
  assert.match(opf, /<package[^>]*\sprefix="foo: http:\/\/x\/ beuk: https:\/\/beuk\.studio\/ns\/arc#"/);
  assert.equal(count(opf, 'prefix='), 1);
  assert.equal(count(opf, '<meta property="beuk:arc-recipient">pub_ABCDEFGH12</meta>'), 1);
  parse(opf, 'application/xml');
});

test('everything else is byte for byte the input; no watermark', async () => {
  const stamped = new Set(['OEBPS/Text/copyright.xhtml', OPF, ADDED]);
  for (const [label, input] of [['copyright', copyrightBook], ['title', titleBook], ['bare', bareBook], ['two', twoCopyrightBook]] as const) {
    const before = readZip(input);
    const after = readZip(await stampEpub(input, S));
    assert.deepEqual(after.map((e) => e.name).filter((n) => n !== ADDED), before.map((e) => e.name), `${label}: same entries, same order`);
    for (const e of before) {
      if (stamped.has(e.name)) continue;
      const o = after.find((x) => x.name === e.name)!;
      assert.ok(o.data.equals(e.data), `${label}: ${e.name} unchanged`);
      if (!/\.(xhtml|opf|ncx|css|xml)$/.test(e.name) && e.name !== 'mimetype') assert.equal(o.method, e.method, `${label}: ${e.name} keeps its compression method (F18)`);
    }
    assert.ok(text(after, 'OEBPS/Styles/blitz.css') === text(before, 'OEBPS/Styles/blitz.css'), `${label}: blitz.css unchanged`);
    /* The stamped copyright page is the input plus one paragraph, nothing else. */
    if (before.some((e) => e.name === 'OEBPS/Text/copyright.xhtml')) {
      const was = text(before, 'OEBPS/Text/copyright.xhtml');
      const now = text(after, 'OEBPS/Text/copyright.xhtml');
      const para = /\n?<p class="beuk-arc-stamp"[^>]*>.*?<\/p>/.exec(now);
      assert.ok(para, `${label}: one stamp paragraph`);
      assert.equal(now.replace(para[0], ''), was, `${label}: nothing else in the page changed`);
      assert.ok(!/background/i.test(para[0]), 'no background watermark');
    }
  }
});

/* F18 on a package that has both kinds: the studio's own build stores
   every entry, so the books above only show stored → stored. */
test('each binary entry keeps its compression method; text is deflated, mimetype stored (F18)', async () => {
  const chunks: Buffer[] = [];
  const zip = new ZipWriter(new Writable({ write(c: Buffer, _e, done) { chunks.push(c); done(); } }));
  for (const e of readZip(syntheticEpub(''))) await zip.add(e.name, e.data, { compress: false });
  await zip.add('OEBPS/Images/packed.bin', Buffer.alloc(4096, 7), { compress: true });
  await zip.add('OEBPS/Images/plain.bin', Buffer.alloc(4096, 9), { compress: false });
  await zip.finish();
  const input = readZip(Buffer.concat(chunks));
  assert.deepEqual(input.slice(-2).map((e) => e.method), [8, 0], 'the fixture has one deflated and one stored binary');
  const out = readZip(await stampEpub(Buffer.concat(chunks), S));
  const method = (n: string) => out.find((e) => e.name === n)!.method;
  assert.equal(method('OEBPS/Images/packed.bin'), 8);
  assert.equal(method('OEBPS/Images/plain.bin'), 0);
  assert.equal(method('mimetype'), 0);
  assert.equal(method('OEBPS/package.opf'), 8);
  assert.equal(method('OEBPS/Text/copyright.xhtml'), 8);
  for (const n of ['OEBPS/Images/packed.bin', 'OEBPS/Images/plain.bin']) {
    assert.ok(out.find((e) => e.name === n)!.data.equals(input.find((e) => e.name === n)!.data), `${n}: same bytes`);
  }
});

test('a bad public id or a non-EPUB is refused', async () => {
  for (const publicId of ['x', 'pub_ABCDEF"<', 'a'.repeat(65), '']) {
    await assert.rejects(stampEpub(copyrightBook, { ...S, publicId }), StampError, publicId);
  }
  await assert.rejects(stampEpub(Buffer.from('not a zip'), S), StampError);
  /* A zip that is not an EPUB (no mimetype first). */
  await assert.rejects(stampEpub(createZip([{ name: 'a.txt', data: Buffer.from('hello') }]), S), StampError);
});

/* Mine: a copy is stamped once, from the unstamped build; stamping a
   stamped copy would give two lines and two ids, so it is refused. */
test('a stamped copy is not stamped again', async () => {
  const once = await stampEpub(copyrightBook, S);
  await assert.rejects(stampEpub(once, { ...S, publicId: 'pub_ZZZZZZZZ99' }), StampError);
  const added = await stampEpub(bareBook, S);
  await assert.rejects(stampEpub(added, S), StampError);
  /* each guard on its own: an OPF that already names a recipient, with no stamp line anywhere */
  const entries = readZip(syntheticEpub(''));
  const opf = entries.find((e) => e.name === OPF)!;
  opf.data = Buffer.from(opf.data.toString('utf8').replace('</metadata>', '<meta property="beuk:arc-recipient">pub_OTHER12345</meta></metadata>'));
  await assert.rejects(stampEpub(createZip(entries), S), StampError);
});
