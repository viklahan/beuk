import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';
import { readZip } from '../src/housekeeping/packages.js';
import { pausedBody } from '../src/access.js';
import { BACKUP_TABLES, classifyTables } from '../src/housekeeping/backup.js';
import { SELF_CHECK_CASES, type CheckContext } from '../src/housekeeping/registry.js';

/*
 * The authorship record (plan 2026-11-09, Task 1): a fingerprint-only
 * stamp per backup / Word export, kept by Beuk, readable only by its
 * owner. No book text ever reaches this table.
 */

let server: TestServer;
let paid: TestServer; // billing on: the day-22 pause is real here
let db: Db;
let alice: Client;
let bob: Client;
let clock = new Date();
const DAY = 86_400_000;
const PASSWORD = 'correct horse battery';

const hex = (seed: string) => {
  let out = '';
  for (let i = 0; out.length < 64; i++) out += ((seed.charCodeAt(i % seed.length) + i) % 16).toString(16);
  return out;
};

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, () => clock);
  paid = await startTestServer(db, () => clock, {
    stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
    stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
    stripePriceId: 'price_fixture_one',
    // Never called: the pause is decided from the database alone.
    stripeApiBase: 'http://127.0.0.1:9',
  });
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice-authorship@example.com');
  await registerUser(bob, 'bob-authorship@example.com');
});

after(async () => {
  await server.close();
  await paid.close();
});

async function stamp(c: Client, body: Record<string, unknown>) {
  return c.post('/api/authorship/stamps', body);
}

/** The raw answer (status + exact body text), for byte-equal comparisons. */
async function raw(c: Client, base: string, p: string): Promise<{ status: number; text: string }> {
  const cookie = (c as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();
  const res = await fetch(base + p, { headers: cookie });
  return { status: res.status, text: await res.text() };
}

async function newWriter(base: string, email: string): Promise<{ c: Client; id: string }> {
  const c = new Client(base);
  assert.equal((await registerUser(c, email, PASSWORD)).status, 201);
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0].id;
  return { c, id };
}

test('stamp: 201 with id and createdAt; row holds no text but bookId, title, sha256, kind', async () => {
  const sha = hex('first');
  const r = await stamp(alice, { bookId: 'book-one', title: '  The Lantern Coast  ', sha256: sha, kind: 'backup', text: 'It began with the tide.' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body).sort(), ['createdAt', 'id']);
  assert.match(String(r.body.id), /^[0-9a-f-]{36}$/);
  assert.equal(r.body.createdAt, clock.toISOString(), 'created_at comes from the injected clock');

  const cols = await db.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = 'authorship_stamps' order by column_name`,
  );
  assert.deepEqual(cols.rows.map((c) => c.column_name), ['book_id', 'created_at', 'id', 'kind', 'sha256', 'title', 'user_id']);
  const row = (await db.query<Record<string, unknown>>('select * from authorship_stamps where id = $1', [r.body.id])).rows[0];
  assert.equal(row.book_id, 'book-one');
  assert.equal(row.title, 'The Lantern Coast');
  assert.equal(row.sha256, sha);
  assert.equal(row.kind, 'backup');
  assert.equal(JSON.stringify(row).includes('It began with the tide'), false, 'no book text is stored');

  const docx = await stamp(alice, { bookId: 'book-one', sha256: sha, kind: 'docx' });
  assert.equal(docx.status, 201, 'title may be left out');
  assert.equal((await db.query<{ title: string }>('select title from authorship_stamps where id = $1', [docx.body.id])).rows[0].title, '');
});

test("stamp: 400 for bad sha256 (63 hex, uppercase, non-hex), bad kind ('pdf'), empty or 201-char bookId, control char in bookId", async () => {
  const good = { bookId: 'book-bad', title: 'T', sha256: hex('bad'), kind: 'backup' };
  const before = (await db.query<{ n: number }>('select count(*)::int as n from authorship_stamps')).rows[0].n;
  const cases: Array<[string, Record<string, unknown>]> = [
    ['63 hex', { ...good, sha256: good.sha256.slice(1) }],
    ['65 hex', { ...good, sha256: good.sha256 + 'a' }],
    ['uppercase', { ...good, sha256: good.sha256.toUpperCase().replace(/^./, 'A') }],
    ['non-hex', { ...good, sha256: 'g' + good.sha256.slice(1) }],
    ['missing sha256', { ...good, sha256: undefined }],
    ["kind 'pdf'", { ...good, kind: 'pdf' }],
    ['missing kind', { ...good, kind: undefined }],
    ['empty bookId', { ...good, bookId: '' }],
    ['201-char bookId', { ...good, bookId: 'x'.repeat(201) }],
    ['control char in bookId', { ...good, bookId: 'book\u0007id' }],
    ['newline in bookId', { ...good, bookId: 'book\nid' }],
    ['number bookId', { ...good, bookId: 42 }],
    ['number title', { ...good, title: 42 }],
  ];
  for (const [why, body] of cases) {
    const r = await stamp(alice, body);
    assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.body)}`);
    assert.equal(typeof r.body.error, 'string', why);
  }
  const after = (await db.query<{ n: number }>('select count(*)::int as n from authorship_stamps')).rows[0].n;
  assert.equal(after, before, 'nothing stored by a refusal');
  assert.equal((await stamp(alice, { ...good, bookId: 'x'.repeat(200) })).status, 201, '200 characters is fine');
});

