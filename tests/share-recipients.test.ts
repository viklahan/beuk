import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import express from 'express';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';
import { readZip } from '../src/housekeeping/packages.js';
import { pausedBody } from '../src/access.js';
import { shareReaderRoutes } from '../src/routes/shares.js';

/*
 * Named reading links (plan 2026-11-08, Task 1): one link per beta
 * reader on top of a share, with its own expiry and close, its own
 * comments, and the name on every page (the page itself is Task 2).
 */

let server: TestServer;
let paid: TestServer; // billing on: the day-22 pause is real here
let db: Db;
let alice: Client;
let bob: Client;
let clock = new Date();
const DAY = 86_400_000;
const PASSWORD = 'correct horse battery';

// A 1×1 transparent PNG.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// The studio's own document shape (as in tests/shares.test.ts).
const studioDoc = {
  meta: { title: 'The Lantern Coast', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 'sec-cover', kind: 'front', type: 'cover', title: 'Cover', content: '' },
    { id: 'sec-ded', kind: 'front', type: 'dedication', title: 'Dedication', content: 'For the keepers.' },
    {
      id: 'sec-one',
      kind: 'body',
      type: 'chapter',
      number: 'One',
      title: 'First Light',
      content: 'It began with the tide.\n\n![A chart of the harbour](img:img-chart)',
    },
    { id: 'sec-two', kind: 'body', type: 'chapter', number: 'Two', title: 'Fog', content: 'The fog came in.' },
  ],
  images: [{ id: 'img-chart', name: 'chart', mediaType: 'image/png', ext: 'png', data: PNG_1PX }],
};

const ON = {
  stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
  stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
  stripePriceId: 'price_fixture_one',
  // Never called: the pause is decided from the database alone.
  stripeApiBase: 'http://127.0.0.1:9',
};

before(async () => {
  db = await createTestDb();
  server = await startTestServer(db, () => clock);
  paid = await startTestServer(db, () => clock, ON);
  alice = new Client(server.base);
  bob = new Client(server.base);
  await registerUser(alice, 'alice-named@example.com');
  await registerUser(bob, 'bob-named@example.com');
});

after(async () => {
  await server.close();
  await paid.close();
});

type Recipient = {
  id: string;
  shareId: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  status: string;
  commentCount: number;
};

async function newManuscript(client: Client, doc: unknown = studioDoc): Promise<string> {
  const r = await client.post('/api/manuscripts', { doc });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return (r.body.manuscript as { id: string }).id;
}

