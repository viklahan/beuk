import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';
import { modeFromKey, parseSubscription } from '../src/billing.js';
import { decideEntitlements, parseEntitlements, type SubscriptionRow } from '../src/entitlements.js';
import { SELF_CHECK_CASES, type CheckContext } from '../src/housekeeping/registry.js';

/*
 * Billing plumbing tests. Every webhook here is signed exactly as Stripe
 * signs ("<t>.<raw body>", HMAC-SHA256, https://docs.stripe.com/webhooks#verify-manually),
 * and every "retrieve the current object" call goes to a local FAKE
 * Stripe API (no real Stripe calls anywhere in the suite). Keys, ids and
 * prices below are placeholders, not real values; the entitlements file
 * is a fixture, not V's pricing (pricing is parked).
 */

const WEBHOOK_SECRET = 'whsec_test_placeholder_not_a_real_key';
const TEST_KEY = 'sk_test_placeholder_not_a_real_key';
const LIVE_KEY = 'sk_live_placeholder_not_a_real_key';
const PRICE_A = 'price_fixture_a';
const PRICE_B = 'price_fixture_b';
const DAY = 86_400_000;

/* ---------------- fake Stripe API ---------------- */

type Obj = Record<string, unknown>;
const fake = {
  subs: new Map<string, Obj>(),
  charges: new Map<string, Obj>(),
  sessions: [] as URLSearchParams[],
  calls: [] as string[],
  failNext: 0,
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

function subscription(
  id: string,
  customer: string,
  status: string,
  opts: { price?: string; livemode?: boolean; userId?: string; periodEnd?: number; cancelAtPeriodEnd?: boolean } = {},
): Obj {
  return {
    id,
    object: 'subscription',
    customer,
    status,
    livemode: opts.livemode ?? false,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    metadata: opts.userId ? { userId: opts.userId } : {},
    items: {
      object: 'list',
      data: [
        {
          id: `si_${id}`,
          current_period_end: opts.periodEnd ?? 1_900_000_000,
          price: { id: opts.price ?? PRICE_A },
        },
      ],
    },
  };
}

function setSub(sub: Obj): void {
  fake.subs.set(sub.id as string, sub);
}

/* ---------------- app servers ---------------- */

let db: Db;
let clock = new Date('2026-10-25T12:00:00Z');
let plainServer: TestServer; // no Stripe keys at all
let secretOnlyServer: TestServer; // webhook secret but no API key
let server: TestServer; // test-mode, fully configured
let liveServer: TestServer; // live-mode key
let entitlementsPath: string;

function sign(rawBody: string, secret = WEBHOOK_SECRET): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return `t=${t},v1=${v1}`;
}

let eventSeq = 0;
function eventBody(type: string, object: Obj, opts: { id?: string; livemode?: boolean } = {}): string {
  return JSON.stringify({
    id: opts.id ?? `evt_fixture_${++eventSeq}`,
    object: 'event',
    type,
    livemode: opts.livemode ?? false,
    data: { object },
  });
}

async function postWebhook(
  base: string,
  rawBody: string,
  signature: string | null = sign(rawBody),
): Promise<{ status: number; body: Obj }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['stripe-signature'] = signature;
  const res = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers, body: rawBody });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Obj) : {} };
}

async function userId(email: string): Promise<string> {
  const found = await db.query<{ id: string }>('select id from users where email = $1', [email]);
  return found.rows[0].id;
}

async function account(client: Client): Promise<{ status: string; granted: boolean; entitlements: string[]; graceEndsAt: string | null; label: string | null }> {
  const res = await client.get('/api/billing/status');
  assert.equal(res.status, 200);
  return res.body.account as never;
}

async function signedIn(base: string, email: string): Promise<Client> {
  const c = new Client(base);
  const r = await registerUser(c, email);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return c;
}

