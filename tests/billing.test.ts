import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Client, createTestDb, registerUser, startTestServer, type TestServer } from './helpers.js';
import type { Db } from '../src/db.js';

// A placeholder fixture secret for tests only — not a real key.
const WEBHOOK_SECRET = 'whsec_test_placeholder_not_a_real_key';
const CUSTOMER_ID = 'cus_test_fixture';

let db: Db;
let plainServer: TestServer; // no Stripe keys at all
let hookServer: TestServer; // webhook secret set, no price/API key

function sign(rawBody: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  return `t=${t},v1=${v1}`;
}

async function postWebhook(
  base: string,
  rawBody: string,
  signature: string | null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) headers['stripe-signature'] = signature;
  const res = await fetch(`${base}/api/billing/webhook`, { method: 'POST', headers, body: rawBody });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
}

function eventBody(type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id: 'evt_test', type, data: { object } });
}

async function planOf(email: string): Promise<{ plan: string; plan_updated_at: string | null; stripe_customer_id: string | null }> {
  const found = await db.query<{ plan: string; plan_updated_at: string | null; stripe_customer_id: string | null }>(
    'select plan, plan_updated_at, stripe_customer_id from users where email = $1',
    [email],
  );
  return found.rows[0];
}

before(async () => {
  db = await createTestDb();
  plainServer = await startTestServer(db);
  hookServer = await startTestServer(db, undefined, { stripeWebhookSecret: WEBHOOK_SECRET });
});

after(async () => {
  await plainServer.close();
  await hookServer.close();
});

test('checkout with no Stripe keys is a clean 501, webhook too', async () => {
  const client = new Client(plainServer.base);
  await registerUser(client, 'nocfg@example.com');

  const checkout = await client.post('/api/billing/checkout');
  assert.equal(checkout.status, 501);
  assert.match(String(checkout.body.error), /not configured/i);

  const webhook = await postWebhook(plainServer.base, eventBody('checkout.session.completed', {}), 't=1,v1=abc');
  assert.equal(webhook.status, 501);

  // Checkout still requires auth even before it is configured.
  const anon = new Client(plainServer.base);
  assert.equal((await anon.post('/api/billing/checkout')).status, 401);
});

test('a correctly signed checkout.session.completed flips the plan to pro', async () => {
  const client = new Client(hookServer.base);
  await registerUser(client, 'buyer@example.com');
  assert.equal((await planOf('buyer@example.com')).plan, 'free');

  const raw = eventBody('checkout.session.completed', {
    customer: CUSTOMER_ID,
    customer_email: 'buyer@example.com',
    mode: 'subscription',
  });
  const res = await postWebhook(hookServer.base, raw, sign(raw, WEBHOOK_SECRET));
  assert.equal(res.status, 200);

  const afterState = await planOf('buyer@example.com');
  assert.equal(afterState.plan, 'pro');
  assert.ok(afterState.plan_updated_at);
  assert.equal(afterState.stripe_customer_id, CUSTOMER_ID);

  // Checkout remains unconfigured here (webhook secret only, no price):
  assert.equal((await client.post('/api/billing/checkout')).status, 501);
});

test('bad or missing signatures are rejected and change nothing', async () => {
  const client = new Client(hookServer.base);
  await registerUser(client, 'victim@example.com');

  const raw = eventBody('checkout.session.completed', {
    customer: 'cus_evil',
    customer_email: 'victim@example.com',
  });
  const forged = await postWebhook(hookServer.base, raw, sign(raw, 'whsec_wrong_secret'));
  assert.equal(forged.status, 400);

  const unsigned = await postWebhook(hookServer.base, raw, null);
  assert.equal(unsigned.status, 400);

  const garbage = await postWebhook(hookServer.base, raw, 'not-a-signature');
  assert.equal(garbage.status, 400);

  const state = await planOf('victim@example.com');
  assert.equal(state.plan, 'free');
  assert.equal(state.plan_updated_at, null);
  assert.equal(state.stripe_customer_id, null);
});

test('subscription lifecycle events drive the plan via the stored customer id', async () => {
  // buyer@example.com went pro in the earlier test, linked to CUSTOMER_ID.
  const deleted = eventBody('customer.subscription.deleted', { customer: CUSTOMER_ID, status: 'canceled' });
  const res1 = await postWebhook(hookServer.base, deleted, sign(deleted, WEBHOOK_SECRET));
  assert.equal(res1.status, 200);
  assert.equal((await planOf('buyer@example.com')).plan, 'free');

  const active = eventBody('customer.subscription.updated', { customer: CUSTOMER_ID, status: 'active' });
  const res2 = await postWebhook(hookServer.base, active, sign(active, WEBHOOK_SECRET));
  assert.equal(res2.status, 200);
  assert.equal((await planOf('buyer@example.com')).plan, 'pro');

  const canceled = eventBody('customer.subscription.updated', { customer: CUSTOMER_ID, status: 'canceled' });
  const res3 = await postWebhook(hookServer.base, canceled, sign(canceled, WEBHOOK_SECRET));
  assert.equal(res3.status, 200);
  assert.equal((await planOf('buyer@example.com')).plan, 'free');
});

test('verified but irrelevant or unattributable events are acknowledged, changing nothing', async () => {
  const irrelevant = eventBody('payment_intent.succeeded', { customer: CUSTOMER_ID });
  const res1 = await postWebhook(hookServer.base, irrelevant, sign(irrelevant, WEBHOOK_SECRET));
  assert.equal(res1.status, 200);
  assert.equal(res1.body.ignored, true);

  const stranger = eventBody('checkout.session.completed', { customer_email: 'nobody@example.com' });
  const res2 = await postWebhook(hookServer.base, stranger, sign(stranger, WEBHOOK_SECRET));
  assert.equal(res2.status, 200);
  assert.equal(res2.body.ignored, true);
});
