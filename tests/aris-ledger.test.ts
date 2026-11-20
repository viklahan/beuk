import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verdict, verifyCounts, type CountClaim, type EditorialFinding } from '../src/aris/ledger.js';

const c = (chapter: string, subject: string, op: CountClaim['op'], amount: number): CountClaim => ({
  chapter,
  subject,
  op,
  amount,
  quote: `${op} ${amount} of ${subject}`,
});
const f = (severity: EditorialFinding['severity'], category: EditorialFinding['category']): EditorialFinding => ({
  severity,
  category,
  location: 'ch 1',
  quote: 'q',
  why: 'w',
  fix: 'x',
});

test('a clean ledger yields no findings', () => {
  assert.deepEqual(verifyCounts([c('1', 'ships', 'set', 12), c('3', 'ships', 'loss', 4), c('5', 'ships', 'set', 8)]), []);
});

test('a later set that disagrees with the running total is a major with the arithmetic shown', () => {
  const out = verifyCounts([c('1', 'ships', 'set', 100), c('2', 'ships', 'loss', 30), c('4', 'ships', 'set', 80)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'major');
  assert.equal(out[0].category, 'ledger');
  assert.match(out[0].why, /100/);
  assert.match(out[0].why, /30/);
  assert.match(out[0].why, /70/);
  assert.match(out[0].why, /80/);
});

test('a matching re-set restarts the subject total', () => {
  const out = verifyCounts([
    c('1', 'ships', 'set', 100),
    c('2', 'ships', 'loss', 30),
    c('3', 'ships', 'set', 70),
    c('4', 'ships', 'loss', 20),
    c('6', 'ships', 'set', 50),
  ]);
  assert.deepEqual(out, []);
});

test('a loss before any set is a minor, and subjects are independent', () => {
  const out = verifyCounts([c('1', 'arrows', 'loss', 10), c('1', 'ships', 'set', 5)]);
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'minor');
  assert.match(out[0].why, /arrows/);
});

test('gain claims raise the running total', () => {
  assert.deepEqual(verifyCounts([c('1', 'crew', 'set', 20), c('2', 'crew', 'gain', 5), c('3', 'crew', 'set', 25)]), []);
});

test('verdict: any critical fails the gate', () => {
  const v = verdict([f('critical', 'continuity'), f('minor', 'prose')]);
  assert.equal(v.gate, 'FAIL — DO NOT SHIP');
  assert.deepEqual(v.tallies, { critical: 1, major: 0, minor: 1 });
});

test('verdict: four majors in one category fail; three do not', () => {
  const three = verdict([f('major', 'prose'), f('major', 'prose'), f('major', 'prose'), f('minor', 'ledger')]);
  assert.equal(three.gate, 'PASS');
  const four = verdict([f('major', 'prose'), f('major', 'prose'), f('major', 'prose'), f('major', 'prose')]);
  assert.equal(four.gate, 'FAIL — DO NOT SHIP');
});

test('verdict: majors spread across categories pass at four total', () => {
  const v = verdict([f('major', 'prose'), f('major', 'ledger'), f('major', 'continuity'), f('major', 'prose')]);
  assert.equal(v.gate, 'PASS');
});