before(async () => {
  fakeServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    fake.calls.push(`${req.method} ${url.pathname}`);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const auth = req.headers.authorization;
    if (auth !== `Bearer ${TEST_KEY}` && auth !== `Bearer ${LIVE_KEY}`) return send(401, { error: { type: 'invalid_request_error' } });
    if (fake.failNext > 0) {
      fake.failNext--;
      return send(500, { error: { type: 'api_error' } });
    }
    if (req.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      fake.sessions.push(new URLSearchParams(await readBody(req)));
      return send(200, { id: `cs_fixture_${fake.sessions.length}`, url: `https://checkout.example/${fake.sessions.length}` });
    }
    if (req.method === 'GET' && url.pathname === '/v1/subscriptions') {
      const customer = url.searchParams.get('customer');
      assert.equal(url.searchParams.get('status'), 'all');
      const data = [...fake.subs.values()].filter((s) => s.customer === customer);
      return send(200, { object: 'list', has_more: false, data });
    }
    const subMatch = url.pathname.match(/^\/v1\/subscriptions\/([^/]+)$/);
    if (req.method === 'GET' && subMatch) {
      const sub = fake.subs.get(decodeURIComponent(subMatch[1]));
      return sub ? send(200, sub) : send(404, { error: { type: 'invalid_request_error' } });
    }
    const chMatch = url.pathname.match(/^\/v1\/charges\/([^/]+)$/);
    if (req.method === 'GET' && chMatch) {
      const ch = fake.charges.get(decodeURIComponent(chMatch[1]));
      return ch ? send(200, ch) : send(404, { error: { type: 'invalid_request_error' } });
    }
    return send(404, { error: { type: 'invalid_request_error' } });
  });
  await new Promise<void>((resolve) => fakeServer.listen(0, '127.0.0.1', () => resolve()));
  const addr = fakeServer.address();
  if (!addr || typeof addr === 'string') throw new Error('no fake address');
  fakeBase = `http://127.0.0.1:${addr.port}`;

  const dir = mkdtempSync(path.join(os.tmpdir(), 'beuk-entitlements-'));
  entitlementsPath = path.join(dir, 'entitlements.json');
  writeFileSync(
    entitlementsPath,
    JSON.stringify({
      prices: {
        [PRICE_A]: { label: 'fixture-label-a', entitlements: ['fixture.feature-one', 'fixture.feature-two'] },
        [PRICE_B]: { entitlements: ['fixture.feature-three'] },
      },
    }),
  );

  db = await createTestDb();
  const now = () => clock;
  plainServer = await startTestServer(db, now);
  secretOnlyServer = await startTestServer(db, now, { stripeWebhookSecret: WEBHOOK_SECRET });
  const configured = {
    stripeWebhookSecret: WEBHOOK_SECRET,
    stripeSecretKey: TEST_KEY,
    stripePriceId: PRICE_A,
    stripeApiBase: fakeBase,
    entitlementsFile: entitlementsPath,
  };
  server = await startTestServer(db, now, configured);
  liveServer = await startTestServer(db, now, { ...configured, stripeSecretKey: LIVE_KEY });
});

after(async () => {
  await plainServer.close();
  await secretOnlyServer.close();
  await server.close();
  await liveServer.close();
  await new Promise<void>((resolve) => fakeServer.close(() => resolve()));
});

/* ---------------- configuration honesty ---------------- */

