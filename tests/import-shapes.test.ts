import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import zlib from 'node:zlib';
import path from 'node:path';
import { test } from 'node:test';
import { fillerParagraphs } from '../scripts/import-shapes/filler.js';
import { buildAll } from '../scripts/import-shapes/generate.js';
import { renderDocx } from '../scripts/import-shapes/render-docx.js';
import { renderPdf } from '../scripts/import-shapes/render-pdf.js';
import { renderMd, renderRtf, renderTxt } from '../scripts/import-shapes/render-text.js';
import { FORMATS, loadShapes, MANIFEST, OUT_DIR, SHAPES_DIR } from '../scripts/import-shapes/shape.js';

/* The import-shapes grid (scripts/import-shapes): real-shaped manuscripts
   in five formats, each with the structure it should import as. These
   checks guard the set itself; the import runs in Chromium
   (npm run import-shapes:run), outside npm test. */

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'beuk-shapes-'));

test('loadShapes parses a valid source', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 't.json'), JSON.stringify({
    id: 't', from: 'scratch', formats: ['txt'],
    blocks: [{ t: 'para', text: 'One plain paragraph.' }],
    expected: { sections: [{ kind: 'body' }] },
  }));
  const shapes = loadShapes(dir);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].id, 't');
});

test('loadShapes names the file on a bad source', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'broken.json'), JSON.stringify({ id: 3 }));
  assert.throws(() => loadShapes(dir), /broken\.json/);
});

test('loadShapes refuses a misspelled key', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'x.json'), JSON.stringify({
    id: 'x', from: 'scratch', formats: ['txt'],
    blocks: [{ t: 'para', txet: 'typo' }],
    expected: { sections: [] },
  }));
  assert.throws(() => loadShapes(dir), /x\.json/);
});

test('ids are unique and match file names', () => {
  const shapes = loadShapes();
  const files = (existsSync(SHAPES_DIR) ? readdirSync(SHAPES_DIR) : []).filter((f) => f.endsWith('.json')).sort();
  assert.deepEqual(shapes.map((s) => s.id + '.json'), files);
  assert.equal(new Set(shapes.map((s) => s.id)).size, shapes.length);
});

const IDS = [
  'titles-only', 'caps-kicker', 'dropcap', 'spaced-caps', 'two-line-heads', 'parts-months',
  'scene-markers-stars', 'scene-markers-section', 'scene-markers-dashes', 'scene-markers-bullet',
  'note-and-contents', 'box-volume', 'worksheet',
  'clean-numbered', 'bare-numbers-digit', 'bare-numbers-word', 'bare-numbers-roman', 'bare-numbers-spelled',
  'no-headings', 'mixed-word-styles', 'empty-chapter', 'prologue-only-ends', 'prologue-only-all',
  'matter-in-ch1', 'books-and-volumes', 'md-headings', 'blank-line-breaks',
];
/* The spec's na rule: layout shapes are PDF (and Word where its styles carry them); the format-only shapes are their format. */
const ONLY: Record<string, string[]> = {
  dropcap: ['docx', 'pdf'], 'spaced-caps': ['docx', 'pdf'], 'caps-kicker': ['docx', 'pdf'], 'two-line-heads': ['docx', 'pdf'],
  'mixed-word-styles': ['docx'], 'md-headings': ['md'], 'blank-line-breaks': ['txt'],
};
/* Names from V's own books (marketbooks): the shapes come from them, never a word of them. */
const BANNED = ['zib', 'pip adventure', 'cheese bandit', 'frost line', "devil's ledger", 'crashlanders', 'raven from darkness', 'kleos', 'ninth finger', 'what you see'];

test('there are exactly the 27 shape ids', () => {
  assert.deepEqual(loadShapes().map((s) => s.id), [...IDS].sort());
});

test('formats follow the na rule', () => {
  for (const s of loadShapes()) assert.deepEqual([...s.formats].sort(), [...(ONLY[s.id] ?? FORMATS)].sort(), s.id);
});

