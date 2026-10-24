-- M2: billing hooks. Users gain a plan; the plan changes ONLY from
-- signature-verified billing webhook events (see src/routes/billing.ts),
-- never from a client request. stripe_customer_id links subscription
-- events (which carry only a customer id) back to the user.
alter table users
  add column plan text not null default 'free' check (plan in ('free', 'pro')),
  add column plan_updated_at timestamptz,
  add column stripe_customer_id text unique;
