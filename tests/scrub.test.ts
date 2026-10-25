import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scrubValue } from '../src/housekeeping/scrub.js';

test('scrubValue keeps Dates as ISO strings instead of turning them into {}', () => {
  const at = new Date('2026-10-25T18:36:52.000Z');
  const out = scrubValue({ selfChecks: { at, note: 'key s3cr3t-value here' } }, ['s3cr3t-value']) as {
    selfChecks: { at: unknown; note: string };
  };
  assert.equal(out.selfChecks.at, '2026-10-25T18:36:52.000Z');
  assert.ok(!out.selfChecks.note.includes('s3cr3t-value'));
  assert.equal(scrubValue(new Date(Number.NaN), ['x']), null);
});
