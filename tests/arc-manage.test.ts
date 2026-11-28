import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { NEVER_PAUSED } from '../src/access.js';
import { approveReader, ArcError, copyUrl, countedClaims, createCampaign, mintCopy, parseCreateInput, rowOf, type ArcDeps } from '../src/arc/campaigns.js';
import { EpubQueue } from '../src/book/epub/queue.js';
import { arcMailTokenHash, suppress } from '../src/arc/mail.js';
import type { Db } from '../src/db.js';
import { readZip } from '../src/housekeeping/packages.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/*
 * ARC slice 1, Task 5: managing a campaign's readers (approve, decline,
 * revoke), closing it, changing it, a new signup link, deleting it, and
 * deleting a BOOK that has one (deleteArcForManuscript, in the same
 * transaction as the manuscript). Download all my data carries the readers.
 * Ruling R4a: /read/<token> opens only a claimed, unrevoked ARC reader.
 *
 * Readers are put in by SQL (Task 6 makes the claim flow); the ARC mailer is
 * a fake that keeps every message and can be told to refuse.
 */

/** A salt of exactly 32 characters (ARC_SALT_MIN_LENGTH), as tests/arc-mail.test.ts. */
const SALT = 'salt-5-0123456789abcdef-0123456x';
const ARC = { mailFrom: 'Beuk readers <readers@beuk.studio>', smtpUrl: 'smtp://u:p@127.0.0.1:9', suppressionSalt: SALT };
const ON = {
  stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
  stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
  stripePriceId: 'price_fixture_one',
  stripeApiBase: 'http://127.0.0.1:9',
};
const DAY = 86_400_000;
const PASSWORD = 'correct horse battery';

class FakeArcMailer implements Mailer {
  sent: MailMessage[] = [];
  refuse = false;
  /** The transport throws (a bug or a dead socket), rather than answering "not delivered". */
  explode = false;
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: ARC.mailFrom, detail: 'fake ARC mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    if (this.explode) throw new Error('the test transport blew up');
    if (this.refuse) return { delivered: false, reason: 'the test mail server refused it', loggedToConsole: false };
    this.sent.push(message);
    return { delivered: true, messageId: '<arc-manage@example.com>' };
  }
  async verify() {
    return { ok: true, detail: 'fake ARC mailer (test)' };
  }
  to(email: string) {
    return this.sent.filter((m) => m.to === email);
  }
}

const studioDoc = {
  meta: { title: 'The Lantern Coast', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 'sec-copy', kind: 'front', type: 'copyright', title: 'Copyright', content: 'Copyright © A. Writer. All rights reserved.' },
    { id: 'sec-one', kind: 'body', type: 'chapter', number: 'One', title: 'First Light', content: 'It began with the tide.' },
    { id: 'sec-two', kind: 'body', type: 'chapter', number: 'Two', title: 'Fog', content: 'The fog came in.' },
  ],
};

let db: Db;
let arcOn: TestServer;
let arcOff: TestServer;
let paid: TestServer;
const mailer = new FakeArcMailer();
const paidMailer = new FakeArcMailer();
let clock = new Date();
let seq = 0;
let readerSeq = 0;

before(async () => {
  db = await createTestDb();
  arcOn = await startTestServer(db, () => clock, { arc: ARC }, undefined, { arcMailer: mailer });
  arcOff = await startTestServer(db, () => clock);
  paid = await startTestServer(db, () => clock, { ...ON, arc: ARC }, undefined, { arcMailer: paidMailer });
});

after(async () => {
  await arcOn.close();
  await arcOff.close();
  await paid.close();
});

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

async function writer(base: string): Promise<{ c: Client; id: string; email: string }> {
  const email = `arc-manage-${++seq}@example.com`;
  const c = new Client(base);
  assert.equal((await registerUser(c, email, PASSWORD)).status, 201);
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]!.id;
  return { c, id, email };
}

async function newManuscript(c: Client): Promise<string> {
  const r = await c.post('/api/manuscripts', { doc: studioDoc });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return (r.body.manuscript as { id: string }).id;
}

function input(manuscriptId: string, extra: Record<string, unknown> = {}) {
  const closes = new Date(clock.getTime() + 30 * DAY);
  return {
    manuscriptId,
    launchDate: new Date(closes.getTime() + DAY).toISOString().slice(0, 10),
    closesAt: closes.toISOString(),
    tz: 'Europe/London',
    ...extra,
  };
}

type Campaign = {
  id: string;
  shareId: string;
  maxClaims: number;
  closesAt: string;
  state: string;
  endedAt: string | null;
  counts: { claimed: number; pending: number; declined: number; revoked: number };
  build: { label: string; bytes: number; holders: number };
};

type Reader = {
  id: string;
  name: string;
  email: string;
  status: string;
  profileLink: string | null;
  claimedAt: string | null;
  revokedAt: string | null;
  firstOpenedAt: string | null;
  lastOpenedAt: string | null;
  mailStopped: boolean;
};

