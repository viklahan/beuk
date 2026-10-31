import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bookFormatSummary, observeBook } from '../src/book/observe.js';
import { readBook } from '../src/book/index.js';
import { STEPS } from '../src/book/upgrade.js';
import type { ReadResult } from '../src/book/index.js';
import type { Db } from '../src/db.js';
import { setAdmin } from '../src/housekeeping/admin.js';
import { Client, createTestDb, registerUser, startTestServer } from './helpers.js';
import { realFixtures } from './book-fixtures.js';

/* BEUK:book-observe (Task 7) — the server reads each saved book with
   readBook AFTER the answer is sent and keeps the latest observation per
   book. It never rejects, delays or alters a save. */

const fixture = () => JSON.parse(JSON.stringify(realFixtures()[0].book)) as Record<string, any>;
type Row = { manuscript_id: string; status: string; upgrades: string[]; warnings: { code: string }[]; unknown_keys: string[]; read_ms: number };
const rows = async (db: Db) => (await db.query<Row>('select * from book_format_observations')).rows;

test('observe: POST and PUT of a fixture book answer exactly as before (status, body keys, ETag) and record one row with status ok', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const c = new Client(server.base);
    await registerUser(c, 'observe1@example.com');
    const book = fixture();
    const created = await c.post('/api/manuscripts', { doc: book });
    assert.equal(created.status, 201);
    assert.deepEqual(Object.keys(created.body), ['manuscript']);
    assert.equal(created.headers.get('etag'), '"1"');
    const m = created.body.manuscript as { id: string; revision: number };
    assert.equal(m.revision, 1);
    await server.settle();
    assert.equal((await rows(db)).length, 1);
    const put = await c.put(`/api/manuscripts/${m.id}`, { doc: book }, { 'if-match': '"1"' });
    assert.equal(put.status, 200);
    assert.deepEqual(Object.keys(put.body), ['manuscript']);
    assert.equal(put.headers.get('etag'), '"2"');
    await server.settle();
    const r = await rows(db);
    assert.equal(r.length, 1, 'upsert: one row per book');
    assert.equal(r[0].status, 'ok');
    assert.ok(r[0].read_ms >= 0);
  } finally {
    await server.close();
  }
});

test('observe: a doc with an unknown key and an over-limit series saves 201/200 and records the warning codes', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const c = new Client(server.base);
    await registerUser(c, 'observe2@example.com');
    const doc = fixture();
    doc.mysteryKey = { a: 1 };
    doc.meta = { ...doc.meta, series: 'S'.repeat(500) };
    const created = await c.post('/api/manuscripts', { doc });
    assert.equal(created.status, 201);
    const id = (created.body.manuscript as { id: string }).id;
    await server.settle();
    let r = await rows(db);
    assert.equal(r.length, 1);
    const codes = r[0].warnings.map((w) => w.code);
    assert.ok(codes.includes('unknown-key'), codes.join());
    assert.ok(codes.includes('over-limit'), codes.join());
    assert.deepEqual(r[0].unknown_keys, ['mysteryKey']);
    const put = await c.put(`/api/manuscripts/${id}`, { doc }, { 'if-match': '"1"' });
    assert.equal(put.status, 200);
    await server.settle();
    r = await rows(db);
    assert.equal(r.length, 1);
  } finally {
    await server.close();
  }
});

test('observe: a failure inside readBook (stub it to throw) still saves; no row; nothing thrown', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  const origErr = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    const c = new Client(server.base);
    await registerUser(c, 'observe3@example.com');
    const created = await c.post('/api/manuscripts', { doc: { title: 'Plain', sections: [] } });
    assert.equal(created.status, 201);
    const id = (created.body.manuscript as { id: string }).id;
    await server.settle();
    await db.query('delete from book_format_observations');
    const boom = (): ReadResult => { throw new Error('boom'); };
    await assert.doesNotReject(observeBook(db, id, {}, new Date(), boom));
    assert.equal((await rows(db)).length, 0);
    assert.ok(logged.length >= 1, 'logged, then swallowed');
    // a database failure (no such manuscript) is swallowed too
    await assert.doesNotReject(observeBook(db, '00000000-0000-4000-8000-000000000000', {}, new Date()));
  } finally {
    console.error = origErr;
    await server.close();
  }
});

test('observe: bookFormatSummary counts by warning code and upgrade name', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const c = new Client(server.base);
    await registerUser(c, 'observe4@example.com');
    const mk = async (doc: unknown) => (await c.post('/api/manuscripts', { doc })).body.manuscript as { id: string };
    const a = await mk({ title: 'A', sections: [] });
    const b = await mk({ title: 'B', sections: [] });
    await server.settle();
    const docA = { title: 'A', sections: [], zzz: 1 };
    const docB = { title: 'B', sections: [], yyy: 1, xxx: 2 };
    await observeBook(db, a.id, docA, new Date());
    await observeBook(db, b.id, docB, new Date());
    const s = await bookFormatSummary(db);
    assert.equal(s.books, 2);
    assert.equal(s.withWarnings, 2);
    assert.equal(s.byCode['unknown-key'], 2, 'counted per book, not per key');
    const record = new Set(STEPS.filter((x) => x.recordOnly).map((x) => x.name));
    const expected = { byUpgrade: {} as Record<string, number>, byDefault: {} as Record<string, number>, byRecord: {} as Record<string, number> };
    for (const doc of [docA, docB])
      for (const u of readBook(doc).upgrades) {
        const bucket = u.startsWith('defaults:') ? expected.byDefault : record.has(u) ? expected.byRecord : expected.byUpgrade;
        bucket[u] = (bucket[u] ?? 0) + 1;
      }
    assert.deepEqual(s.byUpgrade, expected.byUpgrade);
    assert.deepEqual(s.byDefault, expected.byDefault);
    assert.deepEqual(s.byRecord, expected.byRecord);
    assert.ok(Object.keys(s.byUpgrade).length > 0, 'a bare doc is upgraded: upgrade names are counted');
    assert.ok(Object.keys(s.byDefault).length > 0 || Object.keys(s.byRecord).length > 0, 'defaults and record-only steps are reported apart');
    assert.ok(!Object.keys(s.byUpgrade).some((u) => u.startsWith('defaults:') || record.has(u)), 'byUpgrade holds only steps that changed a book');
    assert.ok(s.slowestMs >= 0);
  } finally {
    await server.close();
  }
});

