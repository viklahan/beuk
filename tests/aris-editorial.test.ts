import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEditorialPrompt,
  DIGEST_MAX_CHARS,
  EDITORIAL_WINDOW_CHARS,
  parseEditorialReply,
} from '../src/aris/editorial.js';
import { loadPersona } from '../src/aris/persona.js';

const input = {
  sectionText: 'Mara Vane came back across the water with the case held against her ribs like a shield.',
  sectionLabel: 'Prologue',
  digest: 'Characters: Mara Vane (returned).',
  bookTitle: 'The Lantern Coast',
  covenants: [{ kind: 'place', name: 'Gullwick', note: 'a harbour town' }],
};

const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    digest: 'Characters: Mara Vane (returned, carries the chart case).',
    findings: [
      {
        severity: 'major',
        category: 'continuity',
        location: 'Prologue, second paragraph',
        quote: 'came back across the water',
        why: 'she already arrived in the prior batch',
        fix: 'cut the second arrival',
      },
    ],
    claims: { counts: [{ chapter: 'Prologue', subject: 'ships', op: 'set', amount: 4, quote: 'held against her ribs' }], travel: [], calendar: [] },
    ...over,
  });

test('the prompt carries both persona parts, the digest, the label and the output contract', () => {
  const messages = buildEditorialPrompt(input);
  const system = messages.find((m) => m.role === 'system')!.content;
  const persona = loadPersona();
  assert.ok(system.includes(persona.core.slice(0, 40)));
  assert.ok(system.includes(persona.editorial.slice(0, 40)));
  const user = messages.find((m) => m.role === 'user')!.content;
  assert.ok(user.includes(input.digest));
  assert.ok(user.includes('Prologue'));
  assert.ok(user.includes('Gullwick'));
  assert.match(user, /ONE JSON object/i);
  assert.match(user, /"findings"/);
});

test('an oversized section is cut at the window with a marker', () => {
  const big = { ...input, sectionText: 'x'.repeat(EDITORIAL_WINDOW_CHARS + 500) };
  const user = buildEditorialPrompt(big).find((m) => m.role === 'user')!.content;
  assert.ok(user.includes('[truncated for this read]'));
  assert.ok(!user.includes('x'.repeat(EDITORIAL_WINDOW_CHARS + 1)));
});

test('a valid reply parses: findings kept, claims kept, digest carried', () => {
  const out = parseEditorialReply(reply(), input.sectionText, false);
  assert.ok(!('error' in out));
  if ('error' in out) return;
  assert.equal(out.findings.length, 1);
  assert.equal(out.claims.counts.length, 1);
  assert.equal(out.rejected, 0);
  assert.equal(out.truncated, false);
  assert.match(out.digest, /chart case/);
});

test('a finding whose quote is absent from the text is dropped and tallied', () => {
  const bad = reply({
    findings: [
      { severity: 'major', category: 'prose', location: 'x', quote: 'this sentence is nowhere', why: 'w', fix: 'f' },
    ],
  });
  const out = parseEditorialReply(bad, input.sectionText, false);
  if ('error' in out) assert.fail('should parse');
  assert.equal(out.findings.length, 0);
  assert.equal(out.rejected, 1);
});

test('curly quotes and collapsed whitespace still match; verbatim means verbatim after normalization', () => {
  const text = 'He said “come  back\n across the water” and left.';
  const ok = reply({
    findings: [{ severity: 'minor', category: 'prose', location: 'x', quote: '"come back across the water"', why: 'w', fix: 'f' }],
    claims: { counts: [], travel: [], calendar: [] },
  });
  const out = parseEditorialReply(ok, text, false);
  if ('error' in out) assert.fail('should parse');
  assert.equal(out.findings.length, 1);
  assert.equal(out.rejected, 0);
});

test('an unknown severity or category rejects that finding, keeps the rest', () => {
  const mixed = reply({
    findings: [
      { severity: 'catastrophic', category: 'prose', location: 'x', quote: 'came back', why: 'w', fix: 'f' },
      { severity: 'minor', category: 'continuity', location: 'x', quote: 'came back', why: 'w', fix: 'f' },
    ],
  });
  const out = parseEditorialReply(mixed, input.sectionText, false);
  if ('error' in out) assert.fail('should parse');
  assert.equal(out.findings.length, 1);
  assert.equal(out.rejected, 1);
});

test('a claim with an absent quote is dropped and tallied; a count with a bad amount too', () => {
  const bad = reply({
    claims: {
      counts: [
        { chapter: '1', subject: 'ships', op: 'set', amount: 'four', quote: 'held against her ribs' },
        { chapter: '1', subject: 'ships', op: 'loss', amount: 2, quote: 'not in the text at all' },
      ],
      travel: [{ chapter: '1', from: 'A', to: 'B', quote: 'came back across the water' }],
      calendar: [],
    },
  });
  const out = parseEditorialReply(bad, input.sectionText, false);
  if ('error' in out) assert.fail('should parse');
  assert.equal(out.claims.counts.length, 0);
  assert.equal(out.claims.travel.length, 1);
  assert.equal(out.rejected, 2);
});

test('a prose reply is an error, never an empty pass', () => {
  const out = parseEditorialReply('I read it and it seems fine to me.', input.sectionText, false);
  assert.ok('error' in out);
});

test('the digest is clamped and truncation is reported', () => {
  const long = reply({ digest: 'd'.repeat(DIGEST_MAX_CHARS + 99) });
  const out = parseEditorialReply(long, input.sectionText, true);
  if ('error' in out) assert.fail('should parse');
  assert.equal(out.digest.length, DIGEST_MAX_CHARS);
  assert.equal(out.truncated, true);
});
