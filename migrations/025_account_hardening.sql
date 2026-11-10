-- Account hardening (premium feature 4): optional two-step sign-in
-- (TOTP, RFC 6238) with recovery codes, the sign-in code step, and
-- "where you're signed in". Every new table goes with the account
-- (on delete cascade, and deleted explicitly by "Delete my account").

-- One row per account that has started or finished setting up two-step.
-- enabled_at is null while setup is pending (start given, no code yet).
-- secret: the 20-byte TOTP key, RFC 4648 base32 without padding.
-- last_step: the highest 30-second step a code was accepted for, so a
-- code can never be used twice (replay protection).
create table user_two_step (
  user_id uuid primary key references users(id) on delete cascade,
  secret text not null,
  enabled_at timestamptz,
  last_step bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Ten single-use recovery codes per account, stored only as the
-- lowercase-hex SHA-256 of the normalized code (uppercase, no spaces or
-- dashes). used_at is set when a code is spent.
create table two_step_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code_hash text not null unique,
  used_at timestamptz
);
create index two_step_recovery_codes_user_idx on two_step_recovery_codes (user_id);

-- The step between the right password and the code: a 32-byte token
-- (base64url) given to the browser, stored here only as its SHA-256.
-- It lives 5 minutes and allows 5 codes.
create table sign_in_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
create index sign_in_challenges_user_idx on sign_in_challenges (user_id);
create index sign_in_challenges_expires_at_idx on sign_in_challenges (expires_at);

-- Where you're signed in: a coarse device label ("Firefox on Windows",
-- no versions) and when the session was last active. Never an IP address.
alter table sessions add column label text, add column last_seen_at timestamptz;
