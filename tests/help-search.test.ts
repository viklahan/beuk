import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runMigrations } from '../src/db.js';
import { extractCodes, rebuildHelpIndex, searchHelp, type SearchResult } from '../src/help/search.js';
import { getHelpContent } from '../src/help/content.js';
import { Client, createTestDb, startTestServer, wrapPglite } from './helpers.js';

/* H2 — Help search: code exact match first, full-text next, trigram
   last; pasted multi-line messages; the anonymous search log; the rate
   limit; and the no-JS results page. */

const root = path.resolve(import.meta.dirname, '..');
/** A real EPUBCheck 5.2.1 console run (fixture README says how it was made). */
const PASTED = readFileSync(path.join(root, 'tests', 'fixtures', 'epubcheck', 'three-problems-cli.txt'), 'utf8');

async function trgmDb() {
  const db = wrapPglite(new PGlite({ extensions: { pg_trgm } }));
  await runMigrations(db, path.resolve(root, 'migrations'));
  return db;
}

test('search: an exact code wins — EPUBCheck ids, BEUK- codes (any case) and mapped HTTP statuses', async () => {
  const db = await createTestDb();
  const r = await searchHelp(db, 'RSC-005');
  assert.equal(r.errors[0].code, 'BEUK-X201');
  assert.equal(r.errors[0].match, 'code');
  assert.equal(r.errors[0].matchedCode, 'RSC-005');
  const b = await searchHelp(db, 'what is beuk-u403?');
  assert.equal(b.errors[0].code, 'BEUK-U403');
  const h = await searchHelp(db, '429');
  assert.equal(h.errors[0].code, 'BEUK-J702');
  const g = await searchHelp(db, 'HTTP 410 on my link');
  assert.equal(g.errors[0].code, 'BEUK-H410');
  assert.deepEqual(extractCodes('line 200 of 3 at 120000 ms'), [], 'numbers that are not mapped statuses are not codes');
});

test('search: a pasted multi-line EPUBCheck message hits every entry it names, in order; unknown codes are listed, never guessed', async () => {
  const db = await createTestDb();
  const r = await searchHelp(db, PASTED);
  assert.deepEqual(r.codes, ['OPF-085', 'NCX-001', 'RSC-005', 'RSC-016']);
  const byCode = r.errors.filter((e) => e.match === 'code').map((e) => e.code);
  assert.deepEqual(byCode, ['BEUK-U403', 'BEUK-X201'], 'OPF-085 → U403, RSC-005/RSC-016 → X201; NCX-001 maps to nothing');
});

test('search: words find guides and sections by full text, with highlighted snippets', async () => {
  const db = await createTestDb();
  const r = await searchHelp(db, 'my streak restarted');
  assert.ok(r.guides.some((g) => g.ref === 'your-streak') || r.sections.some((s) => s.ref.startsWith('your-streak#')), 'the streak guide is found');
  assert.ok([...r.guides, ...r.sections].every((x) => x.match === 'text'));
  assert.ok([...r.guides, ...r.sections].some((x) => /«[^»]+»/.test(x.snippet)), 'ts_headline marks the matched words');
  const closed = await searchHelp(db, 'reading copy is closed');
  assert.equal(closed.errors[0]?.code, 'BEUK-H410');
});

test('search: typos fall back to trigram similarity — pg_trgm when the extension exists, the in-app twin when not', async () => {
  const plain = await createTestDb();
  const ext = await plain.query<{ n: number }>(`select count(*)::int as n from pg_extension where extname = 'pg_trgm'`);
  assert.equal(ext.rows[0].n, 0, 'plain PGlite has no pg_trgm: the migration carried on without it');
  const a = await searchHelp(plain, 'strek');
  assert.equal(a.trigram, 'fallback');
  assert.ok(a.guides.some((g) => g.ref === 'your-streak' && g.match === 'similar'), JSON.stringify(a.guides));

  const withTrgm = await trgmDb();
  const ext2 = await withTrgm.query<{ n: number }>(`select count(*)::int as n from pg_extension where extname = 'pg_trgm'`);
  assert.equal(ext2.rows[0].n, 1, 'with the extension loaded the migration created it');
  const idx = await withTrgm.query<{ indexname: string }>(`select indexname from pg_indexes where tablename = 'help_docs' order by indexname`);
  assert.deepEqual(idx.rows.map((x) => x.indexname), ['help_docs_codes_trgm_idx', 'help_docs_pkey', 'help_docs_title_trgm_idx', 'help_docs_tsv_idx']);
  const b = await searchHelp(withTrgm, 'strek');
  assert.equal(b.trigram, 'pg_trgm');
  assert.ok(b.guides.some((g) => g.ref === 'your-streak' && g.match === 'similar'), JSON.stringify(b.guides));
  const c = await searchHelp(withTrgm, 'valdator');
  assert.ok(c.guides.some((g) => g.ref === 'check-your-book'), JSON.stringify(c.guides));
});

