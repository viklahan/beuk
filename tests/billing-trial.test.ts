import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { ACCESS_RULES, decideAccess, NEVER_PAUSED, PAUSABLE_FEATURES, pausedBody, trialFor } from '../src/access.js';
import { cancelBillingForDeletedAccount } from '../src/account/plan.js';
import { StripeBillingProvider, type BillingProvider } from '../src/billing.js';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db.js';
import { decideEntitlements, type EntitlementState } from '../src/entitlements.js';
import type { MailMessage, MailResult, Mailer, MailerStatus } from '../src/mailer.js';
import { readZip } from '../src/housekeeping/packages.js';
import { TrialReminders } from '../src/trial-mail.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { Client, createTestDb, registerUser, testConfig } from './helpers.js';

/*
 * Trial + one price (V, 2026-10-26). Every Stripe call here goes to a
 * local FAKE Stripe API; keys, ids and the price label are placeholders,
 * not V's (the price is not decided). Subscription state is written
 * straight into billing_subscriptions, the table verified webhooks fill
 * (tests/billing.test.ts covers the webhook path itself).
 */

const WEBHOOK_SECRET = 'whsec_test_placeholder_not_a_real_key';
const TEST_KEY = 'sk_test_placeholder_not_a_real_key';
const PRICE = 'price_fixture_one';
const DAY = 86_400_000;
const PASSWORD = 'correct horse battery';
/** Old promises the copy must never make again (V, 2026-10-30). */
const COPY_BANNED = /every export|export(s)? (always|still) (stay|work)|export is always open|no account|7-day|free week/i;

/* ---------------- fake Stripe API ---------------- */

const fake = {
  checkout: [] as URLSearchParams[],
  portal: [] as URLSearchParams[],
  cancels: [] as string[],
  failCancel: false,
};
let fakeServer: Server;
let fakeBase = '';

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

/* ---------------- app servers ---------------- */

class RecordingMailer implements Mailer {
  sent: MailMessage[] = [];
  configured = true;
  refuse = false;
  status(): MailerStatus {
    return this.configured
      ? { configured: true, transport: 'smtp', from: 'beuk@example.com', detail: 'recording mailer (test)' }
      : { configured: false, transport: 'none', from: null, detail: 'email not configured (test)' };
  }
  async send(message: MailMessage): Promise<MailResult> {
    if (!this.configured) return { delivered: false, reason: 'email not configured (test)', loggedToConsole: false };
    if (this.refuse) return { delivered: false, reason: 'refused (test)', loggedToConsole: false };
    this.sent.push(message);
    return { delivered: true, messageId: `<t-${this.sent.length}@example.com>` };
  }
  async verify() {
    return { ok: this.configured, detail: 'test' };
  }
}

interface Srv {
  base: string;
  config: Config;
  reminders: TrialReminders;
  close: () => Promise<void>;
}

let db: Db;
let clock = new Date('2026-11-10T12:00:00Z');
const now = () => clock;
const mailer = new RecordingMailer();
let off: Srv; // no Stripe keys: billing off
let on: Srv; // test-mode keys + price: billing on
let priced: Srv; // billing on, with a price label and Stripe Tax