test('stamp: title over 300 is cut to 300', async () => {
  const r = await stamp(alice, { bookId: 'book-long', title: 'é'.repeat(301) + 'tail', sha256: hex('long'), kind: 'backup' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const t = (await db.query<{ title: string }>('select title from authorship_stamps where id = $1', [r.body.id])).rows[0].title;
  assert.equal([...t].length, 300);
  assert.equal(t, 'é'.repeat(300));
});

test('stamp: 401 signed out', async () => {
  const anon = new Client(server.base);
  const r = await stamp(anon, { bookId: 'book-anon', title: 'T', sha256: hex('anon'), kind: 'backup' });
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'not signed in' });
  assert.equal((await anon.get('/api/authorship/stamps?bookId=book-anon')).status, 401);
  assert.equal((await anon.get(`/api/authorship/check?sha256=${hex('anon')}`)).status, 401);
  assert.equal((await db.query('select 1 from authorship_stamps where book_id = $1', ['book-anon'])).rows.length, 0);
});

test('stamp: 61st inside an hour is 429; after the hour passes (clock + 3601 s) it is 201 again', async () => {
  const saved = clock;
  try {
    const w = await newWriter(server.base, 'rate-authorship@example.com');
    const body = { bookId: 'book-rate', title: 'Rate', sha256: hex('rate'), kind: 'backup' };
    for (let i = 0; i < 60; i++) {
      clock = new Date(saved.getTime() + i * 1000); // all inside one hour
      const r = await stamp(w.c, body);
      assert.equal(r.status, 201, `stamp ${i + 1}: ${JSON.stringify(r.body)}`);
    }
    clock = new Date(saved.getTime() + 60 * 1000);
    const refused = await stamp(w.c, body);
    assert.equal(refused.status, 429);
    assert.equal(typeof refused.body.error, 'string');
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from authorship_stamps where user_id = $1', [w.id])).rows[0].n, 60);
    // Another account is not touched by this one's budget.
    assert.equal((await stamp(bob, { ...body, bookId: 'book-rate-bob' })).status, 201);
    // The window rolls: an hour after the first stamp, room again.
    clock = new Date(saved.getTime() + 3601 * 1000);
    assert.equal((await stamp(w.c, body)).status, 201);
  } finally {
    clock = saved;
  }
});