test('no marketbooks names in any source', () => {
  for (const f of readdirSync(SHAPES_DIR)) {
    const raw = readFileSync(path.join(SHAPES_DIR, f), 'utf8').toLowerCase();
    for (const b of BANNED) assert.ok(!raw.includes(b), `${f} contains "${b}"`);
  }
});

test('expected titles never contain a mustNotAppear string', () => {
  for (const s of loadShapes()) {
    for (const n of s.expected.mustNotAppear ?? []) {
      for (const e of s.expected.sections) assert.ok(!(e.title ?? '').toLowerCase().includes(n.toLowerCase()), `${s.id}: "${e.title}" holds "${n}"`);
    }
  }
});

test('fillerParagraphs is deterministic and within 1% of the word count', () => {
  const a = fillerParagraphs(7, 9000);
  assert.deepEqual(a, fillerParagraphs(7, 9000));
  assert.notDeepEqual(a, fillerParagraphs(8, 9000));
  const words = a.join(' ').split(/\s+/).length;
  assert.ok(Math.abs(words - 9000) <= 90, `${words} words`);
  for (const p of a.slice(0, -1)) { const n = p.split(/\s+/).length; assert.ok(n >= 60 && n <= 120, `paragraph of ${n} words`); }
});

const shapeById = (id: string) => { const s = loadShapes().find((x) => x.id === id); assert.ok(s, id); return s; };

test('txt of clean-numbered starts with the title line and holds every heading in order', () => {
  const txt = renderTxt(shapeById('clean-numbered')).toString('utf8');
  assert.ok(txt.startsWith('The Lantern Keeper\n'));
  const at = ['Chapter 1: The Harbour', 'Chapter 2: The Storm', 'Chapter 3: The Light'].map((h) => txt.indexOf('\n' + h + '\n'));
  assert.ok(at.every((i, k) => i > 0 && (k === 0 || i > at[k - 1])), String(at));
  assert.ok(txt.includes('\n***\n') && txt.endsWith('\n') && !txt.endsWith('\n\n'));
});

test('md of md-headings has atx and setext headings', () => {
  const md = renderMd(shapeById('md-headings')).toString('utf8');
  assert.ok(md.includes('# Chapter 1: The Harbour\n') && md.includes('## Chapter 2: The Storm\n'));
  assert.ok(md.includes('Chapter 3: The Light\n' + '='.repeat('Chapter 3: The Light'.length) + '\n'));
  assert.ok(md.includes('Chapter 4: The Stair\n' + '-'.repeat('Chapter 4: The Stair'.length) + '\n'));
});

test('md title page is front matter', () => {
  assert.ok(renderMd(shapeById('clean-numbered')).toString('utf8').startsWith('---\ntitle: The Lantern Keeper\nauthor: Ada Marsh\n---\n'));
});

test('rtf escapes § and — as \\u escapes', () => {
  const a = renderRtf(shapeById('scene-markers-section')).toString('latin1');
  const b = renderRtf(shapeById('scene-markers-dashes')).toString('latin1');
  assert.ok(a.startsWith('{\\rtf1') && a.includes('\\u167?') && b.includes('\\u8212?'));
  assert.ok(!/[^\x00-\x7f]/.test(a + b), 'rtf is 7-bit');
});

test('blank-line-breaks txt has 3 blank lines at each break', () => {
  const txt = renderTxt(shapeById('blank-line-breaks')).toString('utf8');
  assert.equal(txt.split('\n\n\n\n').length - 1, 3);
  assert.ok(!txt.includes('\n\n\n\n\n'));
});

test('text renderings are byte-identical twice', () => {
  for (const s of loadShapes()) for (const r of [renderTxt, renderMd, renderRtf]) assert.ok(r(s).equals(r(s)), s.id);
});

/* The stored (method 0) entries of a zip, walked by their local headers. */
function unzipStored(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    assert.equal(buf.readUInt16LE(at + 8), 0, 'stored entry');
    const size = buf.readUInt32LE(at + 18), nameLen = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString('utf8');
    const start = at + 30 + nameLen + extra;
    out.set(name, buf.subarray(start, start + size).toString('utf8'));
    at = start + size;
  }
  return out;
}

