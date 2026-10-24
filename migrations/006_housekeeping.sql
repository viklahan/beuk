-- M3: Housekeeping admin surface.
-- is_admin: promoted from the ADMIN_EMAILS env list (synced at register /
-- login; the env list is also honoured directly by the admin gate).
alter table users add column is_admin boolean not null default false;

-- One audit row per Housekeeping action attempted by an admin — actor,
-- action, params summary, result. The actor id is a plain column (no FK):
-- evidence must survive a restore that rewrites the users table; the
-- email snapshot is the durable identifier.
create table housekeeping_audit (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_email text,
  action text not null,
  params_summary jsonb not null default '{}'::jsonb,
  result text not null,
  detail text,
  created_at timestamptz not null default now()
);

create index housekeeping_audit_created_idx on housekeeping_audit (created_at desc);

-- Stored Self-checks runs, stamped with the build they ran against.
-- The promotion gate requires a passing run on the CURRENT build stamp.
create table housekeeping_check_runs (
  id uuid primary key default gen_random_uuid(),
  build_stamp text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  overall text check (overall in ('pass', 'fail')),
  pass_count integer not null default 0,
  fail_count integer not null default 0,
  client_only_count integer not null default 0,
  results jsonb not null default '[]'::jsonb
);

create index housekeeping_check_runs_stamp_idx on housekeeping_check_runs (build_stamp, started_at desc);

-- Human sign-off records for the promotion gate, per build stamp.
create table housekeeping_signoffs (
  id uuid primary key default gen_random_uuid(),
  build_stamp text not null,
  user_id uuid,
  email text,
  note text,
  created_at timestamptz not null default now()
);

create index housekeeping_signoffs_stamp_idx on housekeeping_signoffs (build_stamp, created_at desc);
