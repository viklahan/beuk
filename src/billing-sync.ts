import type { BillingEvent, BillingProvider, StripeSubscription } from './billing.js';
import type { Db } from './db.js';
import { entitlementsFor, type EntitlementsTable } from './entitlements.js';
import { isUuid } from './ids.js';

/**
 * Webhook event → stored billing state. Shared rules:
 *
 * 1. Idempotent, keyed on the Stripe event id (billing_events). Stripe:
 *    "Webhook endpoints might occasionally receive the same event more
 *    than once ... logging the event IDs you've processed, and then not
 *    processing already-logged events."
 *    https://docs.stripe.com/webhooks#handle-duplicate-events
 * 2. Order-independent: an event only names the object that changed; the
 *    current Subscription is RETRIEVED from the API under a per-
 *    subscription advisory lock, so the newest state always wins whichever
 *    delivery lands first. Stripe: "Stripe doesn't guarantee the delivery
 *    of events in the order that they're generated ... You can also use
 *    the API to retrieve any missing objects."
 *    https://docs.stripe.com/webhooks#event-ordering
 * 3. Attribution without guessing (P5): our user id from checkout
 *    (client_reference_id / metadata.userId / subscription metadata),
 *    else the stored customer id, else the existing subscription row.
 *    Never the email. Unattributed subscriptions are stored with no user
 *    and surface in Housekeeping.
 * 4. Refunds and disputes (P3) do not decide anything themselves: they
 *    re-sync the customer's subscriptions and the status Stripe reports
 *    is applied — one source of truth.
 */

export type Outcome =
  | 'synced'
  | 'awaiting-payment'
  | 'ignored-type'
  | 'ignored-not-subscription'
  | 'ignored-wrong-mode'
  | 'unattributed'
  | 'no-subscription'
  | 'customer-conflict';

export interface SyncDeps {
  db: Db;
  provider: BillingProvider;
  table: EntitlementsTable;
  graceDays: number;
  now: () => Date;
}

