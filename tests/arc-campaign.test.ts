import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { pausedBody } from '../src/access.js';
import { blurbOf, coverOf, campaignState, parseCreateInput, ArcError, type CampaignRow } from '../src/arc/campaigns.js';
import type { Db } from '../src/db.js';
import { readZip } from '../src/housekeeping/packages.js';
import type { MailMessage, Mailer, MailerStatus, MailResult } from '../src/mailer.js';
import { PIC_REF_PREFIX } from '../src/pictures.js';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';

/*
 * ARC slice 1, Task 4: starting a campaign. A campaign is a NEW share with
 * no open link, an arc_campaigns row and one built version (the server EPUB
 * build, once). Creating one is gated as shares.create; campaign shares stay
 * out of the beta share list and refuse the beta actions.
 */

/** A salt of exactly 32 characters (ARC_SALT_MIN_LENGTH), as tests/arc-mail.test.ts. */
const SALT = 'salt-4-0123456789abcdef-0123456x';
const ARC = { mailFrom: 'Beuk readers <readers@beuk.studio>', smtpUrl: 'smtp://u:p@127.0.0.1:9', suppressionSalt: SALT };
const ON = {
  stripeWebhookSecret: 'whsec_test_placeholder_not_a_real_key',
  stripeSecretKey: 'sk_test_placeholder_not_a_real_key',
  stripePriceId: 'price_fixture_one',
  // Never called: the pause is decided from the database alone.
  stripeApiBase: 'http://127.0.0.1:9',
};
const DAY = 86_400_000;
const REFUSED = 'This copy belongs to an ARC. Manage it in the ARC panel.';

/** A configured ARC mailer that records instead of sending (no mail goes in this task). */
class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  status(): MailerStatus {
    return { configured: true, transport: 'smtp', from: ARC.mailFrom, detail: 'recording mailer (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return { delivered: true, messageId: '<arc-test@example.com>' };
  }
  async verify() {
    return { ok: true, detail: 'recording mailer (test)' };
  }
}

// A 1×1 transparent PNG.
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// The studio doc of tests/share-recipients.test.ts, plus a copyright section.
const studioDoc = {
  meta: { title: 'The Lantern Coast', author: 'A. Writer', language: 'en' },
  sections: [
    { id: 'sec-cover', kind: 'front', type: 'cover', title: 'Cover', content: '' },
    { id: 'sec-copy', kind: 'front', type: 'copyright', title: 'Copyright', content: 'Copyright © A. Writer. All rights reserved.' },
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

let db: Db;
let arcOn: TestServer;
let arcOff: TestServer;
let paid: TestServer; // billing on + ARC mail: the day-22 pause is real here
let clock = new Date();
let seq = 0;

before(async () => {
  db = await createTestDb();
  arcOn = await startTestServer(db, () => clock, { arc: ARC }, undefined, { arcMailer: new RecordingMailer() });
  arcOff = await startTestServer(db, () => clock);
  paid = await startTestServer(db, () => clock, { ...ON, arc: ARC }, undefined, { arcMailer: new RecordingMailer() });
});

after(async () => {
  await arcOn.close();
  await arcOff.close();
  await paid.close();
});

const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

async function writer(base: string): Promise<{ c: Client; id: string }> {
  const email = `arc-campaign-${++seq}@example.com`;
  const c = new Client(base);
  assert.equal((await registerUser(c, email)).status, 201);
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0]!.id;
  return { c, id };
}

async function newManuscript(c: Client, doc: unknown = studioDoc): Promise<string> {
  const r = await c.post('/api/manuscripts', { doc });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return (r.body.manuscript as { id: string }).id;
}

/** A body the server accepts: closes in 30 days, launches the day after. */
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
  manuscriptId: string;
  title: string;
  launchDate: string;
  closesAt: string;
  tz: string;
  maxClaims: number;
  approvalMode: string;
  state: string;
  createdAt: string;
  endedAt: string | null;
  counts: { claimed: number; pending: number; declined: number; revoked: number };
  build: { label: string; bytes: number; holders: number };
};

async function start(c: Client, mid: string, extra: Record<string, unknown> = {}) {
  const r = await c.post('/api/arc', input(mid, extra));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { campaign: Campaign; signupToken: string; signupUrl: string };
}

