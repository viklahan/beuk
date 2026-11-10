import type { NextFunction, Request, Response } from 'express';
import { readCookie, SESSION_COOKIE, tokenHash } from './auth.js';
import type { BillingProvider } from './billing.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { entitlementsFor, loadEntitlements, type EntitlementsLoad, type EntitlementState } from './entitlements.js';

/**
 * Trial + one price (V, 2026-10-26, rules re-decided 2026-10-30): an account
 * from day one, 21 days of everything (TRIAL_DAYS, default 21), then ONE
 * price for everything. After day 21 unpaid, the store-ready files and the
 * account features lock, and the writer's own words stay theirs.
 *
 * This file is the ONLY place the account's access is decided. It sits
 * on top of src/entitlements.ts (the subscription decision over verified
 * webhook rows) and adds the trial clock. The server is the judge; the
 * studio only shows copy.
 *
 * The rules are data (ACCESS_RULES below): which account features pause
 * after the trial when there is no subscription, and which routes they
 * cover. Everything not listed is never paused; NEVER_PAUSED names the
 * important ones so the tests can prove it.
 *
 * Open after day 21 unpaid: writing, typesetting, preview, the backup
 * file, Word (.docx), Markdown, books already on the shelf (they keep
 * saving: on some browsers the device copy can be cleared, and the shelf
 * copy is then the only one), archive downloads, existing beta links,
 * Download all my data, and the authorship record (seeing your stamps,
 * GET /api/authorship/stamps, and checking a backup against them,
 * GET /api/authorship/check).
 *
 * Locked after day 21 unpaid (PAUSABLE_FEATURES): the store-ready EPUB,
 * the print PDF, the cover wrap, adding new books to the shelf, new beta
 * links (and refreshing an existing link's copy), server EPUBCheck checks,
 * the server-made print-ready PDF (the pdfx job, export.print), saving
 * new files to the archive, and new authorship stamps (POST
 * /api/authorship/stamps, authorship.stamp: the export itself still
 * happens, only the stamp is skipped), and turning on two-step sign-in
 * (twoStep.setup: start + enable; two-step already on stays on, and
 * signing in with it, turning it off and new recovery codes are never
 * paused). export.epub is the server-built store-ready
 * EPUB (POST /api/epub, Step 3 part 3); export.wrap is the server-built
 * cover wrap (POST /api/wrap, part 4).
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
  'jobs.run': 'server EPUBCheck checks',
  'archive.upload': 'saving new files to your export archive',
  'export.epub': 'store-ready EPUB files',
  'export.print': 'print-ready PDFs',
  'export.wrap': 'cover wraps',
  'authorship.stamp': 'new authorship stamps',
  'twoStep.setup': 'turning on two-step sign-in',
} as const;
export type PausableFeature = keyof typeof PAUSABLE_FEATURES;

/** Route → feature. Mounted in src/app.ts in front of the routers. */
export const ACCESS_RULES: ReadonlyArray<{ method: 'POST'; path: string; feature: PausableFeature }> = [
  { method: 'POST', path: '/api/manuscripts', feature: 'shelf.add' },
  { method: 'POST', path: '/api/shares', feature: 'shares.create' },
  { method: 'POST', path: '/api/shares/:id/republish', feature: 'shares.create' },
  { method: 'POST', path: '/api/shares/:id/readers', feature: 'shares.create' },
  { method: 'POST', path: '/api/jobs/epubcheck', feature: 'jobs.run' },
  { method: 'POST', path: '/api/jobs/pdfx', feature: 'export.print' },
  { method: 'POST', path: '/api/epub', feature: 'export.epub' },
  { method: 'POST', path: '/api/wrap', feature: 'export.wrap' },
  { method: 'POST', path: '/api/exports', feature: 'archive.upload' },
  { method: 'POST', path: '/api/authorship/stamps', feature: 'authorship.stamp' },
  { method: 'POST', path: '/api/account/two-step/start', feature: 'twoStep.setup' },
  { method: 'POST', path: '/api/account/two-step/enable', feature: 'twoStep.setup' },
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
  { method: 'GET', path: '/api/shares/:id/readers', why: 'see your named reading links' },
  { method: 'PUT', path: '/api/shares/:id/readers/:rid', why: 'change when a named link ends' },
  { method: 'POST', path: '/api/shares/:id/readers/:rid/revoke', why: 'close a named link' },
  { method: 'POST', path: '/api/shares/:id/close-open', why: 'close the open link' },
  { method: 'GET', path: '/api/shares/:id/comments', why: 'read readers’ comments' },
  { method: 'GET', path: '/read/:token', why: 'readers keep reading an existing link' },
  { method: 'POST', path: '/read/:token/comments', why: 'readers keep commenting on an existing link' },
  { method: 'GET', path: '/api/account/export', why: 'Download all my data' },
  { method: 'POST', path: '/api/account/delete', why: 'delete the account' },
  { method: 'GET', path: '/api/authorship/stamps', why: 'see your authorship record' },
  { method: 'GET', path: '/api/authorship/check', why: 'check a backup against your record' },
  { method: 'POST', path: '/api/auth/login', why: 'sign in' },
  { method: 'POST', path: '/api/auth/login/code', why: 'sign in with two-step already on' },
  { method: 'POST', path: '/api/account/two-step/disable', why: 'turn two-step sign-in off' },
  { method: 'POST', path: '/api/account/two-step/recovery-codes', why: 'get new recovery codes' },
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

/** What the studio is told about an account's access (GET /api/auth/me).
 *  The server stays the judge; the studio only shows copy from this.
 *  `daysLeft` is the free-trial days left while the state is 'trial', else 0.
 *  `locked` is every pausable feature while 'paused', else empty. */
export interface AccessSummary {
  state: AccessState;
  daysLeft: number;
  locked: PausableFeature[];
}

export function accessSummary(access: AccountAccess): AccessSummary {
  return {
    state: access.state,
    daysLeft: access.state === 'trial' ? access.trial.daysLeft : 0,
    locked: access.state === 'paused' ? (Object.keys(PAUSABLE_FEATURES) as PausableFeature[]) : [],
  };
}

/** The 402 a paused feature answers. Plain words: some studio paths show
 *  the server's `error` text as it is. */
export function pausedBody(feature: PausableFeature): Record<string, unknown> {
  return {
    error: `Your free trial has ended, so ${PAUSABLE_FEATURES[feature]} is paused until you choose a plan. You can still write, typeset and preview, and download your own words any time: the backup file, Word and Markdown, and Download all my data.`,
    paused: true,
    feature,
    // Store-ready exports lock; the writer's own words never do.
    exportOpen: false,
    ownWordsOpen: true,
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
