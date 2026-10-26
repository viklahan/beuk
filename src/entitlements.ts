import { readFileSync } from 'node:fs';
import type { NextFunction, Request, Response } from 'express';
import type { Config } from './config.js';
import type { Db } from './db.js';

/**
 * Entitlements as data (P1, V 2026-10-25). A JSON file names, per Stripe
 * price id, the entitlements a subscription on that price carries and an
 * optional display label. V's pricing becomes this file plus Stripe
 * Dashboard setup — no code change, no plan names in code:
 *
 *   { "prices": { "price_…": { "label": "…", "entitlements": ["…"] } } }
 *
 * `entitlementsFor` is the ONLY place access is decided.
 *
 * P4 (V): a lapsed or cancelled writer loses NOTHING they wrote. No route
 * that reads, lists, exports or shares a writer's own work may ever be
 * wrapped in `requireEntitlement`.
 *
 * V's pricing (2026-10-26) is one price for complete access after a
 * sign-up trial, so the account's access is decided in src/access.ts
 * (trial + this file's subscription decision): any granting subscription
 * opens everything, and a short list of account features pauses after
 * the trial (ACCESS_RULES there). `requireEntitlement` stays for a
 * pricing that names features; no route uses it.
 */

export interface EntitlementsPrice {
  label: string | null;
  entitlements: string[];
}

export interface EntitlementsTable {
  prices: Record<string, EntitlementsPrice>;
}

export type EntitlementsLoad =
  | { ok: true; table: EntitlementsTable; source: string | null }
  | { ok: false; error: string; source: string };

