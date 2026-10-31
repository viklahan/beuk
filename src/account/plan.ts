import { accountAccess, TRIAL_END_MIN_MS, type AccessState, type AccountTrial } from '../access.js';
import type { BillingProvider } from '../billing.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { TERMINAL_STATUSES, type EntitlementState } from '../entitlements.js';

export type { AccountTrial } from '../access.js';

/**
 * The account page's "Plan" section and the account-deletion billing
 * step.
 *
 * V's decision (2026-10-26, rules re-decided 2026-10-30): a 21-day free
 * trial that starts at account sign-up, then ONE price for complete
 * access. The price amount is a setting (BILLING_PRICE_LABEL, with
 * STRIPE_PRICE_ID); while it is unset, nothing anywhere shows or implies
 * a price. After the trial without a plan the store-ready files and the
 * account features lock, and the writer's own words (the backup file,
 * Word, Markdown, Download all my data) stay open ("never hold a book
 * hostage").
 *
 * Access is decided in src/access.ts (trial clock + the subscription
 * decision of src/entitlements.ts); this file only gathers what the page
 * shows.
 */

export interface AccountPlan {
  /** Billing switched on on this server (keys + price + valid entitlements file). */
  billingConfigured: boolean;
  /** The server's Stripe mode, or null when unconfigured. */
  mode: 'test' | 'live' | null;
  /** The subscription decision for this account (status 'none' = no subscription). */
  subscription: EntitlementState;
  /** The sign-up trial. null while billing is not switched on: then the
   *  page says nothing about a trial (nothing is paused, and no price is
   *  implied). */
  trial: AccountTrial | null;
  /** The derived access ('open' while billing is off). */
  access: AccessState;
  /** BILLING_PRICE_LABEL while billing is on; null = show no price. */
  priceLabel: string | null;
  /** This account is linked to a Stripe customer (from a verified
   *  webhook), so the Customer Portal has something to show. */
  hasBillingAccount: boolean;
  /** Choosing a plan now would not charge until the trial ends (enough
   *  trial left for Stripe's trial_end; see src/routes/billing.ts). */
  firstChargeWaits: boolean;
  /** Non-terminal subscription rows on this account. */
  liveSubscriptions: number;
  /** This server can cancel subscriptions itself (Stripe key configured),
   *  so deleting the account cancels them. */
  canCancel: boolean;
}

export interface PlanDeps {
  db: Db;
  config: Config;
  billing: BillingProvider;
  now: () => Date;
}

/** Everything the account page's Plan section shows. */
export async function accountPlan(deps: PlanDeps, user: { id: string; createdAt: string }): Promise<AccountPlan> {
  const access = await accountAccess(deps, user.id);
  if (!access) throw new Error('account not found');
  const customer = await deps.db.query<{ stripe_customer_id: string | null }>(
    'select stripe_customer_id from users where id = $1',
    [user.id],
  );
  return {
    billingConfigured: access.billingOn,
    mode: deps.billing.mode,
    subscription: access.subscription,
    trial: access.billingOn ? access.trial : null,
    access: access.state,
    priceLabel: access.priceLabel,
    hasBillingAccount: Boolean(customer.rows[0]?.stripe_customer_id),
    firstChargeWaits:
      access.billingOn && access.trial.active && new Date(access.trial.endsAt).getTime() - deps.now().getTime() >= TRIAL_END_MIN_MS,
    liveSubscriptions: (await liveSubscriptionIds(deps.db, user.id)).length,
    canCancel: deps.billing.configured,
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
 * Cancel the account's live Stripe subscriptions before the account is
 * deleted: immediately (DELETE /v1/subscriptions/:id), so the writer is
 * never charged again. Proration follows BILLING_CANCEL_PRORATE (default
 * false, Stripe's default: no credit for the unused part of the period;
 * true makes Stripe credit it to the customer balance, which is not a
 * refund — refunds are V's call, in the Dashboard).
 *
 * Honest fallback: without a working Stripe key (billing.configured is
 * false) nothing is cancelled and every live subscription is left for the
 * operator, as before. A cancel call that fails leaves that one for the
 * operator too. Never throws for an ordinary "could not cancel": the
 * writer's right to delete the account does not depend on Stripe.
 * Runs BEFORE the deletion transaction.
 */
export async function cancelBillingForDeletedAccount(
  deps: { db: Db; billing: BillingProvider; config?: Config },
  userId: string,
): Promise<DeletionBillingOutcome> {
  const live = await liveSubscriptionIds(deps.db, userId);
  if (!live.length || !deps.billing.configured) return { cancelled: [], leftForOperator: live };
  const prorate = deps.config?.billingCancelProrate ?? false;
  const cancelled: string[] = [];
  const leftForOperator: string[] = [];
  for (const id of live) {
    try {
      const r = await deps.billing.cancelSubscription(id, { prorate });
      if (r.status === 'canceled') cancelled.push(id);
      else leftForOperator.push(id);
    } catch (err) {
      console.warn(`could not cancel subscription ${id} for a deleted account: ${(err as Error).message}`);
      leftForOperator.push(id);
    }
  }
  return { cancelled, leftForOperator };
}
