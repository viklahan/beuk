import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fillerParagraphs } from '../scripts/import-shapes/filler.js';
import { FORMATS, loadShapes, SHAPES_DIR } from '../scripts/import-shapes/shape.js';

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
