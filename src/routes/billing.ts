import { Router, type Request } from 'express';
import type { BillingProvider } from '../billing.js';
import { processVerifiedEvent, type SyncDeps } from '../billing-sync.js';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { readCookie, requireAuth, SESSION_COOKIE, tokenHash } from '../auth.js';
import {
  entitlementsFor,
  loadEntitlements,
  subscriptionRowsFor,
  TERMINAL_STATUSES,
} from '../entitlements.js';

/** Billing endpoints. The one hard rule: billing state changes ONLY
 *  here, from a signature-verified webhook event whose current object is
 *  retrieved from Stripe. No client request can grant anything. */
export function billingRoutes(
  db: Db,
  config: Config,
  billing: BillingProvider,
  now: () => Date = () => new Date(),
): Router {
  const router = Router();
  const loaded = loadEntitlements(config);
  const table = loaded.ok ? loaded.table : { prices: {} };
  const deps: SyncDeps = { db, provider: billing, table, graceDays: config.billingGraceDays, now };
  const serverLivemode = () => (billing.mode === null ? null : billing.mode === 'live');

  /** Prices a checkout may use: the entitlements file's prices, plus
   *  STRIPE_PRICE_ID (the default). Never a price the client invents. */
  const allowedPrices = (): Set<string> => {
    const set = new Set(Object.keys(table.prices));
    if (config.stripePriceId) set.add(config.stripePriceId);
    return set;
  };

  /** Fully configured = keys + price present, the key's mode is
   *  consistent, and the entitlements file (when set) parses. */
  const fullyConfigured = () => billing.checkoutConfigured && loaded.ok;

  async function optionalUser(req: Request): Promise<{ id: string; email: string } | null> {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) return null;
    const found = await db.query<{ id: string; email: string }>(
      `select u.id, u.email from sessions s join users u on u.id = s.user_id
       where s.token_hash = $1 and s.expires_at > now()`,
      [tokenHash(token)],
    );
    return found.rows[0] ?? null;
  }

  // Public: is billing live, and (signed in) what does the server say
  // about this account. The studio shows exactly this — never "you have
  // access" from a redirect alone.
  router.get('/status', async (req, res, next) => {
    try {
      const configured = fullyConfigured();
      const body: Record<string, unknown> = {
        // live = fully configured AND taking real money (live-mode key).
        // Test-mode keys are configured but not live: a TEST MODE badge,
        // and the Ko-fi tip jar stays.
        live: configured && billing.mode === 'live',
        configured,
        mode: billing.mode,
        checkout: configured,
        graceDays: config.billingGraceDays,
      };
      const user = await optionalUser(req);
      if (user) {
        const state = await entitlementsFor(db, user.id, {
          table,
          graceDays: config.billingGraceDays,
          now: now(),
          livemode: serverLivemode(),
        });
        body.account = {
          status: state.status,
          granted: state.granted,
          entitlements: state.entitlements,
          label: state.label,
          renewsAt: state.renewsAt,
          cancelAtPeriodEnd: state.cancelAtPeriodEnd,
          graceEndsAt: state.graceEndsAt,
        };
      }
      return res.json(body);
    } catch (err) {
      return next(err);
    }
  });

  // Start a subscription checkout. Until V sets keys + a price this is a
  // clean 501 — never an error, never a fake success.
  router.post('/checkout', requireAuth(db), async (req, res, next) => {
    try {
      if (!fullyConfigured()) {
        return res.status(501).json({ error: 'billing not configured' });
      }
      const requested = typeof req.body?.priceId === 'string' ? req.body.priceId : null;
      const priceId = requested ?? config.stripePriceId!;
      if (!allowedPrices().has(priceId)) {
        return res.status(400).json({ error: 'unknown price' });
      }
      const userId = req.user!.id;
      // One live subscription per writer: refuse a second checkout while
      // any of their subscriptions is not terminal (past_due / unpaid
      // included — those need the card fixed, not a new subscription).
      const rows = (await subscriptionRowsFor(db, userId)).filter(
        (r) => serverLivemode() === null || r.livemode === serverLivemode(),
      );
      const live = rows.find((r) => !(TERMINAL_STATUSES as readonly string[]).includes(r.status));
      if (live) {
        return res.status(409).json({ error: 'already subscribed', status: live.status });
      }
      const customer = await db.query<{ stripe_customer_id: string | null }>(
        'select stripe_customer_id from users where id = $1',
        [userId],
      );
      const session = await billing.createCheckoutSession({
        userId,
        email: req.user!.email,
        priceId,
        customerId: customer.rows[0]?.stripe_customer_id ?? null,
      });
      return res.json({ url: session.url });
    } catch (err) {
      return next(err);
    }
  });

  // Stripe calls this — unauthenticated by design; the signature IS the
  // authentication. req.body is the RAW body (app.ts mounts an
  // express.raw parser on this exact path before the global JSON parser;
  // signature verification over re-serialized JSON would fail).
  router.post('/webhook', async (req, res, next) => {
    try {
      if (!billing.configured) {
        return res.status(501).json({ error: 'billing not configured' });
      }
      const signatureHeader = req.headers['stripe-signature'];
      const event = billing.verifyWebhook(
        req.body as Buffer,
        Array.isArray(signatureHeader) ? signatureHeader[0] : (signatureHeader ?? null),
      );
      if (!event) return res.status(400).json({ error: 'unverifiable webhook event' });
      return res.json(await processVerifiedEvent(deps, event));
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
