import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fixturePath, realFixtures } from './book-fixtures.js';

/* BEUK:book-corpus — the committed test corpus for the book format.
   The books under tests/fixtures/books/real are slimmed copies of real
   gallery books (tools/book-corpus/slim.mjs): keys, order and text are
   untouched; only binary payloads are swapped for the smallest valid
   file, and each swap is recorded in _fixture.slimmed. These tests
   keep the corpus honest: big enough, small enough, and varied enough
   for the format tests that read it. */

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function envelopes(): { name: string; env: Rec }[] {
  const dir = fixturePath('real');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => ({ name, env: JSON.parse(readFileSync(path.join(dir, name), 'utf8')) as Rec }));
}

/* Visit every string with its path. */
function walk(v: unknown, p: string, visit: (s: string, p: string) => void): void {
  if (typeof v === 'string') visit(v, p);
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, visit));
  else if (isRec(v)) for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k, visit);
}

const RTL = new Set(['ar', 'fa', 'he', 'ur']);

test('corpus: at least 8 real fixtures, each with _fixture.source and a book with a sections array', () => {
  const all = envelopes();
  assert.ok(all.length >= 8, `only ${all.length} fixtures`);
  for (const { name, env } of all) {
    const f = env._fixture;
    assert.ok(isRec(f), `${name}: no _fixture`);
    assert.equal(typeof f.source, 'string', `${name}: _fixture.source`);
    assert.ok((f.source as string).length > 0, `${name}: empty source`);
    assert.ok(Array.isArray(f.slimmed), `${name}: _fixture.slimmed`);
    assert.equal(typeof f.why, 'string', `${name}: _fixture.why`);
    assert.ok(isRec(env.book), `${name}: no book`);
    assert.ok(Array.isArray(env.book.sections), `${name}: book.sections`);
  }
  assert.equal(realFixtures().length, all.length);
});

test('corpus: no fixture carries a base64 payload longer than 2048 characters', () => {
  for (const { name, env } of envelopes()) {
    walk(env, '', (s, p) => {
      if (s.length > 2048 && /^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
        assert.fail(`${name}: ${p} is ${s.length} chars of base64`);
      }
    });
  }
});

test('corpus: coverage, with bible, colour, no printBleed, series and RTL', (t) => {
  const books = envelopes().map(({ name, env }) => ({ name, book: env.book as Rec }));
  const has = (pred: (b: Rec) => boolean) => books.filter((x) => pred(x.book)).map((x) => x.name);
  assert.ok(has((b) => 'bible' in b).length >= 1, 'no fixture with bible');
  assert.ok(has((b) => 'colour' in b).length >= 1, 'no fixture with colour');
  assert.ok(has((b) => !('printBleed' in b)).length >= 1, 'no fixture without printBleed');
  assert.ok(has((b) => isRec(b.meta) && !!b.meta.series).length >= 1, 'no series fixture');
  const rtl = has((b) => isRec(b.meta) && RTL.has(String(b.meta.language)));
  if (rtl.length === 0) t.diagnostic('coverage gap: no RTL-language book (ar/fa/he/ur) in the gallery');
});

test('corpus: total fixture size under 5 MB', () => {
  const dir = fixturePath('real');
  const total = readdirSync(dir).reduce((n, f) => n + statSync(path.join(dir, f)).size, 0);
  assert.ok(total < 5 * 1024 * 1024, `corpus is ${(total / 1048576).toFixed(2)} MB`);
});

test('corpus: every _fixture.source is path-neutral (no drive, absolute root or user directory)', () => {
  for (const { name, env } of envelopes()) {
    const src = (env._fixture as Rec).source as string;
    assert.ok(!/^[A-Za-z]:|^\/|\\Users\\|\/Users\/|\/home\//i.test(src), `${name}: source ${src}`);
    assert.ok(!src.includes('\\'), `${name}: source uses backslashes: ${src}`);
  }
});

/* Resolve "images[3].data" (optionally "... (stub)") inside a book. */
function resolvePath(book: unknown, recorded: string): { found: boolean; value: unknown } {
  const p = recorded.replace(/ \(stub\)$/, '');
  let cur: unknown = book;
  for (const m of p.matchAll(/([^.[\]]+)|\[(\d+)\]/g)) {
    if (m[2] !== undefined) {
      if (!Array.isArray(cur) || Number(m[2]) >= cur.length) return { found: false, value: undefined };
      cur = cur[Number(m[2])];
    } else {
      if (!isRec(cur) || !(m[1] in cur)) return { found: false, value: undefined };
      cur = cur[m[1]];
    }
  }
  return { found: true, value: cur };
}

test('corpus: _fixture.slimmed paths resolve to short payloads, and no long payload is left unrecorded', () => {
  for (const { name, env } of envelopes()) {
    const slimmed = (env._fixture as Rec).slimmed as string[];
    const recorded = new Set<string>();
    for (const entry of slimmed) {
      const r = resolvePath(env.book, entry);
      assert.ok(r.found, `${name}: ${entry} does not resolve inside the book`);
      assert.equal(typeof r.value, 'string', `${name}: ${entry} is not a string`);
      assert.ok((r.value as string).length <= 2048, `${name}: ${entry} still holds ${(r.value as string).length} chars`);
      recorded.add(entry.replace(/ \(stub\)$/, ''));
    }
    const visit = (v: unknown, p: string): void => {
      if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}[${i}]`));
      else if (isRec(v)) {
        if (typeof v.mediaType === 'string' && typeof v.data === 'string') {
          const here = p ? `${p}.data` : 'data';
          assert.ok(v.data.length <= 2048 || recorded.has(here), `${name}: ${here} is long and unrecorded`);
        }
        for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k);
      }
    };
    visit(env.book, '');
  }
});
