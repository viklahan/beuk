import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runCell, withDeadline } from '../scripts/import-shapes/run.js';
import { loadShapes } from '../scripts/import-shapes/shape.js';

/* The import-shapes harness's own failure modes (final review): a cell
   whose studio never boots, or that never settles, is a fail with its
   reason — never a crashed run, never a hang. The browser part runs in
   Chromium (npm run import-shapes:run); these use stand-ins for it. */

const shape = () => loadShapes().find((s) => s.id === 'clean-numbered')!;

test('a studio that fails to open is that cell\'s fail, not a crashed run', async () => {
  const browser = { newContext: async () => { throw new Error('boom: no browser'); } };
  const c = await runCell(browser, 'http://127.0.0.1:1', shape(), 'txt');
  assert.equal(c.status, 'fail');
  assert.match(c.diff ?? '', /boom: no browser/);
});

test('a cell that never settles is a fail after its deadline, and its cleanup runs', async () => {
  let cleaned = false;
  const c = await withDeadline(new Promise(() => {}), 50, () => { cleaned = true; }, { shape: 's', format: 'txt' });
  assert.deepEqual(c, { shape: 's', format: 'txt', status: 'fail', diff: 'cell did not finish within 0.05 s' });
  assert.equal(cleaned, true);
});

test('a cell that settles in time keeps its own result', async () => {
  const c = await withDeadline(Promise.resolve({ shape: 's', format: 'txt' as const, status: 'pass' as const }), 1000, () => {}, { shape: 's', format: 'txt' });
  assert.equal(c.status, 'pass');
});