async function start(c: Client, mid: string, extra: Record<string, unknown> = {}) {
  const r = await c.post('/api/arc', input(mid, extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { campaign: Campaign; signupToken: string; signupUrl: string };
}

/** A writer with a book and a running campaign on the given server. */
async function campaignOn(base: string, extra: Record<string, unknown> = {}) {
  const w = await writer(base);
  const mid = await newManuscript(w.c);
  const s = await start(w.c, mid, extra);
  return { w, mid, campaign: s.campaign, signupToken: s.signupToken };
}

async function buildOf(campaignId: string): Promise<string> {
  return (await db.query<{ id: string }>('select id from arc_builds where campaign_id = $1', [campaignId])).rows[0]!.id;
}

type Status = 'unverified' | 'pending' | 'claimed' | 'declined';

/** An ARC reader row as Task 6's claim flow would leave it. A claimed one
 *  holds a copy (a token, a public id, the build); `withToken` gives any
 *  other status a token too (only to prove /read refuses it, R4a). */
async function addReader(
  campaign: Campaign,
  o: { name: string; email: string; status: Status; profile?: string; withToken?: boolean },
): Promise<{ id: string; token: string | null }> {
  const id = randomUUID();
  const claimed = o.status === 'claimed';
  const token = claimed || o.withToken ? randomBytes(24).toString('base64url') : null;
  const buildId = claimed ? await buildOf(campaign.id) : null;
  const created = new Date(clock.getTime() - 3_600_000 + ++readerSeq * 1000);
  await db.query(
    `insert into share_recipients (id, share_id, role, name, email, status, token_hash, mail_token_hash, profile_link,
       public_id, build_id, claimed_at, email_verified_at, created_at)
     values ($1, $2, 'arc', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      id,
      campaign.shareId,
      o.name,
      o.email,
      o.status,
      token ? sha256(token) : null,
      arcMailTokenHash(arcOn.config, id),
      o.profile ?? null,
      claimed ? randomBytes(12).toString('base64url') : null,
      buildId,
      claimed ? created.toISOString() : null,
      o.status === 'unverified' ? null : created.toISOString(),
      created.toISOString(),
    ],
  );
  return { id, token };
}

async function row(id: string) {
  return (
    await db.query<{
      status: string; token_hash: string | null; public_id: string | null; build_id: string | null;
      claimed_at: Date | null; revoked_at: Date | null;
    }>('select status, token_hash, public_id, build_id, claimed_at, revoked_at from share_recipients where id = $1', [id])
  ).rows[0];
}

const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(`select count(*)::text as n from ${sql}`, params)).rows[0].n);

/** A reader-side page (HTML), with no cookies. */
async function page(base: string, p: string): Promise<{ status: number; text: string }> {
  const r = await fetch(`${base}${p}`);
  return { status: r.status, text: await r.text() };
}

const noNonce = (html: string) => html.replace(/nonce="[^"]*"/g, 'nonce=""');

async function signIn(base: string, email: string): Promise<Client> {
  const c = new Client(base);
  const r = await c.post('/api/auth/login', { email, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c;
}

test('countedClaims and copyUrl', () => {
  assert.equal(countedClaims({ claimed: 3, pending: 2 }), 5);
  assert.equal(countedClaims({ claimed: 0, pending: 0 }), 0);
  assert.equal(copyUrl(arcOn.config, 'tok_123'), `${arcOn.config.appBaseUrl}/arc/r/tok_123`);
});

test('the owner sees pending, claimed and declined readers with their emails, never unverified ones', async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const a = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending', profile: 'https://www.goodreads.com/user/show/1' });
  await addReader(campaign, { name: 'Ghost', email: 'ghost@example.com', status: 'unverified' });
  const b = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  const c = await addReader(campaign, { name: 'Priya', email: 'priya@example.com', status: 'declined' });
  const r = await w.c.get(`/api/arc/${campaign.id}/readers`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const readers = r.body.readers as Reader[];
  assert.deepEqual(readers.map((x) => [x.id, x.name, x.email, x.status]), [
    [a.id, 'Sarah', 'sarah@example.com', 'pending'],
    [b.id, 'Tom', 'tom@example.com', 'claimed'],
    [c.id, 'Priya', 'priya@example.com', 'declined'],
  ], 'oldest first; the unverified row is not shown');
  assert.equal(readers[0].profileLink, 'https://www.goodreads.com/user/show/1', 'shown as text');
  assert.equal(readers[0].claimedAt, null);
  assert.ok(readers[1].claimedAt && !Number.isNaN(Date.parse(readers[1].claimedAt)));
  assert.equal(readers[1].revokedAt, null);
  assert.equal(readers[1].firstOpenedAt, null);
  assert.equal(readers[1].mailStopped, false);
  assert.deepEqual(Object.keys(readers[0]).sort(), [
    'claimedAt', 'email', 'firstOpenedAt', 'id', 'lastOpenedAt', 'mailStopped', 'name', 'profileLink', 'revokedAt', 'status',
  ]);
  assert.equal(JSON.stringify(r.body).includes('ghost@example.com'), false);
});

test("approve gives a copy that opens in today's reader and emails the link", async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const sarah = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending', profile: 'https://example.com/me' });
  const before = mailer.sent.length;
  const r = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((r.body.reader as Reader).status, 'claimed');
  assert.deepEqual(r.body.mail, { sent: true });
  const x = await row(sarah.id);
  assert.equal(x.status, 'claimed');
  assert.match(String(x.public_id), /^[A-Za-z0-9_-]{16}$/, '12 random bytes, base64url');
  assert.equal(x.build_id, await buildOf(campaign.id));
  assert.notEqual(x.claimed_at, null);
  const sent = mailer.sent.slice(before);
  assert.equal(sent.length, 1, 'one email');
  assert.equal(sent[0].to, 'sarah@example.com');
  assert.match(sent[0].subject, /approved your request for The Lantern Coast/);
  const m = /\/arc\/r\/([A-Za-z0-9_-]+)/.exec(sent[0].text);
  assert.ok(m, `the approved email carries the copy link: ${sent[0].text}`);
  assert.equal(x.token_hash, sha256(m[1]), 'the emailed token is the stored hash');
  assert.ok(sent[0].text.includes(copyUrl(arcOn.config, m[1])));
  const read = await page(arcOn.base, `/read/${m[1]}`);
  assert.equal(read.status, 200);
  assert.ok(read.text.includes('Shared with <bdi>Sarah</bdi>'), 'the named reader page');
  assert.equal(await count(`arc_events where recipient_id = $1 and kind = 'approved_sent'`, [sarah.id]), 1);
  // Approving again is refused: the reader already holds a copy.
  const again = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(mailer.sent.length, before + 1, 'no second email');
  assert.equal((await row(sarah.id)).token_hash, sha256(m[1]), 'the copy link did not change');
});

test('approve is undone when ARC mail refuses it', async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const sarah = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  const undone = async (id: string) => {
    const x = await row(id);
    assert.equal(x.status, 'pending');
    assert.equal(x.token_hash, null);
    assert.equal(x.public_id, null);
    assert.equal(x.build_id, null);
    assert.equal(x.claimed_at, null);
  };
  // The mail server refuses: 503 with words.
  mailer.refuse = true;
  try {
    const r = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
    assert.equal(r.status, 503, JSON.stringify(r.body));
    assert.ok(typeof r.body.error === 'string' && r.body.error.length > 10);
    assert.equal((r.body.mail as { reason: string }).reason, 'refused');
  } finally {
    mailer.refuse = false;
  }
  await undone(sarah.id);
  // Over the send limit (100 an hour for a campaign): 429.
  for (let i = 0; i < 100; i++) {
    await db.query(`insert into arc_events (campaign_id, kind, at) values ($1, 'code_sent', $2)`, [campaign.id, clock.toISOString()]);
  }
  const limited = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
  assert.equal(limited.status, 429, JSON.stringify(limited.body));
  assert.equal((limited.body.mail as { reason: string }).reason, 'rate-limited');
  await undone(sarah.id);
  await db.query(`delete from arc_events where campaign_id = $1`, [campaign.id]);
  // ARC mail not set up on this server: 503, nothing claimed.
  const off = await signIn(arcOff.base, w.email);
  const notSet = await off.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
  assert.equal(notSet.status, 503, JSON.stringify(notSet.body));
  assert.equal((notSet.body.mail as { reason: string }).reason, 'not-configured');
  await undone(sarah.id);
  const seen = await w.c.get(`/api/arc?manuscriptId=${(await db.query<{ manuscript_id: string }>('select manuscript_id from arc_campaigns where id = $1', [campaign.id])).rows[0].manuscript_id}`);
  assert.deepEqual((seen.body.campaign as Campaign).counts, { claimed: 0, pending: 1, declined: 0, revoked: 0 });
});

// Controller ruling I5: an approval that cannot be emailed because the reader opted out is no approval.
test('approve of a reader who said Stop or Not me is refused, and nothing about them changes', async () => {
  const { w, mid, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval', maxClaims: 3 });
  const sarah = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  // A 'Not me' hash is global (scope all): an address no other test mails.
  const omar = await addReader(campaign, { name: 'Omar', email: 'not-me-i5@example.com', status: 'pending' });
  await suppress(db, arcOn.config, 'sarah@example.com', { ownerId: w.id });
  await db.query('update share_recipients set mail_stopped_at = $2 where id = $1', [sarah.id, clock.toISOString()]);
  await suppress(db, arcOn.config, 'not-me-i5@example.com', 'all');
  const counts = async () => ((await w.c.get(`/api/arc?manuscriptId=${mid}`)).body.campaign as Campaign).counts;
  const before = await counts();
  const sentBefore = mailer.sent.length;
  const untouched = async (id: string) => {
    const x = await row(id);
    assert.deepEqual(
      [x.status, x.token_hash, x.public_id, x.build_id, x.claimed_at, x.revoked_at],
      ['pending', null, null, null, null, null],
      'still waiting, no copy',
    );
  };
  const stop = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
  assert.equal(stop.status, 409, JSON.stringify(stop.body));
  assert.deepEqual(stop.body, {
    error: 'reader-suppressed',
    message: 'This reader asked for no more email from you. Decline them instead.',
    scope: 'owner',
  });
  await untouched(sarah.id);
  const notMe = await w.c.post(`/api/arc/${campaign.id}/readers/${omar.id}/approve`);
  assert.equal(notMe.status, 409, JSON.stringify(notMe.body));
  assert.deepEqual(notMe.body, {
    error: 'reader-suppressed',
    message: 'This reader asked Beuk for no email from any author. Decline them instead.',
    scope: 'all',
  });
  await untouched(omar.id);
  assert.deepEqual(await counts(), before, 'the cap is as it was');
  assert.equal(mailer.sent.length, sentBefore, 'nothing was sent');
  assert.equal(await count(`arc_events where campaign_id = $1`, [campaign.id]), 0);
  // The panel's way out: decline. It is kept, and says the email was not sent.
  const d = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/decline`);
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal((d.body.mail as { reason: string }).reason, 'suppressed');
  assert.equal((await row(sarah.id)).status, 'declined');
  assert.equal(mailer.sent.length, sentBefore);
});

// I5, the other door: an opt-out that lands between the check and the send. sendArcMail
// says 'suppressed' after the copy was minted; the mint is released like a refused send.
test('an opt-out that arrives after the check still undoes the approval', async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const sarah = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  await suppress(db, arcOn.config, 'sarah@example.com', { ownerId: w.id });
  let hidden = 0;
  // The first suppression lookup (approveReader's own check) sees nothing, as if the Stop came a moment later.
  const lateDb: Db = {
    query: (text, params) =>
      text.includes('from mail_suppressions') && hidden++ === 0 ? Promise.resolve({ rows: [] }) : db.query(text, params),
    tx: (fn) => db.tx(fn),
  };
  const row0 = (await db.query<Record<string, unknown>>(
    `select c.id, c.share_id, c.owner_id, c.manuscript_id, c.max_claims, c.approval_mode, c.launch_date::text as launch_date,
       c.closes_at, c.tz, c.author_notified_at, c.created_at, c.ended_at from arc_campaigns c where c.id = $1`,
    [campaign.id],
  )).rows[0];
  const c = rowOf(row0);
  const deps: ArcDeps = { db: lateDb, config: arcOn.config, arcMailer: mailer, mailer, epubQueue: new EpubQueue(1, 4), now: () => clock };
  const before = mailer.sent.length;
  await assert.rejects(approveReader(deps, c, sarah.id), (e: unknown) =>
    e instanceof ArcError && e.status === 409 && e.extra?.error === 'reader-suppressed' && e.extra?.scope === 'owner');
  assert.equal(hidden, 3, "the first lookup was hidden; then sendArcMail's, then the refusal's scope");
  const x = await row(sarah.id);
  assert.deepEqual([x.status, x.token_hash, x.public_id, x.build_id, x.claimed_at], ['pending', null, null, null, null]);
  assert.equal(mailer.sent.length, before);
  // With the opt-out already on record, the check comes first: no copy is ever minted.
  let mints = 0;
  const watchDb: Db = {
    query: (text, params) => {
      if (/update share_recipients r set/.test(text)) mints += 1;
      return db.query(text, params);
    },
    // The transaction's statements go through this wrapper too (wrapPglite hands fn the bare db).
    tx: (fn) => db.tx(() => fn(watchDb)),
  };
  await assert.rejects(approveReader({ ...deps, db: watchDb }, c, sarah.id), (e: unknown) => e instanceof ArcError && e.extra?.error === 'reader-suppressed');
  assert.equal(mints, 0, 'refused before mintCopy');
});

