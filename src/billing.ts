import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';

/** Billing sits behind this interface so the routes never talk to a
 *  provider directly. M2 ships exactly one implementation (Stripe).
 *  Nothing here is a live integration until Vik sets a price and keys:
 *  `configured` is false and the routes answer 501 until then. */
export interface BillingProvider {
  /** True when every key needed for signed webhooks is present. */
  readonly configured: boolean;
  /** True when checkout can be offered (webhooks + price + API key). */
  readonly checkoutConfigured: boolean;
  /** Verify a webhook delivery's signature against the RAW request body.
   *  Returns the parsed event, or null when the delivery is unsigned or
   *  unverifiable — callers must treat null as "change nothing". */
  verifyWebhook(rawBody: Buffer, signatureHeader: string | null): BillingEvent | null;
  /** Create a hosted checkout session for a subscription; returns its URL. */
  createCheckoutSession(args: {
    userId: string;
    email: string;
  }): Promise<{ url: string }>;
}

export interface BillingEvent {
  type: string;
  data: { object: Record<string, unknown> };
}

/** What a webhook event means for a user's plan, after user resolution
 *  hints are pulled out of the event payload. null = event is not one we
 *  act on. */
export interface PlanChange {
  plan: 'free' | 'pro';
  /** Ways to find the user, in route-side priority order. */
  userId: string | null;
  customerId: string | null;
  email: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Pure mapping: Stripe event → plan change (or null to ignore). Exported
 *  for tests. Subscription statuses that mean "paying" are active and
 *  trialing; anything else (canceled, unpaid, incomplete_expired, paused…)
 *  drops the plan to free, as does a deleted subscription. */
export function planChangeFromEvent(event: BillingEvent): PlanChange | null {
  const obj = event.data?.object ?? {};
  const metadata = (obj.metadata ?? {}) as Record<string, unknown>;
  const customerDetails = (obj.customer_details ?? {}) as Record<string, unknown>;
  const hints = {
    userId: str(metadata.userId) ?? str(obj.client_reference_id),
    customerId: str(obj.customer),
    email: str(customerDetails.email) ?? str(obj.customer_email) ?? str(metadata.email),
  };
  switch (event.type) {
    case 'checkout.session.completed':
      return { plan: 'pro', ...hints };
    case 'customer.subscription.updated': {
      const status = str(obj.status);
      return { plan: status === 'active' || status === 'trialing' ? 'pro' : 'free', ...hints };
    }
    case 'customer.subscription.deleted':
      return { plan: 'free', ...hints };
    default:
      return null;
  }
}

const SIGNATURE_TOLERANCE_SECONDS = 300; // Stripe's default replay window.

export class StripeBillingProvider implements BillingProvider {
  constructor(private config: Config) {}

  get configured(): boolean {
    return this.config.stripeWebhookSecret !== null;
  }

  get checkoutConfigured(): boolean {
    return (
      this.config.stripeWebhookSecret !== null &&
      this.config.stripeSecretKey !== null &&
      this.config.stripePriceId !== null
    );
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string | null): BillingEvent | null {
    const secret = this.config.stripeWebhookSecret;
    if (!secret || !signatureHeader) return null;

    // Header shape: t=<unix seconds>,v1=<hex hmac>[,v1=<older secret's sig>…]
    let timestamp: string | null = null;
    const signatures: string[] = [];
    for (const part of signatureHeader.split(',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (key === 't') timestamp = value;
      if (key === 'v1') signatures.push(value);
    }
    if (!timestamp || signatures.length === 0) return null;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) return null;
    if (Math.abs(Date.now() / 1000 - ts) > SIGNATURE_TOLERANCE_SECONDS) return null;

    // Stripe signs "<timestamp>.<raw body>" with HMAC-SHA256.
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    const matched = signatures.some((sig) => {
      let candidate: Buffer;
      try {
        candidate = Buffer.from(sig, 'hex');
      } catch {
        return false;
      }
      return candidate.length === expected.length && timingSafeEqual(candidate, expected);
    });
    if (!matched) return null;

    try {
      const parsed = JSON.parse(rawBody.toString('utf8')) as BillingEvent;
      if (typeof parsed?.type !== 'string' || typeof parsed?.data?.object !== 'object')
        return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async createCheckoutSession(args: { userId: string; email: string }): Promise<{ url: string }> {
    // Only reachable when checkoutConfigured. Plain HTTPS call to the
    // Stripe API (form-encoded, like their REST API expects) — no SDK.
    const form = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': this.config.stripePriceId!,
      'line_items[0][quantity]': '1',
      customer_email: args.email,
      client_reference_id: args.userId,
      'metadata[userId]': args.userId,
      success_url: `${this.config.appBaseUrl}/?billing=success`,
      cancel_url: `${this.config.appBaseUrl}/?billing=cancelled`,
    });
    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.stripeSecretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
    const payload = (await response.json().catch(() => null)) as { url?: string } | null;
    if (!response.ok || !payload?.url) {
      throw new Error(`stripe checkout session failed (${response.status})`);
    }
    return { url: payload.url };
  }
}