/** Parse + validate an entitlements document. Exported for tests. */
export function parseEntitlements(raw: unknown): EntitlementsTable {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('top level must be an object');
  const prices = (raw as Record<string, unknown>).prices;
  if (!prices || typeof prices !== 'object' || Array.isArray(prices)) {
    throw new Error('"prices" must be an object keyed by Stripe price id');
  }
  const out: Record<string, EntitlementsPrice> = {};
  for (const [priceId, value] of Object.entries(prices as Record<string, unknown>)) {
    if (!/^price_[A-Za-z0-9_]+$/.test(priceId)) throw new Error(`"${priceId}" is not a Stripe price id (price_…)`);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${priceId}: must be an object`);
    const v = value as Record<string, unknown>;
    const ents = v.entitlements;
    if (!Array.isArray(ents) || !ents.every((e) => typeof e === 'string' && /^[a-z0-9][a-z0-9._-]*$/.test(e))) {
      throw new Error(`${priceId}: "entitlements" must be an array of lowercase names`);
    }
    if (v.label !== undefined && v.label !== null && (typeof v.label !== 'string' || !v.label.trim())) {
      throw new Error(`${priceId}: "label" must be a non-empty string when present`);
    }
    out[priceId] = {
      label: typeof v.label === 'string' ? v.label.trim() : null,
      entitlements: [...new Set(ents as string[])],
    };
  }
  return { prices: out };
}

/** Load ENTITLEMENTS_FILE once. No file configured = an empty table
 *  (nothing granted, nothing gated) — said so, never an error. */
export function loadEntitlements(config: Config): EntitlementsLoad {
  if (!config.entitlementsFile) return { ok: true, table: { prices: {} }, source: null };
  try {
    const table = parseEntitlements(JSON.parse(readFileSync(config.entitlementsFile, 'utf8')));
    return { ok: true, table, source: config.entitlementsFile };
  } catch (err) {
    return { ok: false, error: (err as Error).message, source: config.entitlementsFile };
  }
}

/** Stripe subscription statuses (https://docs.stripe.com/api/subscriptions/object).
 *  Policy, per https://docs.stripe.com/billing/subscriptions/webhooks
 *  ("Catch subscription status changes"):
 *  - trialing: "you can safely provision your product"; active: "in good standing".
 *  - past_due: Stripe "might retry payment"; V's P2 keeps access for a
 *    configurable grace (BILLING_GRACE_DAYS, default 7).
 *  - canceled / unpaid: "When a subscription changes to canceled or
 *    unpaid, revoke access to your product."
 *  - incomplete / incomplete_expired: the first payment has not
 *    succeeded; paused: no invoices, no payment. No access. */
export const GRANTING_STATUSES = ['active', 'trialing'] as const;
export const GRACE_STATUSES = ['past_due'] as const;
/** Statuses after which a NEW checkout is allowed (no live subscription). */
export const TERMINAL_STATUSES = ['canceled', 'incomplete_expired'] as const;

export interface SubscriptionRow {
  stripe_subscription_id: string;
  status: string;
  status_since: string | Date;
  price_ids: string[];
  current_period_end: string | Date | null;
  cancel_at_period_end: boolean;
  livemode: boolean;
  updated_at: string | Date;
}

export interface EntitlementState {
  /** The deciding subscription's Stripe status, or 'none'. */
  status: string;
  /** Whether that status currently grants (incl. inside grace). */
  granted: boolean;
  entitlements: string[];
  /** Display label from the entitlements file (null when none). */
  label: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  /** past_due only: when the grace period ends. */
  graceEndsAt: string | null;
  livemode: boolean | null;
}

const DAY_MS = 86_400_000;

function iso(v: string | Date | null): string | null {
  if (v === null) return null;
  return new Date(v).toISOString();
}

/** Pure decision over stored rows. Exported for table tests. */
export function decideEntitlements(
  rows: SubscriptionRow[],
  table: EntitlementsTable,
  graceDays: number,
  now: Date,
): EntitlementState {
  const evaluated = rows.map((row) => {
    let granted = false;
    let graceEndsAt: Date | null = null;
    if ((GRANTING_STATUSES as readonly string[]).includes(row.status)) granted = true;
    else if ((GRACE_STATUSES as readonly string[]).includes(row.status)) {
      graceEndsAt = new Date(new Date(row.status_since).getTime() + graceDays * DAY_MS);
      granted = now.getTime() < graceEndsAt.getTime();
    }
    return { row, granted, graceEndsAt };
  });
  const grantedRows = evaluated.filter((e) => e.granted);
  const entitlements = new Set<string>();
  let label: string | null = null;
  for (const e of grantedRows) {
    for (const pid of e.row.price_ids) {
      const price = table.prices[pid];
      if (!price) continue; // a price not in the file grants nothing
      for (const ent of price.entitlements) entitlements.add(ent);
      label ??= price.label;
    }
  }
  // The deciding row: a granting one if any, else the most recently updated.
  const byRecency = [...evaluated].sort(
    (a, b) => new Date(b.row.updated_at).getTime() - new Date(a.row.updated_at).getTime(),
  );
  const decider = grantedRows[0] ?? byRecency[0];
  if (!decider) {
    return {
      status: 'none',
      granted: false,
      entitlements: [],
      label: null,
      renewsAt: null,
      cancelAtPeriodEnd: false,
      graceEndsAt: null,
      livemode: null,
    };
  }
  return {
    status: decider.row.status,
    granted: decider.granted,
    entitlements: [...entitlements].sort(),
    label,
    renewsAt: iso(decider.row.current_period_end),
    cancelAtPeriodEnd: decider.row.cancel_at_period_end,
    graceEndsAt: decider.graceEndsAt ? decider.graceEndsAt.toISOString() : null,
    livemode: decider.row.livemode,
  };
}

export async function subscriptionRowsFor(db: Db, userId: string): Promise<SubscriptionRow[]> {
  const found = await db.query<SubscriptionRow>(
    `select stripe_subscription_id, status, status_since, price_ids, current_period_end,
            cancel_at_period_end, livemode, updated_at
     from billing_subscriptions where user_id = $1`,
    [userId],
  );
  return found.rows;
}

/** THE access decision. Only rows in the server's own mode count: a
 *  test-mode subscription never grants on a live server (and vice versa). */
export async function entitlementsFor(
  db: Db,
  userId: string,
  opts: { table: EntitlementsTable; graceDays: number; now: Date; livemode: boolean | null },
): Promise<EntitlementState> {
  const rows = (await subscriptionRowsFor(db, userId)).filter(
    (r) => opts.livemode === null || r.livemode === opts.livemode,
  );
  return decideEntitlements(rows, opts.table, opts.graceDays, opts.now);
}

/** Gate ONE feature. Deliberately applied to NO route yet: V's pricing
 *  decides which features are gated (README, Billing). Never apply it to
 *  reading, listing, exporting or sharing a writer's own work (P4). */
export function requireEntitlement(
  db: Db,
  name: string,
  opts: () => { table: EntitlementsTable; graceDays: number; now: Date; livemode: boolean | null },
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: 'not signed in' });
        return;
      }
      const state = await entitlementsFor(db, req.user.id, opts());
      if (!state.entitlements.includes(name)) {
        res.status(402).json({ error: 'not included in your plan', entitlement: name, status: state.status });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