test('decline sends one email; revoke closes the copy', async () => {
  const { w, mid, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const priya = await addReader(campaign, { name: 'Priya', email: 'priya@example.com', status: 'pending' });
  const r = await w.c.post(`/api/arc/${campaign.id}/readers/${priya.id}/decline`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((r.body.reader as Reader).status, 'declined');
  assert.deepEqual(r.body.mail, { sent: true });
  const got = mailer.to('priya@example.com');
  assert.equal(got.length, 1);
  assert.equal(got[0].subject, 'Your request for The Lantern Coast');
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${priya.id}/decline`)).status, 409, 'declined once');
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${priya.id}/approve`)).status, 409, 'a decline is final');
  assert.equal(mailer.to('priya@example.com').length, 1, 'still one email');

  // A decline is never undone, even when the email cannot go.
  const omar = await addReader(campaign, { name: 'Omar', email: 'omar@example.com', status: 'pending' });
  mailer.refuse = true;
  try {
    const d = await w.c.post(`/api/arc/${campaign.id}/readers/${omar.id}/decline`);
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal((d.body.mail as { reason: string }).reason, 'refused');
  } finally {
    mailer.refuse = false;
  }
  assert.equal((await row(omar.id)).status, 'declined');
  // A transport that throws after the decline committed: still 200, the decline kept, the outcome says so.
  const zed = await addReader(campaign, { name: 'Zed', email: 'zed@example.com', status: 'pending' });
  mailer.explode = true;
  try {
    const d = await w.c.post(`/api/arc/${campaign.id}/readers/${zed.id}/decline`);
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal((d.body.reader as Reader).status, 'declined');
    assert.equal((d.body.mail as { sent: boolean }).sent, false);
    assert.equal((d.body.mail as { reason: string }).reason, 'refused');
    assert.match((d.body.mail as { detail: string }).detail, /the test transport blew up/);
  } finally {
    mailer.explode = false;
  }
  assert.equal((await row(zed.id)).status, 'declined');

  // Revoke ("Close this copy"): the claimed reader's link answers 410, and no mail goes.
  const tom = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 200);
  const held = async () => ((await w.c.get(`/api/arc?manuscriptId=${mid}`)).body.campaign as Campaign);
  assert.equal((await held()).build.holders, 1);
  const before = mailer.sent.length;
  const v = await w.c.post(`/api/arc/${campaign.id}/readers/${tom.id}/revoke`);
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const revokedAt = (v.body.reader as Reader).revokedAt;
  assert.ok(revokedAt);
  assert.equal((v.body.reader as Reader).status, 'claimed');
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 410);
  assert.equal(mailer.sent.length, before, 'revoke sends nothing');
  // Decided in Task 5: a closed copy still counts toward the cap, but nobody holds the build through it.
  const after = await held();
  assert.equal(after.build.holders, 0);
  assert.equal(after.counts.revoked, 1);
  assert.equal(after.counts.claimed, 1);
  // Again: the same close time (idempotent); approve cannot reopen it (F9: revoked_at is never cleared).
  const again = await w.c.post(`/api/arc/${campaign.id}/readers/${tom.id}/revoke`);
  assert.equal(again.status, 200);
  assert.equal((again.body.reader as Reader).revokedAt, revokedAt);
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${tom.id}/approve`)).status, 409);
  assert.notEqual((await row(tom.id)).revoked_at, null);
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 410);
  // Only a copy can be closed.
  const ann = await addReader(campaign, { name: 'Ann', email: 'ann@example.com', status: 'pending' });
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${ann.id}/revoke`)).status, 409);
  const camp = await w.c.get(`/api/arc/${campaign.id}/readers`);
  assert.equal((camp.body.readers as Reader[]).find((x) => x.id === tom.id)!.revokedAt, revokedAt);
});

