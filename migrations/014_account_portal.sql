-- Accounts — "your typesetting portal" (/account).
--
-- users.email_confirmed_at: when the writer proved they read mail at
-- users.email (null = not confirmed yet). Accounts that existed before
-- this migration start unconfirmed: nothing proved their address. An
-- unconfirmed account keeps working exactly as before — confirming is
-- never a gate on writing, saving, exporting or the trial.
alter table users add column email_confirmed_at timestamptz;

-- email_confirmations: the links in confirmation emails, like
-- password_resets. The token itself is only ever in the emailed link;
-- the database keeps its SHA-256 hash. Single-use (used_at), expiring
-- (expires_at, set by the app).
--   purpose 'signup'  confirms users.email as it is (sent at sign-up
--                     and on "send the link again").
--   purpose 'change'  moves the account to `email` (the NEW address)
--                     when the link is followed; users.email does not
--                     change before then.
-- `email` is the address the link was sent to.
create table email_confirmations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  purpose text not null check (purpose in ('signup', 'change')),
  email text not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index email_confirmations_user_id_idx on email_confirmations (user_id);
create index email_confirmations_expires_at_idx on email_confirmations (expires_at);