test('no keys: checkout + webhook are a clean 501, status says not live; a webhook secret alone is not enough', async () => {
  const client = await signedIn(plainServer.base, 'nocfg@example.com');
  const checkout = await client.post('/api/billing/checkout');
  assert.equal(checkout.status, 501);
  assert.match(String(checkout.body.error), /not configured/i);
  assert.equal((await postWebhook(plainServer.base, eventBody('checkout.session.completed', {}), 't=1,v1=abc')).status, 501);

  const status = await new Client(plainServer.base).get('/api/billing/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.live, false);
  assert.equal(status.body.configured, false);
  assert.equal(status.body.mode, null);
  assert.equal(status.body.account, undefined, 'anonymous callers get no account block');

  // Without an API key the server cannot retrieve current state, so it
  // must not act on event bodies alone.
  const raw = eventBody('customer.subscription.updated', subscription('sub_x', 'cus_x', 'active'));
  assert.equal((await postWebhook(secretOnlyServer.base, raw)).status, 501);

  // Checkout still requires auth even before it is configured.
  assert.equal((await new Client(plainServer.base).post('/api/billing/checkout')).status, 401);
});

test('status: test-mode keys are configured but NOT live; live-mode keys are live', async () => {
  const t = await new Client(server.base).get('/api/billing/status');
  assert.deepEqual(
    { live: t.body.live, configured: t.body.configured, mode: t.body.mode, graceDays: t.body.graceDays },
    { live: false, configured: true, mode: 'test', graceDays: 7 },
  );
  const l = await new Client(liveServer.base).get('/api/billing/status');
  assert.deepEqual({ live: l.body.live, configured: l.body.configured, mode: l.body.mode }, { live: true, configured: true, mode: 'live' });
});

test('key mode: derived from the key prefix; STRIPE_MODE contradicting the key refuses to run', async () => {
  assert.equal(modeFromKey('sk_test_x'), 'test');
  assert.equal(modeFromKey('rk_test_x'), 'test');
  assert.equal(modeFromKey('sk_live_x'), 'live');
  assert.equal(modeFromKey('rk_live_x'), 'live');
  assert.equal(modeFromKey('pk_live_x'), null);
  assert.equal(modeFromKey(null), null);

  const conflicted = await startTestServer(db, () => clock, {
    stripeWebhookSecret: WEBHOOK_SECRET,
    stripeSecretKey: TEST_KEY,
    stripePriceId: PRICE_A,
    stripeApiBase: fakeBase,
    stripeMode: 'live',
  });
  try {
    const raw = eventBody('customer.subscription.updated', subscription('sub_y', 'cus_y', 'active'));
    assert.equal((await postWebhook(conflicted.base, raw)).status, 501);
    const st = await new Client(conflicted.base).get('/api/billing/status');
    assert.equal(st.body.live, false);
    assert.equal(st.body.configured, false);
    const check = SELF_CHECK_CASES.find((c) => c.id === 'billing.mode.matches-key')!;
    await assert.rejects(check.run!({ db, config: conflicted.config } as CheckContext), /STRIPE_MODE=live/);
  } finally {
    await conflicted.close();
  }
});

test('bad or missing signatures are rejected and change nothing', async () => {
  await signedIn(server.base, 'victim@example.com');
  const victim = await userId('victim@example.com');
  setSub(subscription('sub_evil', 'cus_evil', 'active', { userId: victim }));
  const raw = eventBody('customer.subscription.updated', fake.subs.get('sub_evil')!);
  assert.equal((await postWebhook(server.base, raw, sign(raw, 'whsec_wrong_secret'))).status, 400);
  assert.equal((await postWebhook(server.base, raw, null)).status, 400);
  assert.equal((await postWebhook(server.base, raw, 'not-a-signature')).status, 400);
  // An event with no livemode cannot be placed in a mode: refused.
  const noMode = JSON.stringify({ id: 'evt_nomode', type: 'customer.subscription.updated', data: { object: { id: 'sub_evil' } } });
  assert.equal((await postWebhook(server.base, noMode)).status, 400);

  const subs = await db.query('select 1 from billing_subscriptions where stripe_subscription_id = $1', ['sub_evil']);
  assert.equal(subs.rows.length, 0);
  const events = await db.query('select 1 from billing_events');
  assert.equal(events.rows.length, 0);
});

/* ---------------- checkout ---------------- */

test('checkout: allow-listed price only, our user id travels to the subscription, success_url carries the session id; then customer reuse and 409', async () => {
  const client = await signedIn(server.base, 'buyer@example.com');
  const uid = await userId('buyer@example.com');

  assert.equal((await client.post('/api/billing/checkout', { priceId: 'price_made_up_by_client' })).status, 400);

  const first = await client.post('/api/billing/checkout');
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(String(first.body.url), /^https:\/\/checkout\.example\//);
  const form = fake.sessions.at(-1)!;
  assert.equal(form.get('mode'), 'subscription');
  assert.equal(form.get('line_items[0][price]'), PRICE_A);
  assert.equal(form.get('client_reference_id'), uid);
  assert.equal(form.get('subscription_data[metadata][userId]'), uid);
  assert.match(form.get('success_url') ?? '', /session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.equal(form.get('customer_email'), 'buyer@example.com');
  assert.equal(form.get('customer'), null);

  // The checkout completes, paid by card: the session names our user.
  setSub(subscription('sub_buyer', 'cus_buyer', 'active', { userId: uid }));
  const done = eventBody('checkout.session.completed', {
    id: 'cs_buyer',
    object: 'checkout.session',
    mode: 'subscription',
    payment_status: 'paid',
    client_reference_id: uid,
    metadata: { userId: uid },
    customer: 'cus_buyer',
    subscription: 'sub_buyer',
  });
  const res = await postWebhook(server.base, done);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.outcome, 'synced');

  const state = await account(client);
  assert.equal(state.status, 'active');
  assert.equal(state.granted, true);
  assert.deepEqual(state.entitlements, ['fixture.feature-one', 'fixture.feature-two']);
  const row = await db.query<{ plan: string; stripe_customer_id: string }>(
    'select plan, stripe_customer_id from users where id = $1',
    [uid],
  );
  assert.equal(row.rows[0].plan, 'fixture-label-a', 'users.plan is the cached display label from the entitlements file');
  assert.equal(row.rows[0].stripe_customer_id, 'cus_buyer');

  // A second checkout while subscribed is refused.
  const again = await client.post('/api/billing/checkout');
  assert.equal(again.status, 409);
  assert.equal(again.body.status, 'active');

  // After the subscription ends, a new checkout REUSES the stored customer.
  setSub(subscription('sub_buyer', 'cus_buyer', 'canceled', { userId: uid }));
  await postWebhook(server.base, eventBody('customer.subscription.deleted', { id: 'sub_buyer', object: 'subscription' }));
  const third = await client.post('/api/billing/checkout');
  assert.equal(third.status, 200);
  const form3 = fake.sessions.at(-1)!;
  assert.equal(form3.get('customer'), 'cus_buyer');
  assert.equal(form3.get('customer_email'), null);
});

/* ---------------- idempotency ---------------- */

test('the same event delivered twice is processed once; the second answer says duplicate', async () => {
  const client = await signedIn(server.base, 'twice@example.com');
  const uid = await userId('twice@example.com');
  setSub(subscription('sub_twice', 'cus_twice', 'active', { userId: uid }));
  const raw = eventBody('customer.subscription.created', { id: 'sub_twice', object: 'subscription' }, { id: 'evt_twice' });

  const callsBefore = fake.calls.length;
  const one = await postWebhook(server.base, raw);
  assert.equal(one.status, 200);
  assert.equal(one.body.outcome, 'synced');
  const callsAfterFirst = fake.calls.length;
  assert.ok(callsAfterFirst > callsBefore, 'first delivery retrieves the subscription');

  // Stripe re-delivers (a fresh signature, the same event).
  const two = await postWebhook(server.base, raw);
  assert.equal(two.status, 200);
  assert.equal(two.body.duplicate, true);
  assert.equal(fake.calls.length, callsAfterFirst, 'a duplicate makes no Stripe call and changes nothing');

  const ledger = await db.query<{ attempts: number; outcome: string; user_id: string }>(
    'select attempts, outcome, user_id from billing_events where event_id = $1',
    ['evt_twice'],
  );
  assert.equal(ledger.rows.length, 1);
  assert.equal(ledger.rows[0].attempts, 2);
  assert.equal(ledger.rows[0].outcome, 'synced');
  assert.equal(ledger.rows[0].user_id, uid);
  assert.equal((await account(client)).granted, true);
});

test('a delivery whose handling fails answers 500, stays unprocessed, and the retry is processed (not skipped as duplicate)', async () => {
  const client = await signedIn(server.base, 'retry@example.com');
  const uid = await userId('retry@example.com');
  setSub(subscription('sub_retry', 'cus_retry', 'active', { userId: uid }));
  const raw = eventBody('customer.subscription.created', { id: 'sub_retry', object: 'subscription' }, { id: 'evt_retry' });

  fake.failNext = 1;
  const failed = await postWebhook(server.base, raw);
  assert.equal(failed.status, 500);
  const row = await db.query<{ processed_at: string | null; error: string | null }>(
    'select processed_at, error from billing_events where event_id = $1',
    ['evt_retry'],
  );
  assert.equal(row.rows[0].processed_at, null);
  assert.match(String(row.rows[0].error), /failed \(500\)/);
  assert.equal((await account(client)).granted, false);

  const retried = await postWebhook(server.base, raw);
  assert.equal(retried.status, 200);
  assert.equal(retried.body.outcome, 'synced');
  assert.equal(retried.body.duplicate, undefined);
  assert.equal((await account(client)).granted, true);
});

/* ---------------- async payment methods ---------------- */

test('async payment: an unpaid checkout grants nothing (no Stripe call); async_payment_succeeded grants; async_payment_failed does not', async () => {
  const client = await signedIn(server.base, 'bankdebit@example.com');
  const uid = await userId('bankdebit@example.com');
  // Even if the stored subscription looked active, an UNPAID completed
  // session must not trigger a grant.
  setSub(subscription('sub_async', 'cus_async', 'active', { userId: uid }));
  const session = {
    id: 'cs_async',
    object: 'checkout.session',
    mode: 'subscription',
    payment_status: 'unpaid',
    client_reference_id: uid,
    customer: 'cus_async',
    subscription: 'sub_async',
  };
  const callsBefore = fake.calls.length;
  const completed = await postWebhook(server.base, eventBody('checkout.session.completed', session));
  assert.equal(completed.status, 200);
  assert.equal(completed.body.outcome, 'awaiting-payment');
  assert.equal(fake.calls.length, callsBefore, 'no subscription retrieved for an unpaid session');
  assert.equal((await account(client)).granted, false);
  assert.equal((await account(client)).status, 'none');

  const succeeded = await postWebhook(
    server.base,
    eventBody('checkout.session.async_payment_succeeded', { ...session, payment_status: 'paid' }),
  );
  assert.equal(succeeded.body.outcome, 'synced');
  assert.equal((await account(client)).granted, true);

  // A different writer whose bank debit fails: the subscription Stripe
  // reports is incomplete -> nothing granted.
  const c2 = await signedIn(server.base, 'bankfail@example.com');
  const uid2 = await userId('bankfail@example.com');
  setSub(subscription('sub_async_fail', 'cus_async_fail', 'incomplete', { userId: uid2 }));
  const failed = await postWebhook(
    server.base,
    eventBody('checkout.session.async_payment_failed', {
      ...session,
      id: 'cs_async_fail',
      client_reference_id: uid2,
      customer: 'cus_async_fail',
      subscription: 'sub_async_fail',
    }),
  );
  assert.equal(failed.body.outcome, 'synced');
  const s2 = await account(c2);
  assert.equal(s2.status, 'incomplete');
  assert.equal(s2.granted, false);
});

/* ---------------- ordering ---------------- */

test('out-of-order delivery: a stale "updated(active)" arriving after "deleted" cannot re-grant a cancelled writer', async () => {
  const client = await signedIn(server.base, 'cancelled@example.com');
  const uid = await userId('cancelled@example.com');
  setSub(subscription('sub_order', 'cus_order', 'active', { userId: uid }));
  const created = eventBody('customer.subscription.created', fake.subs.get('sub_order')!);
  const staleActive = eventBody('customer.subscription.updated', { ...fake.subs.get('sub_order')!, status: 'active' });
  await postWebhook(server.base, created);
  assert.equal((await account(client)).granted, true);

  // The writer cancels. Stripe now reports canceled.
  setSub(subscription('sub_order', 'cus_order', 'canceled', { userId: uid }));
  const deleted = eventBody('customer.subscription.deleted', { ...fake.subs.get('sub_order')! });
  await postWebhook(server.base, deleted);
  assert.equal((await account(client)).status, 'canceled');

  // The older "updated" (body says active) is delivered late.
  const late = await postWebhook(server.base, staleActive);
  assert.equal(late.status, 200);
  const state = await account(client);
  assert.equal(state.status, 'canceled', 'the retrieved state wins, not the stale event body');
  assert.equal(state.granted, false);

  // And the reverse arrival order lands in the same place.
  const c2 = await signedIn(server.base, 'reverse@example.com');
  const uid2 = await userId('reverse@example.com');
  setSub(subscription('sub_rev', 'cus_rev', 'canceled', { userId: uid2 }));
  await postWebhook(server.base, eventBody('customer.subscription.deleted', { id: 'sub_rev', object: 'subscription' }));
  await postWebhook(server.base, eventBody('customer.subscription.created', { id: 'sub_rev', object: 'subscription', status: 'active' }));
  await postWebhook(server.base, eventBody('invoice.paid', { id: 'in_rev', object: 'invoice', customer: 'cus_rev' }));
  assert.equal((await account(c2)).status, 'canceled');
  assert.equal((await account(c2)).granted, false);
});

/* ---------------- grace (P2) ---------------- */

test('past_due: inside the 7-day grace entitlements stay; after it they stop; unpaid revokes at once', async () => {
  const client = await signedIn(server.base, 'latecard@example.com');
  const uid = await userId('latecard@example.com');
  setSub(subscription('sub_late', 'cus_late', 'active', { userId: uid }));
  await postWebhook(server.base, eventBody('customer.subscription.created', { id: 'sub_late', object: 'subscription' }));

  const start = clock;
  try {
    setSub(subscription('sub_late', 'cus_late', 'past_due', { userId: uid }));
    await postWebhook(server.base, eventBody('invoice.payment_failed', { id: 'in_late', object: 'invoice', customer: 'cus_late' }));
    let s = await account(client);
    assert.equal(s.status, 'past_due');
    assert.equal(s.granted, true);
    assert.equal(s.graceEndsAt, new Date(start.getTime() + 7 * DAY).toISOString());

    // A later past_due event does not restart the clock.
    clock = new Date(start.getTime() + 3 * DAY);
    await postWebhook(server.base, eventBody('customer.subscription.updated', { id: 'sub_late', object: 'subscription' }));
    clock = new Date(start.getTime() + 6 * DAY + 23 * 3_600_000);
    s = await account(client);
    assert.equal(s.granted, true, 'still inside grace at 6d23h');
    assert.deepEqual(s.entitlements, ['fixture.feature-one', 'fixture.feature-two']);

    clock = new Date(start.getTime() + 7 * DAY + 60_000);
    s = await account(client);
    assert.equal(s.status, 'past_due');
    assert.equal(s.granted, false, 'grace is over');
    assert.deepEqual(s.entitlements, []);

    // Card fixed: Stripe reports active again.
    setSub(subscription('sub_late', 'cus_late', 'active', { userId: uid }));
    await postWebhook(server.base, eventBody('invoice.paid', { id: 'in_late2', object: 'invoice', customer: 'cus_late' }));
    assert.equal((await account(client)).granted, true);

    // unpaid: "revoke access" — no grace.
    setSub(subscription('sub_late', 'cus_late', 'unpaid', { userId: uid }));
    await postWebhook(server.base, eventBody('customer.subscription.updated', { id: 'sub_late', object: 'subscription' }));
    s = await account(client);
    assert.equal(s.status, 'unpaid');
    assert.equal(s.granted, false);
  } finally {
    clock = start;
  }
});

/* ---------------- refunds / disputes (P3) ---------------- */

test('refund and dispute follow the subscription status Stripe reports', async () => {
  const client = await signedIn(server.base, 'refund@example.com');
  const uid = await userId('refund@example.com');
  setSub(subscription('sub_ref', 'cus_ref', 'active', { userId: uid }));
  await postWebhook(server.base, eventBody('customer.subscription.created', { id: 'sub_ref', object: 'subscription' }));

  // A partial refund while the subscription stays active: access stays.
  const refunded = await postWebhook(
    server.base,
    eventBody('charge.refunded', { id: 'ch_ref1', object: 'charge', customer: 'cus_ref', refunded: false }),
  );
  assert.equal(refunded.body.outcome, 'synced');
  assert.equal((await account(client)).granted, true);

  // A dispute; V cancelled the subscription in the Dashboard. The
  // dispute carries only the charge id, so the charge is retrieved.
  setSub(subscription('sub_ref', 'cus_ref', 'canceled', { userId: uid }));
  fake.charges.set('ch_ref2', { id: 'ch_ref2', object: 'charge', customer: 'cus_ref', livemode: false });
  const disputed = await postWebhook(
    server.base,
    eventBody('charge.dispute.created', { id: 'du_ref', object: 'dispute', charge: 'ch_ref2' }),
  );
  assert.equal(disputed.body.outcome, 'synced');
  assert.ok(fake.calls.includes('GET /v1/charges/ch_ref2'));
  const s = await account(client);
  assert.equal(s.status, 'canceled');
  assert.equal(s.granted, false);
});

/* ---------------- test vs live ---------------- */

test('test events never grant on a live server (and live events never on a test server); both are recorded', async () => {
  // A live-mode server receives a TEST event (a test whsec_ left in prod).
  const client = await signedIn(liveServer.base, 'liveuser@example.com');
  const uid = await userId('liveuser@example.com');
  setSub(subscription('sub_testmode', 'cus_testmode', 'active', { userId: uid, livemode: false }));
  const res = await postWebhook(
    liveServer.base,
    eventBody('customer.subscription.created', { id: 'sub_testmode', object: 'subscription' }, { id: 'evt_test_on_live', livemode: false }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'ignored-wrong-mode');
  assert.equal(res.body.ignored, true);
  assert.equal((await account(client)).granted, false);
  const ledger = await db.query<{ outcome: string; livemode: boolean; processed_at: string | null }>(
    'select outcome, livemode, processed_at from billing_events where event_id = $1',
    ['evt_test_on_live'],
  );
  assert.equal(ledger.rows[0].outcome, 'ignored-wrong-mode');
  assert.equal(ledger.rows[0].livemode, false);
  assert.ok(ledger.rows[0].processed_at);

  // Belt and braces: a live-labelled event whose RETRIEVED subscription
  // is a test object is also refused.
  const sneaky = await postWebhook(
    liveServer.base,
    eventBody('customer.subscription.created', { id: 'sub_testmode', object: 'subscription' }, { livemode: true }),
  );
  assert.equal(sneaky.body.outcome, 'ignored-wrong-mode');
  assert.equal((await account(client)).granted, false);

  // A LIVE event on the test-mode server.
  const tclient = await signedIn(server.base, 'testuser@example.com');
  const tuid = await userId('testuser@example.com');
  setSub(subscription('sub_livemode', 'cus_livemode', 'active', { userId: tuid, livemode: true }));
  const res2 = await postWebhook(
    server.base,
    eventBody('customer.subscription.created', { id: 'sub_livemode', object: 'subscription' }, { livemode: true }),
  );
  assert.equal(res2.body.outcome, 'ignored-wrong-mode');
  assert.equal((await account(tclient)).granted, false);
});

/* ---------------- attribution (P5) ---------------- */

test('no email attribution: a subscription for an unknown customer is stored unattributed and Housekeeping lists it', async () => {
  const client = await signedIn(server.base, 'emailmatch@example.com');
  // Created outside our checkout (Dashboard / Payment Link): no user id,
  // a customer we never stored — even though the email matches a user.
  setSub(subscription('sub_stranger', 'cus_stranger', 'active'));
  const res = await postWebhook(
    server.base,
    eventBody('customer.subscription.created', {
      id: 'sub_stranger',
      object: 'subscription',
      customer_email: 'emailmatch@example.com',
      customer_details: { email: 'emailmatch@example.com' },
    }),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.outcome, 'unattributed');
  assert.equal((await account(client)).granted, false, 'an email match grants nothing');
  const row = await db.query<{ user_id: string | null }>(
    'select user_id from billing_subscriptions where stripe_subscription_id = $1',
    ['sub_stranger'],
  );
  assert.equal(row.rows[0].user_id, null);

  // A checkout session with only an email is unattributed too.
  const checkoutByEmail = await postWebhook(
    server.base,
    eventBody('checkout.session.completed', {
      id: 'cs_email',
      object: 'checkout.session',
      mode: 'subscription',
      payment_status: 'paid',
      customer_email: 'emailmatch@example.com',
      customer: 'cus_stranger2',
      subscription: 'sub_stranger',
    }),
  );
  assert.equal(checkoutByEmail.body.outcome, 'unattributed');

  const check = SELF_CHECK_CASES.find((c) => c.id === 'billing.subscriptions.attributed')!;
  await assert.rejects(check.run!({ db, config: server.config } as CheckContext), /sub_stranger \(customer cus_stranger, active\)/);

  // Once the subscription ends it stops being a live problem.
  setSub(subscription('sub_stranger', 'cus_stranger', 'canceled'));
  await postWebhook(server.base, eventBody('customer.subscription.deleted', { id: 'sub_stranger', object: 'subscription' }));
  const detail = await check.run!({ db, config: server.config } as CheckContext);
  assert.match(detail, /every non-terminal subscription is attributed/);
});

test('irrelevant event types and one-time-payment checkouts are acknowledged and change nothing', async () => {
  const a = await postWebhook(server.base, eventBody('payment_intent.succeeded', { id: 'pi_x', customer: 'cus_x' }));
  assert.equal(a.status, 200);
  assert.equal(a.body.outcome, 'ignored-type');
  assert.equal(a.body.ignored, true);
  const b = await postWebhook(server.base, eventBody('checkout.session.completed', { id: 'cs_pay', mode: 'payment', payment_status: 'paid' }));
  assert.equal(b.body.outcome, 'ignored-not-subscription');
});

/* ---------------- P4: a lapsed writer loses nothing ---------------- */

test('P4: a lapsed writer can still list, read, save and export their books, and their beta share links still work', async () => {
  const writer = await signedIn(server.base, 'lapsed@example.com');
  const uid = await userId('lapsed@example.com');
  setSub(subscription('sub_lapsed', 'cus_lapsed', 'active', { userId: uid }));
  await postWebhook(server.base, eventBody('customer.subscription.created', { id: 'sub_lapsed', object: 'subscription' }));
  assert.equal((await account(writer)).granted, true);

  // Work made while subscribed.
  const doc = {
    meta: { title: 'The Lantern Coast', author: 'April Carooke', language: 'en' },
    sections: [{ id: 'sec-one', kind: 'body', type: 'chapter', title: 'First Light', content: 'It began with the tide.' }],
    images: [],
  };
  const created = await writer.post('/api/manuscripts', { doc });
  assert.equal(created.status, 201);
  const mid = (created.body.manuscript as { id: string }).id;
  const bytes = Buffer.from('PK\x03\x04 fixture epub bytes');
  const saved = await writer.upload(`/api/exports?manuscriptId=${mid}&format=epub&filename=lantern.epub`, bytes);
  assert.equal(saved.status, 201);
  const exportId = (saved.body.export as { id: string }).id;
  const share = await writer.post('/api/shares', { manuscriptId: mid });
  assert.equal(share.status, 201, JSON.stringify(share.body));
  const token = share.body.token as string;

  // The subscription lapses: cancelled, and past any grace.
  setSub(subscription('sub_lapsed', 'cus_lapsed', 'canceled', { userId: uid }));
  await postWebhook(server.base, eventBody('customer.subscription.deleted', { id: 'sub_lapsed', object: 'subscription' }));
  const lapsed = await account(writer);
  assert.equal(lapsed.status, 'canceled');
  assert.equal(lapsed.granted, false);
  assert.deepEqual(lapsed.entitlements, []);

  // Everything they wrote is still theirs.
  const list = await writer.get('/api/manuscripts');
  assert.equal(list.status, 200);
  assert.ok((list.body.manuscripts as Array<{ id: string }>).some((m) => m.id === mid));
  const read = await writer.get(`/api/manuscripts/${mid}`);
  assert.equal(read.status, 200);
  assert.equal(JSON.stringify(read.body).includes('It began with the tide.'), true);
  const revision = (read.body.manuscript as { revision: number }).revision;
  const put = await writer.put(`/api/manuscripts/${mid}`, { doc: { ...doc, meta: { ...doc.meta, title: 'The Lantern Coast (rev)' } }, revision });
  assert.equal(put.status, 200, `saving still works: ${JSON.stringify(put.body)}`);

  const exportsList = await writer.get('/api/exports');
  assert.equal(exportsList.status, 200);
  const download = await writer.download(`/api/exports/${exportId}/download`);
  assert.equal(download.status, 200);
  assert.deepEqual(download.bytes, bytes);
  const newExport = await writer.upload(`/api/exports?manuscriptId=${mid}&format=epub&filename=lantern2.epub`, bytes);
  assert.equal(newExport.status, 201, 'a new export can still be saved');

  const reader = await fetch(`${server.base}/read/${token}`);
  assert.equal(reader.status, 200, 'the beta-reader link still opens');
  assert.match(await reader.text(), /It began with the tide\./);
});

/* ---------------- pure pieces ---------------- */

test('decideEntitlements: status policy table (fixture prices, not real pricing)', () => {
  const table = parseEntitlements({
    prices: {
      [PRICE_A]: { label: 'fixture-label-a', entitlements: ['fixture.one'] },
      [PRICE_B]: { entitlements: ['fixture.two'] },
    },
  });
  const now = new Date('2026-10-25T00:00:00Z');
  const row = (status: string, extra: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
    stripe_subscription_id: `sub_${status}`,
    status,
    status_since: now,
    price_ids: [PRICE_A],
    current_period_end: null,
    cancel_at_period_end: false,
    livemode: false,
    updated_at: now,
    ...extra,
  });
  const cases: Array<[string, Partial<SubscriptionRow>, boolean]> = [
    ['active', {}, true],
    ['trialing', {}, true],
    ['past_due', {}, true],
    ['past_due', { status_since: new Date(now.getTime() - 8 * DAY) }, false],
    ['canceled', {}, false],
    ['unpaid', {}, false],
    ['incomplete', {}, false],
    ['incomplete_expired', {}, false],
    ['paused', {}, false],
  ];
  for (const [status, extra, expected] of cases) {
    const d = decideEntitlements([row(status, extra)], table, 7, now);
    assert.equal(d.granted, expected, `${status} ${JSON.stringify(extra)}`);
    assert.deepEqual(d.entitlements, expected ? ['fixture.one'] : []);
  }
  // Grace 0 = no grace.
  assert.equal(decideEntitlements([row('past_due')], table, 0, now).granted, false);
  // A price absent from the file grants no entitlement.
  const unknown = decideEntitlements([row('active', { price_ids: ['price_not_in_file'] })], table, 7, now);
  assert.equal(unknown.granted, true);
  assert.deepEqual(unknown.entitlements, []);
  // A granting subscription beats a newer cancelled one.
  const mixed = decideEntitlements(
    [row('canceled', { updated_at: new Date(now.getTime() + 1000) }), row('active', { price_ids: [PRICE_B] })],
    table,
    7,
    now,
  );
  assert.equal(mixed.status, 'active');
  assert.deepEqual(mixed.entitlements, ['fixture.two']);
  assert.equal(decideEntitlements([], table, 7, now).status, 'none');
});

test('parseEntitlements rejects malformed files; parseSubscription reads item-level period ends', () => {
  assert.throws(() => parseEntitlements([]), /top level/);
  assert.throws(() => parseEntitlements({ prices: { notaprice: { entitlements: [] } } }), /not a Stripe price id/);
  assert.throws(() => parseEntitlements({ prices: { price_x: { entitlements: ['Bad Name'] } } }), /lowercase/);
  assert.throws(() => parseEntitlements({ prices: { price_x: { entitlements: [], label: '' } } }), /label/);

  const s = parseSubscription(subscription('sub_p', 'cus_p', 'active', { periodEnd: 1_800_000_000 }));
  assert.equal(s.currentPeriodEnd?.toISOString(), new Date(1_800_000_000 * 1000).toISOString());
  assert.deepEqual(s.priceIds, [PRICE_A]);
  assert.throws(() => parseSubscription({ id: 'x' }), /not a subscription/);
});

test('migration 012 relaxed users.plan to a display label (P1)', async () => {
  const uid = await userId('buyer@example.com');
  await db.query(`update users set plan = 'any-label-from-the-file' where id = $1`, [uid]);
  const row = await db.query<{ plan: string }>('select plan from users where id = $1', [uid]);
  assert.equal(row.rows[0].plan, 'any-label-from-the-file');
});