test('approve takes the last copy only while it is free and the campaign is open (one conditional update, F8)', async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval', maxClaims: 2 });
  await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  const sarah = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  // A cap below what is counted can only come from outside the API (updateCampaign refuses it):
  // the UPDATE's own condition is the judge.
  await db.query('update arc_campaigns set max_claims = 1 where id = $1', [campaign.id]);
  const before = mailer.sent.length;
  const full = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
  assert.equal(full.status, 409, JSON.stringify(full.body));
  assert.match(String(full.body.error), /cap|copies/i);
  assert.equal((await row(sarah.id)).status, 'pending');
  assert.equal(mailer.sent.length, before);
  await db.query('update arc_campaigns set max_claims = 2 where id = $1', [campaign.id]);
  // Past the closing time, or closed by the author: no new copies (decided by this task).
  const saved = clock;
  try {
    clock = new Date(new Date(campaign.closesAt).getTime() + 1000);
    const late = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
    assert.equal(late.status, 409, JSON.stringify(late.body));
  } finally {
    clock = saved;
  }
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/close`)).status, 200);
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`)).status, 409);
  assert.equal((await row(sarah.id)).status, 'pending');
  // A waiting reader can still be told no after the close.
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/decline`)).status, 200);
});

// mintCopy is also Task 6's (an unverified reader's instant claim, a claimed reader's
// new link): the cap and the closed-copy rule live in its one UPDATE.
test('mintCopy: a new link stops the old one; never past the cap; never a closed copy (F8, F9)', async () => {
  const { campaign } = await campaignOn(arcOn.base, { maxClaims: 2 });
  const tom = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  const fresh = await mintCopy(db, campaign.id, tom.id, clock);
  assert.equal((await row(tom.id)).token_hash, sha256(fresh));
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 404, 'the old link stops');
  assert.equal((await page(arcOn.base, `/read/${fresh}`)).status, 200);
  const ann = await addReader(campaign, { name: 'Ann', email: 'ann@example.com', status: 'unverified' });
  await mintCopy(db, campaign.id, ann.id, clock);
  assert.equal((await row(ann.id)).status, 'claimed', 'the second of two copies');
  const bo = await addReader(campaign, { name: 'Bo', email: 'bo@example.com', status: 'unverified' });
  await assert.rejects(mintCopy(db, campaign.id, bo.id, clock), (e: unknown) => e instanceof ArcError && e.status === 409 && e.extra?.full === true);
  assert.equal((await row(bo.id)).status, 'unverified');
  await db.query('update share_recipients set revoked_at = $2 where id = $1', [tom.id, clock.toISOString()]);
  const closed = await row(tom.id);
  await assert.rejects(mintCopy(db, campaign.id, tom.id, clock), (e: unknown) => e instanceof ArcError && e.status === 409 && e.extra?.revoked === true);
  const still = await row(tom.id);
  assert.equal(still.token_hash, closed.token_hash, 'the closed link was not replaced');
  assert.notEqual(still.revoked_at, null, 'revoked_at is never cleared');
  await assert.rejects(mintCopy(db, campaign.id, randomUUID(), clock), (e: unknown) => e instanceof ArcError && e.status === 404);
});

// The cap's boundary: a waiting reader is already counted, so approving them takes no extra
// slot (the `x.id <> r.id` in mintCopy's count). Max 2, one claimed, one waiting → 200.
test('approving the last waiting reader fills the cap exactly', async () => {
  const { w, mid, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval', maxClaims: 2 });
  await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  const sarah = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  const r = await w.c.post(`/api/arc/${campaign.id}/readers/${sarah.id}/approve`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await row(sarah.id)).status, 'claimed');
  const seen = (await w.c.get(`/api/arc?manuscriptId=${mid}`)).body.campaign as Campaign;
  assert.deepEqual([seen.counts.claimed, seen.counts.pending, seen.maxClaims], [2, 0, 2]);
});

test('the cap cannot go below what is counted, nor above 50', async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  await addReader(campaign, { name: 'Priya', email: 'priya@example.com', status: 'declined' });
  await addReader(campaign, { name: 'Ghost', email: 'ghost@example.com', status: 'unverified' });
  const put = (body: unknown) => w.c.put(`/api/arc/${campaign.id}`, body);
  for (const [why, body] of [
    ['below the 2 counted', { maxClaims: 1 }],
    ['above 50', { maxClaims: 51 }],
    ['zero', { maxClaims: 0 }],
    ['not whole', { maxClaims: 2.5 }],
    ['closesAt in the past', { closesAt: new Date(clock.getTime() - DAY).toISOString() }],
    ['closesAt over 400 days', { closesAt: new Date(clock.getTime() + 401 * DAY).toISOString() }],
    ['closesAt without an offset', { closesAt: '2027-01-01T00:00' }],
    ['nothing to change', {}],
  ] as Array<[string, Record<string, unknown>]>) {
    const r = await put(body);
    assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.body)}`);
    assert.ok(typeof r.body.error === 'string' && r.body.error.length > 10, `${why}: words`);
  }
  assert.equal((await db.query<{ max_claims: number }>('select max_claims from arc_campaigns where id = $1', [campaign.id])).rows[0].max_claims, 50);
  const two = await put({ maxClaims: 2 });
  assert.equal(two.status, 200, JSON.stringify(two.body));
  assert.equal((two.body.campaign as Campaign).maxClaims, 2);
  const closes = new Date(clock.getTime() + 60 * DAY);
  const later = await put({ closesAt: closes.toISOString(), maxClaims: 50 });
  assert.equal(later.status, 200, JSON.stringify(later.body));
  assert.equal((later.body.campaign as Campaign).closesAt, closes.toISOString());
  assert.equal((later.body.campaign as Campaign).maxClaims, 50);
  // Once ended, nothing changes.
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/close`)).status, 200);
  assert.equal((await put({ maxClaims: 10 })).status, 409);
});

test('a new signup link replaces the old one', async () => {
  const { w, campaign, signupToken } = await campaignOn(arcOn.base);
  const hashOf = async () =>
    (await db.query<{ signup_token_hash: string }>('select signup_token_hash from arc_campaigns where id = $1', [campaign.id])).rows[0].signup_token_hash;
  assert.equal(await hashOf(), sha256(signupToken));
  const r = await w.c.post(`/api/arc/${campaign.id}/signup-link`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const fresh = r.body.signupToken as string;
  assert.match(fresh, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(fresh, signupToken);
  assert.equal(r.body.signupUrl, `${arcOn.config.appBaseUrl}/arc/${fresh}`);
  const h = await hashOf();
  assert.equal(h, sha256(fresh));
  assert.notEqual(h, sha256(signupToken));
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/close`)).status, 200);
  const ended = await w.c.post(`/api/arc/${campaign.id}/signup-link`);
  assert.equal(ended.status, 409, JSON.stringify(ended.body));
  assert.equal(await hashOf(), sha256(fresh), 'unchanged once ended');
});

