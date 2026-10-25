-- Billing plumbing (docs/plan-billing-backups-restore-branding.md §3.2).
-- Principle: store what Stripe says, derive access from data.
--
-- billing_events: the dedupe ledger + audit trail, keyed on the Stripe
-- event id. Stripe: "Webhook endpoints might occasionally receive the
-- same event more than once ... logging the event IDs you've processed,
-- and then not processing already-logged events."
-- https://docs.stripe.com/webhooks#handle-duplicate-events
-- Payloads are NOT stored: only id, type, mode, the object id and what
-- this server did with it.
create table billing_events (
  event_id text primary key,
  type text not null,
  livemode boolean not null,
  object_id text,
  received_at timestamptz not null default now(),
  -- null until handling finished; a delivery whose handling threw stays
  -- null (with `error` set) so Stripe's retry is processed, not skipped.
  processed_at timestamptz,
  attempts integer not null default 1,
  -- what happened: synced | awaiting-payment | ignored-type |
  -- ignored-wrong-mode | ignored-not-subscription | unattributed |
  -- no-subscription | customer-conflict
  outcome text,
  error text,
  user_id uuid references users(id) on delete set null
);
create index billing_events_unprocessed_idx on billing_events (received_at) where processed_at is null;

-- billing_subscriptions: the latest Subscription state as RETRIEVED from
-- the Stripe API (never as carried in an event body), so delivery order
-- does not matter. user_id is null while the subscription cannot be
-- attributed to an account (no email guessing; housekeeping shows it).
create table billing_subscriptions (
  stripe_subscription_id text primary key,
  user_id uuid references users(id) on delete set null,
  stripe_customer_id text not null,
  status text not null,
  -- when this server first saw the current status (the past_due grace
  -- clock starts here; Stripe's object carries no "past_due since").
  status_since timestamptz not null,
  price_ids text[] not null default '{}',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  livemode boolean not null,
  updated_at timestamptz not null default now(),
  last_event_id text
);
create index billing_subscriptions_user_idx on billing_subscriptions (user_id);
create index billing_subscriptions_customer_idx on billing_subscriptions (stripe_customer_id);

-- P1 (V, 2026-10-25): access comes from entitlements data; users.plan is
-- kept only as a cached display label, so it is no longer limited to
-- 'free' | 'pro'.
alter table users drop constraint if exists users_plan_check;
