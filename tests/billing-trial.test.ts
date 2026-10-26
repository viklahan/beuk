import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { after, before, test } from 'node:test';
import { buildApp } from '../src/app.js';
import { ACCESS_RULES, decideAccess, NEVER_PAUSED, trialFor } from '../src/access.js';
import { cancelBillingForDeletedAccount } from '../src/account/plan.js';
import type { BillingProvider } from '../src/billing.js';
import type { Config } from '../src/config.js';
import type { Db } from '../src/db.js';
import { decideEntitlements, type EntitlementState } from '../src/entitlements.js';
import type { MailMessage, MailResult, Mailer, MailerStatus } from '../src/mailer.js';
import type { TrialReminders } from '../src/trial-mail.js';
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
  out['POST /api/jobs/epubcheck'] = (await c.post('/api/jobs/epubcheck', { exportId: work.exportId })).status;
  out['POST /api/jobs/pdfx'] = (await c.post('/api/jobs/pdfx', { exportId: work.exportId })).status;
  out['POST /api/exports'] = (
    await c.upload(`/api/exports?manuscriptId=${work.mid}&format=epub&filename=again.epub`, Buffer.from('PK again'))
  ).status;
  return out;
}

function assertAllOpen(statuses: Record<string, number>, why: string): void {
  for (const [route, status] of Object.entries(statuses)) assert.notEqual(status, 402, `${why}: ${route} must not pause`);
}
function assertAllPaused(statuses: Record<string, number>, why: string): void {
  for (const [route, status] of Object.entries(statuses)) assert.equal(status, 402, `${why}: ${route} must pause`);
}

/* ---------------- pure pieces ---------------- */

test('trial math: 7 days from sign-up, days left rounded up, ended at the end instant; a stored end wins', () => {
  const created = '2026-11-01T09:00:00.000Z';
  const t0 = trialFor({ createdAt: created, trialEndsAt: null }, 7, new Date('2026-11-01T09:00:00Z'));
  assert.deepEqual(t0, { startedAt: created, endsAt: '2026-11-08T09:00:00.000Z', active: true, daysLeft: 7 });
  assert.equal(trialFor({ createdAt: created, trialEndsAt: null }, 7, new Date('2026-11-07T09:00:01Z')).daysLeft, 1);
  assert.equal(trialFor({ createdAt: created, trialEndsAt: null }, 7, new Date('2026-11-05T08:00:00Z')).daysLeft, 4);
  const ended = trialFor({ createdAt: created, trialEndsAt: null }, 7, new Date('2026-11-08T09:00:00Z'));
  assert.equal(ended.active, false);
  assert.equal(ended.daysLeft, 0);
  // The sign-up stamp is used as stored (TRIAL_DAYS changing later moves nothing).
  const stamped = trialFor({ createdAt: created, trialEndsAt: '2026-11-20T00:00:00Z' }, 3, new Date('2026-11-10T00:00:00Z'));
  assert.equal(stamped.endsAt, '2026-11-20T00:00:00.000Z');
  assert.equal(stamped.active, true);
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

test('the rules are data: four features, six gated POST routes, and the never-paused list does not overlap', () => {
  assert.deepEqual(
    ACCESS_RULES.map((r) => `${r.method} ${r.path}`),
    [
      'POST /api/manuscripts',
      'POST /api/shares',
      'POST /api/shares/:id/republish',
      'POST /api/jobs/epubcheck',
      'POST /api/jobs/pdfx',
      'POST /api/exports',
    ],
  );
  const gated = new Set(ACCESS_RULES.map((r) => `${r.method} ${r.path}`));
  for (const r of NEVER_PAUSED) assert.ok(!gated.has(`${r.method} ${r.path}`), `${r.method} ${r.path} is both`);
  assert.ok(NEVER_PAUSED.some((r) => r.method === 'PUT' && r.path === '/api/manuscripts/:id'), 'saving a shelf book is never paused');
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
  assert.ok(Math.abs(days - 7) < 0.01, `trial is 7 days (got ${days})`);
});

/* ---------------- the gating matrix ---------------- */

test('gating matrix: trial active, subscribed, past_due inside grace → open; expired, past grace, canceled, unpaid → paused', async () => {
  const cases: Array<{ name: string; trialDays: number; sub?: { status: string; sinceDaysAgo: number }; paused: boolean }> = [
    { name: 'trial active', trialDays: 3, paused: false },
    { name: 'trial expired, no subscription', trialDays: -1, paused: true },
    { name: 'subscribed (active)', trialDays: -10, sub: { status: 'active', sinceDaysAgo: 9 }, paused: false },
    { name: 'subscribed (trialing at Stripe)', trialDays: -1, sub: { status: 'trialing', sinceDaysAgo: 2 }, paused: false },
    { name: 'past_due inside grace', trialDays: -20, sub: { status: 'past_due', sinceDaysAgo: 2 }, paused: false },
    { name: 'past_due after grace', trialDays: -20, sub: { status: 'past_due', sinceDaysAgo: 8 }, paused: true },
    { name: 'canceled', trialDays: -20, sub: { status: 'canceled', sinceDaysAgo: 1 }, paused: true },
    { name: 'unpaid', trialDays: -20, sub: { status: 'unpaid', sinceDaysAgo: 1 }, paused: true },
    { name: 'canceled, but still inside the trial', trialDays: 2, sub: { status: 'canceled', sinceDaysAgo: 1 }, paused: false },
  ];
  for (const k of cases) {
    const w = await writer(on.base, 'matrix');
    const work = await makeWork(w.c); // made while the trial is still running
    await setTrialEnd(w.id, new Date(clock.getTime() + k.trialDays * DAY));
    if (k.sub) await addSub(w.id, `sub_${seq}`, k.sub.status, new Date(clock.getTime() - k.sub.sinceDaysAgo * DAY));
    const statuses = await gatedStatuses(w.c, work);
    if (k.paused) assertAllPaused(statuses, k.name);
    else assertAllOpen(statuses, k.name);
  }
});

test('a paused answer is plain, says export stays open, and changes nothing', async () => {
  const w = await writer(on.base, 'paused');
  const work = await makeWork(w.c);
  await setTrialEnd(w.id, new Date(clock.getTime() - DAY));
  const before = (await db.query('select 1 from manuscripts where user_id = $1', [w.id])).rows.length;
  const r = await w.c.post('/api/manuscripts', { doc: DOC });
  assert.equal(r.status, 402);
  assert.equal(r.body.paused, true);
  assert.equal(r.body.exportOpen, true);
  assert.equal(r.body.feature, 'shelf.add');
  assert.match(String(r.body.error), /every export still work/);
  assert.equal((await db.query('select 1 from manuscripts where user_id = $1', [w.id])).rows.length, before);
  const up = await w.c.upload(`/api/exports?manuscriptId=${work.mid}&format=epub&filename=x.epub`, Buffer.from('PK x'));
  assert.equal(up.status, 402);
  assert.equal(up.body.feature, 'archive.upload');
  // Signed out, a gated route still answers 401 (the gate never decides that).
  assert.equal((await new Client(on.base).post('/api/manuscripts', { doc: DOC })).status, 401);
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
  assert.match(msgs[0].text, /every export/);
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
  assert.match(html, /export is always open/);
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
  assert.match(html, /every export/);
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