test('closing the campaign leaves existing copies working, and the book can start the next one (F13, F10)', async () => {
  const { w, mid, campaign } = await campaignOn(arcOn.base);
  const tom = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  const r = await w.c.post(`/api/arc/${campaign.id}/close`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ended = r.body.campaign as Campaign;
  assert.equal(ended.state, 'ended');
  assert.equal(ended.endedAt, clock.toISOString());
  const saved = clock;
  try {
    clock = new Date(clock.getTime() + 60_000);
    const again = await w.c.post(`/api/arc/${campaign.id}/close`);
    assert.equal(again.status, 200);
    assert.equal((again.body.campaign as Campaign).endedAt, ended.endedAt, 'the first close time stays');
  } finally {
    clock = saved;
  }
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 200, "the reader's copy still opens");
  const next = await start(w.c, mid);
  assert.notEqual(next.campaign.id, campaign.id);
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 200, 'and still opens under the next campaign');
  const shown = await w.c.get(`/api/arc?manuscriptId=${mid}`);
  assert.equal((shown.body.campaign as Campaign).id, next.campaign.id);
});

test('deleting the campaign removes its share and readers, never the suppressions', async () => {
  const { w, mid, campaign } = await campaignOn(arcOn.base);
  const tom = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  await db.query(`insert into arc_events (campaign_id, recipient_id, kind) values ($1, $2, 'ready_sent')`, [campaign.id, tom.id]);
  await suppress(db, arcOn.config, 'tom@example.com', 'all');
  await suppress(db, arcOn.config, 'sarah@example.com', { ownerId: w.id });
  const suppressions = await count('mail_suppressions');
  const r = await w.c.delete(`/api/arc/${campaign.id}`);
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.equal(await count('arc_campaigns where id = $1', [campaign.id]), 0);
  assert.equal(await count('arc_builds where campaign_id = $1', [campaign.id]), 0);
  assert.equal(await count('arc_events where campaign_id = $1', [campaign.id]), 0);
  assert.equal(await count('shares where id = $1', [campaign.shareId]), 0);
  assert.equal(await count('share_recipients where share_id = $1', [campaign.shareId]), 0);
  assert.equal(await count(`share_recipients where email in ('tom@example.com', 'sarah@example.com') and share_id = $1`, [campaign.shareId]), 0);
  assert.equal(await count('mail_suppressions'), suppressions, 'opt-outs outlive the campaign');
  assert.equal(await count('manuscripts where id = $1', [mid]), 1, 'the book stays');
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 404);
  assert.equal((await w.c.delete(`/api/arc/${campaign.id}`)).status, 404);
  await start(w.c, mid);
});

