import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SlidingWindowLimiter } from '../src/rate-limit.js';

const tracked = (l: SlidingWindowLimiter) => (l as unknown as { hits: Map<string, number[]> }).hits.size;

test('reserve() prunes expired keys like hit() does, so many distinct keys cannot grow the map forever', () => {
  let now = 0;
  const limiter = new SlidingWindowLimiter(10, 1000, () => now);
  for (let i = 0; i < 6000; i++) limiter.reserve(`nobody${i}@example.com`);
  now = 5000; // every earlier hit has aged out of the window
  limiter.reserve('one-more@example.com');
  assert.ok(tracked(limiter) <= 1, `expected expired keys pruned, still tracking ${tracked(limiter)}`);
});

test('reserve() still refuses at the limit and release() gives one back', () => {
  let now = 0;
  const limiter = new SlidingWindowLimiter(2, 1000, () => now);
  const a = limiter.reserve('k');
  assert.notEqual(limiter.reserve('k'), null);
  assert.equal(limiter.reserve('k'), null);
  limiter.release('k', a!);
  assert.notEqual(limiter.reserve('k'), null);
});
