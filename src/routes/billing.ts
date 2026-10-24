import { Router } from 'express';
import type { BillingProvider } from '../billing.js';
import { planChangeFromEvent } from '../billing.js';
import type { Db } from '../db.js';
import { requireAuth } from '../auth.js';

interface UserPlanRow {
  id: string;
  plan: string;
  plan_updated_at: string | null;
}

/** Billing endpoints. The one hard rule: a plan changes ONLY here, from a
 *  signature-verified webhook event. No client request can flip a plan. */
export function billingRoutes(db: Db, billing: BillingProvider): Router {
  const router = Router();

  // Start a subscription checkout. Until Vik sets a price + keys this is
  // a clean 501 — never an error, never a fake success.
  router.post('/checkout', requireAuth(db), async (req, res, next) => {
    try {
      if (!billing.checkoutConfigured) {
        return res.status(501).json({ error: 'billing not configured' });
      }
      const session = await billing.createCheckoutSession({
        userId: req.user!.id,
        email: req.user!.email,
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

      const change = planChangeFromEvent(event);
      if (!change) return res.json({ received: true, ignored: true });

      // Resolve the user: explicit id from checkout, then the Stripe
      // customer id we stored earlier, then the email on the event.
      let user: UserPlanRow | undefined;
      if (change.userId) {
        const found = await db.query<UserPlanRow>(
          'select id, plan, plan_updated_at from users where id = $1',
          [change.userId],
        );
        user = found.rows[0];
      }
      if (!user && change.customerId) {
        const found = await db.query<UserPlanRow>(
          'select id, plan, plan_updated_at from users where stripe_customer_id = $1',
          [change.customerId],
        );
        user = found.rows[0];
      }
      if (!user && change.email) {
        const found = await db.query<UserPlanRow>(
          'select id, plan, plan_updated_at from users where email = $1',
          [change.email.toLowerCase()],
        );
        user = found.rows[0];
      }
      // Verified event we cannot attribute: acknowledge it (so the
      // provider stops retrying) but change nothing.
      if (!user) return res.json({ received: true, ignored: true });

      await db.query(
        `update users set plan = $2, plan_updated_at = now(),
           stripe_customer_id = coalesce($3, stripe_customer_id)
         where id = $1`,
        [user.id, change.plan, change.customerId],
      );
      return res.json({ received: true, plan: change.plan });
    } catch (err) {
      return next(err);
    }
  });

  return router;
}