export interface HandleResult {
  outcome: Outcome;
  userId: string | null;
  objectId: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function idOf(value: unknown): string | null {
  return str(value) ?? (value && typeof value === 'object' ? str((value as Record<string, unknown>).id) : null);
}

async function userExists(db: Db, id: string | null): Promise<string | null> {
  if (!id || !isUuid(id)) return null;
  const found = await db.query<{ id: string }>('select id from users where id = $1', [id]);
  return found.rows[0]?.id ?? null;
}

async function userByCustomer(db: Db, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const found = await db.query<{ id: string }>('select id from users where stripe_customer_id = $1', [customerId]);
  return found.rows[0]?.id ?? null;
}

/** Link a Stripe customer to a user, but never steal it from another
 *  user and never overwrite a different stored customer (that would
 *  also trip the unique constraint and make Stripe retry for 3 days).
 *  Returns false on a conflict. */
async function linkCustomer(db: Db, userId: string, customerId: string): Promise<boolean> {
  const updated = await db.query<{ id: string }>(
    `update users set stripe_customer_id = $2
     where id = $1 and stripe_customer_id is null
       and not exists (select 1 from users where stripe_customer_id = $2)
     returning id`,
    [userId, customerId],
  );
  if (updated.rows.length) return true;
  const current = await db.query<{ stripe_customer_id: string | null }>(
    'select stripe_customer_id from users where id = $1',
    [userId],
  );
  return current.rows[0]?.stripe_customer_id === customerId;
}

/** Recompute the cached display label (P1: users.plan is display only). */
export async function refreshPlanLabel(deps: SyncDeps, userId: string): Promise<void> {
  const livemode = deps.provider.mode === null ? null : deps.provider.mode === 'live';
  const state = await entitlementsFor(deps.db, userId, {
    table: deps.table,
    graceDays: deps.graceDays,
    now: deps.now(),
    livemode,
  });
  // 'free' / 'pro' are the labels migration 005 already used; a label
  // from the entitlements file wins when the granting price has one.
  const label = state.granted ? (state.label ?? 'pro') : 'free';
  await deps.db.query(
    `update users set plan = $2, plan_updated_at = $3 where id = $1 and plan is distinct from $2`,
    [userId, label, deps.now()],
  );
}

/** Retrieve one subscription from Stripe and store it. */
export async function syncSubscription(
  deps: SyncDeps,
  subscriptionId: string,
  hintUserId: string | null,
  eventId: string,
): Promise<{ userId: string | null; wrongMode: boolean }> {
  const expectLive = deps.provider.mode === 'live';
  const result = await deps.db.tx(async (tx) => {
    // Serialise concurrent syncs of the same subscription, and fetch
    // INSIDE the lock, so a slower, older read cannot overwrite a newer one.
    await tx.query('select pg_advisory_xact_lock(hashtext($1))', [`billing:${subscriptionId}`]);
    const sub: StripeSubscription = await deps.provider.retrieveSubscription(subscriptionId);
    if (sub.livemode !== expectLive) return { userId: null, previousUserId: null, wrongMode: true };

    const existing = await tx.query<{ user_id: string | null; status: string; status_since: string }>(
      'select user_id, status, status_since from billing_subscriptions where stripe_subscription_id = $1',
      [sub.id],
    );
    const prev = existing.rows[0];
    const userId =
      (await userExists(tx, hintUserId)) ??
      (await userExists(tx, sub.metadataUserId)) ??
      (prev?.user_id ?? null) ??
      (await userByCustomer(tx, sub.customer));
    const now = deps.now();
    const statusSince = prev && prev.status === sub.status ? prev.status_since : now;
    await tx.query(
      `insert into billing_subscriptions
         (stripe_subscription_id, user_id, stripe_customer_id, status, status_since,
          price_ids, current_period_end, cancel_at_period_end, livemode, updated_at, last_event_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (stripe_subscription_id) do update set
         user_id = excluded.user_id,
         stripe_customer_id = excluded.stripe_customer_id,
         status = excluded.status,
         status_since = excluded.status_since,
         price_ids = excluded.price_ids,
         current_period_end = excluded.current_period_end,
         cancel_at_period_end = excluded.cancel_at_period_end,
         livemode = excluded.livemode,
         updated_at = excluded.updated_at,
         last_event_id = excluded.last_event_id`,
      [
        sub.id,
        userId,
        sub.customer,
        sub.status,
        statusSince,
        sub.priceIds,
        sub.currentPeriodEnd,
        sub.cancelAtPeriodEnd,
        sub.livemode,
        now,
        eventId,
      ],
    );
    if (userId) await linkCustomer(tx, userId, sub.customer);
    return { userId, previousUserId: prev?.user_id ?? null, wrongMode: false };
  });
  for (const uid of new Set([result.userId, result.previousUserId])) {
    if (uid) await refreshPlanLabel(deps, uid);
  }
  return { userId: result.userId, wrongMode: result.wrongMode };
}

async function syncCustomer(deps: SyncDeps, customerId: string, eventId: string): Promise<HandleResult> {
  const ids = await deps.provider.listCustomerSubscriptionIds(customerId);
  if (!ids.length) {
    return { outcome: 'no-subscription', userId: await userByCustomer(deps.db, customerId), objectId: customerId };
  }
  let userId: string | null = null;
  let wrongMode = false;
  for (const id of ids) {
    const r = await syncSubscription(deps, id, null, eventId);
    userId ??= r.userId;
    wrongMode ||= r.wrongMode;
  }
  if (wrongMode && !userId) return { outcome: 'ignored-wrong-mode', userId: null, objectId: customerId };
  return { outcome: userId ? 'synced' : 'unattributed', userId, objectId: customerId };
}

const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.trial_will_end',
]);