async function start(overrides: Partial<Config>, billing?: BillingProvider): Promise<Srv> {
  const config = testConfig(overrides);
  const app = buildApp({ db, config, now, mailer, billing });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('no address');
  return {
    base: `http://127.0.0.1:${address.port}`,
    config,
    reminders: app.locals.trialReminders as TrialReminders,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const ON = {
  stripeWebhookSecret: WEBHOOK_SECRET,
  stripeSecretKey: TEST_KEY,
  stripePriceId: PRICE,
  stripeApiBase: '',
};

before(async () => {
  fakeServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${TEST_KEY}`) return send(401, { error: { type: 'invalid_request_error' } });
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      fake.checkout.push(new URLSearchParams(await readBody(req)));
      return send(200, { id: `cs_${fake.checkout.length}`, url: `https://checkout.example/${fake.checkout.length}` });
    }
    if (req.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') {
      fake.portal.push(new URLSearchParams(await readBody(req)));
      return send(200, { id: `bps_${fake.portal.length}`, url: `https://portal.example/${fake.portal.length}` });
    }
    const sub = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (req.method === 'DELETE' && sub) {
      fake.cancels.push(`${decodeURIComponent(sub[1])}${url.search}`);
      if (fake.failCancel) return send(500, { error: { type: 'api_error' } });
      return send(200, { id: decodeURIComponent(sub[1]), object: 'subscription', status: 'canceled' });
    }
    return send(404, { error: { type: 'invalid_request_error' } });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = fakeServer.address();
  if (!addr || typeof addr === 'string') throw new Error('no fake address');
  fakeBase = `http://127.0.0.1:${addr.port}`;

  db = await createTestDb();
  off = await start({});
  on = await start({ ...ON, stripeApiBase: fakeBase });
  priced = await start({ ...ON, stripeApiBase: fakeBase, billingPriceLabel: 'PLACEHOLDER-LABEL', billingAutomaticTax: true });
});

after(async () => {
  await off.close();
  await on.close();
  await priced.close();
  await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
});

/* ---------------- helpers ---------------- */

let seq = 0;
/** A signed-in writer. Sign-up stamps the trial from the database's
 *  real clock; the tests run on a fixed clock, so the trial is then set
 *  to a fresh week on that clock (pass keepStamp to see the real stamp). */
async function writer(base: string, label = 'w', keepStamp = false): Promise<{ c: Client; id: string; email: string }> {
  const email = `${label}-${++seq}@example.com`;
  const c = new Client(base);
  const r = await registerUser(c, email, PASSWORD);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = (await db.query<{ id: string }>('select id from users where email = $1', [email])).rows[0].id;
  if (!keepStamp) await setTrialEnd(id, new Date(clock.getTime() + 7 * DAY));
  return { c, id, email };
}

async function setTrialEnd(userId: string, at: Date): Promise<void> {
  await db.query('update users set trial_ends_at = $2 where id = $1', [userId, at]);
}

async function addSub(userId: string, id: string, status: string, since: Date = clock): Promise<void> {
  await db.query(
    `insert into billing_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, status_since, price_ids, livemode)
     values ($1, $2, $3, $4, $5, $6, false)`,
    [id, userId, `cus_${userId.slice(0, 8)}`, status, since, [PRICE]],
  );
  await db.query('update users set stripe_customer_id = $2 where id = $1 and stripe_customer_id is null', [userId, `cus_${userId.slice(0, 8)}`]);
}

async function page(c: Client, base: string, p: string): Promise<string> {
  const cookie = (c as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();
  return (await fetch(base + p, { headers: cookie })).text();
}

const DOC = {
  meta: { title: 'The Salt Road', author: 'A. Writer', language: 'en' },
  sections: [{ id: 'ch1', kind: 'body', type: 'chapter', title: 'One', content: 'The tide came in at noon.' }],
  images: [],
};

/** A shelf book, an archived EPUB and a reading link, made while open. */
async function makeWork(c: Client): Promise<{ mid: string; exportId: string; shareId: string; token: string }> {
  const m = await c.post('/api/manuscripts', { doc: DOC });
  assert.equal(m.status, 201, JSON.stringify(m.body));
  const mid = (m.body.manuscript as { id: string }).id;
  const x = await c.upload(`/api/exports?manuscriptId=${mid}&format=epub&filename=salt.epub`, Buffer.from('PK fixture'));
  assert.equal(x.status, 201, JSON.stringify(x.body));
  const s = await c.post('/api/shares', { manuscriptId: mid });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  return {
    mid,
    exportId: (x.body.export as { id: string }).id,
    shareId: (s.body.share as { id: string }).id,
    token: s.body.token as string,
  };
}

/** Calls every gated route once; returns route → status. */
async function gatedStatuses(c: Client, work: { mid: string; exportId: string; shareId: string }): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  out['POST /api/manuscripts'] = (await c.post('/api/manuscripts', { doc: DOC })).status;
  out['POST /api/shares'] = (await c.post('/api/shares', { manuscriptId: work.mid })).status;
  out['POST /api/shares/:id/republish'] = (await c.post(`/api/shares/${work.shareId}/republish`)).status;
  out['POST /api/shares/:id/readers'] = (await c.post(`/api/shares/${work.shareId}/readers`, { name: 'Gate check' })).status;
  out['POST /api/jobs/epubcheck'] = (await c.post('/api/jobs/epubcheck', { exportId: work.exportId })).status;
  out['POST /api/jobs/pdfx'] = (await c.post('/api/jobs/pdfx', { exportId: work.exportId })).status;
  out['POST /api/epub'] = (await epubStatus(c, { book: DOC, platform: 'generic' }));
  out['POST /api/wrap'] = (await epubStatus(c, { book: DOC, kind: 'pdf' }, '/api/wrap'));
  out['POST /api/exports'] = (
    await c.upload(`/api/exports?manuscriptId=${work.mid}&format=epub&filename=again.epub`, Buffer.from('PK again'))
  ).status;
  out['POST /api/authorship/stamps'] = (
    await c.post('/api/authorship/stamps', { bookId: 'gate-check', title: 'Gate check', sha256: 'a'.repeat(64), kind: 'backup' })
  ).status;
  return out;
}

/** POST /api/epub (and /api/wrap) answers bytes, not JSON: only the status is read. */
async function epubStatus(c: Client, body: unknown, route = '/api/epub'): Promise<number> {
  const base = (c as unknown as { base: string }).base;
  const cookie = (c as unknown as { cookieHeader(): Record<string, string> }).cookieHeader();
  const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json', ...cookie }, body: JSON.stringify(body) });
  await r.arrayBuffer();
  return r.status;
}

function assertAllOpen(statuses: Record<string, number>, why: string): void {
  for (const [route, status] of Object.entries(statuses)) assert.notEqual(status, 402, `${why}: ${route} must not pause`);
}
function assertAllPaused(statuses: Record<string, number>, why: string): void {
  for (const [route, status] of Object.entries(statuses)) assert.equal(status, 402, `${why}: ${route} must pause`);
}

/* ---------------- pure pieces ---------------- */

test('trial math: 21 days from sign-up, days left rounded up, ended at the end instant; a stored end wins', () => {
  const created = '2026-11-01T09:00:00.000Z';
  const t0 = trialFor({ createdAt: created, trialEndsAt: null }, 21, new Date('2026-11-01T09:00:00Z'));
  assert.deepEqual(t0, { startedAt: created, endsAt: '2026-11-22T09:00:00.000Z', active: true, daysLeft: 21 });
  assert.equal(trialFor({ createdAt: created, trialEndsAt: null }, 21, new Date('2026-11-21T09:00:01Z')).daysLeft, 1);
  assert.equal(trialFor({ createdAt: created, trialEndsAt: null }, 21, new Date('2026-11-19T09:00:00Z')).daysLeft, 3);
  const ended = trialFor({ createdAt: created, trialEndsAt: null }, 21, new Date('2026-11-22T09:00:00Z'));
  assert.equal(ended.active, false);
  assert.equal(ended.daysLeft, 0);
  // The sign-up stamp is used as stored (TRIAL_DAYS changing later moves nothing).
  const stamped = trialFor({ createdAt: created, trialEndsAt: '2026-11-20T00:00:00Z' }, 3, new Date('2026-11-10T00:00:00Z'));
  assert.equal(stamped.endsAt, '2026-11-20T00:00:00.000Z');
  assert.equal(stamped.active, true);
});

test('the day-21 / day-22 boundary: one millisecond before created_at + 21d is trial, at it is paused', () => {
  const T = new Date('2026-11-01T09:00:00.000Z');
  const user = { createdAt: T, trialEndsAt: null };
  const before = trialFor(user, 21, new Date(T.getTime() + 21 * DAY - 1));
  assert.equal(before.active, true);
  assert.equal(before.daysLeft, 1);
  const at = trialFor(user, 21, new Date(T.getTime() + 21 * DAY));
  assert.equal(at.active, false);
  assert.equal(at.daysLeft, 0);
  assert.equal(decideAccess(true, before, decideEntitlements([], { prices: {} }, 21, T)), 'trial');
  assert.equal(decideAccess(true, at, decideEntitlements([], { prices: {} }, 21, T)), 'paused');
});

test('pausedBody names the store-ready features it can pause and never promises them', () => {
  for (const f of ['export.epub', 'export.print', 'export.wrap'] as const) {
    const b = pausedBody(f);
    assert.equal(b.feature, f);
    assert.equal(b.exportOpen, false);
    assert.equal(b.ownWordsOpen, true);
    assert.match(String(b.error), new RegExp(PAUSABLE_FEATURES[f]));
    assert.doesNotMatch(String(b.error), /every export|export(s)? (still|always)/i);
  }
});

test('a config built from an empty env has a 21-day trial', () => {
  assert.equal(loadConfig({}).trialDays, 21);
  assert.equal(loadConfig({ TRIAL_DAYS: '10' }).trialDays, 10);
});

test('migration 021: pre-launch trials get 21 days from sign-up, never shortened, nulls untouched', async () => {
  const mdb = await createTestDb();
  const sql = readFileSync(path.resolve(import.meta.dirname, '..', 'migrations', '021_trial_21_days.sql'), 'utf8');
  const made = async (email: string, endsExpr: string) =>
    (await mdb.query<{ id: string }>(
      `insert into users (email, password_hash, created_at, trial_ends_at, trial_reminder_sent_at)
       values ($1, 'x', '2026-10-01T00:00:00Z', ${endsExpr}, '2026-10-05T00:00:00Z') returning id`,
      [email],
    )).rows[0].id;
  const a = await made('a@example.com', `'2026-10-01T00:00:00Z'::timestamptz + interval '7 days'`);
  const b = await made('b@example.com', `'2026-10-01T00:00:00Z'::timestamptz + interval '30 days'`);
  const c = await made('c@example.com', 'null');
  await mdb.query(sql);
  const get = async (id: string) =>
    (await mdb.query<{ trial_ends_at: Date | null }>('select trial_ends_at from users where id = $1', [id])).rows[0].trial_ends_at;
  assert.equal(new Date((await get(a))!).toISOString(), '2026-10-22T00:00:00.000Z', 'a: created_at + 21d');
  assert.equal(new Date((await get(b))!).toISOString(), '2026-10-31T00:00:00.000Z', 'b: an extension is not shortened');
  assert.equal(await get(c), null, 'c: still null');
  // The re-dated row forgets the reminder it got for the old day-7 end; rows it did not move keep theirs.
  const sent = async (id: string) =>
    (await mdb.query<{ trial_reminder_sent_at: Date | null }>('select trial_reminder_sent_at from users where id = $1', [id])).rows[0].trial_reminder_sent_at;
  assert.equal(await sent(a), null, 'a: reminder cleared so the new end gets one');
  assert.ok(await sent(b), 'b: not re-dated, reminder kept');
  assert.ok(await sent(c), 'c: not re-dated, reminder kept');
});

test('decideAccess: open while billing is off; subscription, grace, trial, paused when on', () => {
  const none = decideEntitlements([], { prices: {} }, 7, clock);
  const active: EntitlementState = { ...none, status: 'active', granted: true };
  const grace: EntitlementState = { ...none, status: 'past_due', granted: true, graceEndsAt: '2026-11-12T00:00:00.000Z' };
  const lapsed: EntitlementState = { ...none, status: 'canceled', granted: false };
  const live = trialFor({ createdAt: clock, trialEndsAt: null }, 7, clock);
  const gone = trialFor({ createdAt: new Date(clock.getTime() - 30 * DAY), trialEndsAt: null }, 7, clock);
  assert.equal(decideAccess(false, gone, none), 'open');
  assert.equal(decideAccess(false, gone, lapsed), 'open');
  assert.equal(decideAccess(true, live, none), 'trial');
  assert.equal(decideAccess(true, gone, none), 'paused');
  assert.equal(decideAccess(true, gone, lapsed), 'paused');
  assert.equal(decideAccess(true, gone, active), 'subscribed');
  assert.equal(decideAccess(true, live, active), 'subscribed');
  assert.equal(decideAccess(true, gone, grace), 'grace');
});

test('the rules are data: eight features, ten gated POST routes, and the never-paused list does not overlap', () => {
  assert.deepEqual(
    ACCESS_RULES.map((r) => `${r.method} ${r.path}`),
    [
      'POST /api/manuscripts',
      'POST /api/shares',
      'POST /api/shares/:id/republish',
      'POST /api/shares/:id/readers',
      'POST /api/jobs/epubcheck',
      'POST /api/jobs/pdfx',
      'POST /api/epub',
      'POST /api/wrap',
      'POST /api/exports',
      'POST /api/authorship/stamps',
    ],
  );
  assert.deepEqual(Object.keys(PAUSABLE_FEATURES).sort(), [
    'archive.upload', 'authorship.stamp', 'export.epub', 'export.print', 'export.wrap', 'jobs.run', 'shares.create', 'shelf.add',
  ]);
  // The three store-ready export features each have their route: export.print (the pdfx job,
  // Step 3 part 2), export.epub (POST /api/epub, part 3) and export.wrap (POST /api/wrap, part 4).
  assert.deepEqual(
    ACCESS_RULES.filter((r) => r.feature.startsWith('export.')).map((r) => `${r.method} ${r.path} ${r.feature}`),
    ['POST /api/jobs/pdfx export.print', 'POST /api/epub export.epub', 'POST /api/wrap export.wrap'],
  );
  const gated = new Set(ACCESS_RULES.map((r) => `${r.method} ${r.path}`));
  for (const r of NEVER_PAUSED) assert.ok(!gated.has(`${r.method} ${r.path}`), `${r.method} ${r.path} is both`);
  assert.ok(NEVER_PAUSED.some((r) => r.method === 'PUT' && r.path === '/api/manuscripts/:id'), 'saving a shelf book is never paused');
  // The authorship record: new stamps pause, looking up the record never does.
  assert.ok(NEVER_PAUSED.some((r) => r.method === 'GET' && r.path === '/api/authorship/stamps'), 'the authorship record is never paused');
  assert.ok(NEVER_PAUSED.some((r) => r.method === 'GET' && r.path === '/api/authorship/check'), 'checking a backup is never paused');
});

/* ---------------- settings unset ---------------- */

test('billing off: nothing gated even long after the trial, no price, checkout and portal 501 with a plain reason', async () => {
  const w = await writer(off.base, 'off');
  const work = await makeWork(w.c);
  await setTrialEnd(w.id, new Date(clock.getTime() - 60 * DAY));
  assertAllOpen(await gatedStatuses(w.c, work), 'billing off');

  const checkout = await w.c.post('/api/billing/checkout');
  assert.equal(checkout.status, 501);
  assert.match(String(checkout.body.reason), /not switched on/);
  const portal = await w.c.post('/api/billing/portal');
  assert.equal(portal.status, 501);
  assert.match(String(portal.body.reason), /not switched on/);
  assert.equal((await new Client(off.base).post('/api/billing/portal')).status, 401);

  const status = await w.c.get('/api/billing/status');
  assert.equal(status.body.priceLabel, null);
  const acct = status.body.account as Record<string, unknown>;
  assert.equal(acct.access, 'open');
  assert.equal(acct.trial, null, 'the trial is not spoken of while billing is off');

  const summary = await w.c.get('/api/account/summary');
  assert.deepEqual(summary.body.plan, { billingOn: false, access: 'open' });

  const html = await page(w.c, off.base, '/account');
  assert.match(html, /data-plan-access="open"/);
  assert.match(html, /Plans are not switched on on this server yet/);
  assert.ok(!/trial/i.test(html.slice(html.indexOf('id="plan"'), html.indexOf('id="security"'))), 'no trial copy');
  assert.ok(!html.includes('data-action="upgrade"'));
  assert.ok(!/[$€£]\s?\d|per month|\/month|per year/i.test(html), 'no price shown or implied');
});

test('a new account gets its trial stamped at sign-up (TRIAL_DAYS)', async () => {
  const w = await writer(on.base, 'stamp', true);
  const row = (await db.query<{ created_at: Date; trial_ends_at: Date }>('select created_at, trial_ends_at from users where id = $1', [w.id])).rows[0];
  const days = (new Date(row.trial_ends_at).getTime() - new Date(row.created_at).getTime()) / DAY;
  assert.ok(Math.abs(days - 21) < 0.01, `trial is 21 days (got ${days})`);
});

/* ---------------- the gating matrix ---------------- */

test('gating matrix: trial active, subscribed, past_due inside grace → open; expired, past grace, canceled, unpaid → paused', async () => {
  const cases: Array<{ name: string; trialDays: number; sub?: { status: string; sinceDaysAgo: number }; paused: boolean; state: string }> = [
    { name: 'trial active', trialDays: 3, paused: false, state: 'trial' },
    { name: 'trial expired, no subscription', trialDays: -1, paused: true, state: 'paused' },
    { name: 'subscribed (active)', trialDays: -10, sub: { status: 'active', sinceDaysAgo: 9 }, paused: false, state: 'subscribed' },
    { name: 'subscribed (trialing at Stripe)', trialDays: -1, sub: { status: 'trialing', sinceDaysAgo: 2 }, paused: false, state: 'subscribed' },
    { name: 'past_due inside grace', trialDays: -20, sub: { status: 'past_due', sinceDaysAgo: 2 }, paused: false, state: 'grace' },
    { name: 'past_due after grace', trialDays: -20, sub: { status: 'past_due', sinceDaysAgo: 8 }, paused: true, state: 'paused' },
    { name: 'canceled', trialDays: -20, sub: { status: 'canceled', sinceDaysAgo: 1 }, paused: true, state: 'paused' },
    { name: 'unpaid', trialDays: -20, sub: { status: 'unpaid', sinceDaysAgo: 1 }, paused: true, state: 'paused' },
    { name: 'canceled, but still inside the trial', trialDays: 2, sub: { status: 'canceled', sinceDaysAgo: 1 }, paused: false, state: 'trial' },
  ];
  for (const k of cases) {
    const w = await writer(on.base, 'matrix');
    const work = await makeWork(w.c); // made while the trial is still running
    await setTrialEnd(w.id, new Date(clock.getTime() + k.trialDays * DAY));
    if (k.sub) await addSub(w.id, `sub_${seq}`, k.sub.status, new Date(clock.getTime() - k.sub.sinceDaysAgo * DAY));
    const statuses = await gatedStatuses(w.c, work);
    if (k.paused) assertAllPaused(statuses, k.name);
    else assertAllOpen(statuses, k.name);
    // The studio reads the same decision: state, trial days left, and the locked list.
    const me = await w.c.get('/api/auth/me');
    const access = me.body.access as { state: string; daysLeft: number; locked: string[] };
    assert.equal(access.state, k.state, `${k.name}: state`);
    assert.deepEqual(access.locked.slice().sort(), k.paused ? Object.keys(PAUSABLE_FEATURES).sort() : [], `${k.name}: locked`);
    assert.equal(access.daysLeft, k.state === 'trial' ? Math.max(1, k.trialDays) : 0, `${k.name}: daysLeft`);
    assert.equal((me.body.user as { id: string }).id, w.id);
    // Download all my data is open in every state, paused included.
    assert.equal((await w.c.download('/api/account/export')).status, 200, `${k.name}: Download all my data`);
  }
  assert.equal(Object.keys(PAUSABLE_FEATURES).length, 8, 'paused locks all eight');
});

test('billing off: /api/auth/me reports an open state, no trial days and nothing locked', async () => {
  const w = await writer(off.base, 'meoff');
  await setTrialEnd(w.id, new Date(clock.getTime() - 30 * DAY));
  assert.deepEqual((await w.c.get('/api/auth/me')).body.access, { state: 'open', daysLeft: 0, locked: [] });
});

test('a paused answer is plain, names what stays open (own words), and changes nothing', async () => {
  const w = await writer(on.base, 'paused');
  const work = await makeWork(w.c);
  await setTrialEnd(w.id, new Date(clock.getTime() - DAY));
  const before = (await db.query('select 1 from manuscripts where user_id = $1', [w.id])).rows.length;
  const r = await w.c.post('/api/manuscripts', { doc: DOC });
  assert.equal(r.status, 402);
  assert.equal(r.body.paused, true);
  assert.equal(r.body.exportOpen, false);
  assert.equal(r.body.ownWordsOpen, true);
  assert.equal(r.body.feature, 'shelf.add');
  assert.match(String(r.body.error), /backup/);
  assert.match(String(r.body.error), /Word/);
  assert.match(String(r.body.error), /Markdown/);
  assert.doesNotMatch(String(r.body.error), /every export|export(s)? (still|always)/i);
  assert.equal((await db.query('select 1 from manuscripts where user_id = $1', [w.id])).rows.length, before);
  const up = await w.c.upload(`/api/exports?manuscriptId=${work.mid}&format=epub&filename=x.epub`, Buffer.from('PK x'));
  assert.equal(up.status, 402);
  assert.equal(up.body.feature, 'archive.upload');
  // Signed out, a gated route still answers 401 (the gate never decides that).
  assert.equal((await new Client(on.base).post('/api/manuscripts', { doc: DOC })).status, 401);
});

test('the pdfx job is the print-ready PDF feature; epubcheck stays jobs.run', async () => {
  const w = await writer(on.base, 'printgate');
  const work = await makeWork(w.c);
  const trial = await w.c.post('/api/jobs/pdfx', { exportId: work.exportId });
  assert.notEqual(trial.status, 402, 'in trial the print job is not paused');
  await setTrialEnd(w.id, new Date(clock.getTime() - DAY));
  const p = await w.c.post('/api/jobs/pdfx', { exportId: work.exportId });
  assert.equal(p.status, 402);
  assert.equal(p.body.feature, 'export.print');
  assert.equal(p.body.paused, true);
  assert.match(String(p.body.error), /print-ready PDFs/);
  const e = await w.c.post('/api/jobs/epubcheck', { exportId: work.exportId });
  assert.equal(e.status, 402);
  assert.equal(e.body.feature, 'jobs.run');
});

test('never paused: a paused writer reads, saves, downloads, keeps links, downloads all data, and can delete', async () => {
  const w = await writer(on.base, 'never');
  const work = await makeWork(w.c);
  const job = await w.c.post('/api/jobs/epubcheck', { exportId: work.exportId });
  assert.equal(job.status, 201, JSON.stringify(job.body));
  const jobId = (job.body.job as { id: string }).id;
  await setTrialEnd(w.id, new Date(clock.getTime() - 3 * DAY));
  assert.equal((await w.c.post('/api/manuscripts', { doc: DOC })).status, 402, 'the account is paused');

  assert.equal((await w.c.get('/api/manuscripts')).status, 200);
  const read = await w.c.get(`/api/manuscripts/${work.mid}`);
  assert.equal(read.status, 200);
  const revision = (read.body.manuscript as { revision: number }).revision;
  const put = await w.c.put(`/api/manuscripts/${work.mid}`, { doc: { ...DOC, meta: { ...DOC.meta, title: 'The Salt Road (2)' } }, revision });
  assert.equal(put.status, 200, 'a book already on the shelf keeps saving');
  assert.equal((await w.c.get('/api/exports')).status, 200);
  assert.equal((await w.c.download(`/api/exports/${work.exportId}/download`)).status, 200);
  assert.equal((await w.c.get(`/api/jobs/${jobId}`)).status, 200);
  assert.equal((await w.c.get('/api/shares')).status, 200);
  assert.equal((await w.c.put(`/api/shares/${work.shareId}`, { allowComments: true })).status, 200);
  assert.equal((await w.c.get(`/api/shares/${work.shareId}/comments`)).status, 200);
  assert.equal((await fetch(`${on.base}/read/${work.token}`)).status, 200, 'readers keep reading');
  const comment = await new Client(on.base).post(`/read/${work.token}/comments`, { sectionId: 'ch1', body: 'Lovely.', readerName: 'Bo' });
  assert.equal(comment.status, 201, JSON.stringify(comment.body));
  assert.equal((await w.c.download('/api/account/export')).status, 200, 'Download all my data');
  assert.equal((await w.c.post(`/api/shares/${work.shareId}/revoke`)).status, 200);
  assert.equal((await w.c.delete(`/api/exports/${work.exportId}`)).status < 300, true);
  const del = await w.c.post('/api/account/delete', { currentPassword: PASSWORD, confirmPhrase: 'delete my account' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
});

/* ---------------- checkout + portal ---------------- */

test('checkout inside the trial: the first charge waits for the trial end (no second trial); none when under 48 hours left; tax off by default', async () => {
  const w = await writer(on.base, 'buy');
  const end = new Date(clock.getTime() + 4 * DAY);
  await setTrialEnd(w.id, end);
  const r = await w.c.post('/api/billing/checkout');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.chargeWaitsUntil, end.toISOString());
  const form = fake.checkout.at(-1)!;
  assert.equal(form.get('subscription_data[trial_end]'), String(Math.floor(end.getTime() / 1000)));
  assert.equal(form.get('subscription_data[trial_period_days]'), null, 'no Stripe trial on top of Beuk’s');
  assert.equal(form.get('automatic_tax[enabled]'), null);
  assert.match(form.get('success_url') ?? '', /\/account\?billing=success&session_id=\{CHECKOUT_SESSION_ID\}$/);
  assert.match(form.get('cancel_url') ?? '', /\/account\?billing=cancelled$/);

  await setTrialEnd(w.id, new Date(clock.getTime() + 47 * 3_600_000));
  const soon = await w.c.post('/api/billing/checkout');
  assert.equal(soon.status, 200);
  assert.equal(soon.body.chargeWaitsUntil, null);
  assert.equal(fake.checkout.at(-1)!.get('subscription_data[trial_end]'), null, 'under 48 hours: the plan starts now');

  await setTrialEnd(w.id, new Date(clock.getTime() - DAY));
  await w.c.post('/api/billing/checkout');
  assert.equal(fake.checkout.at(-1)!.get('subscription_data[trial_end]'), null, 'after the trial: the plan starts now');
});

test('checkout with BILLING_AUTOMATIC_TAX: automatic_tax on, and an existing customer saves the address', async () => {
  const w = await writer(priced.base, 'tax');
  const fresh = await w.c.post('/api/billing/checkout');
  assert.equal(fresh.status, 200);
  assert.equal(fake.checkout.at(-1)!.get('automatic_tax[enabled]'), 'true');
  assert.equal(fake.checkout.at(-1)!.get('customer_update[address]'), null, 'only with an existing customer');
  await db.query('update users set stripe_customer_id = $2 where id = $1', [w.id, 'cus_taxfixture']);
  await w.c.post('/api/billing/checkout');
  assert.equal(fake.checkout.at(-1)!.get('customer'), 'cus_taxfixture');
  assert.equal(fake.checkout.at(-1)!.get('customer_update[address]'), 'auto');
});

test('portal: 409 with no billing account yet; then a session for the stored customer, returning to /account', async () => {
  const w = await writer(on.base, 'portal');
  const none = await w.c.post('/api/billing/portal');
  assert.equal(none.status, 409);
  assert.match(String(none.body.reason), /no billing to manage/);
  await addSub(w.id, `sub_portal_${seq}`, 'active');
  const r = await w.c.post('/api/billing/portal', { customerId: 'cus_someone_else' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(String(r.body.url), /^https:\/\/portal\.example\//);
  const form = fake.portal.at(-1)!;
  assert.equal(form.get('customer'), `cus_${w.id.slice(0, 8)}`, 'never a customer id from the client');
  assert.match(form.get('return_url') ?? '', /\/account$/);
});

/* ---------------- cancel on delete ---------------- */

test('deleting an account cancels its live subscription at Stripe immediately (prorate per setting); terminal ones are not called', async () => {
  const w = await writer(on.base, 'cancel');
  await addSub(w.id, 'sub_live_cancel', 'active');
  await db.query(
    `insert into billing_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, status_since, livemode)
     values ('sub_old_cancel', $1, 'cus_x', 'canceled', now(), false)`,
    [w.id],
  );
  const html = await page(w.c, on.base, '/account');
  assert.match(html, /data-subscription-cancels/);
  assert.match(html, /Deleting the account cancels it at Stripe straight away/);
  const before = fake.cancels.length;
  const del = await w.c.post('/api/account/delete', { currentPassword: PASSWORD, confirmPhrase: 'delete my account' });
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(del.body.subscriptionsLeftForOperator, 0);
  assert.equal(del.body.next, '/account/deleted');
  assert.deepEqual(fake.cancels.slice(before), ['sub_live_cancel'], 'one DELETE, no prorate parameter (Stripe default false)');
  assert.equal((await db.query("select 1 from billing_subscriptions where stripe_subscription_id = 'sub_live_cancel'")).rows.length, 0);
});

test('cancelBillingForDeletedAccount: prorate setting, a failing cancel is left for the operator, unconfigured cancels nothing', async () => {
  const w = await writer(on.base, 'cancelunit');
  await addSub(w.id, 'sub_unit_a', 'active');
  await addSub(w.id, 'sub_unit_b', 'past_due');
  const calls: string[] = [];
  const fakeProvider = {
    configured: true,
    cancelSubscription: async (id: string, opts: { prorate: boolean }) => {
      calls.push(`${id}:${opts.prorate}`);
      if (id === 'sub_unit_b') throw new Error('stripe DELETE /v1/subscriptions/sub_unit_b failed (500)');
      return { status: 'canceled' };
    },
  } as unknown as BillingProvider;
  const out = await cancelBillingForDeletedAccount({ db, billing: fakeProvider, config: testConfig({ billingCancelProrate: true }) }, w.id);
  assert.deepEqual(out, { cancelled: ['sub_unit_a'], leftForOperator: ['sub_unit_b'] });
  assert.deepEqual(calls.sort(), ['sub_unit_a:true', 'sub_unit_b:true']);

  const unconfigured = { configured: false, cancelSubscription: async () => assert.fail('must not call') } as unknown as BillingProvider;
  const none = await cancelBillingForDeletedAccount({ db, billing: unconfigured }, w.id);
  assert.deepEqual(none.cancelled, []);
  assert.deepEqual(none.leftForOperator.sort(), ['sub_unit_a', 'sub_unit_b']);
});

test('the Stripe provider sends prorate=true when BILLING_CANCEL_PRORATE is on, and a refused cancel is left for the operator', async () => {
  const prorating = await start({ ...ON, stripeApiBase: fakeBase, billingCancelProrate: true });
  try {
    const w = await writer(prorating.base, 'prorate');
    await addSub(w.id, 'sub_prorate', 'active');
    const before = fake.cancels.length;
    const del = await w.c.post('/api/account/delete', { currentPassword: PASSWORD, confirmPhrase: 'delete my account' });
    assert.equal(del.status, 200);
    assert.deepEqual(fake.cancels.slice(before), ['sub_prorate?prorate=true']);

    const w2 = await writer(prorating.base, 'refused');
    await addSub(w2.id, 'sub_refused', 'active');
    fake.failCancel = true;
    const del2 = await w2.c.post('/api/account/delete', { currentPassword: PASSWORD, confirmPhrase: 'delete my account' });
    fake.failCancel = false;
    assert.equal(del2.status, 200, 'deleting never depends on Stripe answering');
    assert.equal(del2.body.subscriptionsLeftForOperator, 1);
    const left = await db.query<{ user_id: string | null }>("select user_id from billing_subscriptions where stripe_subscription_id = 'sub_refused'");
    assert.deepEqual(left.rows, [{ user_id: null }]);
    const after = await (await fetch(`${prorating.base}/account/deleted?subscription=left`)).text();
    assert.match(after, /still running at Stripe/);
  } finally {
    fake.failCancel = false;
    await prorating.close();
  }
});

/* ---------------- trial-ending email ---------------- */

test('trial-ending email: once per account, 3 days before, only with email + billing on; a refused send is retried; subscribed accounts get none', async () => {
  // Isolate: every other account is out of the reminder window.
  await db.query('update users set trial_reminder_sent_at = now()');
  const soon = await writer(on.base, 'remind');
  const later = await writer(on.base, 'notyet');
  const paid = await writer(on.base, 'paid');
  await setTrialEnd(soon.id, new Date(clock.getTime() + 2 * DAY));
  await setTrialEnd(later.id, new Date(clock.getTime() + 5 * DAY));
  await setTrialEnd(paid.id, new Date(clock.getTime() + 1 * DAY));
  await addSub(paid.id, 'sub_paid_remind', 'active');

  // Billing off: nothing, and it says why.
  const offTick = await off.reminders.tick();
  assert.deepEqual(offTick, { ran: false, skipped: 'billing is not switched on', sent: 0, failed: 0 });

  // Email off: nothing, never claimed as sent.
  mailer.configured = false;
  const noMail = await on.reminders.tick();
  assert.equal(noMail.ran, false);
  assert.equal(noMail.skipped, "email isn't set up on this server");
  mailer.configured = true;

  // Refused by the mail server: not recorded, so the next tick tries again.
  mailer.refuse = true;
  const refused = await on.reminders.tick();
  assert.equal(refused.failed, 1);
  assert.equal((await db.query<{ t: Date | null }>('select trial_reminder_sent_at as t from users where id = $1', [soon.id])).rows[0].t, null);
  mailer.refuse = false;

  const first = await on.reminders.tick();
  assert.equal(first.sent, 1);
  const msgs = mailer.sent.filter((m) => m.to === soon.email && /trial ends/.test(m.subject));
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].subject, /Your Beuk trial ends on/);
  assert.match(msgs[0].text, /\/account/);
  assert.match(msgs[0].text, /the backup file, Word and Markdown/);
  assert.doesNotMatch(msgs[0].text, COPY_BANNED);
  assert.ok(!/[$€£]\s?\d|per month/i.test(msgs[0].text), 'no price while no label is set');
  assert.ok(!/!/.test(msgs[0].text), 'no exclamation marks');
  assert.ok((await db.query<{ t: Date | null }>('select trial_reminder_sent_at as t from users where id = $1', [soon.id])).rows[0].t);

  // Once means once.
  assert.equal((await on.reminders.tick()).sent, 0);
  assert.equal(mailer.sent.filter((m) => m.to === soon.email && /trial ends/.test(m.subject)).length, 1);
  assert.equal(mailer.sent.filter((m) => m.to === later.email && /trial ends/.test(m.subject)).length, 0, 'not yet in the window');
  assert.equal(mailer.sent.filter((m) => m.to === paid.email && /trial ends/.test(m.subject)).length, 0, 'has a plan');

  // Two days on, the later one comes due — once.
  const saved = clock;
  clock = new Date(clock.getTime() + 2 * DAY + 3_600_000);
  try {
    assert.equal((await on.reminders.tick()).sent, 1);
    assert.equal(mailer.sent.filter((m) => m.to === later.email && /trial ends/.test(m.subject)).length, 1);
  } finally {
    clock = saved;
  }
});

test('trial-ending email: accounts passed over (a plan already) never crowd out ones still in their trial — the tick pages through the window', async () => {
  await db.query('update users set trial_reminder_sent_at = now()');
  // Small pages, so three subscribed accounts fill more than one page.
  const paging = new TrialReminders({
    db,
    config: on.config,
    billing: new StripeBillingProvider(on.config),
    mailer,
    now,
    batchSize: 2,
  });
  // Fixed ids, so the subscribed accounts come first in id order and the
  // waiting one last (sign-up would draw random ids).
  const insert = async (id: string, label: string, endsInDays: number): Promise<string> => {
    const email = `${label}-${++seq}@example.com`;
    await db.query("insert into users (id, email, password_hash, trial_ends_at) values ($1, $2, 'x', $3)", [
      id,
      email,
      new Date(clock.getTime() + endsInDays * DAY),
    ]);
    return email;
  };
  const subscribed: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const id = `0000000${i}-0000-4000-8000-000000000000`;
    subscribed.push(await insert(id, `pagesub${i}`, 1));
    await addSub(id, `sub_page_${i}`, 'trialing');
  }
  const waiting = { email: await insert('ffffffff-ffff-4fff-bfff-ffffffffffff', 'pagewait', 2) };
  const before = mailer.sent.length;
  const out = await paging.tick();
  assert.equal(out.sent, 1, JSON.stringify(out));
  const fresh = mailer.sent.slice(before);
  assert.deepEqual(fresh.map((m) => m.to), [waiting.email]);
  for (const e of subscribed) assert.ok(!fresh.some((m) => m.to === e), 'a plan already: no email');
  assert.equal((await paging.tick()).sent, 0, 'once means once');
});

test('Download all my data carries the stored trial fields even while billing is off', async () => {
  const w = await writer(off.base, 'exporttrial');
  const ends = new Date('2026-11-17T12:00:00.000Z');
  const sentAt = new Date('2026-11-14T12:00:00.000Z');
  await db.query('update users set trial_ends_at = $2, trial_reminder_sent_at = $3 where id = $1', [w.id, ends, sentAt]);
  const res = await w.c.download('/api/account/export');
  assert.equal(res.status, 200);
  const account = JSON.parse(readZip(res.bytes).find((e) => e.name === 'account.json')!.data.toString('utf8'));
  assert.equal(account.plan.trialEndsAt, ends.toISOString());
  assert.equal(account.plan.trialReminderSentAt, sentAt.toISOString());

  await db.query('update users set trial_reminder_sent_at = null where id = $1', [w.id]);
  const again = await w.c.download('/api/account/export');
  const account2 = JSON.parse(readZip(again.bytes).find((e) => e.name === 'account.json')!.data.toString('utf8'));
  assert.equal(account2.plan.trialReminderSentAt, null, 'null = not sent');
});

/* ---------------- Plan section copy ---------------- */

test('Plan section copy: trial (days left, what pauses, first charge waits), price label only when set, paused notice, past_due notice, active', async () => {
  // Trial, no label.
  const t = await writer(on.base, 'copytrial');
  await setTrialEnd(t.id, new Date(clock.getTime() + 4 * DAY));
  let html = await page(t.c, on.base, '/account');
  assert.match(html, /data-plan-access="trial"/);
  assert.match(html, /Your free trial runs until 14 Nov 2026: 4 days left/);
  assert.match(html, /the first payment waits until your trial ends/);
  assert.match(html, /data-action="upgrade"/);
  assert.ok(!html.includes('data-action="manage"'), 'no billing account yet');
  assert.match(html, /the backup file, Word and Markdown are always open/);
  const planHtml = html.slice(html.indexOf('id="plan"'), html.indexOf('id="security"'));
  assert.match(planHtml, /4 days left/);
  for (const locked of [/EPUB/, /print PDF/, /cover wrap/, /shelf/, /beta-reader links/, /checks/]) assert.match(planHtml, locked);
  assert.doesNotMatch(planHtml, COPY_BANNED);
  assert.match(html, /This server takes test payments only/);
  assert.ok(!html.includes('One plan,'), 'no price line without BILLING_PRICE_LABEL');
  const sum = (await t.c.get('/api/account/summary')).body.plan as Record<string, unknown>;
  assert.deepEqual(
    { billingOn: sum.billingOn, access: sum.access, days: sum.trialDaysLeft, price: sum.priceLabel, up: sum.canUpgrade, manage: sum.canManage },
    { billingOn: true, access: 'trial', days: 4, price: null, up: true, manage: false },
  );

  // With a label (placeholder text, not a real price).
  const p = await writer(priced.base, 'copyprice');
  html = await page(p.c, priced.base, '/account');
  assert.match(html, /One plan, PLACEHOLDER-LABEL, opens everything/);
  assert.equal((await p.c.get('/api/billing/status')).body.priceLabel, 'PLACEHOLDER-LABEL');

  // Paused: what still works, and export open.
  const z = await writer(on.base, 'copypaused');
  await setTrialEnd(z.id, new Date(clock.getTime() - DAY));
  html = await page(z.c, on.base, '/account');
  assert.match(html, /data-plan-access="paused"/);
  assert.match(html, /data-plan-notice="paused"/);
  assert.match(html, /Your free trial ended on 9 Nov 2026/);
  assert.match(html, /are paused/);
  assert.match(html, /the backup file, Word and Markdown/);
  const pausedHtml = html.slice(html.indexOf('id="plan"'), html.indexOf('id="security"'));
  for (const locked of [/EPUB/, /print PDF/, /cover wrap/, /shelf/, /beta-reader links/, /checks/]) assert.match(pausedHtml, locked);
  assert.doesNotMatch(pausedHtml, COPY_BANNED);
  assert.match(html, /data-action="upgrade"/);

  // past_due inside grace: calm notice, Manage billing, no second checkout.
  const g = await writer(on.base, 'copygrace');
  await setTrialEnd(g.id, new Date(clock.getTime() - 20 * DAY));
  await addSub(g.id, `sub_grace_${seq}`, 'past_due', new Date(clock.getTime() - 2 * DAY));
  html = await page(g.c, on.base, '/account');
  assert.match(html, /data-plan-access="grace"/);
  assert.match(html, /The last payment didn’t go through/);
  assert.match(html, /everything stays open until 15 Nov 2026/);
  assert.match(html, /data-action="manage"/);
  assert.ok(!html.includes('data-action="upgrade"'));

  // Active.
  const a = await writer(on.base, 'copyactive');
  await addSub(a.id, `sub_active_${seq}`, 'active');
  html = await page(a.c, on.base, '/account');
  assert.match(html, /data-plan-access="subscribed"/);
  assert.match(html, /active\. Everything is open to you/);
  assert.match(html, /data-action="manage"/);
  assert.ok(!html.includes('data-action="upgrade"'));

  // Back from Stripe.
  html = await page(a.c, on.base, '/account?billing=success');
  assert.match(html, /data-billing-return="success"/);
  assert.ok(!/!/.test(html.slice(html.indexOf('id="plan"'), html.indexOf('id="security"'))), 'no exclamation marks in the Plan section');
});

test('GET /api/auth/me still answers {user} when the access lookup throws (logged, no access key)', async () => {
  let broken = false;
  const real = new StripeBillingProvider({ ...on.config });
  const stub = new Proxy(real, {
    get(t, k) {
      if (k === 'mode' && broken) throw new Error('stub: stripe mode unavailable');
      const v = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  }) as BillingProvider;
  const s = await start({ ...ON, stripeApiBase: fakeBase }, stub);
  const logged: string[] = [];
  const orig = console.log;
  try {
    const w = await writer(s.base, 'mebroken');
    const ok = await w.c.get('/api/auth/me');
    assert.equal(ok.status, 200);
    assert.ok((ok.body.access as { state: string }).state, 'access present while healthy');
    broken = true;
    console.log = (m?: unknown) => { logged.push(String(m)); };
    const me = await w.c.get('/api/auth/me');
    console.log = orig;
    assert.equal(me.status, 200);
    assert.equal((me.body.user as { id: string }).id, w.id);
    assert.ok(!('access' in me.body), 'no access key on failure');
    assert.ok(logged.some((l) => l.includes('auth.me.access_failed') && l.includes('stripe mode unavailable')), 'failure is logged');
  } finally {
    console.log = orig;
    await s.close();
  }
});

/** Every value of one string key in the studio page, one per language pack. */
function packValues(html: string, key: string): string[] {
  const out: string[] = [];
  const marker = '"' + key + '": "';
  let i = html.indexOf(marker);
  while (i >= 0) {
    let j = i + marker.length;
    let v = '';
    while (j < html.length && html[j] !== '"') {
      if (html[j] === String.fromCharCode(92)) { v += html[j] + html[j + 1]; j += 2; } else { v += html[j]; j += 1; }
    }
    out.push(v);
    i = html.indexOf(marker, j);
  }
  return out;
}

test('studio: the paused strings in all 13 packs say what is locked and what stays downloadable, never "every export"', () => {
  const html = readFileSync(path.resolve(import.meta.dirname, '..', 'client', 'index.html'), 'utf8');
  for (const key of ['plan.paused', 'plan.pausedToast', 'tour.s4b']) {
    const values = packValues(html, key);
    assert.equal(values.length, 13, `${key} in 13 packs`);
    for (const v of values) assert.doesNotMatch(v, /every export|export.*(still|always)/i, `${key}: ${v.slice(0, 60)}`);
  }
  for (const v of packValues(html, 'plan.paused')) {
    for (const w of ['EPUB', 'print PDF', 'cover wrap', 'backup file', 'Word', 'Markdown', 'Download all my data']) assert.ok(v.includes(w), `plan.paused mentions ${w}`);
  }
  for (const key of ['auth.subLogin', 'auth.subRegister']) {
    const values = packValues(html, key);
    assert.equal(values.length, 13, key);
    assert.doesNotMatch(values[0], /without an account/i, `${key}: no promise that the studio works without an account`);
  }
});
