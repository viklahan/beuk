import type { BillingProvider } from '../billing.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { entitlementsFor, loadEntitlements, TERMINAL_STATUSES, type EntitlementState } from '../entitlements.js';

/**
 * The account page's "Plan" section and the account-deletion billing
 * step — the two seams the billing work fills in.
 *
 * V's decision (2026-10-26): a 7-day free trial that starts at account
 * sign-up, then ONE price for complete access. The price amount is a
 * setting that is NOT decided yet; while it is unset, nothing anywhere
 * shows or implies a price. Export always stays open, whatever the
 * account state ("never hold a book hostage").
 *
 * What exists in the code today: subscription rows from verified Stripe
 * webhooks and the entitlements decision over them (src/entitlements.ts).
 * There is NO trial clock in the code yet. `accountPlan` therefore
 * reports `trial: null` ("not tracked by this server yet") and the page
 * says nothing about a trial or a price. The billing wave fills in
 * `trial` here (computed from users.created_at + 7 days, or whatever
 * the billing work stores) and the page renders it without changes
 * elsewhere.
 */

export interface AccountTrial {
  startedAt: string;
  endsAt: string;
  /** true while now < endsAt. */
  active: boolean;
}

export interface AccountPlan {
  /** Billing set up on this server (keys + price + entitlements file). */
  billingConfigured: boolean;
  /** The server's Stripe mode, or null when unconfigured. */
  mode: 'test' | 'live' | null;
  /** The subscription decision for this account (status 'none' = no subscription). */
  subscription: EntitlementState;
  /** HOOK for the billing wave: the sign-up trial. null = not tracked yet. */
  trial: AccountTrial | null;
  /** Non-terminal subscription rows on this account: the ones deleting the
   *  account would leave running while cancelBillingForDeletedAccount
   *  cancels nothing. */
  liveSubscriptions: number;
}

export interface PlanDeps {
  db: Db;
  config: Config;
  billing: BillingProvider;
  now: () => Date;
}

/** HOOK (billing wave): everything the account page's Plan section shows. */
export async function accountPlan(deps: PlanDeps, user: { id: string; createdAt: string }): Promise<AccountPlan> {
  const loaded = loadEntitlements(deps.config);
  const table = loaded.ok ? loaded.table : { prices: {} };
  const mode = deps.billing.mode;
  const subscription = await entitlementsFor(deps.db, user.id, {
    table,
    graceDays: deps.config.billingGraceDays,
    now: deps.now(),
    livemode: mode === null ? null : mode === 'live',
  });
  return {
    billingConfigured: deps.billing.checkoutConfigured && loaded.ok,
    mode,
    subscription,
    // Billing wave: compute the trial from user.createdAt here.
    trial: null,
    liveSubscriptions: (await liveSubscriptionIds(deps.db, user.id)).length,
  };
}

async function liveSubscriptionIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db.query<{ stripe_subscription_id: string; status: string }>(
    'select stripe_subscription_id, status from billing_subscriptions where user_id = $1',
    [userId],
  );
  return rows.rows
    .filter((r) => !(TERMINAL_STATUSES as readonly string[]).includes(r.status))
    .map((r) => r.stripe_subscription_id);
}

export interface DeletionBillingOutcome {
  /** Subscriptions the provider cancelled. */
  cancelled: string[];
  /** Live (non-terminal) subscriptions this server could NOT cancel. They
   *  are left in billing_subscriptions with user_id null (unattributed),
   *  where Housekeeping lists them, so the operator can cancel them in
   *  the Stripe Dashboard. */
  leftForOperator: string[];
}

/**
 * HOOK (billing wave): cancel the account's live Stripe subscriptions
 * before the account is deleted. The BillingProvider in src/billing.ts
 * has no cancel call today, so this cancels nothing and reports every
 * live subscription as left for the operator. When the provider gains
 * `cancelSubscription(id)`, call it here for each live id.
 *
 * Runs BEFORE the deletion transaction. Must not throw for an ordinary
 * "could not cancel": the writer's right to delete the account does not
 * depend on Stripe answering.
 */
export async function cancelBillingForDeletedAccount(
  deps: { db: Db; billing: BillingProvider },
  userId: string,
): Promise<DeletionBillingOutcome> {
  const live = await liveSubscriptionIds(deps.db, userId);
  // TODO(billing wave): deps.billing.cancelSubscription(id) for each live id.
  return { cancelled: [], leftForOperator: live };
}