const count = async (sql: string, params: unknown[] = []) =>
  Number((await db.query<{ n: string }>(`select count(*)::text as n from ${sql}`, params)).rows[0].n);

test('without ARC mail a campaign is refused and nothing is stored', async () => {
  const w = await writer(arcOff.base);
  const mid = await newManuscript(w.c);
  const r = await w.c.post('/api/arc', input(mid));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal((r.body.mail as { reason: string }).reason, 'ARC_MAIL_FROM is not set');
  assert.equal(typeof r.body.error, 'string');
  assert.equal(await count('arc_campaigns'), 0);
  assert.equal(await count('arc_builds'), 0);
  assert.equal(await count('shares where owner_id = $1', [w.id]), 0);
});

test('a campaign is a new share with no open link, a campaign row and one built version', async () => {
  const w = await writer(arcOn.base);
  const mid = await newManuscript(w.c);
  const { campaign, signupToken, signupUrl } = await start(w.c, mid);
  assert.match(signupToken, /^[A-Za-z0-9_-]{32}$/);
  assert.equal(signupUrl, `${arcOn.config.appBaseUrl}/arc/${signupToken}`);

  const share = (
    await db.query<{ token_hash: string | null; open_link_closed_at: Date | null; manuscript_id: string; owner_id: string; allow_comments: boolean; reader_name_required: boolean; title: string; expires_at: Date | null; revoked_at: Date | null }>(
      'select token_hash, open_link_closed_at, manuscript_id, owner_id, allow_comments, reader_name_required, title, expires_at, revoked_at from shares where id = $1',
      [campaign.shareId],
    )
  ).rows[0];
  assert.ok(share, 'the campaign has its own share');
  assert.equal(share.token_hash, null, 'no open link');
  assert.notEqual(share.open_link_closed_at, null);
  assert.equal(share.manuscript_id, mid);
  assert.equal(share.owner_id, w.id);
  assert.equal(share.allow_comments, true);
  assert.equal(share.reader_name_required, true);
  assert.equal(share.title, 'The Lantern Coast');
  assert.equal(share.expires_at, null);
  assert.equal(share.revoked_at, null);

  const row = (await db.query<{ signup_token_hash: string; max_claims: number; approval_mode: string; tz: string }>(
    'select signup_token_hash, max_claims, approval_mode, tz from arc_campaigns where id = $1',
    [campaign.id],
  )).rows[0];
  assert.equal(row.signup_token_hash, sha256(signupToken));
  assert.notEqual(row.signup_token_hash, signupToken, 'only the hash is stored');
  assert.equal(row.max_claims, 50);
  assert.equal(row.approval_mode, 'instant');
  assert.equal(row.tz, 'Europe/London');

  const builds = (await db.query<{ version_no: number; label: string; epub_base64: string; epub_sha256: string; epub_bytes: number; epub_filename: string; cover: unknown; blurb: string }>(
    'select version_no, label, epub_base64, epub_sha256, epub_bytes, epub_filename, cover, blurb from arc_builds where campaign_id = $1',
    [campaign.id],
  )).rows;
  assert.equal(builds.length, 1, 'built once');
  const b = builds[0];
  assert.equal(b.version_no, 1);
  assert.equal(b.label, 'v1.0');
  const bytes = Buffer.from(b.epub_base64, 'base64');
  assert.equal(b.epub_sha256, sha256(bytes));
  assert.equal(b.epub_bytes, bytes.length);
  const entries = readZip(bytes);
  assert.ok(entries.some((e) => e.name === 'mimetype'), 'a real EPUB package');
  assert.match(b.epub_filename, /-arc\.epub$/, b.epub_filename);
  assert.equal(b.cover, null, 'this book has no cover');
  assert.equal(b.blurb, '', 'this book has no description or wrap blurb');

  assert.equal(campaign.manuscriptId, mid);
  assert.equal(campaign.title, 'The Lantern Coast');
  assert.deepEqual(campaign.counts, { claimed: 0, pending: 0, declined: 0, revoked: 0 });
  assert.equal(campaign.state, 'open');
  assert.equal(campaign.maxClaims, 50);
  assert.equal(campaign.approvalMode, 'instant');
  assert.equal(campaign.endedAt, null);
  assert.deepEqual(campaign.build, { label: 'v1.0', bytes: bytes.length, holders: 0 });
  assert.equal(JSON.stringify(campaign).includes(signupToken), false, 'the campaign JSON never carries the token');
});