test("stamps: own rows for that bookId, newest first, at most 200; bob sees none of alice's rows for the same bookId", async () => {
  const saved = clock;
  try {
    const w = await newWriter(server.base, 'list-authorship@example.com');
    const uid = w.id;
    // 205 rows straight into the table (the route's hourly budget is tested above).
    for (let i = 0; i < 205; i++) {
      await db.query(
        `insert into authorship_stamps (user_id, book_id, title, sha256, kind, created_at) values ($1, 'shared-id', $2, $3, $4, $5)`,
        [uid, `T${i}`, hex(`l${i}`), i % 2 ? 'docx' : 'backup', new Date(saved.getTime() - (205 - i) * 60_000)],
      );
    }
    await db.query(
      `insert into authorship_stamps (user_id, book_id, title, sha256, kind, created_at) values ($1, 'other-book', 'Other', $2, 'backup', $3)`,
      [uid, hex('other'), saved],
    );
    const r = await w.c.get('/api/authorship/stamps?bookId=shared-id');
    assert.equal(r.status, 200);
    const stamps = r.body.stamps as Array<Record<string, unknown>>;
    assert.equal(stamps.length, 200);
    assert.deepEqual(Object.keys(stamps[0]).sort(), ['createdAt', 'id', 'kind', 'sha256', 'title']);
    assert.equal(stamps[0].title, 'T204', 'newest first');
    assert.equal(stamps[199].title, 'T5');
    for (let i = 1; i < stamps.length; i++) assert.ok(String(stamps[i - 1].createdAt) >= String(stamps[i].createdAt));
    assert.ok(!stamps.some((s) => s.title === 'Other'), 'only that bookId');

    // Bob uses the very same bookId: he sees only his own.
    const none = await raw(bob, server.base, '/api/authorship/stamps?bookId=shared-id');
    assert.equal(none.status, 200);
    assert.equal(none.text, JSON.stringify({ stamps: [] }));
    assert.equal((await stamp(bob, { bookId: 'shared-id', title: 'Bob', sha256: hex('bob'), kind: 'backup' })).status, 201);
    const mine = await bob.get('/api/authorship/stamps?bookId=shared-id');
    assert.deepEqual((mine.body.stamps as Array<{ title: string }>).map((s) => s.title), ['Bob']);
    const unknown = await raw(w.c, server.base, '/api/authorship/stamps?bookId=never-stamped');
    assert.equal(unknown.text, JSON.stringify({ stamps: [] }));

    assert.equal((await w.c.get('/api/authorship/stamps')).status, 400, 'bookId is required');
    assert.equal((await w.c.get(`/api/authorship/stamps?bookId=${'x'.repeat(201)}`)).status, 400);
  } finally {
    clock = saved;
  }
});

test("check: oldest first, at most 20; bob checking alice's sha256 gets {recorded:[]} — byte-equal to an unknown sha256", async () => {
  const saved = clock;
  try {
    const w = await newWriter(server.base, 'check-authorship@example.com');
    const sha = hex('check-me');
    for (let i = 0; i < 25; i++) {
      await db.query(
        `insert into authorship_stamps (user_id, book_id, title, sha256, kind, created_at) values ($1, 'b', $2, $3, 'backup', $4)`,
        [w.id, `C${i}`, sha, new Date(saved.getTime() - (25 - i) * 60_000)],
      );
    }
    const r = await w.c.get(`/api/authorship/check?sha256=${sha}`);
    assert.equal(r.status, 200);
    const recorded = r.body.recorded as Array<Record<string, unknown>>;
    assert.equal(recorded.length, 20);
    assert.deepEqual(Object.keys(recorded[0]).sort(), ['createdAt', 'kind', 'title']);
    assert.equal(recorded[0].title, 'C0', 'oldest first');
    assert.equal(recorded[19].title, 'C19');
    assert.equal(recorded[0].createdAt, new Date(saved.getTime() - 25 * 60_000).toISOString());

    const theirs = await raw(bob, server.base, `/api/authorship/check?sha256=${sha}`);
    const unknown = await raw(bob, server.base, `/api/authorship/check?sha256=${hex('never-seen-anywhere')}`);
    assert.equal(theirs.status, 200);
    assert.equal(theirs.status, unknown.status);
    assert.equal(theirs.text, unknown.text, 'another account answers byte for byte like an unknown fingerprint');
    assert.equal(theirs.text, JSON.stringify({ recorded: [] }));

    assert.equal((await w.c.get('/api/authorship/check?sha256=ABC')).status, 400);
    assert.equal((await w.c.get(`/api/authorship/check?sha256=${sha.toUpperCase()}`)).status, 400);
    assert.equal((await w.c.get('/api/authorship/check')).status, 400);
  } finally {
    clock = saved;
  }
});