test('docx is a zip whose document.xml holds every heading text', () => {
  const z = unzipStored(renderDocx(shapeById('clean-numbered')));
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'docProps/core.xml']) assert.ok(z.has(part), part);
  const doc = z.get('word/document.xml')!;
  for (const h of ['Chapter 1: The Harbour', 'Chapter 2: The Storm', 'Chapter 3: The Light']) assert.ok(doc.includes('<w:t xml:space="preserve">' + h + '</w:t>'), h);
  assert.match(z.get('docProps/core.xml')!, /<dc:title>The Lantern Keeper<\/dc:title>.*<dc:creator>Ada Marsh<\/dc:creator>/s);
});

test('mixed-word-styles uses Heading1, Heading2 and a bold Normal run', () => {
  const doc = unzipStored(renderDocx(shapeById('mixed-word-styles'))).get('word/document.xml')!;
  assert.ok(doc.includes('<w:pStyle w:val="Heading1"/>') && doc.includes('<w:pStyle w:val="Heading2"/>'));
  assert.ok(doc.includes('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Chapter 3: Night</w:t></w:r>'));
});

test('dropcap emits framePr dropCap', () => {
  assert.ok(unzipStored(renderDocx(shapeById('dropcap'))).get('word/document.xml')!.includes('<w:framePr w:dropCap="drop" w:lines="3"'));
});

test('docx escapes & in text', () => {
  assert.ok(unzipStored(renderDocx(shapeById('box-volume'))).get('word/document.xml')!.includes('Moss &amp; Wren'));
});

test('docx is byte-identical twice', () => {
  for (const s of loadShapes()) assert.ok(renderDocx(s).equals(renderDocx(s)), s.id);
});

/* Every content stream of a PDF, inflated when it is Flate-encoded. */
function pdfStreams(buf: Buffer): string[] {
  const out: string[] = [];
  const raw = buf.toString('latin1');
  const re = /<<([^]*?)>>\s*stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length, end = raw.indexOf('endstream', start);
    const body = buf.subarray(start, end);
    try { out.push(/FlateDecode/.test(m[1]) ? zlib.inflateSync(body).toString('latin1') : body.toString('latin1')); } catch { /* not a content stream */ }
  }
  return out;
}

test('pdf of spaced-caps holds the text "T H E"', async () => {
  const streams = pdfStreams(await renderPdf(shapeById('spaced-caps'))).join('\n');
  assert.ok(/<5420482045/i.test(streams), 'hex string for "T H E"');
});

test('pdf carries no clock and no metadata title', async () => {
  const raw = (await renderPdf(shapeById('clean-numbered'))).toString('latin1');
  assert.ok(raw.startsWith('%PDF-'));
  assert.ok(!/\/Title\s*\(/.test(raw) && !/\/Author\s*\(/.test(raw));
  assert.ok(raw.includes('D:20260101000000Z'));
});

test('pdf is byte-identical twice', async () => {
  for (const id of ['clean-numbered', 'dropcap', 'no-headings']) assert.ok((await renderPdf(shapeById(id))).equals(await renderPdf(shapeById(id))), id);
});

test('manifest lists exactly the applicable cells, and every file matches its hash', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { file: string; shape: string; format: string; sha256: string }[];
  const cells = loadShapes().flatMap((s) => s.formats.map((f) => `${s.id}.${f}`)).sort();
  assert.deepEqual(manifest.map((m) => m.file), cells);
  assert.deepEqual(readdirSync(OUT_DIR).sort(), cells);
  for (const m of manifest) assert.equal(createHash('sha256').update(readFileSync(path.join(OUT_DIR, m.file))).digest('hex'), m.sha256, m.file);
});

test('buildAll output matches the committed files', async () => {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  assert.deepEqual((await buildAll()).map(({ file, shape, format, sha256 }) => ({ file, shape, format, sha256 })), manifest);
});