test('one running campaign per book', async () => {
  const w = await writer(arcOn.base);
  const mid = await newManuscript(w.c);
  await start(w.c, mid, { maxClaims: 12, approvalMode: 'approval' });
  const again = await w.c.post('/api/arc', input(mid));
  assert.equal(again.status, 409, JSON.stringify(again.body));
  assert.equal(await count('arc_campaigns where manuscript_id = $1', [mid]), 1);
  assert.equal(await count('shares where manuscript_id = $1', [mid]), 1, 'no second share was left behind');
  const other = await newManuscript(w.c);
  const second = await start(w.c, other);
  assert.equal(second.campaign.manuscriptId, other);
});

// Added by this task (the brief's step "after first setting ended_at = closes_at"):
// a campaign whose closing time has passed ends on the next start, and a new one runs.
test('a campaign past its closing time ends when the next one starts', async () => {
  const w = await writer(arcOn.base);
  const mid = await newManuscript(w.c);
  const first = await start(w.c, mid);
  const saved = clock;
  try {
    clock = new Date(new Date(first.campaign.closesAt).getTime() + DAY);
    const seen = await w.c.get(`/api/arc?manuscriptId=${mid}`);
    assert.equal((seen.body.campaign as Campaign).state, 'closed', 'past closes_at, not yet ended');
    const next = await start(w.c, mid);
    assert.notEqual(next.campaign.id, first.campaign.id);
    const old = (await db.query<{ ended_at: Date; closes_at: Date }>('select ended_at, closes_at from arc_campaigns where id = $1', [first.campaign.id])).rows[0];
    assert.equal(new Date(old.ended_at).toISOString(), new Date(old.closes_at).toISOString());
    const now = await w.c.get(`/api/arc?manuscriptId=${mid}`);
    assert.equal((now.body.campaign as Campaign).id, next.campaign.id, 'the running one is shown');
  } finally {
    clock = saved;
  }
});

test('bad input is refused with words', async () => {
  const w = await writer(arcOn.base);
  const mid = await newManuscript(w.c);
  const bad: Array<[string, Record<string, unknown>]> = [
    ['maxClaims 0', { maxClaims: 0 }],
    ['maxClaims 51', { maxClaims: 51 }],
    ['maxClaims 2.5', { maxClaims: 2.5 }],
    ['launchDate 2027-02-30', { launchDate: '2027-02-30' }],
    ['closesAt in the past', { closesAt: new Date(clock.getTime() - DAY).toISOString() }],
    ['closesAt over 400 days ahead', { closesAt: new Date(clock.getTime() + 401 * DAY).toISOString() }],
    ['closesAt not an instant', { closesAt: 'next tuesday' }],
    ['tz Mars/Base', { tz: 'Mars/Base' }],
    ['approvalMode', { approvalMode: 'lottery' }],
    ['manuscriptId', { manuscriptId: 'not-a-uuid' }],
  ];
  for (const [why, extra] of bad) {
    const r = await w.c.post('/api/arc', input(mid, extra));
    assert.equal(r.status, 400, `${why}: ${JSON.stringify(r.body)}`);
    assert.ok(typeof r.body.error === 'string' && r.body.error.length > 10, `${why}: words`);
  }
  assert.equal(await count('arc_campaigns where manuscript_id = $1', [mid]), 0);
  // Another writer's book (or none) answers 404, as the share routes do.
  const stranger = await w.c.post('/api/arc', input(randomUUID()));
  assert.equal(stranger.status, 404);
});