test("day 22: POST stamps answers the paused body (pausedBody('authorship.stamp')); both GETs still 200", async () => {
  const w = await newWriter(paid.base, 'day22-authorship@example.com');
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() + 7 * DAY)]);
  const sha = hex('day22');
  const body = { bookId: 'book-22', title: 'Day 22', sha256: sha, kind: 'backup' };
  assert.equal((await stamp(w.c, body)).status, 201, 'inside the trial');

  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() - DAY)]);
  const refused = await stamp(w.c, body);
  assert.equal(refused.status, 402);
  assert.deepEqual(refused.body, pausedBody('authorship.stamp'));
  assert.match(String(refused.body.error), /new authorship stamps/);
  assert.equal((await db.query<{ n: number }>('select count(*)::int as n from authorship_stamps where user_id = $1', [w.id])).rows[0].n, 1);

  const list = await w.c.get('/api/authorship/stamps?bookId=book-22');
  assert.equal(list.status, 200);
  assert.equal((list.body.stamps as unknown[]).length, 1);
  const check = await w.c.get(`/api/authorship/check?sha256=${sha}`);
  assert.equal(check.status, 200);
  assert.equal((check.body.recorded as unknown[]).length, 1);
});

test('account: Download all my data includes authorship_stamps; account deletion removes them', async () => {
  const w = await newWriter(server.base, 'export-authorship@example.com');
  const saved = clock;
  const a = await stamp(w.c, { bookId: 'exp-book', title: 'Export Me', sha256: hex('exp-a'), kind: 'backup' });
  // A second later, so the export's created_at order is the stamping order (an equal time would fall back to the random id).
  clock = new Date(saved.getTime() + 1000);
  const b = await stamp(w.c, { bookId: 'exp-book', title: 'Export Me', sha256: hex('exp-b'), kind: 'docx' });
  clock = saved;
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const res = await w.c.download('/api/account/export');
  assert.equal(res.status, 200);
  const entries = readZip(res.bytes);
  const file = entries.find((e) => e.name === 'authorship.json');
  assert.ok(file, entries.map((e) => e.name).join(', '));
  const json = JSON.parse(file.data.toString('utf8')) as { stamps: Array<Record<string, unknown>> };
  assert.deepEqual(
    json.stamps.map((s) => [s.id, s.bookId, s.title, s.sha256, s.kind, s.createdAt]),
    [
      [a.body.id, 'exp-book', 'Export Me', hex('exp-a'), 'backup', a.body.createdAt],
      [b.body.id, 'exp-book', 'Export Me', hex('exp-b'), 'docx', b.body.createdAt],
    ],
  );
  const all = entries.map((e) => e.data.toString('latin1')).join('\n');
  assert.equal(all.includes(hex('l0')), false, "nobody else's stamps");
  const readme = entries.find((e) => e.name === 'README.txt')!.data.toString('utf8');
  assert.match(readme, /authorship\.json/);

  const del = await w.c.post('/api/account/delete', { currentPassword: PASSWORD, confirmPhrase: 'delete my account' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((del.body.removed as Record<string, number>).authorship_stamps, 2);
  assert.equal((await db.query('select 1 from authorship_stamps where user_id = $1', [w.id])).rows.length, 0);
});

test('ops: BACKUP_TABLES includes authorship_stamps; registry self-check passes', async () => {
  const order = BACKUP_TABLES as readonly string[];
  assert.ok(order.includes('authorship_stamps'));
  assert.ok(order.indexOf('authorship_stamps') > order.indexOf('users'), 'after users (FK-safe restore order)');
  const classified = await classifyTables(db);
  assert.deepEqual(classified.unclassified, []);
  assert.deepEqual(classified.missing, []);

  const c = SELF_CHECK_CASES.find((x) => x.id === 'authorship.schema.table-present')!;
  assert.ok(c && c.kind === 'server' && c.run);
  assert.match(c.title, /authorship_stamps/);
  const detail = await c.run!({ db } as CheckContext);
  assert.match(String(detail), /authorship_stamps/);
});
