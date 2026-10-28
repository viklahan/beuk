import type { NextFunction, Request, Response } from 'express';
import { readCookie, SESSION_COOKIE, tokenHash } from './auth.js';
import type { BillingProvider } from './billing.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { entitlementsFor, loadEntitlements, type EntitlementsLoad, type EntitlementState } from './entitlements.js';

/**
 * Trial + one price (V, 2026-10-26): a free trial that starts at account
 * sign-up (TRIAL_DAYS, default 7), then ONE price for complete access.
 * Writing on a device never needs an account, and export always stays
 * open ("never hold a book hostage").
 *
 * This file is the ONLY place the account's access is decided. It sits
 * on top of src/entitlements.ts (the subscription decision over verified
 * webhook rows) and adds the trial clock.
 *
 * The rules are data (ACCESS_RULES below): which account features pause
 * after the trial when there is no subscription, and which routes they
 * cover. Everything not listed is never paused; NEVER_PAUSED names the
 * important ones so the tests can prove it.
 *
 * Why these four, and why not the shelf copy of a book already there:
 * the writer's text must never be lost. The device copy always saves (it
 * never talks to the server). A book ALREADY on the shelf keeps saving
 * there too (PUT /api/manuscripts/:id is never paused): on some browsers
 * the device copy can be cleared, and the shelf copy is then the only
 * one, so pausing it could cost a writer their latest pages. What pauses
 * is adding NEW books to the shelf, new beta-reader links (and refreshing
 * an existing link's copy), server EPUBCheck / PDF/X checks, and saving
 * new files into the export archive. Every export from the studio is
 * made on the device and never asks the server.
 */

export type AccessState =
  /** Billing is not switched on: everything is open, nothing is said about plans. */
  | 'open'
  /** Inside the free trial (and no subscription that decides otherwise). */
  | 'trial'
  /** A subscription Stripe reports as active or trialing. */
  | 'subscribed'
  /** past_due inside BILLING_GRACE_DAYS: still everything, with a calm notice. */
  | 'grace'
  /** After the trial without a granting subscription: account features pause. */
  | 'paused';

export interface AccountTrial {
  startedAt: string;
  endsAt: string;
  /** true while now < endsAt. */
  active: boolean;
  /** Whole days left, rounded up (0 once it has ended). */
  daysLeft: number;
}

export interface AccountAccess {
  /** Billing switched on: keys + webhook secret + STRIPE_PRICE_ID, a
   *  consistent key mode, and a valid entitlements file when one is set. */
  billingOn: boolean;
  state: AccessState;
  trial: AccountTrial;
  subscription: EntitlementState;
  /** BILLING_PRICE_LABEL, only while billing is on. Never a made-up price. */
  priceLabel: string | null;
}

/** The account features that pause, and what they are called for people. */
export const PAUSABLE_FEATURES = {
  'shelf.add': 'adding new books to your shelf',
  'shares.create': 'new beta-reader links',
  'jobs.run': 'server EPUBCheck and PDF/X checks',
  'archive.upload': 'saving new files to your export archive',
} as const;
export type PausableFeature = keyof typeof PAUSABLE_FEATURES;

/** Route → feature. Mounted in src/app.ts in front of the routers. */
export const ACCESS_RULES: ReadonlyArray<{ method: 'POST'; path: string; feature: PausableFeature }> = [
  { method: 'POST', path: '/api/manuscripts', feature: 'shelf.add' },
  { method: 'POST', path: '/api/shares', feature: 'shares.create' },
  { method: 'POST', path: '/api/shares/:id/republish', feature: 'shares.create' },
  { method: 'POST', path: '/api/jobs/epubcheck', feature: 'jobs.run' },
  { method: 'POST', path: '/api/jobs/pdfx', feature: 'jobs.run' },
  { method: 'POST', path: '/api/exports', feature: 'archive.upload' },
];

/** Never paused, whatever the plan (tested route by route). */
export const NEVER_PAUSED: ReadonlyArray<{ method: string; path: string; why: string }> = [
  { method: 'GET', path: '/api/manuscripts', why: 'list your shelf' },
  { method: 'GET', path: '/api/manuscripts/:id', why: 'open a shelf book' },
  { method: 'PUT', path: '/api/manuscripts/:id', why: 'keep saving a book already on the shelf' },
  { method: 'DELETE', path: '/api/manuscripts/:id', why: 'remove a shelf book' },
  { method: 'POST', path: '/api/pictures/missing', why: 'save the pictures of a book already on the shelf' },
  { method: 'PUT', path: '/api/pictures/:sha', why: 'save the pictures of a book already on the shelf' },
  { method: 'GET', path: '/api/pictures/:sha', why: 'open a shelf book with its pictures' },
  { method: 'GET', path: '/api/exports', why: 'list the archive' },
  { method: 'GET', path: '/api/exports/:id/download', why: 'download an archived file' },
  { method: 'DELETE', path: '/api/exports/:id', why: 'remove an archived file' },
  { method: 'GET', path: '/api/jobs/:id', why: 'read a check result' },
  { method: 'GET', path: '/api/shares', why: 'see your reading links' },
  { method: 'PUT', path: '/api/shares/:id', why: 'change or close a link' },
  { method: 'POST', path: '/api/shares/:id/revoke', why: 'close a link' },
  { method: 'GET', path: '/api/shares/:id/comments', why: 'read readers’ comments' },
  { method: 'GET', path: '/read/:token', why: 'readers keep reading an existing link' },
  { method: 'POST', path: '/read/:token/comments', why: 'readers keep commenting on an existing link' },
  { method: 'GET', path: '/api/account/export', why: 'Download all my data' },
  { method: 'POST', path: '/api/account/delete', why: 'delete the account' },
];