test('deleting the book deletes its campaign; its beta share stays, detached', async () => {
  const { w, mid, campaign } = await campaignOn(arcOn.base);
  const beta = await w.c.post('/api/shares', { manuscriptId: mid });
  assert.equal(beta.status, 201, JSON.stringify(beta.body));
  const betaId = (beta.body.share as { id: string }).id;
  const tom = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  await db.query(`insert into arc_events (campaign_id, recipient_id, kind) values ($1, $2, 'ready_sent')`, [campaign.id, tom.id]);
  // Another writer cannot delete it, and their attempt touches nothing.
  const stranger = await writer(arcOn.base);
  assert.equal((await stranger.c.delete(`/api/manuscripts/${mid}`)).status, 404);
  assert.equal(await count('arc_campaigns where id = $1', [campaign.id]), 1);
  const r = await w.c.delete(`/api/manuscripts/${mid}`);
  assert.equal(r.status, 204, JSON.stringify(r.body));
  assert.equal(await count('manuscripts where id = $1', [mid]), 0);
  assert.equal(await count('arc_campaigns where manuscript_id = $1 or id = $2', [mid, campaign.id]), 0);
  assert.equal(await count('arc_builds where campaign_id = $1', [campaign.id]), 0);
  assert.equal(await count('arc_events where campaign_id = $1', [campaign.id]), 0);
  assert.equal(await count('shares where id = $1', [campaign.shareId]), 0, 'no campaign share');
  assert.equal(await count('share_recipients where share_id = $1', [campaign.shareId]), 0, 'readers gone');
  const b = (await db.query<{ manuscript_id: string | null }>('select manuscript_id from shares where id = $1', [betaId])).rows[0];
  assert.ok(b, 'the beta share stays');
  assert.equal(b.manuscript_id, null, 'detached');
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 404);
});

