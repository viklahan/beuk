-- Trial + one price (V, 2026-10-26): a 7-day free trial that starts at
-- account sign-up, then one price for complete access. See src/access.ts.
--
-- trial_ends_at: when this account's free trial ends. Sign-up stamps it
-- (now() + TRIAL_DAYS); the stamp never moves when TRIAL_DAYS changes
-- later. A row without one (restored from an older backup) falls back to
-- created_at + TRIAL_DAYS in src/access.ts.
--
-- Accounts that exist before this migration get created_at + 7 days, as
-- if they had had the trial since sign-up, so an account older than a
-- week has used its trial already. Nothing pauses until billing is
-- switched on (STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET + STRIPE_PRICE_ID).
-- To give every existing account a fresh week on the day billing is
-- switched on, the operator can run this once (README, Billing):
--   update users set trial_ends_at = now() + interval '7 days' where trial_ends_at < now() + interval '7 days';
--
-- trial_reminder_sent_at: when the one "your trial ends soon" email was
-- accepted by the mail server. Null = not sent (it is never set for a
-- message that was not delivered).
alter table users
  add column if not exists trial_ends_at timestamptz,
  add column if not exists trial_reminder_sent_at timestamptz;

update users set trial_ends_at = created_at + interval '7 days' where trial_ends_at is null;