test('search log: every query is logged without user id or IP, zero-result queries included', async () => {
  const db = await createTestDb();
  const cols = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'search_log' order by ordinal_position`,
  );
  assert.deepEqual(cols.rows.map((c) => c.column_name), ['id', 'q_hash', 'q_text', 'results_count', 'clicked_ref', 'created_at']);
  const none = await searchHelp(db, 'zzqxv flarn');
  assert.equal(none.total, 0);
  const hit = await searchHelp(db, 'RSC-005');
  const long = await searchHelp(db, 'x'.repeat(500) + ' cover');
  const rows = await db.query<{ q_text: string; results_count: number; q_hash: string }>(`select q_text, results_count, q_hash from search_log order by id`);
  assert.equal(rows.rows.length, 3);
  assert.deepEqual(rows.rows[0], { q_text: 'zzqxv flarn', results_count: 0, q_hash: rows.rows[0].q_hash });
  assert.match(rows.rows[0].q_hash, /^[0-9a-f]{64}$/);
  assert.equal(rows.rows[1].results_count, hit.total);
  assert.equal(rows.rows[2].q_text.length, 200, 'q_text is truncated to 200 characters');
  assert.ok(long.total >= 0);
  const zero = await db.query<{ n: number }>(`select count(*)::int as n from search_log where results_count = 0`);
  assert.equal(zero.rows[0].n, 1);
});

test('index: rebuilds idempotently from the content and drops rows whose content is gone', async () => {
  const db = await createTestDb();
  const first = await rebuildHelpIndex(db, getHelpContent());
  const count = async () => (await db.query<{ n: number }>('select count(*)::int as n from help_docs')).rows[0].n;
  const n = await count();
  assert.equal(n, first.upserted);
  const c = getHelpContent();
  assert.ok(n >= c.guides.length + c.errors.length);
  await db.query(`insert into help_docs (id, kind, ref, title, body, url) values ('guide:gone', 'guide', 'gone', 'Gone', 'x', '/help/gone')`);
  const second = await rebuildHelpIndex(db, c);
  assert.equal(second.removed, 1);
  assert.equal(await count(), n);
  const third = await rebuildHelpIndex(db, c);
  assert.equal(third.removed, 0);
  assert.equal(await count(), n);
});

test('API: GET /api/help/search is public and rate-limited per IP (429 + Retry-After); clicks are recorded', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db, undefined, {}, undefined, { helpSearchLimits: { burst: 2, refillMs: 60_000 } });
  try {
    const anon = new Client(server.base);
    assert.equal((await anon.get('/api/help/search?q=')).status, 400);
    const ok = await anon.get('/api/help/search?q=RSC-005');
    assert.equal(ok.status, 200);
    const body = ok.body as unknown as SearchResult;
    assert.equal(body.errors[0].code, 'BEUK-X201');
    assert.ok(body.logId);
    const click = await fetch(`${server.base}/api/help/search/click`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ logId: body.logId, ref: 'BEUK-X201' }),
    });
    assert.equal(click.status, 204);
    const logged = await db.query<{ clicked_ref: string }>('select clicked_ref from search_log where id = $1::bigint', [body.logId]);
    assert.equal(logged.rows[0].clicked_ref, 'BEUK-X201');
    assert.equal((await anon.get('/api/help/search?q=cover')).status, 200);
    const limited = await anon.get('/api/help/search?q=cover');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    // The no-JS page shares the bucket and says so in words.
    const page = await fetch(`${server.base}/help/search?q=cover`);
    assert.equal(page.status, 429);
    assert.match(await page.text(), /please wait \d+ seconds?/);
    // Another client address has its own bucket.
    const other = await anon.request('GET', '/api/help/search?q=cover', undefined, { 'x-forwarded-for': '203.0.113.9' });
    assert.equal(other.status, 200);
  } finally {
    await server.close();
  }
});

test('no-JS search page: /help/search?q= renders the results server-side, zero results say so', async () => {
  const db = await createTestDb();
  const server = await startTestServer(db);
  try {
    const res = await fetch(`${server.base}/help/search?q=${encodeURIComponent(PASTED)}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /href="\/help\/errors\/BEUK-U403"/);
    assert.match(html, /href="\/help\/errors\/BEUK-X201"/);
    assert.match(html, /<code>NCX-001<\/code>/);
    // The form posts (a long pasted report can outgrow a URL); the API takes { q } too.
    const big = `${PASTED}\n${'x '.repeat(6000)}`;
    const posted = await fetch(`${server.base}/help/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ q: big }).toString(),
    });
    assert.equal(posted.status, 200);
    assert.match(await posted.text(), /href="\/help\/errors\/BEUK-U403"/);
    const api = await fetch(`${server.base}/api/help/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: big }),
    });
    assert.equal(api.status, 200);
    assert.deepEqual(((await api.json()) as SearchResult).codes, ['OPF-085', 'NCX-001', 'RSC-005', 'RSC-016']);
    const none = await (await fetch(`${server.base}/help/search?q=zzqxv+flarn`)).text();
    assert.match(none, /Nothing in the guides or the error dictionary matches that yet/);
    assert.match(none, /data-total="0"/);
  } finally {
    await server.close();
  }
});