test('a paused author can still approve, decline, revoke, close, change, rotate and delete', async () => {
  const w = await writer(paid.base);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() + 7 * DAY)]);
  const mid = await newManuscript(w.c);
  const { campaign } = await start(w.c, mid, { approvalMode: 'approval' });
  const a = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  const b = await addReader(campaign, { name: 'Priya', email: 'priya@example.com', status: 'pending' });
  const c = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() - DAY)]);
  assert.equal((await w.c.post('/api/manuscripts', { doc: studioDoc })).status, 402, 'the account is paused');
  const steps: Array<[string, string, unknown, number]> = [
    ['GET', `/api/arc/${campaign.id}/readers`, undefined, 200],
    ['POST', `/api/arc/${campaign.id}/readers/${a.id}/approve`, undefined, 200],
    ['POST', `/api/arc/${campaign.id}/readers/${b.id}/decline`, undefined, 200],
    ['POST', `/api/arc/${campaign.id}/readers/${c.id}/revoke`, undefined, 200],
    ['PUT', `/api/arc/${campaign.id}`, { maxClaims: 10 }, 200],
    ['POST', `/api/arc/${campaign.id}/signup-link`, undefined, 200],
    ['POST', `/api/arc/${campaign.id}/close`, undefined, 200],
    ['DELETE', `/api/arc/${campaign.id}`, undefined, 204],
  ];
  for (const [method, p, body, want] of steps) {
    const r = await w.c.request(method, p, body);
    assert.equal(r.status, want, `${method} ${p}: ${JSON.stringify(r.body)}`);
  }
  assert.equal(paidMailer.to('sarah@example.com').length, 1, 'the approval went out');
  for (const [method, p] of [
    ['GET', '/api/arc/:id/readers'],
    ['POST', '/api/arc/:id/readers/:rid/approve'],
    ['POST', '/api/arc/:id/readers/:rid/decline'],
    ['POST', '/api/arc/:id/readers/:rid/revoke'],
    ['POST', '/api/arc/:id/close'],
    ['PUT', '/api/arc/:id'],
    ['POST', '/api/arc/:id/signup-link'],
    ['DELETE', '/api/arc/:id'],
  ]) {
    assert.ok(NEVER_PAUSED.some((r) => r.method === method && r.path === p), `${method} ${p} is in NEVER_PAUSED`);
  }
});

test("Download all my data carries the campaign with its readers' emails", async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'claimed' });
  await addReader(campaign, { name: 'Ghost', email: 'ghost@example.com', status: 'unverified' });
  await addReader(campaign, { name: 'Priya', email: 'priya@example.com', status: 'pending', profile: 'https://example.com/priya' });
  const mid = (await db.query<{ manuscript_id: string }>('select manuscript_id from arc_campaigns where id = $1', [campaign.id])).rows[0].manuscript_id;
  const beta = await w.c.post('/api/shares', { manuscriptId: mid });
  assert.equal(beta.status, 201);
  const betaId = (beta.body.share as { id: string }).id;
  const res = await w.c.download('/api/account/export');
  assert.equal(res.status, 200);
  const entries = readZip(res.bytes);
  const name = `shares/The Lantern Coast (${campaign.shareId.slice(0, 8)}).json`;
  const entry = entries.find((e) => e.name === name);
  assert.ok(entry, `${name} in ${entries.map((e) => e.name).join(', ')}`);
  const share = JSON.parse(entry.data.toString('utf8'));
  assert.equal(share.arc.readers[0].email, 'sarah@example.com');
  assert.equal(share.arc.readers[0].name, 'Sarah');
  assert.equal(share.arc.readers[0].status, 'claimed');
  assert.equal(share.arc.readers[1].email, 'priya@example.com');
  assert.equal(share.arc.readers[1].profileLink, 'https://example.com/priya');
  assert.equal(share.arc.readers.length, 2, 'never an unconfirmed request');
  assert.equal(JSON.stringify(share).includes('ghost@example.com'), false);
  assert.equal(share.arc.campaign.id, campaign.id);
  assert.equal(share.arc.campaign.approvalMode, 'approval');
  assert.equal(share.arc.campaign.maxClaims, 50);
  assert.deepEqual(share.recipients, [], 'ARC readers are listed once, in the arc block');
  assert.equal(JSON.stringify(share).includes('token'), false, 'no token or token hash');
  // A beta share's file has no arc block.
  const betaEntry = entries.find((e) => e.name === `shares/The Lantern Coast (${betaId.slice(0, 8)}).json`);
  assert.ok(betaEntry);
  assert.equal('arc' in JSON.parse(betaEntry.data.toString('utf8')), false);
  const readme = entries.find((e) => e.name === 'README.txt')!.data.toString('utf8');
  assert.match(readme, /readers' names and email addresses/);
});

