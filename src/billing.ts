import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.js';

/** Billing sits behind this interface so the routes never talk to a
 *  provider directly. One implementation ships (Stripe, plain HTTPS, no
 *  SDK). Nothing here is a live integration until V sets keys and a
 *  price: `configured` is false and the routes answer 501 until then.
 *
 *  Design (docs/plan-billing-backups-restore-branding.md §3.2): the
 *  webhook body only says WHICH object changed; the server then
 *  RETRIEVES the current Subscription from the Stripe API and stores
 *  that. Stripe: "You can also use the API to retrieve any missing
 *  objects" and "Stripe doesn't guarantee the delivery of events in the
 *  order that they're generated ... Don't use `created` to determine
 *  event order" (https://docs.stripe.com/webhooks#event-ordering), and
 *  "retrieve the associated subscription and confirm that its status is
 *  `active` before extending the customer's access"
 *  (https://docs.stripe.com/billing/subscriptions/webhooks#track-active-subscriptions). */
export interface BillingProvider {
  /** True when signed webhooks can be processed: webhook secret + API
   *  key present (the key is needed to retrieve current state) and the
   *  key's mode does not contradict STRIPE_MODE. */
  readonly configured: boolean;
  /** True when checkout can be offered (configured + a price). */
  readonly checkoutConfigured: boolean;
  /** 'test' | 'live' from the API key prefix; null without a key. */
  readonly mode: StripeMode | null;
  /** Non-null when the configuration contradicts itself (said why). */
  readonly misconfiguration: string | null;
  /** Verify a webhook delivery's signature against the RAW request body.
   *  Returns the parsed event, or null when the delivery is unsigned or
   *  unverifiable — callers must treat null as "change nothing". */
  verifyWebhook(rawBody: Buffer, signatureHeader: string | null): BillingEvent | null;
  /** Create a hosted checkout session for a subscription; returns its URL. */
  createCheckoutSession(args: CheckoutArgs): Promise<{ url: string }>;
  /** GET /v1/subscriptions/:id — the current Subscription. */
  retrieveSubscription(id: string): Promise<StripeSubscription>;
  /** GET /v1/subscriptions?customer=…&status=all — every subscription of
   *  one customer, any status. */
  listCustomerSubscriptionIds(customerId: string): Promise<string[]>;
  /** GET /v1/charges/:id — used to find the customer behind a dispute. */
  retrieveCharge(id: string): Promise<{ id: string; customer: string | null; livemode: boolean }>;
  /** POST /v1/billing_portal/sessions — a short-lived Customer Portal URL
   *  for one customer (cancel, change card, invoices). */
  createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** DELETE /v1/subscriptions/:id — cancel now. Stripe: "Cancels a
   *  customer's subscription immediately. The customer won't be charged
   *  again for the subscription." `prorate`: "Will generate a proration
   *  invoice item that credits remaining unused time until the
   *  subscription period end. Defaults to false."
   *  (https://docs.stripe.com/api/subscriptions/cancel, checked 2026-10-26). */
  cancelSubscription(id: string, opts: { prorate: boolean }): Promise<{ status: string }>;
}

export type StripeMode = 'test' | 'live';

export interface CheckoutArgs {
  userId: string;
  email: string;
  priceId: string;
  /** The Stripe customer this user already has, if any. Reusing it
   *  stops every checkout from minting a new Customer (create-session
   *  docs: "If blank for Checkout Sessions in `subscription` mode ...
   *  Checkout will create a new Customer object",
   *  https://docs.stripe.com/api/checkout/sessions/create). */
  customerId: string | null;
  /** Beuk's own trial end, when the writer subscribes inside it. Passed
   *  as subscription_data[trial_end] so the first charge waits for the
   *  end of the trial they already have: the trial is never counted
   *  twice (no Stripe trial on top) and never cut short. Null = charge
   *  now. Stripe requires it to be "at least 48 hours in the future"
   *  (create-session reference, checked 2026-10-26). */
  trialEnd: Date | null;
  /** automatic_tax[enabled]=true (BILLING_AUTOMATIC_TAX). */
  automaticTax: boolean;
}

export interface BillingEvent {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
}

/** The fields of a Stripe Subscription this server stores
 *  (https://docs.stripe.com/api/subscriptions/object). */
export interface StripeSubscription {
  id: string;
  customer: string;
  status: string;
  livemode: boolean;
  cancelAtPeriodEnd: boolean;
  /** Newer API versions carry current_period_end on each subscription
   *  item (see the object reference); older ones at the top level. The
   *  earliest item end is used, falling back to the top-level field. */
  currentPeriodEnd: Date | null;
  priceIds: string[];
  metadataUserId: string | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Mode from a Stripe API key prefix. Stripe: sandbox keys start with
 *  `sk_test_` / `rk_test_`; live keys with `sk_live_` / `rk_live_`
 *  (https://docs.stripe.com/keys). Anything else: null (unknown). */
export function modeFromKey(key: string | null): StripeMode | null {
  if (!key) return null;
  if (/^(sk|rk)_live_/.test(key)) return 'live';
  if (/^(sk|rk)_test_/.test(key)) return 'test';
  return null;
}

/** Parse a Subscription API object into the stored shape. Exported for
 *  tests. Throws on a body that is not a subscription. */
export function parseSubscription(raw: Record<string, unknown>): StripeSubscription {
  const id = str(raw.id);
  const customerField = raw.customer;
  const customer =
    str(customerField) ??
    (customerField && typeof customerField === 'object'
      ? str((customerField as Record<string, unknown>).id)
      : null);
  const status = str(raw.status);
  if (!id || !customer || !status || typeof raw.livemode !== 'boolean') {
    throw new Error('stripe returned something that is not a subscription');
  }
  const items = ((raw.items as Record<string, unknown> | undefined)?.data ?? []) as Array<
    Record<string, unknown>
  >;
  const priceIds: string[] = [];
  const ends: number[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const price = item.price as Record<string, unknown> | undefined;
    const pid = str(price?.id);
    if (pid && !priceIds.includes(pid)) priceIds.push(pid);
    if (typeof item.current_period_end === 'number') ends.push(item.current_period_end);
  }
  if (!ends.length && typeof raw.current_period_end === 'number') ends.push(raw.current_period_end);
  const metadata = (raw.metadata ?? {}) as Record<string, unknown>;
  return {
    id,
    customer,
    status,
    livemode: raw.livemode,
    cancelAtPeriodEnd: raw.cancel_at_period_end === true,
    currentPeriodEnd: ends.length ? new Date(Math.min(...ends) * 1000) : null,
    priceIds,
    metadataUserId: str(metadata.userId),
  };
}

const SIGNATURE_TOLERANCE_SECONDS = 300; // Stripe's library default: "a default tolerance of 5 minutes" (https://docs.stripe.com/webhooks#preventing-replay-attacks).

export class StripeBillingProvider implements BillingProvider {
  constructor(private config: Config) {}

  get mode(): StripeMode | null {
    return modeFromKey(this.config.stripeSecretKey);
  }

  get misconfiguration(): string | null {
    const key = this.config.stripeSecretKey;
    if (key && this.mode === null) {
      return 'STRIPE_SECRET_KEY does not start with sk_test_/rk_test_/sk_live_/rk_live_, so its mode is unknown';
    }
    if (key && this.config.stripeMode && this.config.stripeMode !== this.mode) {
      return `STRIPE_MODE=${this.config.stripeMode} but STRIPE_SECRET_KEY is a ${this.mode}-mode key`;
    }
    return null;
  }

  get configured(): boolean {
    return (
      this.config.stripeWebhookSecret !== null &&
      this.config.stripeSecretKey !== null &&
      this.misconfiguration === null
    );
  }

  get checkoutConfigured(): boolean {
    return this.configured && this.config.stripePriceId !== null;
  }

  verifyWebhook(rawBody: Buffer, signatureHeader: string | null): BillingEvent | null {
    const secret = this.config.stripeWebhookSecret;
    if (!secret || !signatureHeader) return null;

    // Header shape: t=<unix seconds>,v1=<hex hmac>[,v1=<older secret's sig>…]
    // Only v1 counts: "ignore all schemes that aren't v1"
    // (https://docs.stripe.com/webhooks#verify-manually).
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
      if (typeof parsed?.id !== 'string' || !parsed.id) return null;
      if (typeof parsed?.type !== 'string' || typeof parsed?.data?.object !== 'object')
        return null;
      // Every Stripe event carries livemode (https://docs.stripe.com/api/events/object).
      // An event without it cannot be placed in a mode, so it is refused.
      if (typeof parsed.livemode !== 'boolean') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async api(method: 'GET' | 'POST' | 'DELETE', pathAndQuery: string, form?: URLSearchParams) {
    const response = await fetch(`${this.config.stripeApiBase}${pathAndQuery}`, {
      method,
      headers: {
        authorization: `Bearer ${this.config.stripeSecretKey}`,
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: form?.toString(),
    });
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response.ok || !payload) {
      // Never echo the payload: it may carry customer data.
      throw new Error(`stripe ${method} ${pathAndQuery.split('?')[0]} failed (${response.status})`);
    }
    return payload;
  }

  async createCheckoutSession(args: CheckoutArgs): Promise<{ url: string }> {
    // Only reachable when checkoutConfigured. Form-encoded, as the
    // Stripe REST API expects. https://docs.stripe.com/api/checkout/sessions/create
    const form = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': args.priceId,
      'line_items[0][quantity]': '1',
      client_reference_id: args.userId,
      'metadata[userId]': args.userId,
      // Carried onto the Subscription itself, so subscription events
      // can be attributed without guessing (subscription_data.metadata).
      'subscription_data[metadata][userId]': args.userId,
      // "Include the {CHECKOUT_SESSION_ID} placeholder in your page's
      // URL" (https://docs.stripe.com/checkout/fulfillment#redirect-hosted-checkout).
      // The landing page shows "confirming…" until /api/billing/status
      // says otherwise; it never claims access on its own.
      // Back to the account page, which waits for verified webhooks.
      success_url: `${this.config.appBaseUrl}/account?billing=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.config.appBaseUrl}/account?billing=cancelled`,
    });
    if (args.customerId) form.set('customer', args.customerId);
    else form.set('customer_email', args.email);
    if (args.trialEnd) form.set('subscription_data[trial_end]', String(Math.floor(args.trialEnd.getTime() / 1000)));
    if (args.automaticTax) {
      // https://docs.stripe.com/tax/checkout/page (checked 2026-10-26):
      // Checkout collects the billing address it needs for tax; with an
      // existing Customer, customer_update[address]=auto saves it there.
      form.set('automatic_tax[enabled]', 'true');
      if (args.customerId) form.set('customer_update[address]', 'auto');
    }
    const payload = await this.api('POST', '/v1/checkout/sessions', form);
    const url = str(payload.url);
    if (!url) throw new Error('stripe checkout session has no url');
    return { url };
  }

  async createPortalSession(args: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    // https://docs.stripe.com/api/customer_portal/sessions/create — with
    // no `configuration`, "the session uses the default configuration",
    // which is saved in the Dashboard (Settings > Billing > Customer portal).
    const form = new URLSearchParams({ customer: args.customerId, return_url: args.returnUrl });
    const payload = await this.api('POST', '/v1/billing_portal/sessions', form);
    const url = str(payload.url);
    if (!url) throw new Error('stripe portal session has no url');
    return { url };
  }

  async cancelSubscription(id: string, opts: { prorate: boolean }): Promise<{ status: string }> {
    const query = opts.prorate ? '?prorate=true' : '';
    const payload = await this.api('DELETE', `/v1/subscriptions/${encodeURIComponent(id)}${query}`);
    return { status: str(payload.status) ?? 'unknown' };
  }

  async retrieveSubscription(id: string): Promise<StripeSubscription> {
    return parseSubscription(await this.api('GET', `/v1/subscriptions/${encodeURIComponent(id)}`));
  }

  async listCustomerSubscriptionIds(customerId: string): Promise<string[]> {
    // "Passing in a value of `all` will return subscriptions of all
    // statuses" (https://docs.stripe.com/api/subscriptions/list); limit
    // max is 100. One writer having >100 subscriptions is not a real
    // case here, so has_more is treated as an error, never silently cut.
    const query = new URLSearchParams({ customer: customerId, status: 'all', limit: '100' });
    const payload = await this.api('GET', `/v1/subscriptions?${query.toString()}`);
    if (payload.has_more === true) throw new Error('customer has more than 100 subscriptions');
    const data = Array.isArray(payload.data) ? (payload.data as Array<Record<string, unknown>>) : [];
    return data.map((s) => str(s.id)).filter((id): id is string => id !== null);
  }

  async retrieveCharge(id: string): Promise<{ id: string; customer: string | null; livemode: boolean }> {
    // https://docs.stripe.com/api/charges/object — `customer`: "ID of the
    // customer this charge is for if one exists."
    const payload = await this.api('GET', `/v1/charges/${encodeURIComponent(id)}`);
    return { id, customer: str(payload.customer), livemode: payload.livemode === true };
  }
}