const DAY_MS = 86_400_000;

/** Stripe: subscription_data.trial_end "Has to be at least 48 hours in
 *  the future" (https://docs.stripe.com/api/checkout/sessions/create,
 *  checked 2026-10-26). One hour of margin for the time on the page. */
export const TRIAL_END_MIN_MS = 49 * 3_600_000;

export interface AccessDeps {
  db: Db;
  config: Config;
  billing: BillingProvider;
  now: () => Date;
}

/** The entitlements file is read once per Config (as src/routes/billing.ts
 *  does at start-up): a change to it needs a restart. */
const loadedFor = new WeakMap<Config, EntitlementsLoad>();
function entitlementsOf(config: Config): EntitlementsLoad {
  let loaded = loadedFor.get(config);
  if (!loaded) {
    loaded = loadEntitlements(config);
    loadedFor.set(config, loaded);
  }
  return loaded;
}

/** Billing is switched on for this server. */
export function billingSwitchedOn(config: Config, billing: BillingProvider): boolean {
  return billing.checkoutConfigured && entitlementsOf(config).ok;
}

/** The trial for one account. Pure; exported for tests. */
export function trialFor(
  user: { createdAt: string | Date; trialEndsAt: string | Date | null },
  trialDays: number,
  now: Date,
): AccountTrial {
  const started = new Date(user.createdAt);
  const ends = user.trialEndsAt ? new Date(user.trialEndsAt) : new Date(started.getTime() + trialDays * DAY_MS);
  const left = ends.getTime() - now.getTime();
  return {
    startedAt: started.toISOString(),
    endsAt: ends.toISOString(),
    active: left > 0,
    daysLeft: left > 0 ? Math.ceil(left / DAY_MS) : 0,
  };
}

/** The derived access. Pure; exported for tests. */
export function decideAccess(billingOn: boolean, trial: AccountTrial, subscription: EntitlementState): AccessState {
  if (!billingOn) return 'open';
  if (subscription.granted) return subscription.graceEndsAt ? 'grace' : 'subscribed';
  if (trial.active) return 'trial';
  return 'paused';
}

/** Everything this server decides about one account's access. Null when
 *  the account does not exist. */
export async function accountAccess(deps: AccessDeps, userId: string): Promise<AccountAccess | null> {
  const row = (
    await deps.db.query<{ created_at: string | Date; trial_ends_at: string | Date | null }>(
      'select created_at, trial_ends_at from users where id = $1',
      [userId],
    )
  ).rows[0];
  if (!row) return null;
  const loaded = entitlementsOf(deps.config);
  const table = loaded.ok ? loaded.table : { prices: {} };
  const mode = deps.billing.mode;
  const now = deps.now();
  const subscription = await entitlementsFor(deps.db, userId, {
    table,
    graceDays: deps.config.billingGraceDays,
    now,
    livemode: mode === null ? null : mode === 'live',
  });
  const billingOn = deps.billing.checkoutConfigured && loaded.ok;
  const trial = trialFor({ createdAt: row.created_at, trialEndsAt: row.trial_ends_at }, deps.config.trialDays, now);
  return {
    billingOn,
    state: decideAccess(billingOn, trial, subscription),
    trial,
    subscription,
    priceLabel: billingOn ? deps.config.billingPriceLabel : null,
  };
}

/** The 402 a paused feature answers. Plain words: some studio paths show
 *  the server's `error` text as it is. */
export function pausedBody(feature: PausableFeature): Record<string, unknown> {
  return {
    error: `Your free trial has ended, so ${PAUSABLE_FEATURES[feature]} is paused until you choose a plan. Writing, the books on your shelf and every export still work.`,
    paused: true,
    feature,
    exportOpen: true,
  };
}

/**
 * Express middleware factory: `gate(feature)` answers 402 when the
 * signed-in account's access is 'paused', and otherwise lets the request
 * through untouched. It never answers 401 itself: a request without a
 * valid session goes on to the router, whose requireAuth says so. While
 * billing is off it does no database work at all.
 */
export function accessGate(deps: AccessDeps) {
  return (feature: PausableFeature) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!billingSwitchedOn(deps.config, deps.billing)) return next();
        const token = readCookie(req, SESSION_COOKIE);
        if (!token) return next();
        const found = await deps.db.query<{ id: string }>(
          `select u.id from sessions s join users u on u.id = s.user_id
           where s.token_hash = $1 and s.expires_at > now()`,
          [tokenHash(token)],
        );
        const userId = found.rows[0]?.id;
        if (!userId) return next();
        const access = await accountAccess(deps, userId);
        if (access?.state === 'paused') {
          res.status(402).json(pausedBody(feature));
          return;
        }
        next();
      } catch (err) {
        next(err);
      }
    };
}
