import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadShapes, SHAPES_DIR } from '../scripts/import-shapes/shape.js';

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