test('parseCreateInput: the defaults and the edges', () => {
  const now = new Date('2026-12-01T12:00:00Z');
  const base = { manuscriptId: randomUUID(), launchDate: '2027-01-15', closesAt: '2027-01-14T00:00:00Z', tz: 'America/Los_Angeles' };
  const ok = parseCreateInput(base, now);
  assert.ok(!(ok instanceof ArcError), String(ok));
  assert.equal(ok.maxClaims, 50);
  assert.equal(ok.approvalMode, 'instant');
  assert.equal(ok.lang, 'en');
  assert.equal(ok.closesAt, '2027-01-14T00:00:00.000Z');
  const edge = parseCreateInput({ ...base, maxClaims: 1, closesAt: new Date(now.getTime() + 400 * DAY).toISOString(), lang: 'pt-BR' }, now);
  assert.ok(!(edge instanceof ArcError), String(edge));
  assert.equal(edge.maxClaims, 1);
  assert.equal(edge.lang, 'pt-BR');
  const r = parseCreateInput({ ...base, maxClaims: 50, approvalMode: 'approval' }, now);
  assert.ok(!(r instanceof ArcError));
  assert.equal(r.approvalMode, 'approval');
  for (const v of [null, 'x', [], 42]) {
    const e = parseCreateInput(v, now);
    assert.ok(e instanceof ArcError && e.status === 400, JSON.stringify(v));
  }
});

test('GET shows the mail status and the campaign, only to its owner', async () => {
  const alice = await writer(arcOn.base);
  const bob = await writer(arcOn.base);
  const mid = await newManuscript(alice.c);
  const none = await alice.c.get(`/api/arc?manuscriptId=${mid}`);
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { mail: { configured: true, reason: null }, campaign: null });
  const { campaign } = await start(alice.c, mid);
  const mine = await alice.c.get(`/api/arc?manuscriptId=${mid}`);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.campaign, campaign);
  const theirs = await bob.c.get(`/api/arc?manuscriptId=${mid}`);
  assert.equal(theirs.status, 200);
  assert.equal(theirs.body.campaign, null, "another writer never sees it");
  const off = await (await writer(arcOff.base)).c.get(`/api/arc?manuscriptId=${mid}`);
  assert.deepEqual(off.body.mail, { configured: false, reason: 'ARC_MAIL_FROM is not set' });
  assert.equal((await new Client(arcOn.base).get(`/api/arc?manuscriptId=${mid}`)).status, 401);
  assert.equal((await alice.c.get('/api/arc?manuscriptId=nope')).status, 400);
});

test('a paused account cannot start a campaign but still sees it', async () => {
  const w = await writer(paid.base);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() + 7 * DAY)]);
  const mid = await newManuscript(w.c);
  const other = await newManuscript(w.c);
  const { campaign } = await start(w.c, mid);
  await db.query('update users set trial_ends_at = $2 where id = $1', [w.id, new Date(clock.getTime() - DAY)]);
  const r = await w.c.post('/api/arc', input(other));
  assert.equal(r.status, 402);
  assert.deepEqual(r.body, pausedBody('shares.create'));
  assert.equal(await count('arc_campaigns where manuscript_id = $1', [other]), 0);
  const seen = await w.c.get(`/api/arc?manuscriptId=${mid}`);
  assert.equal(seen.status, 200);
  assert.equal((seen.body.campaign as Campaign).id, campaign.id);
});