test('observe: the Housekeeping ops summary includes bookFormat', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const admin = new Client(server.base);
    await registerUser(admin, 'observe-admin@example.com');
    await setAdmin(db, 'observe-admin@example.com', true);
    const ops = await admin.get('/api/housekeeping/ops');
    assert.equal(ops.status, 200);
    const bf = (ops.body as { bookFormat: Record<string, unknown> }).bookFormat;
    assert.deepEqual(bf, { books: 0, withWarnings: 0, byCode: {}, byUpgrade: {}, byDefault: {}, byRecord: {}, slowestMs: 0 });
  } finally {
    await server.close();
  }
});

test('observe: no detail, no long strings stored (long key names, long writer string in a wrong-typed field)', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const c = new Client(server.base);
    await registerUser(c, 'observe6@example.com');
    const SECRET = 'PRIVATE-WRITER-TEXT-' + 'x'.repeat(300);
    const doc = fixture();
    doc['k'.repeat(400)] = 1;
    doc.meta = { ...doc.meta, series: 5, language: SECRET, title: { not: SECRET } };
    doc.sections[0].title = { nope: SECRET };
    const created = await c.post('/api/manuscripts', { doc });
    assert.equal(created.status, 201);
    await server.settle();
    const r = await rows(db);
    assert.equal(r.length, 1);
    const stored = JSON.stringify(r[0]);
    assert.ok(!stored.includes('PRIVATE-WRITER-TEXT'), 'no writer text stored');
    for (const w of r[0].warnings) {
      assert.deepEqual(Object.keys(w).sort(), ['code', 'path']);
      assert.ok(w.path.length <= 120);
    }
    assert.ok(r[0].warnings.length > 0);
    assert.equal(r[0].unknown_keys.length, 1);
    assert.equal(r[0].unknown_keys[0].length, 80);
  } finally {
    await server.close();
  }
});

test('observe: 300 unknown keys: caps applied and the truncation recorded', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const c = new Client(server.base);
    await registerUser(c, 'observe7@example.com');
    const doc = fixture();
    for (let i = 0; i < 300; i++) doc[`extra${i}`] = i;
    const created = await c.post('/api/manuscripts', { doc });
    assert.equal(created.status, 201);
    await server.settle();
    const [row] = await rows(db);
    assert.equal(row.warnings.length, 201, '200 kept + one truncated entry');
    assert.deepEqual(row.warnings[200], { code: 'truncated', path: '100 more' });
    assert.equal(row.unknown_keys.length, 51, '50 kept + a count entry');
    assert.equal(row.unknown_keys[50], '250 more');
  } finally {
    await server.close();
  }
});

/* Review Focus 5 — readBook on the largest gallery-sized book. */
function bigBook(): Record<string, unknown> {
  const text = realFixtures()
    .flatMap((f) => ((f.book as { sections?: { content?: string }[] }).sections ?? []).map((s) => s.content ?? ''))
    .join(' ');
  const words = text.split(/\s+/).filter(Boolean);
  assert.ok(words.length > 1000, 'fixture text available');
  const per = Math.ceil(250_000 / 60);
  const body = (n: number): string => {
    const out: string[] = [];
    for (let i = 0; i < per; i++) out.push(words[(n * 7919 + i) % words.length]);
    return `${out.join(' ')} beuk-pic:p${n}`;
  };
  const base = fixture();
  base.sections = Array.from({ length: 60 }, (_, i) => ({
    id: `s${i}`, kind: 'body', type: 'chapter', title: `Chapter ${i + 1}`, subtitle: '', number: String(i + 1),
    content: body(i), included: true, plateId: `beuk-pic:p${i}`,
  }));
  return base;
}

test('observe: readBook on the largest gallery-sized book (~250k words, 60 sections, pictures as refs) takes under the budget', () => {
  const book = bigBook();
  const time = (): number => { const t0 = performance.now(); readBook(book); return performance.now() - t0; };
  time(); // warm-up
  const runs = Array.from({ length: 5 }, time).sort((a, b) => a - b);
  const ms = runs[2];
  if (process.env.BEUK_PERF_PRINT) console.log('readBook runs (ms):', runs.map((r) => r.toFixed(1)).join(', '));
  // MEASURED on the Legion (2026-10-30): per-process medians of 5 runs over 7 processes were
  // 2.5, 2.6, 3.7, 4.2, 4.4, 4.5, 5.4 ms; the median of those is 4.2 ms. CONTROLLER RULING: budget = 10x = 42 ms.
  // 3x (12.6 ms) flaked (single runs up to 18.5 ms); 10x still catches algorithmic regressions.
  assert.ok(ms < BUDGET_MS, `readBook median ${ms.toFixed(1)} ms; budget ${BUDGET_MS} ms`);
});
const BUDGET_MS = 42;