test('another writer gets 404 for every route', async () => {
  const { w, campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const sarah = await addReader(campaign, { name: 'Sarah', email: 'sarah@example.com', status: 'pending' });
  const tom = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  const stranger = await writer(arcOn.base);
  const routes: Array<[string, string, unknown?]> = [
    ['GET', `/api/arc/${campaign.id}/readers`],
    ['POST', `/api/arc/${campaign.id}/readers/${sarah.id}/approve`],
    ['POST', `/api/arc/${campaign.id}/readers/${sarah.id}/decline`],
    ['POST', `/api/arc/${campaign.id}/readers/${tom.id}/revoke`],
    ['POST', `/api/arc/${campaign.id}/close`],
    ['PUT', `/api/arc/${campaign.id}`, { maxClaims: 10 }],
    ['POST', `/api/arc/${campaign.id}/signup-link`],
    ['DELETE', `/api/arc/${campaign.id}`],
  ];
  for (const [method, p, body] of routes) {
    const r = await stranger.c.request(method, p, body);
    assert.equal(r.status, 404, `${method} ${p}: ${JSON.stringify(r.body)}`);
  }
  for (const [method, p, body] of routes) {
    assert.equal((await new Client(arcOn.base).request(method, p, body)).status, 401, `${method} ${p} signed out`);
  }
  // Nothing moved.
  assert.equal((await row(sarah.id)).status, 'pending');
  assert.equal((await row(tom.id)).revoked_at, null);
  const c = (await db.query<{ ended_at: Date | null; max_claims: number }>('select ended_at, max_claims from arc_campaigns where id = $1', [campaign.id])).rows[0];
  assert.deepEqual(c, { ended_at: null, max_claims: 50 });
  // A reader of the owner's other campaign is not this campaign's reader; a bad id is not one either.
  const other = await start(w.c, await newManuscript(w.c), { approvalMode: 'approval' });
  const elsewhere = await addReader(other.campaign, { name: 'Ann', email: 'ann@example.com', status: 'pending' });
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${elsewhere.id}/approve`)).status, 404);
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/not-a-uuid/approve`)).status, 404);
  assert.equal((await w.c.post(`/api/arc/not-a-uuid/close`)).status, 404);
  assert.equal((await row(elsewhere.id)).status, 'pending');
  // An unverified reader is not shown, so it cannot be approved either.
  const ghost = await addReader(campaign, { name: 'Ghost', email: 'ghost@example.com', status: 'unverified' });
  assert.equal((await w.c.post(`/api/arc/${campaign.id}/readers/${ghost.id}/approve`)).status, 404);
});

test('/read opens only a claimed ARC reader whose copy is open (R4a)', async () => {
  const { campaign } = await campaignOn(arcOn.base, { approvalMode: 'approval' });
  const unknown = await page(arcOn.base, `/read/${randomBytes(24).toString('base64url')}`);
  assert.equal(unknown.status, 404);
  for (const status of ['unverified', 'pending', 'declined'] as const) {
    const r = await addReader(campaign, { name: `R-${status}`, email: `${status}@example.com`, status, withToken: true });
    const p = await page(arcOn.base, `/read/${r.token}`);
    assert.equal(p.status, 404, `${status}: as an unknown link`);
    assert.equal(noNonce(p.text), noNonce(unknown.text), `${status}: the very page an unknown link gets`);
    assert.equal((await page(arcOn.base, `/read/${r.token}/comments`)).status, 404, `${status}: comments`);
    const post = await fetch(`${arcOn.base}/read/${r.token}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sectionId: 'sec-one', body: 'hello', readerName: 'x' }),
    });
    assert.equal(post.status, 404, `${status}: no comment`);
  }
  const tom = await addReader(campaign, { name: 'Tom', email: 'tom@example.com', status: 'claimed' });
  const open = await page(arcOn.base, `/read/${tom.token}`);
  assert.equal(open.status, 200);
  assert.ok(open.text.includes('Shared with <bdi>Tom</bdi>'));
  assert.equal((await page(arcOn.base, `/read/${tom.token}/comments`)).status, 200);
  await db.query('update share_recipients set revoked_at = $2 where id = $1', [tom.id, clock.toISOString()]);
  assert.equal((await page(arcOn.base, `/read/${tom.token}`)).status, 410, 'revoked: as a closed link');
  assert.equal((await page(arcOn.base, `/read/${tom.token}/comments`)).status, 410);
});

// Task 4's review asked for this race. Over HTTP the EPUB queue takes one build per
// writer at a time, so the second request is refused before it reaches the index
// (429, OBSERVED on the first run). Two createCampaign calls on two queues both pass
// the running check and both build; the unique index lets exactly one through.
test('two starts for one book at once make exactly one campaign', async () => {
  const w = await writer(arcOn.base);
  const mid = await newManuscript(w.c);
  const [a, b] = await Promise.all([w.c.post('/api/arc', input(mid)), w.c.post('/api/arc', input(mid))]);
  const statuses = [a.status, b.status].sort();
  assert.equal(statuses[0], 201, `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`);
  assert.ok([409, 429].includes(statuses[1]), `${JSON.stringify(a.body)} / ${JSON.stringify(b.body)}`);
  assert.equal(await count('arc_campaigns where manuscript_id = $1', [mid]), 1);
  assert.equal(await count('shares where manuscript_id = $1', [mid]), 1);

  const mid2 = await newManuscript(w.c);
  const deps = (): ArcDeps => ({ db, config: arcOn.config, arcMailer: mailer, mailer, epubQueue: new EpubQueue(1, 4), now: () => clock });
  const parsed = parseCreateInput(input(mid2), clock);
  assert.ok(!(parsed instanceof ArcError));
  const both = await Promise.allSettled([createCampaign(deps(), w.id, parsed), createCampaign(deps(), w.id, parsed)]);
  assert.deepEqual(both.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
  const lost = both.find((x) => x.status === 'rejected') as PromiseRejectedResult;
  assert.ok(lost.reason instanceof ArcError, String(lost.reason));
  assert.equal(lost.reason.status, 409);
  assert.equal(lost.reason.message, 'This book already has an ARC running. Close it before starting another.');
  assert.equal(await count('arc_campaigns where manuscript_id = $1', [mid2]), 1);
  assert.equal(await count('shares where manuscript_id = $1', [mid2]), 1, 'the loser left no share behind');
  assert.equal(await count('arc_builds b join arc_campaigns c on c.id = b.campaign_id where c.manuscript_id = $1', [mid2]), 1);
});
