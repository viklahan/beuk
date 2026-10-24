-- P0 #5 account basics: password-reset tokens.
-- The token itself is only ever in the emailed link; the database keeps
-- its SHA-256 hash. Single-use (used_at), 60-minute expiry (expires_at,
-- set by the app as now() + 60 minutes).
create table password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index password_resets_user_id_idx on password_resets (user_id);
create index password_resets_expires_at_idx on password_resets (expires_at);