test('the campaign share stays out of the beta share list and refuses beta actions', async () => {
  const w = await writer(arcOn.base);
  const mid = await newManuscript(w.c);
  const beta = await w.c.post('/api/shares', { manuscriptId: mid });
  assert.equal(beta.status, 201);
  const betaId = (beta.body.share as { id: string }).id;
  const { campaign } = await start(w.c, mid);
  const sid = campaign.shareId;

  const list = await w.c.get('/api/shares');
  assert.deepEqual((list.body.shares as Array<{ id: string }>).map((s) => s.id), [betaId]);
  const filtered = await w.c.get(`/api/shares?manuscriptId=${mid}`);
  assert.deepEqual((filtered.body.shares as Array<{ id: string }>).map((s) => s.id), [betaId]);

  const rid = randomUUID();
  const refused: Array<[string, string, unknown?]> = [
    ['POST', `/api/shares/${sid}/republish`],
    ['POST', `/api/shares/${sid}/revoke`],
    ['POST', `/api/shares/${sid}/close-open`],
    ['POST', `/api/shares/${sid}/readers`, { name: 'Priya' }],
    ['GET', `/api/shares/${sid}/readers`],
    ['PUT', `/api/shares/${sid}/readers/${rid}`, { expiresInDays: 3 }],
    ['POST', `/api/shares/${sid}/readers/${rid}/revoke`],
    // F6: an expiry here would end every ARC copy.
    ['PUT', `/api/shares/${sid}`, { expiresInDays: 1 }],
    ['DELETE', `/api/shares/${sid}`],
  ];
  for (const [method, path, body] of refused) {
    const r = await w.c.request(method, path, body);
    assert.equal(r.status, 409, `${method} ${path}: ${JSON.stringify(r.body)}`);
    assert.deepEqual(r.body, { error: REFUSED }, `${method} ${path}`);
  }
  const share = (await db.query<{ expires_at: Date | null; revoked_at: Date | null; title: string }>(
    'select expires_at, revoked_at, title from shares where id = $1',
    [sid],
  )).rows[0];
  assert.deepEqual(share, { expires_at: null, revoked_at: null, title: 'The Lantern Coast' }, 'nothing changed');
  assert.equal(await count('share_recipients where share_id = $1', [sid]), 0);

  // The comment routes stay as they are.
  assert.equal((await w.c.get(`/api/shares/${sid}/comments`)).status, 200);
  // Another writer still gets 404 (existence not leaked), never the 409.
  const stranger = await writer(arcOn.base);
  assert.equal((await stranger.c.post(`/api/shares/${sid}/revoke`)).status, 404);
  assert.equal((await stranger.c.put(`/api/shares/${sid}`, { expiresInDays: 1 })).status, 404);
  // The beta share keeps working.
  assert.equal((await w.c.post(`/api/shares/${betaId}/close-open`)).status, 200);
});

test('a book whose pictures are missing is refused as the EPUB route refuses it', async () => {
  const w = await writer(arcOn.base);
  const mid = await newManuscript(w.c);
  const gone = 'a'.repeat(64);
  const doc = { ...studioDoc, images: [{ id: 'img-chart', name: 'chart', mediaType: 'image/png', ext: 'png', data: PIC_REF_PREFIX + gone }] };
  // Straight into the row: the shelf would refuse to save a ref it does not hold.
  await db.query('update manuscripts set doc = $2 where id = $1', [mid, JSON.stringify(doc)]);
  const r = await w.c.post('/api/arc', input(mid));
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.deepEqual(r.body.missingPictures, [gone]);
  assert.match(String(r.body.error), /picture/);
  assert.equal(await count('arc_campaigns where manuscript_id = $1', [mid]), 0);
  assert.equal(await count('shares where manuscript_id = $1', [mid]), 0);
});

// Added by this task (ruling F5): the blurb falls back to coverRecipe.wrap.blurb; the cover is kept only as a picture type.
test('the blurb and the cover the build keeps', () => {
  assert.equal(blurbOf({ meta: { description: '  A tide story.  ' }, coverRecipe: { wrap: { blurb: 'Back cover.' } } }), 'A tide story.');
  assert.equal(blurbOf({ meta: { description: '   ' }, coverRecipe: { wrap: { blurb: ' Back cover. ' } } }), 'Back cover.');
  assert.equal(blurbOf({ meta: {}, coverRecipe: { blurb: 'not here' } }), '', 'coverRecipe.blurb is not the field (F5)');
  assert.equal(blurbOf({}), '');
  assert.equal([...blurbOf({ meta: { description: '😀'.repeat(2500) } })].length, 2000);
  assert.deepEqual(coverOf({ cover: { mediaType: 'image/png', data: PNG_1PX, ext: 'png', name: 'c' } }), { mediaType: 'image/png', data: PNG_1PX });
  assert.equal(coverOf({ cover: { mediaType: 'image/svg+xml', data: PNG_1PX } }), null);
  assert.equal(coverOf({ cover: null }), null);
  assert.equal(coverOf({}), null);
});

test('campaignState: ended, then closed, else open', () => {
  const row = { closes_at: '2027-01-14T00:00:00.000Z', ended_at: null } as unknown as CampaignRow;
  assert.equal(campaignState(row, new Date('2027-01-13T23:59:59Z')), 'open');
  assert.equal(campaignState(row, new Date('2027-01-14T00:00:00Z')), 'closed');
  assert.equal(campaignState({ ...row, ended_at: '2027-01-01T00:00:00.000Z' }, new Date('2026-12-01T00:00:00Z')), 'ended');
});