/** Dispatch one verified, mode-checked, not-yet-processed event. */
export async function handleEvent(deps: SyncDeps, event: BillingEvent): Promise<HandleResult> {
  const obj = event.data.object;
  const objectId = str(obj.id);

  switch (event.type) {
    // Checkout fulfillment (https://docs.stripe.com/checkout/fulfillment):
    // "Check the payment_status property to determine if it requires
    // fulfillment" — the guide fulfils only when payment_status !=
    // 'unpaid'; delayed methods (bank debits) complete the session
    // unpaid and later send checkout.session.async_payment_succeeded.
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      if (obj.mode !== 'subscription') return { outcome: 'ignored-not-subscription', userId: null, objectId };
      const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
      const customerId = idOf(obj.customer);
      const userId =
        (await userExists(deps.db, str(metadata.userId))) ??
        (await userExists(deps.db, str(obj.client_reference_id))) ??
        (await userByCustomer(deps.db, customerId));
      if (!userId) return { outcome: 'unattributed', userId: null, objectId };
      if (customerId && !(await linkCustomer(deps.db, userId, customerId))) {
        // The user already has a DIFFERENT customer, or another user owns
        // this one: change nothing; Housekeeping shows the event.
        return { outcome: 'customer-conflict', userId, objectId };
      }
      if (event.type === 'checkout.session.completed' && obj.payment_status === 'unpaid') {
        return { outcome: 'awaiting-payment', userId, objectId };
      }
      const subscriptionId = idOf(obj.subscription);
      if (!subscriptionId) return { outcome: 'no-subscription', userId, objectId };
      const r = await syncSubscription(deps, subscriptionId, userId, event.id);
      return { outcome: r.wrongMode ? 'ignored-wrong-mode' : 'synced', userId: r.userId, objectId };
    }

    // invoice.paid / invoice.payment_failed: re-sync the customer's
    // subscriptions (after invoice.paid "retrieve the associated
    // subscription and confirm that its status is active",
    // https://docs.stripe.com/billing/subscriptions/webhooks#track-active-subscriptions).
    // Re-syncing by customer avoids depending on where the invoice keeps
    // its subscription id, which differs between API versions.
    case 'invoice.paid':
    case 'invoice.payment_failed': {
      const customerId = idOf(obj.customer);
      if (!customerId) return { outcome: 'unattributed', userId: null, objectId };
      return syncCustomer(deps, customerId, event.id);
    }

    // P3: refunds and disputes follow the subscription status Stripe
    // reports. charge.refunded "Contains the updated Charge";
    // charge.dispute.created "Contains a Dispute, which exposes charge"
    // (https://docs.stripe.com/billing/subscriptions/webhooks#refund-events).
    // A Charge carries `customer` (https://docs.stripe.com/api/charges/object);
    // a Dispute does not, so its charge is retrieved.
    case 'charge.refunded': {
      const customerId = idOf(obj.customer);
      if (!customerId) return { outcome: 'unattributed', userId: null, objectId };
      return syncCustomer(deps, customerId, event.id);
    }
    case 'charge.dispute.created': {
      const chargeId = idOf(obj.charge);
      if (!chargeId) return { outcome: 'unattributed', userId: null, objectId };
      const charge = await deps.provider.retrieveCharge(chargeId);
      if (!charge.customer) return { outcome: 'unattributed', userId: null, objectId };
      return syncCustomer(deps, charge.customer, event.id);
    }

    default: {
      if (SUBSCRIPTION_EVENTS.has(event.type)) {
        if (!objectId) return { outcome: 'unattributed', userId: null, objectId };
        const r = await syncSubscription(deps, objectId, null, event.id);
        if (r.wrongMode) return { outcome: 'ignored-wrong-mode', userId: null, objectId };
        return { outcome: r.userId ? 'synced' : 'unattributed', userId: r.userId, objectId };
      }
      return { outcome: 'ignored-type', userId: null, objectId };
    }
  }
}

/** The whole webhook pipeline after signature verification. Returns the
 *  JSON the route answers with; throws (→ 500, Stripe retries) only when
 *  handling failed, and then the event stays unprocessed. */
export async function processVerifiedEvent(
  deps: SyncDeps,
  event: BillingEvent,
): Promise<Record<string, unknown>> {
  const objectId = str(event.data.object.id);
  // Ledger first. `inserted` tells a first delivery from a redelivery.
  const ledger = await deps.db.query<{ processed_at: string | null; outcome: string | null }>(
    `insert into billing_events (event_id, type, livemode, object_id, received_at)
     values ($1, $2, $3, $4, $5)
     on conflict (event_id) do update set attempts = billing_events.attempts + 1
     returning processed_at, outcome`,
    [event.id, event.type, event.livemode, objectId, deps.now()],
  );
  const row = ledger.rows[0];
  if (row?.processed_at) {
    return { received: true, duplicate: true, outcome: row.outcome };
  }

  const finish = async (result: HandleResult) => {
    await deps.db.query(
      `update billing_events set processed_at = $2, outcome = $3, user_id = $4, error = null
       where event_id = $1`,
      [event.id, deps.now(), result.outcome, result.userId],
    );
    return {
      received: true,
      outcome: result.outcome,
      ...(result.outcome.startsWith('ignored') ? { ignored: true } : {}),
    };
  };

  // Test vs live honesty: Stripe signs test and live deliveries with
  // different secrets ("If you use the same endpoint for both test and
  // live API keys, the secret is different for each one",
  // https://docs.stripe.com/webhooks#verify-events) — but a test-mode
  // whsec_ left on a live server would still verify test events. So the
  // event's own livemode must match the server's key mode; a mismatch is
  // recorded and changes nothing.
  const serverLive = deps.provider.mode === 'live';
  if (event.livemode !== serverLive) {
    return finish({ outcome: 'ignored-wrong-mode', userId: null, objectId });
  }

  try {
    return await finish(await handleEvent(deps, event));
  } catch (err) {
    await deps.db.query('update billing_events set error = $2 where event_id = $1', [
      event.id,
      String((err as Error).message ?? err).slice(0, 500),
    ]);
    throw err;
  }
}
