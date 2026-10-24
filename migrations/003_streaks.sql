-- M1: server-verified writing streak.
-- streak_days: one row per day the server itself stamped activity (heartbeat).
-- streak_freezes: ledger of days covered WITHOUT activity — source 'repair'
--   (auto-applied after a missed day, consuming the freeze balance),
--   'pause' (planned ahead, does not consume balance), 'grant' (manual).
-- streak_state: per-user freeze balance. New accounts start with 1 freeze:
--   the streak is forgiving by design.
create table streak_days (
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table streak_freezes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  day date not null,
  source text not null check (source in ('repair', 'pause', 'grant')),
  created_at timestamptz not null default now(),
  unique (user_id, day)
);

create table streak_state (
  user_id uuid primary key references users(id) on delete cascade,
  freezes_available integer not null default 1 check (freezes_available >= 0),
  updated_at timestamptz not null default now()
);