async function newShare(client: Client, extra: Record<string, unknown> = {}) {
  const mid = await newManuscript(client);
  const r = await client.post('/api/shares', { manuscriptId: mid, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return { mid, ...(r.body as { share: { id: string; status: string }; token: string }) };
}

async function addReader(client: Client, shareId: string, body: Record<string, unknown>) {
  const r = await client.post(`/api/shares/${shareId}/readers`, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { recipient: Recipient; token: string };
}

async function getHtml(base: string, pathName: string) {
  const res = await fetch(`${base}${pathName}`);
  return { status: res.status, headers: res.headers, html: await res.text() };
}

async function postComment(token: string, body: Record<string, unknown>, ip?: string, base = server.base) {
  const res = await fetch(`${base}/read/${token}/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ip ? { 'x-forwarded-for': ip } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function readComments(token: string) {
  const res = await fetch(`${server.base}/read/${token}/comments`);
  return { status: res.status, body: (await res.json()) as { comments: Array<Record<string, unknown>> } };
}

test('create → list → read: named token returned once, stored hashed, page renders', async () => {
  const { share } = await newShare(alice);
  const { recipient, token } = await addReader(alice, share.id, { name: 'Priya', expiresInDays: 30 });
  assert.match(token, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(recipient.shareId, share.id);
  assert.equal(recipient.name, 'Priya');
  assert.equal(recipient.status, 'active');
  assert.equal(recipient.revokedAt, null);
  assert.equal(recipient.firstOpenedAt, null);
  assert.equal(recipient.lastOpenedAt, null);
  assert.equal(recipient.commentCount, 0);
  assert.ok(recipient.createdAt);
  assert.ok(Math.abs(new Date(recipient.expiresAt!).getTime() - (clock.getTime() + 30 * DAY)) < 1000);

  const rows = await db.query<{ token_hash: string }>('select token_hash from share_recipients where id = $1', [recipient.id]);
  assert.match(rows.rows[0].token_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(rows.rows[0].token_hash, token);

  const second = await addReader(alice, share.id, { name: 'Marco' });
  assert.equal(second.recipient.expiresAt, null, 'no expiry given = never expires');

  const list = await alice.get(`/api/shares/${share.id}/readers`);
  assert.equal(list.status, 200);
  const readers = list.body.readers as Array<Record<string, unknown>>;
  assert.deepEqual(readers.map((r) => r.name), ['Priya', 'Marco'], 'ordered by created_at');
  for (const r of readers) {
    assert.equal(r.token, undefined, 'the token is never listed');
    assert.equal(r.tokenHash, undefined);
    assert.equal(r.token_hash, undefined);
  }

  const page = await getHtml(server.base, `/read/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /The Lantern Coast/);
  const ch = await getHtml(server.base, `/read/${token}?c=1`);
  assert.match(ch.html, /It began with the tide\./);
  const img = await fetch(`${server.base}/read/${token}/img/img-chart`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  // The share JSON carries the new field, with the share's status untouched.
  const shares = (await alice.get('/api/shares')).body.shares as Array<Record<string, unknown>>;
  const mine = shares.find((s) => s.id === share.id)!;
  assert.equal(mine.openLinkClosedAt, null);
  assert.equal(mine.status, 'active');
});

test('names: NFC + trim, 1–60, control chars 400, duplicate (case-insensitive) 409, rename via PUT 400', async () => {
  const { share } = await newShare(alice);
  // "e" + combining acute → the single NFC code point é; spaces trimmed.
  const nfc = await addReader(alice, share.id, { name: '  Renée  ' });
  assert.equal(nfc.recipient.name, 'Renée');
  // 60 code points (astral emoji count as one each) is fine; 61 is not.
  const sixty = '😀'.repeat(60);
  assert.equal((await addReader(alice, share.id, { name: sixty })).recipient.name, sixty);
  assert.equal((await alice.post(`/api/shares/${share.id}/readers`, { name: 'x'.repeat(61) })).status, 400);
  assert.equal((await alice.post(`/api/shares/${share.id}/readers`, { name: '   ' })).status, 400);
  assert.equal((await alice.post(`/api/shares/${share.id}/readers`, { name: '' })).status, 400);
  assert.equal((await alice.post(`/api/shares/${share.id}/readers`, {})).status, 400);
  assert.equal((await alice.post(`/api/shares/${share.id}/readers`, { name: 42 })).status, 400);
  for (const bad of ['Pri\nya', 'Pri\u0000ya', 'Priya\t', '\u007fPriya', 'Pri\u0085ya']) {
    assert.equal((await alice.post(`/api/shares/${share.id}/readers`, { name: bad })).status, 400, JSON.stringify(bad));
  }
  // RTL and markup characters are names like any other (escaping is the page's job).
  assert.equal((await addReader(alice, share.id, { name: 'سارة' })).recipient.name, 'سارة');
  assert.equal((await addReader(alice, share.id, { name: '</style>"&\'<>' })).recipient.name, '</style>"&\'<>');

  await addReader(alice, share.id, { name: 'Priya' });
  const dup = await alice.post(`/api/shares/${share.id}/readers`, { name: ' PRIYA ' });
  assert.equal(dup.status, 409);
  assert.equal(typeof dup.body.error, 'string');
  // The same name on another reading copy is fine.
  const other = await newShare(alice);
  await addReader(alice, other.share.id, { name: 'Priya' });

  // Bad expiry is refused like on shares.
  assert.equal((await alice.post(`/api/shares/${share.id}/readers`, { name: 'Late', expiresAt: '2000-01-01T00:00:00Z' })).status, 400);
  assert.equal((await alice.post(`/api/shares/${share.id}/readers`, { name: 'Late', expiresInDays: -1 })).status, 400);

  const { recipient } = await addReader(alice, share.id, { name: 'Tomas' });
  const rename = await alice.put(`/api/shares/${share.id}/readers/${recipient.id}`, { name: 'Tom' });
  assert.equal(rename.status, 400);
  const renameWithExpiry = await alice.put(`/api/shares/${share.id}/readers/${recipient.id}`, { name: 'Tom', expiresInDays: 7 });
  assert.equal(renameWithExpiry.status, 400);
  assert.equal((await alice.put(`/api/shares/${share.id}/readers/${recipient.id}`, {})).status, 400, 'nothing to update');
  const changed = await alice.put(`/api/shares/${share.id}/readers/${recipient.id}`, { expiresInDays: 7 });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  const rc = changed.body.recipient as Recipient;
  assert.equal(rc.name, 'Tomas');
  assert.ok(Math.abs(new Date(rc.expiresAt!).getTime() - (clock.getTime() + 7 * DAY)) < 1000);
  const cleared = await alice.put(`/api/shares/${share.id}/readers/${recipient.id}`, { expiresAt: null });
  assert.equal((cleared.body.recipient as Recipient).expiresAt, null);
  const stored = await db.query<{ name: string }>('select name from share_recipients where id = $1', [recipient.id]);
  assert.equal(stored.rows[0].name, 'Tomas');
});

test('cap: 50 named links (closed ones count) then 409', async () => {
  const { share } = await newShare(alice);
  for (let i = 0; i < 50; i++) {
    const { recipient } = await addReader(alice, share.id, { name: `Reader ${i}` });
    if (i < 5) {
      const closed = await alice.post(`/api/shares/${share.id}/readers/${recipient.id}/revoke`);
      assert.equal(closed.status, 200);
    }
  }
  const over = await alice.post(`/api/shares/${share.id}/readers`, { name: 'Reader 50' });
  assert.equal(over.status, 409);
  assert.equal(typeof over.body.error, 'string');
  const n = await db.query<{ n: number }>('select count(*)::int as n from share_recipients where share_id = $1', [share.id]);
  assert.equal(n.rows[0].n, 50);
});

test('combined status: share revoked → every named 410; share expired → named 410; named revoked/expired → only that one 410; the 410 page never contains the reader\'s name', async () => {
  // Named link closed / expired on its own: only that one goes.
  const a = await newShare(alice);
  const p = await addReader(alice, a.share.id, { name: 'Priyanka Closed' });
  const q = await addReader(alice, a.share.id, { name: 'Quentin Expiring', expiresInDays: 1 });
  const r = await addReader(alice, a.share.id, { name: 'Rosa Open' });
  const revoked = await alice.post(`/api/shares/${a.share.id}/readers/${p.recipient.id}/revoke`);
  assert.equal(revoked.status, 200);
  assert.equal((revoked.body.recipient as Recipient).status, 'revoked');
  assert.ok((revoked.body.recipient as Recipient).revokedAt);
  const gone = await getHtml(server.base, `/read/${p.token}`);
  assert.equal(gone.status, 410);
  assert.match(gone.html, /This reading copy is closed/);
  assert.match(gone.html, /The writer has closed this reading copy\./);
  assert.equal(gone.html.includes('Priyanka'), false, 'the 410 page never names the reader');
  assert.equal((await readComments(p.token)).status, 410);
  assert.equal((await postComment(p.token, { sectionId: 'sec-one', body: 'x' })).status, 410);
  assert.equal((await getHtml(server.base, `/read/${q.token}`)).status, 200);
  assert.equal((await getHtml(server.base, `/read/${r.token}`)).status, 200);
  assert.equal((await getHtml(server.base, `/read/${a.token}`)).status, 200, 'the open link is untouched');

  const saved = clock;
  clock = new Date(saved.getTime() + 2 * DAY);
  try {
    const exp = await getHtml(server.base, `/read/${q.token}`);
    assert.equal(exp.status, 410);
    assert.match(exp.html, /The reading period for this copy has ended\./);
    assert.equal(exp.html.includes('Quentin'), false);
    assert.equal((await getHtml(server.base, `/read/${r.token}`)).status, 200);
    const list = (await alice.get(`/api/shares/${a.share.id}/readers`)).body.readers as Recipient[];
    assert.deepEqual(list.map((x) => x.status), ['revoked', 'expired', 'active']);
  } finally {
    clock = saved;
  }

  // The share expires: every named link expires with it.
  const b = await newShare(alice, { expiresInDays: 1 });
  const b1 = await addReader(alice, b.share.id, { name: 'Bea Expired' });
  const b2 = await addReader(alice, b.share.id, { name: 'Bo' });
  clock = new Date(saved.getTime() + 2 * DAY);
  try {
    for (const t of [b1.token, b2.token]) {
      const g = await getHtml(server.base, `/read/${t}`);
      assert.equal(g.status, 410);
      assert.equal(g.html.includes('Bea'), false);
      assert.equal(g.html.includes('Bo<'), false);
    }
    const list = (await alice.get(`/api/shares/${b.share.id}/readers`)).body.readers as Recipient[];
    assert.deepEqual(list.map((x) => x.status), ['expired', 'expired']);
  } finally {
    clock = saved;
  }

  // The share is revoked: every named link is closed.
  const c = await newShare(alice);
  const c1 = await addReader(alice, c.share.id, { name: 'Cleo Revoked' });
  const c2 = await addReader(alice, c.share.id, { name: 'Cy' });
  assert.equal((await alice.post(`/api/shares/${c.share.id}/revoke`)).status, 200);
  for (const t of [c1.token, c2.token]) {
    const g = await getHtml(server.base, `/read/${t}`);
    assert.equal(g.status, 410);
    assert.equal(g.html.includes('Cleo'), false);
    assert.equal((await readComments(t)).status, 410);
  }
  const list = (await alice.get(`/api/shares/${c.share.id}/readers`)).body.readers as Recipient[];
  assert.deepEqual(list.map((x) => x.status), ['revoked', 'revoked']);
});

test('close-open: the open token 410s, named links keep reading, share JSON has openLinkClosedAt', async () => {
  const { share, token } = await newShare(alice);
  const named = await addReader(alice, share.id, { name: 'Dana' });
  const closed = await alice.post(`/api/shares/${share.id}/close-open`);
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const sj = closed.body.share as Record<string, unknown>;
  assert.ok(typeof sj.openLinkClosedAt === 'string' && sj.openLinkClosedAt);
  assert.equal(sj.status, 'active', 'the share itself stays active');
  assert.equal(sj.revokedAt, null);

  const open = await getHtml(server.base, `/read/${token}`);
  assert.equal(open.status, 410);
  assert.match(open.html, /This reading copy is closed/);
  assert.equal((await readComments(token)).status, 410);
  assert.equal((await postComment(token, { sectionId: 'sec-one', body: 'x', readerName: 'Anon' })).status, 410);
  assert.notEqual((await fetch(`${server.base}/read/${token}/img/img-chart`)).status, 200);

  assert.equal((await getHtml(server.base, `/read/${named.token}`)).status, 200);
  assert.equal((await postComment(named.token, { sectionId: 'sec-one', body: 'Still here.' })).status, 201);

  // Idempotent: a second close keeps the first moment.
  const again = await alice.post(`/api/shares/${share.id}/close-open`);
  assert.equal((again.body.share as Record<string, unknown>).openLinkClosedAt, sj.openLinkClosedAt);
  const listed = ((await alice.get('/api/shares')).body.shares as Array<Record<string, unknown>>).find((s) => s.id === share.id)!;
  assert.equal(listed.openLinkClosedAt, sj.openLinkClosedAt);
  assert.equal(listed.status, 'active');
});

test('image route: a closed named token gets 410 and no bytes', async () => {
  const { share, token } = await newShare(alice);
  const named = await addReader(alice, share.id, { name: 'Ivo' });
  const other = await addReader(alice, share.id, { name: 'Ines' });
  assert.equal((await fetch(`${server.base}/read/${named.token}/img/img-chart`)).status, 200);
  await alice.post(`/api/shares/${share.id}/readers/${named.recipient.id}/revoke`);
  const res = await fetch(`${server.base}/read/${named.token}/img/img-chart`);
  assert.equal(res.status, 410);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.length, 0, 'no image bytes');
  assert.notEqual(res.headers.get('content-type'), 'image/png');
  // The share is still open: the open link and the other named link still get the picture.
  assert.equal((await fetch(`${server.base}/read/${token}/img/img-chart`)).status, 200);
  assert.equal((await fetch(`${server.base}/read/${other.token}/img/img-chart`)).status, 200);
});

test('comments: named sees only its own, open sees only recipient_id null, reader_name forced to the recipient name, owner list carries recipientId', async () => {
  const { share, token } = await newShare(alice); // reader name required (the default)
  const p = await addReader(alice, share.id, { name: 'Priya' });
  const m = await addReader(alice, share.id, { name: 'Marco' });

  const open = await postComment(token, { sectionId: 'sec-one', body: 'From the open link.', readerName: 'Anon' });
  assert.equal(open.status, 201);
  // A named comment with an empty body name is fine even though names are required.
  const pc = await postComment(p.token, { sectionId: 'sec-one', body: 'Priya here.' });
  assert.equal(pc.status, 201, JSON.stringify(pc.body));
  assert.equal((pc.body.comment as Record<string, unknown>).readerName, 'Priya');
  // The body's readerName is ignored on a named link, even an over-long one.
  const spoof = await postComment(m.token, { sectionId: 'sec-two', body: 'Marco here.', readerName: 'Priya' });
  assert.equal(spoof.status, 201);
  assert.equal((spoof.body.comment as Record<string, unknown>).readerName, 'Marco');
  const long = await postComment(m.token, { sectionId: 'sec-two', body: 'Again.', readerName: 'x'.repeat(200) });
  assert.equal(long.status, 201);
  assert.equal((long.body.comment as Record<string, unknown>).readerName, 'Marco');

  const seenP = await readComments(p.token);
  assert.equal(seenP.status, 200);
  assert.deepEqual(seenP.body.comments.map((c) => c.body), ['Priya here.']);
  const seenM = await readComments(m.token);
  assert.deepEqual(seenM.body.comments.map((c) => c.body), ['Marco here.', 'Again.']);
  assert.ok(seenM.body.comments.every((c) => c.readerName === 'Marco'));
  const seenOpen = await readComments(token);
  assert.deepEqual(seenOpen.body.comments.map((c) => c.body), ['From the open link.']);
  for (const list of [seenP, seenM, seenOpen]) {
    for (const c of list.body.comments) assert.equal(c.recipientId, undefined, 'readers never see recipient ids');
  }

  const stored = await db.query<{ body: string; reader_name: string; recipient_id: string | null }>(
    'select body, reader_name, recipient_id from share_comments where share_id = $1 order by created_at',
    [share.id],
  );
  assert.deepEqual(
    stored.rows.map((r) => [r.body, r.reader_name, r.recipient_id]),
    [
      ['From the open link.', 'Anon', null],
      ['Priya here.', 'Priya', p.recipient.id],
      ['Marco here.', 'Marco', m.recipient.id],
      ['Again.', 'Marco', m.recipient.id],
    ],
  );

  // The writer sees everything, each with its link.
  const owner = (await alice.get(`/api/shares/${share.id}/comments`)).body.comments as Array<Record<string, unknown>>;
  assert.equal(owner.length, 4);
  const byBody = Object.fromEntries(owner.map((c) => [c.body, c.recipientId]));
  assert.equal(byBody['From the open link.'], null);
  assert.equal(byBody['Priya here.'], p.recipient.id);
  assert.equal(byBody['Again.'], m.recipient.id);
  const mid = (await db.query<{ manuscript_id: string }>('select manuscript_id from shares where id = $1', [share.id])).rows[0].manuscript_id;
  const byManuscript = (await alice.get(`/api/shares/comments?manuscriptId=${mid}`)).body.comments as Array<Record<string, unknown>>;
  assert.equal(byManuscript.find((c) => c.body === 'Priya here.')!.recipientId, p.recipient.id);
  const cid = owner.find((c) => c.body === 'Priya here.')!.id as string;
  const resolved = await alice.post(`/api/shares/${share.id}/comments/${cid}/resolve`);
  assert.equal((resolved.body.comment as Record<string, unknown>).recipientId, p.recipient.id);

  // Comment counts per named link.
  const readers = (await alice.get(`/api/shares/${share.id}/readers`)).body.readers as Recipient[];
  assert.deepEqual(readers.map((r) => [r.name, r.commentCount]), [['Priya', 1], ['Marco', 2]]);
});

test('rate limit: two named links on one share have separate per-share budgets', async () => {
  // The reader router on its own, with a per-share budget of 2 (the app's own limits are 200).
  const app = express();
  app.use(express.json());
  app.use('/read', shareReaderRoutes(db, { now: () => clock, limits: { perIp: 100, perIpWindowMs: 60_000, perShare: 2, perShareWindowMs: 60_000 } }));
  const s: Server = await new Promise((resolve) => {
    const x = app.listen(0, () => resolve(x));
  });
  const addr = s.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    const { share, token } = await newShare(alice);
    const p = await addReader(alice, share.id, { name: 'Pia' });
    const m = await addReader(alice, share.id, { name: 'Max' });
    const body = { sectionId: 'sec-one', body: 'note', readerName: 'R' };
    for (const t of [p.token, p.token]) assert.equal((await postComment(t, body, '203.0.113.1', base)).status, 201);
    assert.equal((await postComment(p.token, body, '203.0.113.2', base)).status, 429, 'Pia’s budget is spent');
    for (const t of [m.token, m.token]) assert.equal((await postComment(t, body, '203.0.113.3', base)).status, 201, 'Max has his own');
    assert.equal((await postComment(m.token, body, '203.0.113.4', base)).status, 429);
    for (const t of [token, token]) assert.equal((await postComment(t, body, '203.0.113.5', base)).status, 201, 'the open link has its own');
    assert.equal((await postComment(token, body, '203.0.113.6', base)).status, 429);
  } finally {
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

test('opens: first_opened_at set once, last_opened_at throttled to 1 h (injected clock), share_readers untouched by named opens', async () => {
  const { share } = await newShare(alice);
  const { recipient, token } = await addReader(alice, share.id, { name: 'Olu' });
  const saved = clock;
  const at = (ms: number) => new Date(saved.getTime() + ms);
  const row = async () =>
    (
      await db.query<{ first_opened_at: Date | null; last_opened_at: Date | null }>(
        'select first_opened_at, last_opened_at from share_recipients where id = $1',
        [recipient.id],
      )
    ).rows[0];
  try {
    assert.equal((await getHtml(server.base, `/read/${token}`)).status, 200);
    let r = await row();
    assert.equal(new Date(r.first_opened_at!).getTime(), saved.getTime());
    assert.equal(new Date(r.last_opened_at!).getTime(), saved.getTime());

    clock = at(30 * 60_000); // 30 minutes later: not written
    await getHtml(server.base, `/read/${token}?c=1`);
    r = await row();
    assert.equal(new Date(r.first_opened_at!).getTime(), saved.getTime());
    assert.equal(new Date(r.last_opened_at!).getTime(), saved.getTime());

    clock = at(61 * 60_000); // over an hour after the last write: written
    await getHtml(server.base, `/read/${token}`);
    r = await row();
    assert.equal(new Date(r.first_opened_at!).getTime(), saved.getTime(), 'first open never moves');
    assert.equal(new Date(r.last_opened_at!).getTime(), at(61 * 60_000).getTime());

    // Images and comments are not opens.
    clock = at(5 * 3_600_000);
    await fetch(`${server.base}/read/${token}/img/img-chart`);
    await readComments(token);
    r = await row();
    assert.equal(new Date(r.last_opened_at!).getTime(), at(61 * 60_000).getTime());

    const readers = await db.query<{ n: number }>('select count(*)::int as n from share_readers where share_id = $1', [share.id]);
    assert.equal(readers.rows[0].n, 0, 'named opens never count as anonymous readers');
    const listed = ((await alice.get('/api/shares')).body.shares as Array<Record<string, unknown>>).find((s) => s.id === share.id)!;
    assert.equal(listed.readerCount, 0);
    const rj = ((await alice.get(`/api/shares/${share.id}/readers`)).body.readers as Recipient[])[0];
    assert.equal(rj.firstOpenedAt, saved.toISOString());
    assert.equal(rj.lastOpenedAt, at(61 * 60_000).toISOString());
  } finally {
    clock = saved;
  }
});

test('republish: every named link shows the new text; recipient createdAt unchanged', async () => {
  const { share, mid } = await newShare(alice);
  const p = await addReader(alice, share.id, { name: 'Pen' });
  const q = await addReader(alice, share.id, { name: 'Quill' });
  for (const t of [p.token, q.token]) assert.match((await getHtml(server.base, `/read/${t}?c=2`)).html, /The fog came in\./);

  const ms = await alice.get(`/api/manuscripts/${mid}`);
  const revision = (ms.body.manuscript as { revision: number }).revision;
  const doc = structuredClone(studioDoc);
  doc.sections[3].content = 'The fog lifted at dawn.';
  assert.equal((await alice.put(`/api/manuscripts/${mid}`, { doc, revision })).status, 200);
  const rep = await alice.post(`/api/shares/${share.id}/republish`);
  assert.equal(rep.status, 200, JSON.stringify(rep.body));

  for (const t of [p.token, q.token]) {
    const html = (await getHtml(server.base, `/read/${t}?c=2`)).html;
    assert.match(html, /The fog lifted at dawn\./);
    assert.doesNotMatch(html, /The fog came in\./);
  }
  const after = (await alice.get(`/api/shares/${share.id}/readers`)).body.readers as Recipient[];
  assert.deepEqual(after.map((r) => r.createdAt), [p.recipient.createdAt, q.recipient.createdAt]);
});

test('IDOR: another writer cannot create, list, change, revoke readers or close-open on alice\'s share', async () => {
  const { share, token } = await newShare(alice);
  const p = await addReader(alice, share.id, { name: 'Pat' });
  const rid = p.recipient.id;

  assert.equal((await bob.post(`/api/shares/${share.id}/readers`, { name: 'Mallory' })).status, 404);
  assert.equal((await bob.get(`/api/shares/${share.id}/readers`)).status, 404);
  assert.equal((await bob.put(`/api/shares/${share.id}/readers/${rid}`, { expiresInDays: 1 })).status, 404);
  assert.equal((await bob.post(`/api/shares/${share.id}/readers/${rid}/revoke`)).status, 404);
  assert.equal((await bob.post(`/api/shares/${share.id}/close-open`)).status, 404);
  // Bob's own share id with Alice's recipient id doesn't work either.
  const bobShare = await newShare(bob);
  assert.equal((await bob.put(`/api/shares/${bobShare.share.id}/readers/${rid}`, { expiresInDays: 1 })).status, 404);
  assert.equal((await bob.post(`/api/shares/${bobShare.share.id}/readers/${rid}/revoke`)).status, 404);
  // Nor does Alice's own other share with this recipient.
  const aliceOther = await newShare(alice);
  assert.equal((await alice.post(`/api/shares/${aliceOther.share.id}/readers/${rid}/revoke`)).status, 404);
  // Malformed ids.
  assert.equal((await alice.post(`/api/shares/${share.id}/readers/not-a-uuid/revoke`)).status, 404);
  assert.equal((await alice.get('/api/shares/not-a-uuid/readers')).status, 404);
  // Signed out: 401.
  assert.equal((await new Client(server.base).get(`/api/shares/${share.id}/readers`)).status, 401);

  // Nothing changed for Alice.
  assert.equal((await getHtml(server.base, `/read/${token}`)).status, 200);
  assert.equal((await getHtml(server.base, `/read/${p.token}`)).status, 200);
  const r = (await db.query<{ revoked_at: unknown; expires_at: unknown }>('select revoked_at, expires_at from share_recipients where id = $1', [rid])).rows[0];
  assert.equal(r.revoked_at, null);
  assert.equal(r.expires_at, null);
  const s = (await db.query<{ open_link_closed_at: unknown }>('select open_link_closed_at from shares where id = $1', [share.id])).rows[0];
  assert.equal(s.open_link_closed_at, null);
  assert.equal(((await bob.get('/api/shares')).body.shares as unknown[]).length, 1, 'only his own');
});

test('day 22: POST readers refused like POST /api/shares; GET/PUT/revoke/close-open and /read on a named link still work', async () => {
  const email = 'day22-named@example.com';
  const c = new Client(paid.base);
  assert.equal((await registerUser(c, email, PASSWORD)).status, 201);
  const uid = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0].id;
  await db.query('update users set trial_ends_at = $2 where id = $1', [uid, new Date(clock.getTime() + 7 * DAY)]);
  const mid = await newManuscript(c);
  const s = await c.post('/api/shares', { manuscriptId: mid });
  assert.equal(s.status, 201);
  const shareId = (s.body.share as { id: string }).id;
  const p = await addReader(c, shareId, { name: 'Pilar' });
  const q = await addReader(c, shareId, { name: 'Quinn' });

  // Day 22, no plan: the account is paused.
  await db.query('update users set trial_ends_at = $2 where id = $1', [uid, new Date(clock.getTime() - DAY)]);
  const refusedShare = await c.post('/api/shares', { manuscriptId: mid });
  assert.equal(refusedShare.status, 402);
  const refused = await c.post(`/api/shares/${shareId}/readers`, { name: 'Rafa' });
  assert.equal(refused.status, 402);
  assert.deepEqual(refused.body, refusedShare.body);
  assert.deepEqual(refused.body, pausedBody('shares.create'));
  assert.equal((await db.query('select 1 from share_recipients where name = $1', ['Rafa'])).rows.length, 0);

  assert.equal((await c.get(`/api/shares/${shareId}/readers`)).status, 200);
  assert.equal((await c.put(`/api/shares/${shareId}/readers/${p.recipient.id}`, { expiresInDays: 14 })).status, 200);
  const page = await getHtml(paid.base, `/read/${p.token}`);
  assert.equal(page.status, 200);
  assert.match(page.html, /The Lantern Coast/);
  assert.equal((await postComment(p.token, { sectionId: 'sec-one', body: 'Still reading.' }, undefined, paid.base)).status, 201);
  assert.equal((await c.post(`/api/shares/${shareId}/readers/${q.recipient.id}/revoke`)).status, 200);
  assert.equal((await getHtml(paid.base, `/read/${q.token}`)).status, 410);
  assert.equal((await c.post(`/api/shares/${shareId}/close-open`)).status, 200);
  assert.equal((await getHtml(paid.base, `/read/${p.token}`)).status, 200, 'the named link outlives the open one');
});

test('account: export lists share_recipients (no token_hash); delete removes them', async () => {
  const email = 'export-named@example.com';
  const c = new Client(server.base);
  assert.equal((await registerUser(c, email, PASSWORD)).status, 201);
  const { share } = await newShare(c);
  const p = await addReader(c, share.id, { name: 'Elif', expiresInDays: 10 });
  await addReader(c, share.id, { name: 'Ezra' });
  await c.post(`/api/shares/${share.id}/readers/${p.recipient.id}/revoke`);
  assert.equal((await postComment(p.token, { sectionId: 'sec-one', body: 'x' })).status, 410);
  const other = await addReader(c, share.id, { name: 'Emre' });
  assert.equal((await postComment(other.token, { sectionId: 'sec-one', body: 'Lovely.' })).status, 201);
  await getHtml(server.base, `/read/${other.token}`);

  const res = await c.download('/api/account/export');
  assert.equal(res.status, 200);
  const entries = readZip(res.bytes);
  const file = entries.find((e) => e.name.startsWith('shares/'))!;
  assert.ok(file, entries.map((e) => e.name).join(', '));
  const text = file.data.toString('utf8');
  const json = JSON.parse(text) as { recipients: Array<Record<string, unknown>>; comments: Array<Record<string, unknown>>; openLinkClosedAt: unknown };
  assert.deepEqual(json.recipients.map((r) => r.name), ['Elif', 'Ezra', 'Emre']);
  const elif = json.recipients[0];
  assert.equal(elif.id, p.recipient.id);
  assert.equal(elif.createdAt, p.recipient.createdAt);
  assert.equal(elif.expiresAt, p.recipient.expiresAt);
  assert.ok(elif.revokedAt);
  assert.ok(json.recipients[2].firstOpenedAt);
  assert.equal(json.openLinkClosedAt, null);
  assert.equal(json.comments[0].recipientId, other.recipient.id);
  for (const r of json.recipients) {
    assert.equal(r.tokenHash, undefined);
    assert.equal(r.token_hash, undefined);
  }
  const hashes = (await db.query<{ token_hash: string }>('select token_hash from share_recipients where share_id = $1', [share.id])).rows;
  for (const all of entries.map((e) => e.data.toString('latin1'))) {
    for (const h of hashes) assert.equal(all.includes(h.token_hash), false, 'no token hash anywhere in the export');
    assert.equal(all.includes(p.token), false, 'no token anywhere in the export');
  }

  const del = await c.post('/api/account/delete', { currentPassword: PASSWORD, confirmPhrase: 'delete my account' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal((del.body.removed as Record<string, number>).share_recipients, 3);
  assert.equal((await db.query('select 1 from share_recipients where share_id = $1', [share.id])).rows.length, 0);
  assert.equal((await getHtml(server.base, `/read/${other.token}`)).status, 404);
});
